import { expect, test, type Locator, type Page } from '@playwright/test';

type Viewport = { width: number; height: number };

const scenarioUrl = (scenario: string) => `/__test__/poker-action-tray?scenario=${scenario}`;

async function openScenario(page: Page, scenario: string, viewport: Viewport) {
  await page.setViewportSize(viewport);
  await page.goto(scenarioUrl(scenario));
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

test.describe('table entry and waiting room UX', () => {
  test('known-name table entry uses compact joining state instead of the large form', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('pdh.player.name', 'Alex Mobile');
    });
    await openScenario(page, 'joining-known-name', { width: 390, height: 844 });

    await expect(page.getByTestId('table-entry-connecting')).toBeVisible();
    await expect(page.getByTestId('table-entry-form')).toHaveCount(0);
    await expect(page.getByText(/Table Entry/i)).toHaveCount(0);
    await expect(page.getByText(/Enter your table name/i)).toHaveCount(0);
    await expect(page.getByText(/Alex Mobile is joining/i)).toBeVisible();
  });

  test('direct table fallback asks for a player name with corrected copy', async ({ page }) => {
    await openScenario(page, 'join-fallback', { width: 390, height: 844 });

    await expect(page.getByTestId('table-entry-form')).toBeVisible();
    await expect(page.getByText('Join Table')).toBeVisible();
    await expect(page.getByText('Enter your player name to take a seat.')).toBeVisible();
    await expect(page.getByText(/table name/i)).toHaveCount(0);
    await expect(page.getByTestId('table-entry-player-name-input')).toBeVisible();
    await expect(page.getByTestId('table-entry-join-button')).toHaveText('Join');
  });

  test('desktop waiting room shows countdown, ready count, seated players, and CTA', async ({
    page,
  }) => {
    await openScenario(page, 'start-gate', { width: 1280, height: 720 });

    await expect(page.getByTestId('start-gate')).toBeVisible();
    await expect(page.getByText('Waiting for players')).toBeVisible();
    await expect(page.getByTestId('start-gate-countdown')).toContainText(/Starts in/i);
    await expect(page.getByTestId('start-gate-countdown')).toContainText(/\d+s/);
    await expect(page.getByTestId('start-gate-ready-count')).toHaveText('Ready 0 / 2');
    await expect(page.getByTestId('start-gate-player')).toHaveCount(2);
    await expect(page.getByText(/Alex waiting/)).toBeVisible();
    await expect(page.getByText(/Sam waiting/)).toBeVisible();
    await expect(page.getByTestId('ready-for-hand')).toHaveText('Ready for Hand');
  });

  test('mobile waiting room is high enough and keeps Ready reachable', async ({ page }) => {
    await openScenario(page, 'start-gate', { width: 390, height: 844 });

    const waitingCard = page.getByTestId('start-gate');
    const readyButton = page.getByTestId('ready-for-hand');

    await expectInsideViewport(page, waitingCard);
    await expectInsideViewport(page, readyButton);
    await expect(readyButton).toBeEnabled();
    await readyButton.click({ trial: true });

    const box = await waitingCard.boundingBox();
    const viewport = page.viewportSize();
    expect(box, 'missing waiting card box').not.toBeNull();
    expect(viewport, 'missing viewport').not.toBeNull();
    expect(box!.y).toBeLessThan(viewport!.height * 0.34);
  });

  test('ready state updates player chip, count, and button copy', async ({ page }) => {
    await openScenario(page, 'start-gate-ready', { width: 390, height: 844 });

    await expect(page.getByTestId('start-gate-ready-count')).toHaveText('Ready 1 / 2');
    await expect(page.getByText(/Alex ready/)).toBeVisible();
    await expect(page.getByText(/Sam waiting/)).toBeVisible();
    await expect(page.getByTestId('ready-for-hand')).toHaveText('Ready');
  });
});
