import { describe, expect, it } from 'vitest';
import { PokerTable } from '../src/table';

const zeroRng = () => 0.42; // deterministic-ish

describe('discard phase timeout', () => {
  it('uses a default discard timeout', () => {
    const table = new PokerTable('t');

    expect(table.state.config.discardTimeoutMs).toBe(30_000);
  });

  it('auto-discards leftmost card on timeout', () => {
    const table = new PokerTable('t', { discardTimeoutMs: 0 });
    table.seatPlayer(0, { id: 'p1', name: 'Alice', stack: 1000 });
    table.seatPlayer(1, { id: 'p2', name: 'Bob', stack: 1000 });
    table.startHand(zeroRng);
    const hand = table.state.hand!;
    // jump into discard phase manually
    hand.phase = 'discard';
    hand.street = 'flop';
    hand.discardPending = hand.players.map((p) => p.id);
    hand.discardDeadline = Date.now() - 1;
    const originalCounts = hand.players.map((p) => p.holeCards.length);
    table.autoDiscard();
    expect(hand.discardPending.length).toBe(0);
    hand.players.forEach((p, idx) => {
      expect(p.holeCards.length).toBe(originalCounts[idx] - 1);
    });
    const logLine = hand.log.find((l) => l.message.includes('discarded (auto)'));
    expect(logLine).toBeTruthy();
  });

  it('lets the same player discard on multiple streets in one hand', () => {
    const table = new PokerTable('t');
    table.seatPlayer(0, { id: 'p1', name: 'Alice', stack: 1000 });
    table.seatPlayer(1, { id: 'p2', name: 'Bob', stack: 1000 });
    table.startHand(zeroRng);
    const hand = table.state.hand!;
    const player = hand.players.find((p) => p.id === 'p1')!;
    const firstCount = player.holeCards.length;

    hand.phase = 'discard';
    hand.street = 'flop';
    hand.discardPending = ['p1'];
    table.applyDiscard('p1', 0);

    expect(player.holeCards.length).toBe(firstCount - 1);
    expect(hand.street).toBe('turn');
    expect(hand.phase).toBe('betting');

    hand.phase = 'discard';
    hand.street = 'turn';
    hand.discardPending = ['p1'];
    table.applyDiscard('p1', 0);

    expect(player.holeCards.length).toBe(firstCount - 2);
    expect(hand.street).toBe('river');
    expect(hand.phase).toBe('betting');
  });

  it('keeps a pending discard usable after a stale discard rejection', () => {
    const table = new PokerTable('t');
    table.seatPlayer(0, { id: 'p1', name: 'Alice', stack: 1000 });
    table.seatPlayer(1, { id: 'p2', name: 'Bob', stack: 1000 });
    table.startHand(zeroRng);
    const hand = table.state.hand!;
    const player = hand.players.find((p) => p.id === 'p1')!;
    const firstCount = player.holeCards.length;

    hand.phase = 'discard';
    hand.street = 'flop';
    hand.discardPending = ['p1'];

    expect(() => table.applyDiscard('p2', 0)).toThrow('Player not pending discard');
    expect(hand.discardPending).toEqual(['p1']);

    table.applyDiscard('p1', 0);

    expect(player.holeCards.length).toBe(firstCount - 1);
    expect(hand.phase).toBe('betting');
  });
});

describe('first hand start gate', () => {
  it('opens a start gate instead of starting immediately when two players sit', () => {
    const table = new PokerTable('t');
    table.seatPlayer(0, { id: 'p1', name: 'Alice', stack: 1000 });
    table.beginNextHandIfReady();

    expect(table.state.startGate).toBeNull();
    expect(table.state.hand).toBeNull();

    table.seatPlayer(1, { id: 'p2', name: 'Bob', stack: 1000 });
    table.beginNextHandIfReady();

    expect(table.state.hand).toBeNull();
    expect(table.state.startGate).toMatchObject({
      minPlayers: 2,
      readyPlayerIds: [],
    });
  });

  it('starts early when all three seated players are ready', () => {
    const table = new PokerTable('t');
    table.seatPlayer(0, { id: 'p1', name: 'Alice', stack: 1000 });
    table.seatPlayer(1, { id: 'p2', name: 'Bob', stack: 1000 });
    table.seatPlayer(2, { id: 'p3', name: 'Charlie', stack: 1000 });
    table.beginNextHandIfReady();

    table.setReadyForHand('p1', true);
    table.setReadyForHand('p2', true);
    table.setReadyForHand('p3', true);

    expect(table.advanceStartGate()).toBe(true);
    expect(table.state.startGate).toBeNull();
    expect(table.state.hand?.players.map((player) => player.id)).toEqual(['p1', 'p2', 'p3']);
  });

  it('starts when the countdown expires without requiring ready clicks', () => {
    const table = new PokerTable('t');
    table.seatPlayer(0, { id: 'p1', name: 'Alice', stack: 1000 });
    table.seatPlayer(1, { id: 'p2', name: 'Bob', stack: 1000 });
    table.beginNextHandIfReady();
    const gate = table.state.startGate!;

    expect(table.advanceStartGate(gate.startsAt + 1)).toBe(true);
    expect(table.state.hand?.players.map((player) => player.id)).toEqual(['p1', 'p2']);
  });
});
