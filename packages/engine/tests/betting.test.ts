import { describe, expect, it } from 'vitest';
import { PokerTable } from '../src/table';
import { Card } from '../src/types';

const rng = () => 0.1;
const C = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

describe('betting rules', () => {
  it('posts blinds at hand start', () => {
    const table = new PokerTable('t', { smallBlind: 400, bigBlind: 800 });
    table.seatPlayer(0, { id: 'p0', name: 'UTG', stack: 5000 });
    table.seatPlayer(1, { id: 'p1', name: 'SB', stack: 5000 });
    table.seatPlayer(2, { id: 'p2', name: 'BB', stack: 5000 });
    table.startHand(rng);

    const hand = table.state.hand!;
    const sb = hand.players.find((p) => p.id === 'p1')!;
    const bb = hand.players.find((p) => p.id === 'p2')!;
    expect(sb.betThisStreet).toBe(400);
    expect(bb.betThisStreet).toBe(800);
    expect(hand.currentBet).toBe(800);
    expect(hand.minRaise).toBe(800);
  });

  it('short all-in raise does not reopen betting', () => {
    const table = new PokerTable('t', { smallBlind: 400, bigBlind: 800 });
    table.seatPlayer(0, { id: 'p0', name: 'UTG', stack: 5000 });
    table.seatPlayer(1, { id: 'p1', name: 'SB', stack: 1900 }); // can only raise short
    table.seatPlayer(2, { id: 'p2', name: 'BB', stack: 5000 });
    table.startHand(rng);
    const hand = table.state.hand!;
    // UTG raises to 1600
    table.applyAction('p0', { type: 'raise', amount: 1600 });
    expect(hand.actionOnSeat).toBe(1);
    // SB shoves to 1900 total (only 300 raise, not full)
    table.applyAction('p1', { type: 'allIn', amount: 1900 });
    // BB calls
    table.applyAction('p2', { type: 'call' });
    // UTG must call but cannot be forced to re-raise
    table.applyAction('p0', { type: 'call' });
    table.advancePendingPhase(hand.pendingNextPhaseAt ?? 0);
    expect(hand.minRaise).toBe(800);
    expect(hand.street).toBe('flop');
    expect(hand.phase).toBe('betting');
  });

  it('does not mutate state when raise cap rejects a raise', () => {
    const table = new PokerTable('t', { smallBlind: 400, bigBlind: 800 });
    table.seatPlayer(0, { id: 'p0', name: 'UTG', stack: 10000 });
    table.seatPlayer(1, { id: 'p1', name: 'SB', stack: 10000 });
    table.seatPlayer(2, { id: 'p2', name: 'BB', stack: 10000 });
    table.startHand(rng);
    const hand = table.state.hand!;

    table.applyAction('p0', { type: 'raise', amount: 1600 });
    table.applyAction('p1', { type: 'raise', amount: 2400 });

    const bb = hand.players.find((p) => p.id === 'p2')!;
    const before = {
      stack: bb.stack,
      betThisStreet: bb.betThisStreet,
      totalCommitted: bb.totalCommitted,
      currentBet: hand.currentBet,
      raisesThisStreet: hand.raisesThisStreet,
      actionOnSeat: hand.actionOnSeat,
    };

    expect(() => table.applyAction('p2', { type: 'raise', amount: 3200 })).toThrow(
      'Raise cap reached'
    );

    expect(bb.stack).toBe(before.stack);
    expect(bb.betThisStreet).toBe(before.betThisStreet);
    expect(bb.totalCommitted).toBe(before.totalCommitted);
    expect(hand.currentBet).toBe(before.currentBet);
    expect(hand.raisesThisStreet).toBe(before.raisesThisStreet);
    expect(hand.actionOnSeat).toBe(before.actionOnSeat);
  });

  it('rejects illegal check and below-min raise', () => {
    const table = new PokerTable('t', { smallBlind: 400, bigBlind: 800 });
    table.seatPlayer(0, { id: 'p0', name: 'UTG', stack: 10000 });
    table.seatPlayer(1, { id: 'p1', name: 'SB', stack: 10000 });
    table.seatPlayer(2, { id: 'p2', name: 'BB', stack: 10000 });
    table.startHand(rng);

    expect(() => table.applyAction('p0', { type: 'check' })).toThrow('Cannot check');
    expect(() => table.applyAction('p0', { type: 'raise', amount: 1200 })).toThrow(
      'Raise below minimum'
    );
    expect(() => table.applyAction('p0', { type: 'bet', amount: 400 })).toThrow(
      'Cannot bet, must raise'
    );
  });

  it('builds side pots correctly for staggered all-ins', () => {
    const table = new PokerTable('t', { smallBlind: 400, bigBlind: 800 });
    table.seatPlayer(0, { id: 'p0', name: 'Short', stack: 1000 });
    table.seatPlayer(1, { id: 'p1', name: 'Mid', stack: 3000 });
    table.seatPlayer(2, { id: 'p2', name: 'Deep', stack: 5000 });
    table.startHand(rng);

    const hand = table.state.hand!;
    const p0 = hand.players.find((p) => p.id === 'p0')!;
    const p1 = hand.players.find((p) => p.id === 'p1')!;
    const p2 = hand.players.find((p) => p.id === 'p2')!;

    hand.board = [C('A', 'S'), C('8', 'D'), C('7', 'H'), C('6', 'C'), C('2', 'S')];
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
    expect(hand.pots).toEqual([
      { amount: 3000, eligible: ['p0', 'p1', 'p2'] },
      { amount: 4000, eligible: ['p1', 'p2'] },
      { amount: 2000, eligible: ['p2'] },
    ]);

    const results = (table as any).scoreShowdown(hand) as Array<{
      playerId: string;
      amount: number;
    }>;
    const byPlayer = new Map(results.map((r) => [r.playerId, r.amount]));
    expect(byPlayer.get('p0')).toBe(3000);
    expect(byPlayer.get('p1')).toBe(4000);
    expect(byPlayer.get('p2')).toBe(2000);
  });
});
