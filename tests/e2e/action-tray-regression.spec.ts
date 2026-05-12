import { expect, test, type Locator, type Page } from '@playwright/test';

type Viewport = { width: number; height: number };

const scenarioUrl = (scenario: string) => `/__test__/poker-action-tray?scenario=${scenario}`;

async function openScenario(page: Page, scenario: string, viewport: Viewport) {
  await page.setViewportSize(viewport);
  await page.goto(scenarioUrl(scenario));
  await expect(page.getByTestId('street-indicator')).toBeAttached();
}

async function expectWithinViewport(page: Page, locator: Locator) {
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

async function expectClickable(locator: Locator) {
  await expect(locator).toBeVisible();
  await expect(locator).toBeEnabled();
  await locator.click({ trial: true });
}

test.describe('poker action tray viewport regressions', () => {
  test('betting controls stay visible and clickable on mobile portrait', async ({ page }) => {
    await openScenario(page, 'betting-call', { width: 390, height: 844 });

    const tray = page.getByTestId('action-tray');
    await expectWithinViewport(page, tray);

    await expect(page.getByTestId('action-fold')).toHaveText('Fold');
    await expect(page.getByTestId('action-call')).toHaveText('Call 400');
    await expect(page.getByTestId('action-raise-toggle')).toHaveText('Raise');
    await expect(page.getByRole('button', { name: /Call 0/ })).toHaveCount(0);

    await expectClickable(page.getByTestId('action-call'));
    await page.getByTestId('action-raise-toggle').click();
    await expect(page.getByTestId('action-raise-toggle')).toHaveText('Raise');
    await expect(page.getByRole('button', { name: /^Close (Bet|Raise)$/ })).toHaveCount(0);
    await expect(page.getByTestId('bet-panel-close')).toBeVisible();
    await expect(page.getByTestId('action-raise')).toContainText('Raise to 1600');
    await expectWithinViewport(page, page.getByTestId('action-raise'));
    await expectClickable(page.getByTestId('action-raise'));
    await expect(page.getByTestId('raise-option-allin')).toBeVisible();
    await expect(page.getByTestId('action-raise')).not.toContainText('Confirm all-in');
    await page.getByTestId('raise-option-allin').click();
    await expect(page.getByTestId('action-raise')).toContainText('Confirm all-in');
    await page.getByTestId('bet-panel-close').click();
    await expect(page.getByTestId('bet-panel-close')).toHaveCount(0);

    await openScenario(page, 'betting-check-allin', { width: 390, height: 844 });
    await expectWithinViewport(page, page.getByTestId('action-tray'));
    await expect(page.getByTestId('action-check')).toHaveText('Check');
    await expect(page.getByTestId('action-allin')).toContainText('All-in 300');
    await expectClickable(page.getByTestId('action-check'));
    await expectClickable(page.getByTestId('action-allin'));
    await expect(page.getByRole('button', { name: /Call 0/ })).toHaveCount(0);
  });

  test('small mobile keeps critical betting buttons readable above the bottom edge', async ({
    page,
  }) => {
    await openScenario(page, 'betting-call', { width: 375, height: 667 });

    await expectWithinViewport(page, page.getByTestId('action-tray'));
    for (const testId of ['action-fold', 'action-call', 'action-raise-toggle']) {
      const button = page.getByTestId(testId);
      await expectWithinViewport(page, button);
      await expect(button).toBeEnabled();
      const box = await button.boundingBox();
      expect(box!.width).toBeGreaterThan(70);
      expect(box!.height).toBeGreaterThanOrEqual(40);
    }
  });

  test('mobile landscape keeps the action tray reachable', async ({ page }) => {
    await openScenario(page, 'betting-call', { width: 844, height: 390 });

    await expectWithinViewport(page, page.getByTestId('action-tray'));
    await expectWithinViewport(page, page.getByTestId('action-call'));
    await expectClickable(page.getByTestId('action-call'));
    await expect(page.getByTestId('action-raise-toggle')).toBeVisible();
  });

  test('discard phase keeps cards selectable and confirm CTA reachable', async ({ page }) => {
    await openScenario(page, 'discard', { width: 390, height: 844 });

    const tray = page.getByTestId('action-tray');
    await expectWithinViewport(page, tray);
    await expect(tray.getByText('Discard 1 card')).toBeVisible();
    await expect(tray.getByText('Choose one card to continue')).toBeVisible();
    await expect(page.getByText(/Select 1 card to discard/)).toHaveCount(0);
    await expect(page.getByTestId('confirm-discard')).toBeVisible();
    await expect(page.getByTestId('confirm-discard')).toBeDisabled();

    await page.waitForTimeout(1500);
    const firstCard = page.getByTestId('hero-hole-card-0');
    await expectWithinViewport(page, firstCard);
    await firstCard.click();

    const confirm = page.getByTestId('confirm-discard');
    await expect(confirm).toBeEnabled();
    await expect(tray.getByText('Choose one card to continue')).toHaveCount(0);
    await expect(confirm).toHaveText('Discard selected');
    await expectWithinViewport(page, confirm);
    await confirm.click({ trial: true });
  });

  test('showdown keeps result summary and server-owned between-hand state visible', async ({
    page,
  }) => {
    await openScenario(page, 'showdown', { width: 390, height: 844 });

    await expectWithinViewport(page, page.getByTestId('showdown-result-banner'));
    await expect(page.getByTestId('hand-history-panel')).toHaveCount(0);

    const countdown = page.getByTestId('next-hand-countdown');
    await expectWithinViewport(page, countdown);
    await expect(countdown).toContainText(/Next hand in|Ready for next hand/);
    await expect(countdown).toContainText(/Server controlled|Results held/);
    await expect(page.getByRole('button', { name: 'Ready' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next Hand' })).toHaveCount(0);
  });

  test('desktop viewport still shows betting controls correctly', async ({ page }) => {
    await openScenario(page, 'betting-call', { width: 1280, height: 720 });

    await expectWithinViewport(page, page.getByTestId('action-tray'));
    await expect(page.getByTestId('action-fold')).toBeVisible();
    await expect(page.getByTestId('action-call')).toHaveText('Call 400');
    await expect(page.getByTestId('action-raise-toggle')).toHaveText('Raise');
    await expectClickable(page.getByTestId('action-call'));
    await expect(page.getByRole('button', { name: /Call 0/ })).toHaveCount(0);
  });
});
