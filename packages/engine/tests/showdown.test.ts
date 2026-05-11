import { describe, expect, it } from 'vitest';
import { PokerTable } from '../src/table';
import { Card } from '../src/types';

const C = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

describe('showdown split pots', () => {
  it('splits the pot when the board is the best hand', () => {
    const table = new PokerTable('t', { smallBlind: 400, bigBlind: 800 });
    table.seatPlayer(0, { id: 'p1', name: 'Kings', stack: 5000 });
    table.seatPlayer(1, { id: 'p2', name: 'Queens', stack: 5000 });
    table.startHand(() => 0.42);
    const hand = table.state.hand!;

    hand.board = [C('6', 'S'), C('7', 'D'), C('8', 'H'), C('9', 'C'), C('T', 'S')];
    const p1 = hand.players.find((p) => p.id === 'p1')!;
    const p2 = hand.players.find((p) => p.id === 'p2')!;
    p1.holeCards = [C('K', 'C'), C('K', 'D')];
    p2.holeCards = [C('Q', 'C'), C('Q', 'D')];

    hand.pots = [{ amount: 2000, eligible: [p1.id, p2.id] }];
    const { winners: results, pots } = (table as any).scoreShowdown(hand) as {
      winners: Array<{
        playerId: string;
        amount: number;
        handLabel?: string;
        bestFive?: Card[];
      }>;
      pots: Array<{
        label: string;
        amount: number;
        winners: Array<{ playerId: string; amount: number }>;
      }>;
    };

    expect(pots).toEqual([
      expect.objectContaining({
        potId: 'pot-0',
        label: 'Main pot',
        amount: 2000,
        eligible: [p1.id, p2.id],
        winners: expect.arrayContaining([
          expect.objectContaining({ playerId: p1.id, amount: 1000 }),
          expect.objectContaining({ playerId: p2.id, amount: 1000 }),
        ]),
      }),
    ]);

    expect(results.length).toBe(2);
    const amounts = results.map((r) => r.amount).sort((a, b) => a - b);
    expect(amounts).toEqual([1000, 1000]);
    expect(results.every((r) => r.handLabel === 'Straight')).toBe(true);
    expect(results.every((r) => (r.bestFive ?? []).length === 5)).toBe(true);
  });

  it('reports side-pot winners separately while preserving aggregated totals', () => {
    const table = new PokerTable('t', { smallBlind: 400, bigBlind: 800 });
    table.seatPlayer(0, { id: 'p0', name: 'Short', stack: 1000 });
    table.seatPlayer(1, { id: 'p1', name: 'Mid', stack: 3000 });
    table.seatPlayer(2, { id: 'p2', name: 'Deep', stack: 5000 });
    table.startHand(() => 0.42);
    const hand = table.state.hand!;

    hand.board = [C('A', 'S'), C('8', 'D'), C('7', 'H'), C('6', 'C'), C('2', 'S')];
    const p0 = hand.players.find((p) => p.id === 'p0')!;
    const p1 = hand.players.find((p) => p.id === 'p1')!;
    const p2 = hand.players.find((p) => p.id === 'p2')!;
    p0.holeCards = [C('A', 'H'), C('K', 'D')];
    p1.holeCards = [C('K', 'C'), C('Q', 'D')];
    p2.holeCards = [C('Q', 'C'), C('J', 'D')];
    p0.totalCommitted = 1000;
    p1.totalCommitted = 3000;
    p2.totalCommitted = 5000;
    p0.status = 'allIn';
    p1.status = 'allIn';
    p2.status = 'allIn';

    (table as any).buildSidePots(hand);
    const { winners: results, pots } = (table as any).scoreShowdown(hand) as {
      winners: Array<{
        playerId: string;
        amount: number;
        potLabels?: string[];
      }>;
      pots: Array<{
        label: string;
        amount: number;
        winners: Array<{ playerId: string; amount: number; handLabel?: string }>;
      }>;
    };

    expect(pots).toEqual([
      expect.objectContaining({
        potId: 'pot-0',
        label: 'Main pot',
        amount: 3000,
        eligible: ['p0', 'p1', 'p2'],
        winners: [expect.objectContaining({ playerId: 'p0', amount: 3000 })],
      }),
      expect.objectContaining({
        potId: 'pot-1',
        label: 'Side pot 1',
        amount: 4000,
        eligible: ['p1', 'p2'],
        winners: [expect.objectContaining({ playerId: 'p1', amount: 4000 })],
      }),
      expect.objectContaining({
        potId: 'pot-2',
        label: 'Side pot 2',
        amount: 2000,
        eligible: ['p2'],
        winners: [expect.objectContaining({ playerId: 'p2', amount: 2000 })],
      }),
    ]);
    const byPlayer = new Map(results.map((r) => [r.playerId, r]));
    expect(byPlayer.get('p0')?.amount).toBe(3000);
    expect(byPlayer.get('p1')?.amount).toBe(4000);
    expect(byPlayer.get('p2')?.amount).toBe(2000);
    expect(byPlayer.get('p1')?.potLabels).toEqual(['Side pot 1']);
  });
});
