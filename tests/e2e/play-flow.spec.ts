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

async function createTwoPlayers(browser: Browser) {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();

  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await pageA.goto('/play');
  await pageA.getByTestId('join-name-input').fill(`E2E-A-${Date.now()}`);
  await pageA.getByRole('button', { name: 'Create a table for friends' }).click();
  const tableSummary = pageA.getByText(/^Table [A-Z0-9]{6}/).first();
  await expect(tableSummary).toBeVisible();
  const code = (await tableSummary.textContent())!.match(/Table ([A-Z0-9]{6})/)![1];
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
});
