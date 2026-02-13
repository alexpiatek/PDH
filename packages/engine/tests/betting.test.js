import { describe, expect, it } from 'vitest';
import { PokerTable } from '../src/table';
const rng = () => 0.1;
describe('betting rules', () => {
  it('short all-in raise does not reopen betting', () => {
    const table = new PokerTable('t', { smallBlind: 400, bigBlind: 800 });
    table.seatPlayer(0, { id: 'p0', name: 'UTG', stack: 5000 });
    table.seatPlayer(1, { id: 'p1', name: 'SB', stack: 1900 }); // can only raise short
    table.seatPlayer(2, { id: 'p2', name: 'BB', stack: 5000 });
    table.startHand(rng);
    const hand = table.state.hand;
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
});
