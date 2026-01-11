import { describe, expect, it } from 'vitest';
import { PokerTable } from '../src/table';

const zeroRng = () => 0.42; // deterministic-ish

describe('discard phase timeout', () => {
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
});
