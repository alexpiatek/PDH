import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildDeck, evaluateSeven, PokerTable, type Card, type HandState } from '../src';
import { actingPlayer, cardKey, createSeededRng, discardedCardKeys } from './testUtils';

const DECK = buildDeck();

function totalSeatStacks(table: PokerTable): number {
  return table.state.seats.reduce((sum, seat) => sum + (seat?.stack ?? 0), 0);
}

function totalCommitted(hand: HandState): number {
  return hand.players.reduce((sum, p) => sum + p.totalCommitted, 0);
}

function assertCardAccounting(hand: HandState) {
  const liveKeys = [
    ...hand.deck.map(cardKey),
    ...hand.board.map(cardKey),
    ...hand.players.flatMap((p) => p.holeCards.map(cardKey)),
  ];
  const liveSet = new Set(liveKeys);
  expect(liveSet.size).toBe(liveKeys.length);

  const discarded = discardedCardKeys(hand);
  for (const key of discarded) {
    expect(liveSet.has(key)).toBe(false);
  }

  const totalKnown = liveSet.size + discarded.size;
  expect(totalKnown).toBeLessThanOrEqual(52);

  for (const p of hand.players) {
    for (const c of p.holeCards) {
      expect(discarded.has(cardKey(c))).toBe(false);
    }
  }
}

function assertChipInvariant(table: PokerTable, initialTotal: number) {
  const hand = table.state.hand;
  if (!hand) {
    expect(totalSeatStacks(table)).toBe(initialTotal);
    return;
  }

  if (hand.phase === 'showdown') {
    expect(totalSeatStacks(table)).toBe(initialTotal);
  } else {
    expect(totalSeatStacks(table) + totalCommitted(hand)).toBe(initialTotal);
  }
}

function stepWithValidAction(table: PokerTable, rand: () => number) {
  const hand = table.state.hand;
  if (!hand || hand.phase !== 'betting') return;

  const actor = actingPlayer(hand);
  const otherActive = hand.players.find((p) => p.id !== actor.id && p.status === 'active');
  if (otherActive) {
    expect(() => table.applyAction(otherActive.id, { type: 'check' })).toThrow('Not your turn');
  }

  const toCall = hand.currentBet - actor.betThisStreet;
  if (toCall > 0) {
    if (actor.stack === 0 || rand() < 0.15) {
      table.applyAction(actor.id, { type: 'fold' });
    } else {
      table.applyAction(actor.id, { type: 'call' });
    }
  } else if (
    hand.currentBet === 0 &&
    hand.raisesThisStreet < 2 &&
    actor.stack > hand.minRaise &&
    rand() < 0.1
  ) {
    table.applyAction(actor.id, { type: 'bet', amount: hand.minRaise });
  } else {
    table.applyAction(actor.id, { type: 'check' });
  }

  if (hand.pendingNextPhaseAt) {
    table.advancePendingPhase(hand.pendingNextPhaseAt);
  }
}

function stepDiscard(table: PokerTable, rand: () => number) {
  const hand = table.state.hand;
  if (!hand || hand.phase !== 'discard') return;

  const beforeStreet = hand.street;
  table.advancePendingPhase(Date.now() + 10_000);
  const sameHand = table.state.hand;
  if (sameHand) {
    expect(sameHand.phase).toBe('discard');
    expect(sameHand.street).toBe(beforeStreet);
  }

  const pending = [...hand.discardPending];
  if (!pending.length) return;
  const playerId = pending[Math.floor(rand() * pending.length)];
  table.applyDiscard(playerId, 0);
}

function runToTerminal(table: PokerTable, rand: () => number, initialTotal: number) {
  let guard = 256;
  while (table.state.hand && table.state.hand.phase !== 'showdown' && guard > 0) {
    const hand = table.state.hand;
    assertCardAccounting(hand);
    assertChipInvariant(table, initialTotal);
    expect(hand.players.every((p) => p.stack >= 0)).toBe(true);

    if (hand.phase === 'betting') {
      stepWithValidAction(table, rand);
    } else if (hand.phase === 'discard') {
      stepDiscard(table, rand);
    }

    guard -= 1;
  }

  const hand = table.state.hand;
  if (!hand) return;

  assertCardAccounting(hand);
  assertChipInvariant(table, initialTotal);
  expect(hand.pots.every((pot) => pot.amount >= 0)).toBe(true);

  const contenders = hand.players.filter((p) => p.status !== 'folded' && p.status !== 'out');
  if (contenders.length > 1) {
    const potTotal = hand.pots.reduce((sum, pot) => sum + pot.amount, 0);
    expect(potTotal).toBe(totalCommitted(hand));
  }
}

describe('engine properties', () => {
  it('preserves chips, pot accounting, card uniqueness, and state-machine guards', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 0x7fffffff }),
        fc.integer({ min: 2, max: 6 }),
        fc.integer({ min: 2000, max: 15000 }),
        (seed, players, stack) => {
          const table = new PokerTable('prop');
          for (let i = 0; i < players; i += 1) {
            table.seatPlayer(i, { id: `p${i}`, name: `P${i}`, stack });
          }

          const rng = createSeededRng(seed);
          table.startHand(rng);
          const initialTotal = totalSeatStacks(table) + totalCommitted(table.state.hand!);
          runToTerminal(table, rng, initialTotal);
        }
      ),
      { numRuns: 75 }
    );
  });

  const sevenCardsArb = fc
    .uniqueArray(fc.integer({ min: 0, max: 51 }), { minLength: 7, maxLength: 7 })
    .map((indexes) => indexes.map((idx) => DECK[idx] as Card));

  it('hand rank comparison is antisymmetric', () => {
    fc.assert(
      fc.property(sevenCardsArb, sevenCardsArb, (aCards, bCards) => {
        const a = evaluateSeven(aCards).score;
        const b = evaluateSeven(bCards).score;
        const cmpAB = Math.sign(a - b);
        const cmpBA = Math.sign(b - a);
        expect(cmpAB === -cmpBA).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  it('hand rank comparison is transitive', () => {
    fc.assert(
      fc.property(sevenCardsArb, sevenCardsArb, sevenCardsArb, (aCards, bCards, cCards) => {
        const a = evaluateSeven(aCards).score;
        const b = evaluateSeven(bCards).score;
        const c = evaluateSeven(cCards).score;

        if (a >= b && b >= c) {
          expect(a).toBeGreaterThanOrEqual(c);
        }
      }),
      { numRuns: 200 }
    );
  });
});
