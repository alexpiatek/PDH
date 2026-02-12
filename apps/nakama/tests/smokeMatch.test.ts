import { describe, expect, it, vi } from 'vitest';
import {
  SMOKE_MATCH_MODULE,
  ensureSmokeMatch,
  rpcEnsureSmokeMatch,
  smokeMatchHandler,
  type SmokeMatchState,
} from '../src/smokeMatch';

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

function encodeMessage(payload: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload));
}

describe('smokeMatchHandler', () => {
  it('increments shared counter and broadcasts replicated state', () => {
    const nk = makeNakamaMock();
    const broadcastMessage = vi.fn();
    const dispatcher = { broadcastMessage };

    const init = smokeMatchHandler.matchInit({}, logger, nk, { tableId: 'room-1' });
    const state = init.state as SmokeMatchState;

    const p1 = { userId: 'u1' };
    const p2 = { userId: 'u2' };

    smokeMatchHandler.matchJoin({}, logger, nk, dispatcher, 1, state, [p1, p2]);

    const messages = [
      { opCode: 1, sender: p1, data: encodeMessage({ type: 'inc', amount: 2 }) },
      { opCode: 1, sender: p2, data: encodeMessage({ type: 'inc', amount: 1 }) },
    ];

    smokeMatchHandler.matchLoop({}, logger, nk, dispatcher, 2, state, messages);

    expect(state.counter).toBe(3);

    const stateMessages = broadcastMessage.mock.calls
      .map((call) => {
        try {
          return JSON.parse(call[1] as string);
        } catch {
          return null;
        }
      })
      .filter((msg) => msg?.type === 'state');

    expect(stateMessages.length).toBeGreaterThan(0);

    const latest = stateMessages.at(-1);
    expect(latest.state.counter).toBe(3);
    expect(latest.state.connectedPlayers).toBe(2);
    expect(latest.state.players).toEqual(['u1', 'u2']);
  });

  it('returns an error for invalid client payload', () => {
    const nk = makeNakamaMock();
    const broadcastMessage = vi.fn();
    const dispatcher = { broadcastMessage };

    const init = smokeMatchHandler.matchInit({}, logger, nk, { tableId: 'room-2' });
    const state = init.state as SmokeMatchState;
    const p1 = { userId: 'u1' };

    smokeMatchHandler.matchJoin({}, logger, nk, dispatcher, 1, state, [p1]);

    smokeMatchHandler.matchLoop(
      {},
      logger,
      {
        ...nk,
        binaryToString: () => '{bad-json',
      },
      dispatcher,
      2,
      state,
      [{ opCode: 1, sender: p1, data: new TextEncoder().encode('broken') }]
    );

    const errorMessageCall = broadcastMessage.mock.calls.find((call) => {
      try {
        const parsed = JSON.parse(call[1] as string);
        return parsed.type === 'error';
      } catch {
        return false;
      }
    });

    expect(errorMessageCall).toBeTruthy();
  });
});

describe('ensureSmokeMatch / rpcEnsureSmokeMatch', () => {
  it('reuses an existing authoritative match when available', () => {
    const nk = makeNakamaMock();
    nk.matchList = vi.fn(() => [{ match_id: 'existing-id', label: '{"tableId":"smoke-a","mode":"smoke"}' }]);

    const result = ensureSmokeMatch(nk, { tableId: 'smoke-a', module: SMOKE_MATCH_MODULE });

    expect(result.created).toBe(false);
    expect(result.matchId).toBe('existing-id');
    expect(nk.matchCreate).not.toHaveBeenCalled();
  });

  it('creates and returns match id through RPC payload', () => {
    const nk = makeNakamaMock();

    const response = rpcEnsureSmokeMatch(
      {},
      logger,
      nk,
      JSON.stringify({ tableId: 'smoke-b', module: SMOKE_MATCH_MODULE })
    );

    const parsed = JSON.parse(response);
    expect(parsed.created).toBe(true);
    expect(parsed.matchId).toBe('created-match-id');
    expect(nk.matchCreate).toHaveBeenCalledWith(SMOKE_MATCH_MODULE, { tableId: 'smoke-b' });
  });
});
