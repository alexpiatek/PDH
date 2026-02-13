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
    const results = (table as any).scoreShowdown(hand) as Array<{
      playerId: string;
      amount: number;
    }>;

    expect(results.length).toBe(2);
    const amounts = results.map((r) => r.amount).sort((a, b) => a - b);
    expect(amounts).toEqual([1000, 1000]);
  });
});
