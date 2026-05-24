import { expect, test, type Locator, type Page } from '@playwright/test';

type Viewport = { width: number; height: number };

const scenarioUrl = (scenario: string, params: Record<string, string> = {}) => {
  const search = new URLSearchParams({ scenario, ...params });
  return `/__test__/poker-action-tray?${search.toString()}`;
};

async function openScenario(
  page: Page,
  scenario: string,
  viewport: Viewport,
  params: Record<string, string> = {}
) {
  await page.setViewportSize(viewport);
  await page.goto(scenarioUrl(scenario, params));
  await expect(page.getByTestId('street-indicator')).toBeAttached();
}

async function openMenu(page: Page) {
  await page.getByTestId('table-menu-button').click();
  await expect(page.getByTestId('table-menu')).toBeVisible();
  return page.getByTestId('table-menu');
}

async function boxOf(locator: Locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `missing bounding box for ${locator}`).not.toBeNull();
  return box!;
}

async function expectNoOverlap(a: Locator, b: Locator, label: string) {
  const [boxA, boxB] = await Promise.all([boxOf(a), boxOf(b)]);
  const overlaps =
    boxA.x < boxB.x + boxB.width &&
    boxA.x + boxA.width > boxB.x &&
    boxA.y < boxB.y + boxB.height &&
    boxA.y + boxA.height > boxB.y;
  expect(overlaps, `${label}: ${JSON.stringify({ boxA, boxB })}`).toBe(false);
}

async function expectWithinViewport(page: Page, locator: Locator, label: string) {
  const box = await boxOf(locator);
  const viewport = page.viewportSize();
  expect(viewport, `missing viewport for ${label}`).not.toBeNull();
  expect(box.x, `${label} left bound`).toBeGreaterThanOrEqual(-1);
  expect(box.y, `${label} top bound`).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width, `${label} right bound`).toBeLessThanOrEqual(viewport!.width + 1);
  expect(box.y + box.height, `${label} bottom bound`).toBeLessThanOrEqual(viewport!.height + 1);
}

test.describe('active table menu and overlays', () => {
  test('player-facing menu removes extras/disconnect and keeps table actions', async ({ page }) => {
    await openScenario(page, 'betting-call', { width: 390, height: 844 });

    const menu = await openMenu(page);
    await expect(menu.getByText('Show Extras')).toHaveCount(0);
    await expect(menu.getByText('Disconnect')).toHaveCount(0);
    await expect(page.getByTestId('menu-hand-history')).toHaveText('Hand History');
    await expect(page.getByTestId('menu-rules')).toHaveText('Rules');
    await expect(page.getByTestId('menu-exit-table')).toHaveText('Exit Table');
    await expect(page.getByTestId('menu-copy-table-code')).toHaveCount(0);
  });

  test('copy table code appears only for valid table codes and gives lightweight feedback', async ({
    page,
  }) => {
    await openScenario(page, 'betting-call', { width: 1280, height: 720 });
    await openMenu(page);
    await expect(page.getByTestId('menu-copy-table-code')).toHaveCount(0);

    await openScenario(page, 'betting-call', { width: 1280, height: 720 }, { tableId: 'BVAZU3' });
    await openMenu(page);
    await expect(page.getByTestId('menu-copy-table-code')).toBeVisible();
    await page.getByTestId('menu-copy-table-code').click();
    await expect(page.getByTestId('menu-copy-table-code')).toContainText('Copied');
    await expect(page.getByTestId('copy-table-code-feedback')).toHaveCount(0);

    await openScenario(page, 'betting-call', { width: 390, height: 844 }, { tableId: 'BVAZU3' });
    await openMenu(page);
    await page.getByTestId('menu-copy-table-code').click();
    await expect(page.getByTestId('menu-copy-table-code')).toContainText('Copied');
    await expect(page.getByTestId('copy-table-code-feedback')).toHaveCount(0);
  });

  test('hand history is closed by default and toggles without covering mobile actions', async ({
    page,
  }) => {
    await openScenario(page, 'betting-call', { width: 390, height: 844 });

    await expect(page.getByTestId('hand-history-panel')).toHaveCount(0);
    await openMenu(page);
    await page.getByTestId('menu-hand-history').click();
    await expect(page.getByTestId('hand-history-panel')).toBeVisible();
    await expectNoOverlap(
      page.getByTestId('hand-history-panel'),
      page.getByTestId('action-tray'),
      'history should not overlap action tray'
    );

    await openMenu(page);
    await page.getByTestId('menu-hand-history').click();
    await expect(page.getByTestId('hand-history-panel')).toHaveCount(0);

    await openMenu(page);
    await page.getByTestId('menu-hand-history').click();
    await page.getByTestId('hand-history-close').click();
    await expect(page.getByTestId('hand-history-panel')).toHaveCount(0);
  });

  test('rules overlay opens and closes in place without navigation', async ({ page }) => {
    await openScenario(page, 'betting-call', { width: 390, height: 844 });
    const beforeUrl = page.url();

    await openMenu(page);
    await page.getByTestId('menu-rules').click();
    await expect(page.getByTestId('rules-overlay')).toBeVisible();
    await expect(page.getByText('How Bondi Poker works')).toBeVisible();
    await expect(page.getByText('Discards stay hidden.')).toBeVisible();
    expect(page.url()).toBe(beforeUrl);

    await page.getByTestId('rules-close').click();
    await expect(page.getByTestId('rules-overlay')).toHaveCount(0);
    expect(page.url()).toBe(beforeUrl);
  });
});

