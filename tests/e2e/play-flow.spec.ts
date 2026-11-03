import { expect, test, type Browser, type Page } from '@playwright/test';

type PlayerPair = {
  actor: Page;
  waiting: Page;
};

async function toNumber(text: string | null): Promise<number> {
  return Number((text ?? '').replace(/[^0-9-]/g, ''));
}

async function resolveActorPair(pageA: Page, pageB: Page): Promise<PlayerPair> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [aCanAct, bCanAct] = await Promise.all([
      pageA.getByTestId('action-fold').isEnabled(),
      pageB.getByTestId('action-fold').isEnabled(),
    ]);
    if (aCanAct !== bCanAct) {
      return aCanAct ? { actor: pageA, waiting: pageB } : { actor: pageB, waiting: pageA };
    }
    await pageA.waitForTimeout(100);
  }
  throw new Error('Timed out waiting for exactly one active player turn.');
}

async function advanceToFlopBetting(pageA: Page, pageB: Page, maxMs: number) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const [streetA, streetB] = await Promise.all([
      pageA.getByTestId('street-indicator').textContent(),
      pageB.getByTestId('street-indicator').textContent(),
    ]);
    if (streetA?.startsWith('flop /') && streetB?.startsWith('flop /')) {
      return;
    }

    const [aCanAct, bCanAct] = await Promise.all([
      pageA.getByTestId('action-fold').isEnabled(),
      pageB.getByTestId('action-fold').isEnabled(),
    ]);
    if (aCanAct === bCanAct) {
      await pageA.waitForTimeout(125);
      continue;
    }

    const actor = aCanAct ? pageA : pageB;
    const acted = await takeSafeAction(actor);
    if (!acted) {
      await pageA.waitForTimeout(125);
    }
  }

  throw new Error('Timed out advancing hand to flop betting.');
}

async function takeSafeAction(page: Page): Promise<boolean> {
  const check = page.getByTestId('action-check');
  const call = page.getByTestId('action-call');
  const raise = page.getByTestId('action-raise');
  const allIn = page.getByTestId('action-allin');
  const clickFast = async (locator: ReturnType<Page['getByTestId']>) => {
    try {
      await locator.click({ timeout: 500 });
      return true;
    } catch {
      return false;
    }
  };

  for (let attempt = 0; attempt < 8; attempt += 1) {
    if ((await check.isVisible()) && (await check.isEnabled())) {
      if (await clickFast(check)) return true;
    }
    if ((await call.isVisible()) && (await call.isEnabled())) {
      if (await clickFast(call)) return true;
    }
    if ((await raise.isVisible()) && (await raise.isEnabled())) {
      if (await clickFast(raise)) return true;
    }
    if ((await allIn.isVisible()) && (await allIn.isEnabled())) {
      if (await clickFast(allIn)) return true;
    }
    await page.waitForTimeout(75);
  }

  return false;
}

async function waitForStreet(page: Page, street: 'preflop' | 'flop' | 'turn' | 'river') {
  await expect(page.getByTestId('street-indicator')).toContainText(new RegExp(`^${street} /`));
}

