import { describe, expect, it, vi } from 'vitest';
import { pdhMatchHandler } from '../src/pdhMatch';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function makeNakamaMock() {
  return {
    binaryToString: (data: Uint8Array) => new TextDecoder().decode(data),
    matchCreate: vi.fn(() => 'created-match-id'),
    matchList: vi.fn(() => []),
  };
}

function encode(payload: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload));
}

describe('pdhMatchHandler', () => {
  it('advances queued betting phase in match loop ticks', () => {
    const nk = makeNakamaMock();
    const broadcastMessage = vi.fn();
    const dispatcher = { broadcastMessage };

    const init = pdhMatchHandler.matchInit({}, logger, nk, { tableId: 'main' });
    const state = init.state as any;

    const presences = [
      { userId: 'u1' },
      { userId: 'u2' },
      { userId: 'u3' },
    ];

    pdhMatchHandler.matchJoin({}, logger, nk, dispatcher, 1, state, presences);

    const presenceById = new Map(presences.map((p) => [p.userId, p]));

    // Seat all three players so a hand starts.
    for (const p of presences) {
      pdhMatchHandler.matchLoop(
        {},
        logger,
        nk,
        dispatcher,
        2,
        state,
        [{ opCode: 1, sender: p, data: encode({ type: 'join', name: p.userId, buyIn: 5000 }) }]
      );
    }

    expect(state.table.hand).toBeTruthy();
    expect(state.table.hand.phase).toBe('betting');

    // Play out preflop with calls/checks until engine queues next phase.
    let safety = 10;
    while (state.table.hand && !state.table.hand.pendingNextPhaseAt && safety > 0) {
      const hand = state.table.hand;
      const actor = hand.players.find((p: any) => p.seat === hand.actionOnSeat);
      expect(actor).toBeTruthy();
      const sender = presenceById.get(actor.id);
      expect(sender).toBeTruthy();
      const toCall = hand.currentBet - actor.betThisStreet;
      const action = toCall > 0 ? { type: 'action', action: 'call' } : { type: 'action', action: 'check' };

      pdhMatchHandler.matchLoop(
        {},
        logger,
        nk,
        dispatcher,
        3,
        state,
        [{ opCode: 1, sender, data: encode(action) }]
      );
      safety -= 1;
    }

    expect(state.table.hand.pendingNextPhaseAt).not.toBeNull();
    const phaseBeforeTick = state.table.hand.phase;

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(state.table.hand.pendingNextPhaseAt + 1);
    try {
      pdhMatchHandler.matchLoop({}, logger, nk, dispatcher, 4, state, []);
    } finally {
      nowSpy.mockRestore();
    }

    expect(phaseBeforeTick).toBe('betting');
    expect(state.table.hand.phase).toBe('discard');
    expect(state.table.hand.street).toBe('flop');
  });
});
