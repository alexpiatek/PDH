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
    await expect(page.getByTestId('copy-table-code-feedback')).toHaveText('Table code copied.');
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

  test('showdown result banner stays clear of board, hero cards, and next-hand controls', async ({
    page,
  }) => {
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1280, height: 720 },
    ]) {
      await openScenario(page, 'showdown', viewport);
      const banner = page.getByTestId('showdown-result-banner');
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
  });

  test('last-action toast uses a safe lane with board, seats, hero cards, and actions', async ({
    page,
  }) => {
    await openScenario(page, 'betting-check-allin', { width: 390, height: 844 });

    const toast = page.getByTestId('latest-action-toast');
    await expect(toast).toHaveText('Sam checked');
    await expectNoOverlap(toast, page.getByTestId('community-cards'), 'toast and board');
    await expectNoOverlap(toast, page.getByTestId('seat-card-player-hero'), 'toast and hero seat');
    await expectNoOverlap(toast, page.getByTestId('hero-hole-cards'), 'toast and hero cards');
    await expectNoOverlap(toast, page.getByTestId('action-tray'), 'toast and action tray');
  });
});
