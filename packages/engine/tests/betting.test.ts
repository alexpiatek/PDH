import { describe, expect, it } from 'vitest';
import { PokerTable } from '../src/table';
import { Card } from '../src/types';
import { settleBettingStreetWithCalls } from './testUtils';

const rng = () => 0.1;
const C = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

function bettingStateSnapshot(table: PokerTable, playerId: string) {
  const hand = table.state.hand!;
  const player = hand.players.find((p) => p.id === playerId)!;
  const seat = table.state.seats[player.seat]!;
  return {
    seatStack: seat.stack,
    playerStack: player.stack,
    betThisStreet: player.betThisStreet,
    totalCommitted: player.totalCommitted,
    currentBet: hand.currentBet,
    minRaise: hand.minRaise,
    raisesThisStreet: hand.raisesThisStreet,
    pots: hand.pots.map((pot) => ({ amount: pot.amount, eligible: [...pot.eligible] })),
  };
}

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

  it('rejects negative all-in amounts without changing stacks or commitments', () => {
    const table = new PokerTable('t', { smallBlind: 400, bigBlind: 800 });
    table.seatPlayer(0, { id: 'p0', name: 'UTG', stack: 5000 });
    table.seatPlayer(1, { id: 'p1', name: 'SB', stack: 5000 });
    table.seatPlayer(2, { id: 'p2', name: 'BB', stack: 5000 });
    table.startHand(rng);
    const hand = table.state.hand!;
    const actor = hand.players.find((p) => p.seat === hand.actionOnSeat)!;
    const seat = table.state.seats[actor.seat]!;
    const before = {
      seatStack: seat.stack,
      playerStack: actor.stack,
      betThisStreet: actor.betThisStreet,
      totalCommitted: actor.totalCommitted,
      currentBet: hand.currentBet,
    };

    expect(() => table.applyAction(actor.id, { type: 'allIn', amount: -1 })).toThrow(
      'Invalid action amount'
    );

    expect(seat.stack).toBe(before.seatStack);
    expect(actor.stack).toBe(before.playerStack);
    expect(actor.betThisStreet).toBe(before.betThisStreet);
    expect(actor.totalCommitted).toBe(before.totalCommitted);
    expect(hand.currentBet).toBe(before.currentBet);
  });

  it('rejects fractional raise amounts without changing chip or betting state', () => {
    const table = new PokerTable('t', { smallBlind: 400, bigBlind: 800 });
    table.seatPlayer(0, { id: 'p0', name: 'UTG', stack: 5000 });
    table.seatPlayer(1, { id: 'p1', name: 'SB', stack: 5000 });
    table.seatPlayer(2, { id: 'p2', name: 'BB', stack: 5000 });
    table.startHand(rng);
    const actor = table.state.hand!.players.find((p) => p.seat === table.state.hand!.actionOnSeat)!;
    const before = bettingStateSnapshot(table, actor.id);

    expect(() => table.applyAction(actor.id, { type: 'raise', amount: 1600.5 })).toThrow(
      'Invalid action amount'
    );

    expect(bettingStateSnapshot(table, actor.id)).toEqual(before);
  });

  it('rejects fractional all-in amounts without changing chip or betting state', () => {
    const table = new PokerTable('t', { smallBlind: 400, bigBlind: 800 });
    table.seatPlayer(0, { id: 'p0', name: 'UTG', stack: 5000 });
    table.seatPlayer(1, { id: 'p1', name: 'SB', stack: 5000 });
    table.seatPlayer(2, { id: 'p2', name: 'BB', stack: 5000 });
    table.startHand(rng);
    const actor = table.state.hand!.players.find((p) => p.seat === table.state.hand!.actionOnSeat)!;
    const before = bettingStateSnapshot(table, actor.id);

    expect(() => table.applyAction(actor.id, { type: 'allIn', amount: 1600.5 })).toThrow(
      'Invalid action amount'
    );

    expect(bettingStateSnapshot(table, actor.id)).toEqual(before);
  });

  it('rejects fractional bet amounts without changing chip or betting state', () => {
    const table = new PokerTable('t', { smallBlind: 400, bigBlind: 800 });
    table.seatPlayer(0, { id: 'p0', name: 'Button', stack: 5000 });
    table.seatPlayer(1, { id: 'p1', name: 'SB', stack: 5000 });
    table.seatPlayer(2, { id: 'p2', name: 'BB', stack: 5000 });
    table.startHand(rng);
    settleBettingStreetWithCalls(table);
    const actor = table.state.hand!.players.find((p) => p.seat === table.state.hand!.actionOnSeat)!;
    const before = bettingStateSnapshot(table, actor.id);

    expect(() => table.applyAction(actor.id, { type: 'bet', amount: 1600.5 })).toThrow(
      'Invalid action amount'
    );

    expect(bettingStateSnapshot(table, actor.id)).toEqual(before);
  });

  it('rejects fractional seat stacks and rebuys', () => {
    const table = new PokerTable('t', { smallBlind: 100, bigBlind: 200 });

    expect(() => table.seatPlayer(0, { id: 'p0', name: 'P0', stack: 1000.5 })).toThrow(
      'Invalid stack amount'
    );

    table.seatPlayer(0, { id: 'p0', name: 'P0', stack: 2000 });
    table.seatPlayer(1, { id: 'p1', name: 'P1', stack: 0, status: 'busted', sittingOut: true });

    expect(() => table.rebuy('p1', 1000.5)).toThrow('Invalid rebuy amount');
    expect(table.state.seats[1]?.stack).toBe(0);
    expect(table.state.seats[1]?.status).toBe('busted');
  });

  it('clamps huge all-in amounts to the acting player stack', () => {
    const table = new PokerTable('t', { smallBlind: 400, bigBlind: 800 });
    table.seatPlayer(0, { id: 'p0', name: 'UTG', stack: 5000 });
    table.seatPlayer(1, { id: 'p1', name: 'SB', stack: 5000 });
    table.seatPlayer(2, { id: 'p2', name: 'BB', stack: 5000 });
    table.startHand(rng);
    const hand = table.state.hand!;
    const actor = hand.players.find((p) => p.seat === hand.actionOnSeat)!;

    table.applyAction(actor.id, { type: 'allIn', amount: Number.MAX_SAFE_INTEGER });

    expect(actor.stack).toBe(0);
    expect(actor.totalCommitted).toBe(5000);
    expect(table.state.seats[actor.seat]?.stack).toBe(0);
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

  it('auto-folds a timed-out actor during betting', () => {
    const table = new PokerTable('t', { smallBlind: 400, bigBlind: 800, actionTimeoutMs: 10_000 });
    table.seatPlayer(0, { id: 'p0', name: 'UTG', stack: 5000 });
    table.seatPlayer(1, { id: 'p1', name: 'SB', stack: 5000 });
    table.seatPlayer(2, { id: 'p2', name: 'BB', stack: 5000 });
    table.startHand(rng);

    const hand = table.state.hand!;
    const actor = hand.players.find((p) => p.seat === hand.actionOnSeat)!;
    const now = Date.now();
    hand.actionDeadline = now - 1;

    const result = table.autoAction(now);

    expect(result).toEqual({ playerId: actor.id, action: 'fold' });
    expect(actor.status).toBe('folded');
    expect(hand.log.some((entry) => entry.message.includes('auto-folded (timeout)'))).toBe(true);
  });

  it('starts heads-up post-flop action on the big blind', () => {
    const table = new PokerTable('t', { smallBlind: 400, bigBlind: 800 });
    table.seatPlayer(0, { id: 'button', name: 'Button', stack: 5000 });
    table.seatPlayer(1, { id: 'bb', name: 'Big Blind', stack: 5000 });
    table.startHand(rng);

    table.applyAction('button', { type: 'call' });
    table.applyAction('bb', { type: 'check' });
    table.advancePendingPhase(Number.MAX_SAFE_INTEGER);

    const hand = table.state.hand!;
    expect(hand.street).toBe('flop');
    expect(hand.phase).toBe('betting');
    expect(hand.actionOnSeat).toBe(1);
  });

  it('advances the button once between hands', () => {
    const table = new PokerTable('t', { smallBlind: 400, bigBlind: 800 });
    table.seatPlayer(0, { id: 'p0', name: 'P0', stack: 5000 });
    table.seatPlayer(1, { id: 'p1', name: 'P1', stack: 5000 });
    table.startHand(rng);
    expect(table.state.hand?.buttonSeat).toBe(0);

    table.state.hand!.phase = 'showdown';
    table.advanceToNextHand();
    expect(table.state.hand?.buttonSeat).toBe(1);

    table.state.hand!.phase = 'showdown';
    table.advanceToNextHand();
    expect(table.state.hand?.buttonSeat).toBe(0);
  });

  it('does not start a hand with only one active ready seat', () => {
    const table = new PokerTable('t', { smallBlind: 400, bigBlind: 800 });
    table.seatPlayer(0, { id: 'p0', name: 'P0', stack: 5000 });
    table.seatPlayer(1, { id: 'p1', name: 'P1', stack: 5000 });
    table.setSittingOut('p1', true);

    expect(() => table.beginNextHandIfReady()).not.toThrow();
    expect(table.state.hand).toBeNull();
  });

  it('does not silently reset a busted stack between hands', () => {
    const table = new PokerTable('t', { smallBlind: 100, bigBlind: 200 });
    table.seatPlayer(0, { id: 'winner', name: 'Winner', stack: 1000 });
    table.seatPlayer(1, { id: 'loser', name: 'Loser', stack: 1000 });
    table.startHand(rng);

    const hand = table.state.hand!;
    hand.board = [C('A', 'S'), C('K', 'S'), C('Q', 'S'), C('J', 'S'), C('2', 'D')];
    const winner = hand.players.find((p) => p.id === 'winner')!;
    const loser = hand.players.find((p) => p.id === 'loser')!;
    winner.holeCards = [C('T', 'S'), C('9', 'D')];
    loser.holeCards = [C('3', 'C'), C('4', 'D')];
    winner.stack = 0;
    loser.stack = 0;
    winner.totalCommitted = 1000;
    loser.totalCommitted = 1000;
    winner.status = 'allIn';
    loser.status = 'allIn';
    table.state.seats[winner.seat]!.stack = 0;
    table.state.seats[loser.seat]!.stack = 0;

    (table as any).finishHand();

    expect(table.state.seats[0]?.stack).toBe(2000);
    expect(table.state.seats[1]?.stack).toBe(0);
    expect(table.state.seats[1]?.status).toBe('busted');
    expect(table.state.seats[1]?.sittingOut).toBe(true);
    expect(hand.log.some((entry) => entry.message === 'Loser is out of chips')).toBe(true);

    table.advanceToNextHand();

    expect(table.state.seats[1]?.stack).toBe(0);
    expect(table.state.hand).toBeNull();
  });

  it('rebuy is explicit and returns a busted player to the next hand', () => {
    const table = new PokerTable('t', { smallBlind: 100, bigBlind: 200 });
    table.seatPlayer(0, { id: 'p0', name: 'P0', stack: 2000 });
    table.seatPlayer(1, { id: 'p1', name: 'P1', stack: 0, status: 'busted', sittingOut: true });

    table.rebuy('p1');

    expect(table.state.seats[1]?.stack).toBe(10000);
    expect(table.state.seats[1]?.status).toBe('active');
    expect(table.state.seats[1]?.sittingOut).toBe(false);
    expect(table.state.log.some((entry) => entry.message === 'P1 rebought for 10000')).toBe(true);

    table.advanceToNextHand();
    table.advanceStartGate(table.state.startGate!.startsAt + 1);

    expect(table.state.hand?.players.map((player) => player.id).sort()).toEqual(['p0', 'p1']);
  });

  it('excludes sitting-out seats from deals and blinds', () => {
    const table = new PokerTable('t', { smallBlind: 100, bigBlind: 200 });
    table.seatPlayer(0, { id: 'p0', name: 'P0', stack: 5000 });
    table.seatPlayer(1, { id: 'p1', name: 'P1', stack: 5000 });
    table.seatPlayer(2, { id: 'p2', name: 'P2', stack: 5000 });
    table.setSittingOut('p1', true);

    table.startHand(rng);

    const hand = table.state.hand!;
    expect(hand.players.map((player) => player.id).sort()).toEqual(['p0', 'p2']);
    expect(hand.log.some((entry) => entry.message.includes('P1 posts'))).toBe(false);
  });
});
