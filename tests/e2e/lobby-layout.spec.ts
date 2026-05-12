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

async function expectStartsInViewport(page: Page, locator: Locator) {
  await expect(locator).toBeVisible();

  const box = await locator.boundingBox();
  expect(box, `missing bounding box for ${locator}`).not.toBeNull();

  const viewport = page.viewportSize();
  expect(viewport, 'missing viewport').not.toBeNull();

  expect(box!.width).toBeGreaterThan(0);
  expect(box!.height).toBeGreaterThan(0);
  expect(box!.y).toBeGreaterThanOrEqual(-1);
  expect(box!.y).toBeLessThanOrEqual(viewport!.height - 44);
}

test.describe('Bondi Poker lobby layout', () => {
  test('mobile portrait shows primary play controls above the fold', async ({ page }) => {
    await openLobby(page, { width: 390, height: 844 });

    const quickPlayCard = page.getByTestId('quick-play-card');
    const joinCodeCard = page.getByTestId('join-code-card');
    const quickPlayButton = page.getByTestId('join-button');

    await expectInsideViewport(page, page.getByTestId('join-name-input'));
    await expectInsideViewport(page, quickPlayButton);
    await expect(quickPlayButton).toBeEnabled();
    await quickPlayButton.click({ trial: true });

    await expectStartsInViewport(page, joinCodeCard);
    await expect(page.getByTestId('lobby-hero')).toBeHidden();

    const quickBox = await quickPlayCard.boundingBox();
    const joinBox = await joinCodeCard.boundingBox();
    expect(quickBox, 'missing quick play card box').not.toBeNull();
    expect(joinBox, 'missing join code card box').not.toBeNull();
    expect(joinBox!.y).toBeGreaterThan(quickBox!.y);
  });

  test('small mobile keeps the primary action card fully reachable', async ({ page }) => {
    await openLobby(page, { width: 375, height: 667 });

    await expectInsideViewport(page, page.getByTestId('quick-play-card'));
    await expectInsideViewport(page, page.getByTestId('join-name-input'));
    await expectInsideViewport(page, page.getByTestId('join-button'));
  });

  test('desktop keeps a polished action-led two-column lobby', async ({ page }) => {
    await openLobby(page, { width: 1280, height: 720 });

    const hero = page.getByTestId('lobby-hero');
    const actions = page.getByTestId('lobby-actions');

    await expect(hero).toBeVisible();
    await expect(actions).toBeVisible();
    await expect(page.getByTestId('join-name-input')).toBeVisible();
    await expect(page.getByTestId('join-button')).toBeVisible();
    await expect(page.getByTestId('join-code-card')).toBeVisible();
    await expect(page.getByTestId('recent-tables-card')).toBeVisible();

    const heroBox = await hero.boundingBox();
    const actionsBox = await actions.boundingBox();
    expect(heroBox, 'missing desktop hero box').not.toBeNull();
    expect(actionsBox, 'missing desktop action box').not.toBeNull();

    expect(heroBox!.x).toBeLessThan(actionsBox!.x);
    expect(actionsBox!.width).toBeGreaterThan(heroBox!.width);
    expect(heroBox!.y + heroBox!.height).toBeGreaterThan(actionsBox!.y);
  });

  test('recent tables stays below primary play actions on mobile', async ({ page }) => {
    await openLobby(page, { width: 390, height: 844 });

    const quickPlayCard = page.getByTestId('quick-play-card');
    const recentTablesCard = page.getByTestId('recent-tables-card');

    await expect(recentTablesCard).toBeVisible();

    const quickBox = await quickPlayCard.boundingBox();
    const recentBox = await recentTablesCard.boundingBox();
    expect(quickBox, 'missing quick play card box').not.toBeNull();
    expect(recentBox, 'missing recent tables box').not.toBeNull();

    expect(recentBox!.y).toBeGreaterThan(quickBox!.y + quickBox!.height);
  });
});
