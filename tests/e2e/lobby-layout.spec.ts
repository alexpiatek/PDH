import { expect, test, type Locator, type Page } from '@playwright/test';

type Viewport = { width: number; height: number };

async function openLobby(page: Page, viewport: Viewport) {
  await page.setViewportSize(viewport);
  await page.goto('/play');
  await expect(page.getByTestId('lobby-shell')).toBeVisible();
}

async function expectInsideViewport(page: Page, locator: Locator) {
  await expect(locator).toBeVisible();

  const box = await locator.boundingBox();
  expect(box, `missing bounding box for ${locator}`).not.toBeNull();

  const viewport = page.viewportSize();
  expect(viewport, 'missing viewport').not.toBeNull();

  expect(box!.width).toBeGreaterThan(0);
  expect(box!.height).toBeGreaterThan(0);
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.y).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1);
}

test.describe('Bondi Poker lobby layout', () => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 375, height: 667 },
  ]) {
    test(`mobile ${viewport.width} keeps create and invitation controls reachable`, async ({
      page,
    }) => {
      await openLobby(page, viewport);
      const create = page.getByRole('button', { name: 'Create a table for friends' });
      await create.scrollIntoViewIfNeeded();
      await expectInsideViewport(page, create);
      await create.click({ trial: true });
      const join = page.getByTestId('join-code-button');
      await join.scrollIntoViewIfNeeded();
      await expectInsideViewport(page, page.getByTestId('join-code-input'));
      await expectInsideViewport(page, join);
      await join.click({ trial: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        viewport.width
      );
    });
  }

  test('desktop puts friend tables first and keeps public play available', async ({ page }) => {
    await openLobby(page, { width: 1280, height: 720 });
    const hero = page.getByTestId('lobby-hero');
    const actions = page.getByTestId('lobby-actions');
    await expect(hero).toBeVisible();
    await expect(actions).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create a table for friends' })).toBeVisible();
    await expect(page.getByTestId('join-code-card')).toBeVisible();
    await expect(page.getByTestId('join-button')).toBeHidden();
    await page.getByText('Looking for a public game?').click();
    await expect(page.getByTestId('join-button')).toBeVisible();
    const heroBox = await hero.boundingBox();
    const actionsBox = await actions.boundingBox();
    expect(heroBox!.x + heroBox!.width).toBeLessThan(actionsBox!.x);
  });

  test('recent tables appear only when the player has visited a table', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'pdh.lobby.recent_tables',
        JSON.stringify([
          { code: 'RZ587G', name: 'Friday poker', updatedAt: '2026-11-03T00:00:00Z' },
        ])
      );
    });
    await openLobby(page, { width: 390, height: 844 });
    const recent = page.getByTestId('recent-tables-card');
    await recent.scrollIntoViewIfNeeded();
    await expect(recent.getByRole('button', { name: /Friday poker/ })).toBeVisible();
    const recentBox = await recent.boundingBox();
    const joinBox = await page.getByTestId('join-code-card').boundingBox();
    expect(recentBox!.y).toBeGreaterThan(joinBox!.y + joinBox!.height);
  });
});