async function createTwoPlayers(
  browser: Browser,
  options: { viewport?: { width: number; height: number }; replayFirstAction?: boolean } = {}
) {
  const contextA = await browser.newContext({ viewport: options.viewport });
  const contextB = await browser.newContext({ viewport: options.viewport });
  let actionReplayed = false;
  let rejectionObserved = false;
  if (options.replayFirstAction) {
    await contextA.routeWebSocket(/\/ws(?:\?|$)/, (route) => {
      const server = route.connectToServer();
      route.onMessage((message) => {
        server.send(message);
        const envelope = JSON.parse(message.toString());
        const payload = envelope.match_data_send?.data;
        if (!payload || actionReplayed) return;
        const action = JSON.parse(Buffer.from(payload, 'base64').toString());
        if (action.type === 'action' && Number.isInteger(action.seq)) {
          actionReplayed = true;
          server.send(message);
        }
      });
      server.onMessage((message) => {
        route.send(message);
        const envelope = JSON.parse(message.toString());
        if (!envelope.match_data?.data) return;
        const payload = JSON.parse(Buffer.from(envelope.match_data.data, 'base64').toString());
        if (
          payload.type === 'error' &&
          /duplicate|not your turn|not in betting phase/i.test(payload.message)
        ) {
          rejectionObserved = true;
        }
      });
    });
  }

  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await pageA.goto('/play');
  await pageA.getByTestId('join-name-input').fill(`E2E-A-${Date.now()}`);
  await pageA.getByRole('button', { name: 'Create a table for friends' }).click();
  const tableSummary = pageA.getByText(/^Table code [A-Z0-9]{6}/).first();
  await expect(tableSummary).toBeVisible();
  const code = (await tableSummary.textContent())!.match(/Table code ([A-Z0-9]{6})/)![1];
  await pageB.goto('/play');
  await pageB.getByTestId('join-name-input').fill(`E2E-B-${Date.now()}`);
  await pageB.getByTestId('join-code-input').fill(code);
  await pageB.getByTestId('join-code-button').click();
  await Promise.all([
    pageA.getByTestId('ready-for-hand').click(),
    pageB.getByTestId('ready-for-hand').click(),
  ]);
  await Promise.all([
    expect(pageA.getByTestId('hero-stack')).toBeVisible(),
    expect(pageB.getByTestId('hero-stack')).toBeVisible(),
  ]);
  await Promise.all([
    expect(pageA.getByTestId('street-indicator')).toContainText(/preflop \/ betting/),
    expect(pageB.getByTestId('street-indicator')).toContainText(/preflop \/ betting/),
  ]);

  return {
    pageA,
    pageB,
    rejectionObserved: () => rejectionObserved,
    async close() {
      await Promise.allSettled([contextA.close(), contextB.close()]);
    },
  };
}