test.describe('active table layout safety', () => {
  test('seat role badges reserve space and long names truncate', async ({ page }) => {
    await openScenario(page, 'long-names', { width: 390, height: 844 });

    for (const playerId of ['player-hero', 'player-villain']) {
      const name = page.getByTestId(`seat-player-name-${playerId}`);
      const badges = page.getByTestId(`seat-role-badges-${playerId}`);
      await expectNoOverlap(name, badges, `${playerId} name and role badges`);
      await expect(badges.getByTestId('role-chip').first()).toBeVisible();
    }

    await expect
      .poll(() =>
        page
          .getByTestId('seat-player-name-player-hero')
          .evaluate((element) => element.scrollWidth > element.clientWidth)
      )
      .toBe(true);
  });

  test('mobile 4 to 9 player nameplates stay inside the viewport safe area', async ({ page }) => {
    for (const scenario of ['mobile-4', 'mobile-5', 'mobile-6', 'mobile-9']) {
      await openScenario(page, scenario, { width: 390, height: 844 });
      const seatCards = page.locator('[data-testid^="seat-card-"]');
      const count = await seatCards.count();
      const expectedCount = Number.parseInt(scenario.replace('mobile-', ''), 10);
      expect(count, `${scenario} seat card count`).toBe(expectedCount);
      for (let index = 0; index < count; index += 1) {
        await expectWithinViewport(page, seatCards.nth(index), `${scenario} seat ${index}`);
      }
      await expect
        .poll(() =>
          page
            .getByTestId('seat-player-name-player-hero')
            .evaluate((element) => element.scrollWidth > element.clientWidth)
        )
        .toBe(true);
    }
  });

  test('seat status text is human-readable sentence case', async ({ page }) => {
    await openScenario(page, 'betting-call', { width: 390, height: 844 });

    await expect(page.getByTestId('turn-indicator')).toHaveText(/Your turn · \d+s/);
    await expect(page.getByTestId('seat-player-status-player-hero')).toHaveText(/Your turn · \d+s/);
    await expect(page.getByTestId('seat-player-status-player-villain')).toHaveText('Waiting');
    await expect(page.getByText(/YOUR TURN|TO ACT|WAITING|DISCARDING|FOLDED|DISCONNECTED|RECONNECTING|ALL-IN/)).toHaveCount(0);
    await expect(page.getByText(/ - \d+s/)).toHaveCount(0);
  });

  test('showdown result banner stays clear of board, hero cards, and next-hand controls', async ({
    page,
  }) => {
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1280, height: 720 },
    ]) {
      await openScenario(page, viewport.width < 500 ? 'showdown-long' : 'showdown', viewport);
      const banner = page.getByTestId('showdown-result-banner');
      await expect(banner).toContainText(/wins 16,750|wins 4,000/);
      await expect(banner).toContainText(/Straight Flush/);
      await expect(banner).toContainText(/Main/);
      if (viewport.width < 500) {
        await expect
          .poll(() =>
            page
              .getByTestId('showdown-result-main-line')
              .evaluate((element) => element.scrollWidth <= element.clientWidth + 1)
          )
          .toBe(true);
      }
      await expectNoOverlap(banner, page.getByTestId('community-cards'), 'result and board');
      await expectNoOverlap(banner, page.getByTestId('hero-hole-cards'), 'result and hero cards');
      await expectNoOverlap(
        banner,
        page.getByTestId('next-hand-countdown'),
        'result and next-hand controls'
      );
    }
  });

  test('discard tray copy is simplified and stays clear of hero cards', async ({ page }) => {
    await openScenario(page, 'discard', { width: 390, height: 844 });

    const tray = page.getByTestId('action-tray');
    await expect(tray.getByText('Discard 1 card')).toBeVisible();
    await expect(tray.getByText('Choose one card to continue')).toBeVisible();
    await expect(page.getByText(/Select 1 card to discard/)).toHaveCount(0);
    await expect(page.getByTestId('confirm-discard')).toBeDisabled();
    await expectNoOverlap(tray, page.getByTestId('hero-hole-cards'), 'discard tray and hero cards');

    await page.getByTestId('hero-hole-card-0').click();
    await expect(page.getByTestId('confirm-discard')).toBeEnabled();
    await expect(page.getByTestId('confirm-discard')).toHaveText('Discard selected');
    await expect(tray.getByText('Choose one card to continue')).toHaveCount(0);
    await expect(tray.getByText(/0\/1/)).toHaveCount(0);
  });

  test('all-in discard does not show rebuy or queued sit-out as active-hand UI', async ({
    page,
  }) => {
    await openScenario(
      page,
      'all-in-discard-stale-seat',
      { width: 390, height: 844 },
      {
        status: 'Sit out queued.',
      }
    );

    const tray = page.getByTestId('action-tray');
    await expect(tray.getByText('Discard 1 card')).toBeVisible();
    await expect(page.getByTestId('confirm-discard')).toBeDisabled();
    await expect(page.getByTestId('rebuy-status')).toHaveCount(0);
    await expect(page.getByTestId('rebuy-next-hand')).toHaveCount(0);
    await expect(page.getByTestId('sit-out-next-hand')).toHaveCount(0);
    await expect(page.getByTestId('table-notice')).toHaveCount(0);

    await page.getByTestId('hero-hole-card-0').click();
    await expect(page.getByTestId('confirm-discard')).toBeEnabled();
    await expect(page.getByTestId('confirm-discard')).toBeVisible();
    await expect(page.getByTestId('rebuy-status')).toHaveCount(0);
  });

  test('last-action ticker uses one stable safe lane', async ({
    page,
  }) => {
    await openScenario(page, 'betting-check-allin', { width: 390, height: 844 });

    const ticker = page.getByTestId('latest-action-ticker');
    await expect(ticker).toHaveText('Sam checked');
    await expectNoOverlap(ticker, page.getByTestId('pot-amount'), 'ticker and pot');
    await expectNoOverlap(ticker, page.getByTestId('community-cards'), 'ticker and board');
    await expectNoOverlap(ticker, page.getByTestId('seat-card-player-hero'), 'ticker and hero seat');
    await expectNoOverlap(ticker, page.getByTestId('hero-hole-cards'), 'ticker and hero cards');
    await expectNoOverlap(ticker, page.getByTestId('action-tray'), 'ticker and action tray');

    await openMenu(page);
    await page.getByTestId('menu-hand-history').click();
    await expect(page.getByTestId('latest-action-ticker')).toHaveCount(0);

    await openScenario(page, 'showdown', { width: 390, height: 844 });
    await expect(page.getByTestId('latest-action-ticker')).toHaveCount(0);
  });

  test('rebuy and sit-out controls wait until the hand is resolved', async ({ page }) => {
    await openScenario(page, 'out-of-chips-active', { width: 390, height: 844 });

    await expect(page.getByTestId('rebuy-status')).toHaveCount(0);
    await expect(page.getByTestId('rebuy-next-hand')).toHaveCount(0);
    await expect(page.getByTestId('sit-out-next-hand')).toHaveCount(0);
    await expect(page.getByTestId('table-notice')).toHaveCount(0);

    await openScenario(page, 'out-of-chips-between', { width: 390, height: 844 });
    await expect(page.getByTestId('rebuy-status')).toHaveText("You're out of chips");
    await expect(page.getByText('Choose what happens next hand.')).toBeVisible();
    await expect(page.getByTestId('rebuy-next-hand')).toBeVisible();
    await expect(page.getByTestId('sit-out-next-hand')).toBeVisible();
    await expect(page.getByText('Rebuy is only available between hands')).toHaveCount(0);

    await page.getByTestId('sit-out-next-hand').click();
    await expect(page.getByTestId('rebuy-status')).toHaveText('Applying queued sit out');
    await expect(page.getByText('Applying queued sit out...')).toBeVisible();
  });
});
