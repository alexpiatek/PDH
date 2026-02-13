import { describe, expect, it } from 'vitest';
import { PokerTable } from '../src/table';
import {
  advanceToShowdownWithCallsAndFirstDiscards,
  createTableWithPlayers,
  discardAllPending,
  discardedCardKeys,
  settleBettingStreetWithCalls,
} from './testUtils';

describe('PDH flow contract', () => {
  it('deals 5 hole cards to each player for 2-9 players', () => {
    for (let playerCount = 2; playerCount <= 9; playerCount += 1) {
      const table = createTableWithPlayers(playerCount, 10000, 1000 + playerCount);
      const hand = table.state.hand!;
      expect(hand.players.length).toBe(playerCount);
      for (const player of hand.players) {
        expect(player.holeCards).toHaveLength(5);
      }
    }
  });

  it('does not allow discards pre-flop', () => {
    const table = createTableWithPlayers(3);
    const hand = table.state.hand!;
    expect(hand.street).toBe('preflop');
    expect(hand.phase).toBe('betting');
    expect(() => table.applyDiscard(hand.players[0].id, 0)).toThrow('Not in discard phase');
  });

  it('requires exactly one discard after flop/turn/river betting before advancing', () => {
    const table = createTableWithPlayers(3);

    // Pre-flop betting completes, then flop betting starts (no pre-flop discard).
    settleBettingStreetWithCalls(table);
    let hand = table.state.hand!;
    expect(hand.street).toBe('flop');
    expect(hand.phase).toBe('betting');
    expect(hand.players.every((p) => p.holeCards.length === 5)).toBe(true);

    // Flop betting -> discard phase.
    settleBettingStreetWithCalls(table);
    hand = table.state.hand!;
    expect(hand.street).toBe('flop');
    expect(hand.phase).toBe('discard');
    expect(hand.discardPending).toHaveLength(3);

    const firstPending = hand.discardPending[0];
    table.applyDiscard(firstPending, 0);

    hand = table.state.hand!;
    expect(hand.street).toBe('flop');
    expect(hand.phase).toBe('discard');
    expect(hand.discardPending).toHaveLength(2);

    discardAllPending(table);
    hand = table.state.hand!;
    expect(hand.street).toBe('turn');
    expect(hand.phase).toBe('betting');
    expect(hand.players.every((p) => p.holeCards.length === 4)).toBe(true);

    // Turn betting -> discard phase -> river betting.
    settleBettingStreetWithCalls(table);
    hand = table.state.hand!;
    expect(hand.street).toBe('turn');
    expect(hand.phase).toBe('discard');
    discardAllPending(table);

    hand = table.state.hand!;
    expect(hand.street).toBe('river');
    expect(hand.phase).toBe('betting');
    expect(hand.players.every((p) => p.holeCards.length === 3)).toBe(true);

    // River betting -> discard phase -> showdown.
    settleBettingStreetWithCalls(table);
    hand = table.state.hand!;
    expect(hand.street).toBe('river');
    expect(hand.phase).toBe('discard');
    discardAllPending(table);

    hand = table.state.hand!;
    expect(hand.street).toBe('showdown');
    expect(hand.phase).toBe('showdown');

    const survivors = hand.players.filter((p) => p.status !== 'folded' && p.status !== 'out');
    expect(survivors.length).toBeGreaterThan(1);
    expect(survivors.every((p) => p.holeCards.length === 2)).toBe(true);
  });

  it('excludes folded players from future discard requirements and rejects folded discard attempts', () => {
    const table = createTableWithPlayers(3);

    // Move to flop betting.
    settleBettingStreetWithCalls(table);

    // Fold p0 during flop betting.
    let hand = table.state.hand!;
    const foldedId = 'p0';
    let safety = 16;
    while (!hand.pendingNextPhaseAt && safety > 0) {
      const actor = hand.players.find((p) => p.seat === hand.actionOnSeat)!;
      const toCall = hand.currentBet - actor.betThisStreet;
      if (actor.id === foldedId) {
        table.applyAction(actor.id, { type: 'fold' });
      } else if (toCall > 0) {
        table.applyAction(actor.id, { type: 'call' });
      } else {
        table.applyAction(actor.id, { type: 'check' });
      }
      hand = table.state.hand!;
      safety -= 1;
    }

    table.advancePendingPhase(hand.pendingNextPhaseAt ?? Date.now());

    hand = table.state.hand!;
    expect(hand.phase).toBe('discard');
    expect(hand.discardPending.includes(foldedId)).toBe(false);
    expect(() => table.applyDiscard(foldedId, 0)).toThrow('Player not pending discard');

    discardAllPending(table);
    hand = table.state.hand!;
    expect(hand.street).toBe('turn');
    if (hand.phase === 'discard') {
      expect(hand.discardPending.includes(foldedId)).toBe(false);
    }
  });

  it('never evaluates discarded cards at showdown', () => {
    const table = createTableWithPlayers(4, 10000, 0x1a2b3c4d);
    const hand = advanceToShowdownWithCallsAndFirstDiscards(table);

    const discarded = discardedCardKeys(hand);
    expect(discarded.size).toBeGreaterThan(0);

    const survivors = hand.players.filter((p) => p.status !== 'folded' && p.status !== 'out');
    expect(survivors.every((p) => p.holeCards.length === 2)).toBe(true);

    for (const winner of hand.showdownWinners) {
      for (const card of winner.bestFive ?? []) {
        const key = `${card.rank}${card.suit}`;
        expect(discarded.has(key)).toBe(false);
      }
    }
  });

  it('is deterministic for equal seed + equal actions', () => {
    const t1 = createTableWithPlayers(4, 10000, 0xabc123);
    const t2 = createTableWithPlayers(4, 10000, 0xabc123);

    const h1 = advanceToShowdownWithCallsAndFirstDiscards(t1);
    const h2 = advanceToShowdownWithCallsAndFirstDiscards(t2);

    const signature = (table: PokerTable) => {
      const hand = table.state.hand!;
      return {
        seats: table.state.seats.map((s) => (s ? { id: s.id, stack: s.stack } : null)),
        street: hand.street,
        phase: hand.phase,
        board: hand.board.map((c) => `${c.rank}${c.suit}`),
        players: hand.players.map((p) => ({
          id: p.id,
          status: p.status,
          stack: p.stack,
          totalCommitted: p.totalCommitted,
          hole: p.holeCards.map((c) => `${c.rank}${c.suit}`),
        })),
        winners: hand.showdownWinners.map((w) => ({
          playerId: w.playerId,
          amount: w.amount,
          handStrength: w.handStrength,
          bestFive: (w.bestFive ?? []).map((c) => `${c.rank}${c.suit}`),
        })),
      };
    };

    expect(signature(t1)).toEqual(signature(t2));
    expect(h1.showdownWinners).toEqual(h2.showdownWinners);
  });
});