test.describe('Play table E2E', () => {
  test('two players can join and play from preflop to flop with live UI updates', async ({
    browser,
  }) => {
    const players = await createTwoPlayers(browser);
    const { pageA, pageB } = players;

    try {
      await waitForStreet(pageA, 'preflop');
      await waitForStreet(pageB, 'preflop');

      const potBefore = await toNumber(await pageA.getByTestId('pot-amount').textContent());
      expect(potBefore).toBeGreaterThanOrEqual(0);

      const heroStackA = await toNumber(await pageA.getByTestId('hero-stack').textContent());
      const heroStackB = await toNumber(await pageB.getByTestId('hero-stack').textContent());
      expect(heroStackA).toBeLessThan(10000);
      expect(heroStackB).toBeLessThan(10000);

      await advanceToFlopBetting(pageA, pageB, 45_000);

      await waitForStreet(pageA, 'flop');
      await waitForStreet(pageB, 'flop');

      const potAfter = await toNumber(await pageA.getByTestId('pot-amount').textContent());
      expect(potAfter).toBeGreaterThanOrEqual(potBefore);
    } finally {
      await players.close();
    }
  });

  test('turn indicator and action buttons switch between players', async ({ browser }) => {
    const players = await createTwoPlayers(browser);
    const { pageA, pageB } = players;

    try {
      await waitForStreet(pageA, 'preflop');
      await waitForStreet(pageB, 'preflop');

      const pair = await resolveActorPair(pageA, pageB);
      await expect(pair.actor.getByTestId('action-fold')).toBeEnabled();
      await expect(pair.waiting.getByTestId('action-fold')).toBeDisabled();

      const turnBefore = await pair.actor.getByTestId('turn-indicator').textContent();
      await expect.poll(() => takeSafeAction(pair.actor)).toBe(true);

      await expect
        .poll(async () => {
          return pair.actor.getByTestId('turn-indicator').textContent();
        })
        .not.toBe(turnBefore);

      await expect(pair.actor.getByTestId('action-fold')).toBeDisabled();
      await expect(pair.waiting.getByTestId('action-fold')).toBeEnabled();
    } finally {
      await players.close();
    }
  });

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 375, height: 667 },
  ]) {
    test(`mobile ${viewport.width} completes a real hand, clears a rejected repeat and deals the next hand`, async ({
      browser,
    }) => {
      const players = await createTwoPlayers(browser, { viewport, replayFirstAction: true });
      const pages = [players.pageA, players.pageB];
      try {
        const firstHandId = await players.pageA
          .getByTestId('poker-game-screen')
          .getAttribute('data-hand-id');
        expect(firstHandId).toBeTruthy();
        await advanceToFlopBetting(players.pageA, players.pageB, 30_000);
        await expect.poll(players.rejectionObserved).toBe(true);
        for (let round = 0; round < 3; round++) {
          const street = ['flop', 'turn', 'river'][round];
          for (const page of pages)
            await expect(page.getByTestId('street-indicator')).toContainText(`${street} / betting`);
          for (const page of pages) {
            await expect(page.getByTestId('table-notice')).toHaveCount(0);
            await expect
              .poll(async () =>
                page.getByTestId('community-cards').evaluate((board) => {
                  const hero = document
                    .querySelector('[data-testid="hero-stack"]')
                    ?.closest('[data-testid^="seat-card-"]');
                  if (!hero) return false;
                  const a = board.getBoundingClientRect(),
                    b = hero.getBoundingClientRect();
                  return a.bottom + 2 <= b.top;
                })
              )
              .toBe(true);
            await expect(page.locator('[data-testid^="hero-hole-card-"]')).toHaveCount(5 - round);
          }
          if (round === 0) {
            const stackBeforeReload = await players.pageA.getByTestId('hero-stack').textContent();
            await players.pageA.reload();
            await expect(players.pageA.getByTestId('poker-game-screen')).toHaveAttribute(
              'data-hand-id',
              firstHandId!
            );
            await expect(players.pageA.getByTestId('hero-stack')).toHaveText(stackBeforeReload!);
          }
          const deadline = Date.now() + 25_000;
          while (!(await players.pageA.getByTestId('confirm-discard').isVisible())) {
            if (Date.now() > deadline) throw Error(`Timed out finishing ${street} betting`);
            for (const page of pages) {
              if (await page.getByTestId('action-fold').isEnabled()) {
                await takeSafeAction(page);
                break;
              }
            }
            await players.pageA.waitForTimeout(100);
          }
          for (const page of pages) {
            await page
              .getByRole('button', { name: /choose to discard face down/ })
              .first()
              .click();
            await expect(page.getByTestId('confirm-discard')).toBeEnabled();
            await expect
              .poll(async () => {
                const cards = await page.getByTestId('hero-hole-cards').boundingBox();
                const tray = await page.getByTestId('action-tray').boundingBox();
                return Boolean(cards && tray && cards.y + cards.height <= tray.y);
              })
              .toBe(true);
            await page.getByTestId('confirm-discard').click();
          }
        }
        for (const page of pages) {
          await expect(page.getByTestId('street-indicator')).toContainText('showdown /');
          await expect(page.locator('[data-testid^="hero-hole-card-"]')).toHaveCount(2);
          await expect(page.getByTestId('showdown-result-banner')).toBeVisible();
        }
        expect(
          (await toNumber(await players.pageA.getByTestId('hero-stack').textContent())) +
            (await toNumber(await players.pageB.getByTestId('hero-stack').textContent()))
        ).toBe(20000);
        await Promise.all(
          pages.map((page) =>
            page
              .getByTestId('next-hand-countdown')
              .getByRole('button', { name: 'Ready', exact: true })
              .click()
          )
        );
        for (const page of pages) {
          await expect(page.getByTestId('poker-game-screen')).not.toHaveAttribute(
            'data-hand-id',
            firstHandId!
          );
          await expect(page.getByTestId('street-indicator')).toContainText('preflop / betting');
          await expect(page.locator('[data-testid^="hero-hole-card-"]')).toHaveCount(5);
          await expect(page.getByTestId('table-notice')).toHaveCount(0);
        }
      } finally {
        await players.close();
      }
    });
  }
});
