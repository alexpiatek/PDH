import { describe, expect, it, vi } from 'vitest';
import {
  ensurePdhMatch,
  pdhMatchHandler,
  rpcEnsurePdhMatch,
  rpcGetPdhReplay,
  rpcTerminatePdhMatch,
} from '../src/pdhMatch';

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
    matchSignal: vi.fn(() => JSON.stringify({ ok: true })),
  };
}

function encode(payload: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload));
}

function errorMessagesFrom(broadcastMessage: ReturnType<typeof vi.fn>) {
  return broadcastMessage.mock.calls
    .map((call) => {
      try {
        const parsed = JSON.parse(call[1] as string);
        return parsed.type === 'error' ? String(parsed.message) : null;
      } catch {
        return null;
      }
    })
    .filter((msg): msg is string => Boolean(msg));
}

function actionPayloadFor(hand: any, playerId: string, seq: number) {
  const player = hand.players.find((p: any) => p.id === playerId);
  const toCall = hand.currentBet - player.betThisStreet;
  return {
    type: 'action',
    action: toCall > 0 ? 'call' : 'check',
    seq,
  };
}

function expireStartGate(nk: any, dispatcher: any, state: any, tick = 3) {
  expect(state.table.startGate).toBeTruthy();
  const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(state.table.startGate.startsAt + 1);
  try {
    pdhMatchHandler.matchLoop({}, logger, nk, dispatcher, tick, state, []);
  } finally {
    nowSpy.mockRestore();
  }
}

function setupThreePlayerMatch() {
  const nk = makeNakamaMock();
  const broadcastMessage = vi.fn();
  const dispatcher = { broadcastMessage };
  const init = pdhMatchHandler.matchInit({}, logger, nk, { tableId: 'main' });
  const state = init.state as any;
  const presences = [
    { userId: 'u1', sessionId: 's1' },
    { userId: 'u2', sessionId: 's2' },
    { userId: 'u3', sessionId: 's3' },
  ];
  const presenceById = new Map(presences.map((p) => [p.userId, p]));

  pdhMatchHandler.matchJoin({}, logger, nk, dispatcher, 1, state, presences);

  for (const p of presences) {
    pdhMatchHandler.matchLoop({}, logger, nk, dispatcher, 2, state, [
      { opCode: 1, sender: p, data: encode({ type: 'join', name: p.userId, buyIn: 5000 }) },
    ]);
  }

  expireStartGate(nk, dispatcher, state);

  expect(state.table.hand).toBeTruthy();
  expect(state.table.hand.phase).toBe('betting');

  return { nk, dispatcher, state, presences, presenceById, broadcastMessage };
}

describe('pdhMatchHandler', () => {
  it('rejects fractional authoritative match configuration', () => {
    const nk = makeNakamaMock();

    expect(() =>
      pdhMatchHandler.matchInit({}, logger, nk, {
        tableId: 'bad-buyin',
        buyIn: 5000.5,
        maxPlayers: 6,
      })
    ).toThrow('Table buy-in must be an integer');

    expect(() =>
      pdhMatchHandler.matchInit({}, logger, nk, {
        tableId: 'bad-max',
        buyIn: 5000,
        maxPlayers: 6.5,
      })
    ).toThrow('Max players must be an integer');
  });

  it('uses the match buy-in instead of malicious join payload amounts', () => {
    const nk = makeNakamaMock();
    const broadcastMessage = vi.fn();
    const dispatcher = { broadcastMessage };
    const init = pdhMatchHandler.matchInit({}, logger, nk, {
      tableId: 'stakes',
      buyIn: 5000,
      maxPlayers: 6,
    });
    const state = init.state as any;
    const presence = { userId: 'u1', sessionId: 's1' };

    pdhMatchHandler.matchJoin({}, logger, nk, dispatcher, 1, state, [presence]);
    pdhMatchHandler.matchLoop({}, logger, nk, dispatcher, 2, state, [
      {
        opCode: 1,
        sender: presence,
        data: encode({ type: 'join', name: 'u1', buyIn: 999_999_999 }),
      },
    ]);

    expect(errorMessagesFrom(broadcastMessage)).toEqual([]);
    expect(state.table.seats[0]?.id).toBe('u1');
    expect(state.table.seats[0]?.stack).toBe(5000);
    expect(state.table.seats[0]?.buyInTotal).toBe(5000);
  });

  it('uses the match buy-in instead of malicious rebuy payload amounts', () => {
    const nk = makeNakamaMock();
    const broadcastMessage = vi.fn();
    const dispatcher = { broadcastMessage };
    const init = pdhMatchHandler.matchInit({}, logger, nk, {
      tableId: 'rebuy-stakes',
      buyIn: 5000,
      maxPlayers: 6,
    });
    const state = init.state as any;
    const presence = { userId: 'u1', sessionId: 's1' };

    pdhMatchHandler.matchJoin({}, logger, nk, dispatcher, 1, state, [presence]);
    pdhMatchHandler.matchLoop({}, logger, nk, dispatcher, 2, state, [
      { opCode: 1, sender: presence, data: encode({ type: 'join', name: 'u1', buyIn: 5000 }) },
    ]);
    state.table.seats[0].stack = 0;
    state.table.seats[0].status = 'busted';
    state.table.seats[0].sittingOut = true;
    state.table.hand = null;

    broadcastMessage.mockClear();
    pdhMatchHandler.matchLoop({}, logger, nk, dispatcher, 3, state, [
      {
        opCode: 1,
        sender: presence,
        data: encode({ type: 'rebuy', amount: 999_999_999, seq: 1 }),
      },
    ]);

    expect(errorMessagesFrom(broadcastMessage)).toEqual([]);
    expect(state.table.seats[0]?.stack).toBe(5000);
    expect(state.table.seats[0]?.buyInTotal).toBe(10000);
  });

  it('rejects negative action payloads without mutating the hand', () => {
    const { nk, dispatcher, state, presenceById, broadcastMessage } = setupThreePlayerMatch();
    const hand = state.table.hand;
    const actor = hand.players.find((p: any) => p.seat === hand.actionOnSeat);
    const sender = presenceById.get(actor.id);
    const handBefore = JSON.stringify(state.table.hand);

    broadcastMessage.mockClear();
    pdhMatchHandler.matchLoop({}, logger, nk, dispatcher, 3, state, [
      {
        opCode: 1,
        sender,
        data: encode({ type: 'action', action: 'allIn', amount: -1, seq: 1 }),
      },
    ]);

    expect(errorMessagesFrom(broadcastMessage)).toContain('Invalid payload');
    expect(JSON.stringify(state.table.hand)).toBe(handBefore);
  });

  it('clamps huge action amounts to the acting stack', () => {
    const { nk, dispatcher, state, presenceById, broadcastMessage } = setupThreePlayerMatch();
    const hand = state.table.hand;
    const actor = hand.players.find((p: any) => p.seat === hand.actionOnSeat);
    const sender = presenceById.get(actor.id);
    const available = actor.stack + actor.betThisStreet;

    broadcastMessage.mockClear();
    pdhMatchHandler.matchLoop({}, logger, nk, dispatcher, 3, state, [
      {
        opCode: 1,
        sender,
        data: encode({
          type: 'action',
          action: 'allIn',
          amount: Number.MAX_SAFE_INTEGER,
          seq: 1,
        }),
      },
    ]);

    const updatedActor = state.table.hand.players.find((p: any) => p.id === actor.id);
    expect(errorMessagesFrom(broadcastMessage)).toEqual([]);
    expect(updatedActor.stack).toBe(0);
    expect(updatedActor.totalCommitted).toBe(available);
    expect(state.table.seats[updatedActor.seat]?.stack).toBe(0);
  });

  it('enforces maxPlayers inside the gameplay match when join payloads race lobby checks', () => {
    const nk = makeNakamaMock();
    const broadcastMessage = vi.fn();
    const dispatcher = { broadcastMessage };
    const init = pdhMatchHandler.matchInit({}, logger, nk, {
      tableId: 'heads-up',
      buyIn: 5000,
      maxPlayers: 2,
    });
    const state = init.state as any;
    const presences = [
      { userId: 'u1', sessionId: 's1' },
      { userId: 'u2', sessionId: 's2' },
      { userId: 'u3', sessionId: 's3' },
    ];

    pdhMatchHandler.matchJoin({}, logger, nk, dispatcher, 1, state, presences);
    for (const presence of presences) {
      pdhMatchHandler.matchLoop({}, logger, nk, dispatcher, 2, state, [
        {
          opCode: 1,
          sender: presence,
          data: encode({ type: 'join', name: presence.userId, buyIn: 5000 }),
        },
      ]);
    }

    expect(errorMessagesFrom(broadcastMessage)).toContain('No open seats');
    expect(state.table.seats).toHaveLength(2);
    expect(state.table.seats.filter(Boolean).map((seat: any) => seat.id)).toEqual(['u1', 'u2']);
  });

  it('stages the first hand and starts early once three seated players are ready', () => {
    const nk = makeNakamaMock();
    const broadcastMessage = vi.fn();
    const dispatcher = { broadcastMessage };
    const init = pdhMatchHandler.matchInit({}, logger, nk, {
      tableId: 'quick',
      buyIn: 5000,
      maxPlayers: 6,
    });
    const state = init.state as any;
    const presences = [
      { userId: 'u1', sessionId: 's1' },
      { userId: 'u2', sessionId: 's2' },
      { userId: 'u3', sessionId: 's3' },
    ];

    pdhMatchHandler.matchJoin({}, logger, nk, dispatcher, 1, state, presences);
    for (const presence of presences) {
      pdhMatchHandler.matchLoop({}, logger, nk, dispatcher, 2, state, [
        {
          opCode: 1,
          sender: presence,
          data: encode({ type: 'join', name: presence.userId, buyIn: 5000 }),
        },
      ]);
      expect(state.table.hand).toBeNull();
    }

    expect(state.table.startGate).toBeTruthy();

    for (const presence of presences) {
      pdhMatchHandler.matchLoop({}, logger, nk, dispatcher, 3, state, [
        {
          opCode: 1,
          sender: presence,
          data: encode({ type: 'readyForHand', ready: true }),
        },
      ]);
    }

    expect(state.table.startGate).toBeNull();
    expect(state.table.hand).toBeTruthy();
    expect(state.table.hand.players.map((player: any) => player.id)).toEqual(['u1', 'u2', 'u3']);
  });

  it('starts the first hand when the start gate countdown expires', () => {
    const nk = makeNakamaMock();
    const broadcastMessage = vi.fn();
    const dispatcher = { broadcastMessage };
    const init = pdhMatchHandler.matchInit({}, logger, nk, {
      tableId: 'countdown',
      buyIn: 5000,
      maxPlayers: 6,
    });
    const state = init.state as any;
    const presences = [
      { userId: 'u1', sessionId: 's1' },
      { userId: 'u2', sessionId: 's2' },
    ];

    pdhMatchHandler.matchJoin({}, logger, nk, dispatcher, 1, state, presences);
    for (const presence of presences) {
      pdhMatchHandler.matchLoop({}, logger, nk, dispatcher, 2, state, [
        {
          opCode: 1,
          sender: presence,
          data: encode({ type: 'join', name: presence.userId, buyIn: 5000 }),
        },
      ]);
    }

    expect(state.table.hand).toBeNull();
    expireStartGate(nk, dispatcher, state);

    expect(state.table.startGate).toBeNull();
    expect(state.table.hand).toBeTruthy();
    expect(state.table.hand.players.map((player: any) => player.id)).toEqual(['u1', 'u2']);
  });

  it('advances queued betting phase in match loop ticks', () => {
    const nk = makeNakamaMock();
    const broadcastMessage = vi.fn();
    const dispatcher = { broadcastMessage };

    const init = pdhMatchHandler.matchInit({}, logger, nk, { tableId: 'main' });
    const state = init.state as any;

    const presences = [{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }];

    pdhMatchHandler.matchJoin({}, logger, nk, dispatcher, 1, state, presences);

    const presenceById = new Map(presences.map((p) => [p.userId, p]));
    const seqByPlayer = new Map<string, number>();

    // Seat all three players so a hand starts.
    for (const p of presences) {
      pdhMatchHandler.matchLoop({}, logger, nk, dispatcher, 2, state, [
        { opCode: 1, sender: p, data: encode({ type: 'join', name: p.userId, buyIn: 5000 }) },
      ]);
    }

    expireStartGate(nk, dispatcher, state);

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
      const nextSeq = (seqByPlayer.get(actor.id) ?? 0) + 1;
      seqByPlayer.set(actor.id, nextSeq);
      const action =
        toCall > 0
          ? { type: 'action', action: 'call', seq: nextSeq }
          : { type: 'action', action: 'check', seq: nextSeq };

      pdhMatchHandler.matchLoop({}, logger, nk, dispatcher, 3, state, [
        { opCode: 1, sender, data: encode(action) },
      ]);
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
    expect(state.table.hand.phase).toBe('betting');
    expect(state.table.hand.street).toBe('flop');
  });

  it('rejects out-of-turn actions before engine mutation', () => {
    const { nk, dispatcher, state, presenceById, broadcastMessage } = setupThreePlayerMatch();
    const handBefore = JSON.stringify(state.table.hand);
    const hand = state.table.hand;
    const actor = hand.players.find((p: any) => p.seat === hand.actionOnSeat);
    const intruder = hand.players.find((p: any) => p.id !== actor.id);
    const sender = presenceById.get(intruder.id);
    const payload = actionPayloadFor(hand, intruder.id, 1);

    broadcastMessage.mockClear();
    pdhMatchHandler.matchLoop({}, logger, nk, dispatcher, 3, state, [
      { opCode: 1, sender, data: encode(payload) },
    ]);

    expect(errorMessagesFrom(broadcastMessage)).toContain('Not your turn');
    expect(JSON.stringify(state.table.hand)).toBe(handBefore);
  });

  it('guards duplicate rapid actions with per-player sequence checks', () => {
    const { nk, dispatcher, state, presenceById, broadcastMessage } = setupThreePlayerMatch();
    const hand = state.table.hand;
    const actor = hand.players.find((p: any) => p.seat === hand.actionOnSeat);
    const sender = presenceById.get(actor.id);
    const payload = actionPayloadFor(hand, actor.id, 1);

    broadcastMessage.mockClear();
    pdhMatchHandler.matchLoop({}, logger, nk, dispatcher, 3, state, [
      { opCode: 1, sender, data: encode(payload) },
      { opCode: 1, sender, data: encode(payload) },
    ]);

    expect(errorMessagesFrom(broadcastMessage)).toContain('Duplicate or stale action sequence');
    expect(state.lastSeqByPlayer[actor.id]).toBe(1);
  });

  it('requires action sequence numbers for mutating messages', () => {
    const { nk, dispatcher, state, presenceById, broadcastMessage } = setupThreePlayerMatch();
    const hand = state.table.hand;
    const actor = hand.players.find((p: any) => p.seat === hand.actionOnSeat);
    const sender = presenceById.get(actor.id);
    const toCall = hand.currentBet - actor.betThisStreet;
    const payload =
      toCall > 0 ? { type: 'action', action: 'call' } : { type: 'action', action: 'check' };

    broadcastMessage.mockClear();
    pdhMatchHandler.matchLoop({}, logger, nk, dispatcher, 3, state, [
      { opCode: 1, sender, data: encode(payload) },
    ]);

    expect(errorMessagesFrom(broadcastMessage)).toContain('Missing action sequence');
    expect(state.lastSeqByPlayer[actor.id]).toBeUndefined();
  });

  it('rejects unsupported protocol versions as invalid payloads', () => {
    const { nk, dispatcher, state, presenceById, broadcastMessage } = setupThreePlayerMatch();
    const hand = state.table.hand;
    const actor = hand.players.find((p: any) => p.seat === hand.actionOnSeat);
    const sender = presenceById.get(actor.id);
    const payload = { v: 999, type: 'action', action: 'check', seq: 1 };

    broadcastMessage.mockClear();
    pdhMatchHandler.matchLoop({}, logger, nk, dispatcher, 3, state, [
      { opCode: 1, sender, data: encode(payload) },
    ]);

    expect(errorMessagesFrom(broadcastMessage)).toContain('Invalid payload');
    expect(state.lastSeqByPlayer[actor.id]).toBeUndefined();
  });

  it('prevents stale burst replays from becoming valid after turn changes', () => {
    const { nk, dispatcher, state, presenceById, broadcastMessage } = setupThreePlayerMatch();
    const hand = state.table.hand;
    const actor = hand.players.find((p: any) => p.seat === hand.actionOnSeat);
    const seatOrder = [...hand.players].sort((a: any, b: any) => a.seat - b.seat);
    const actorIndex = seatOrder.findIndex((p: any) => p.id === actor.id);
    const contender = seatOrder[(actorIndex + 1) % seatOrder.length];
    const actorSender = presenceById.get(actor.id);
    const contenderSender = presenceById.get(contender.id);

    const contenderSeq1 = actionPayloadFor(hand, contender.id, 1);
    const actorSeq1 = actionPayloadFor(hand, actor.id, 1);

    broadcastMessage.mockClear();
    pdhMatchHandler.matchLoop({}, logger, nk, dispatcher, 3, state, [
      { opCode: 1, sender: contenderSender, data: encode(contenderSeq1) },
      { opCode: 1, sender: actorSender, data: encode(actorSeq1) },
    ]);
    expect(errorMessagesFrom(broadcastMessage)).toContain('Not your turn');
    expect(state.table.hand.actionOnSeat).toBe(contender.seat);

    broadcastMessage.mockClear();
    pdhMatchHandler.matchLoop({}, logger, nk, dispatcher, 4, state, [
      { opCode: 1, sender: contenderSender, data: encode(contenderSeq1) },
    ]);
    expect(errorMessagesFrom(broadcastMessage)).toContain('Duplicate or stale action sequence');

    const contenderSeq2 = actionPayloadFor(state.table.hand, contender.id, 2);
    broadcastMessage.mockClear();
    pdhMatchHandler.matchLoop({}, logger, nk, dispatcher, 5, state, [
      { opCode: 1, sender: contenderSender, data: encode(contenderSeq2) },
    ]);
    expect(errorMessagesFrom(broadcastMessage)).toEqual([]);
    expect(state.lastSeqByPlayer[contender.id]).toBe(2);
  });

  it('ensures an authoritative pdh match via helper/rpc', () => {
    const nk = makeNakamaMock();
    const created = ensurePdhMatch(nk as any, { tableId: 'itest', module: 'pdh' });

    expect(created.created).toBe(true);
    expect(created.tableId).toBe('itest');
    expect(created.module).toBe('pdh');
    expect(created.matchId).toBe('created-match-id');
    expect(nk.matchCreate).toHaveBeenCalledWith('pdh', { tableId: 'itest' });

    nk.matchList.mockReturnValueOnce([
      { label: JSON.stringify({ tableId: 'itest' }), matchId: 'existing-pdh-match' },
    ]);
    const existingPayload = rpcEnsurePdhMatch(
      {},
      logger as any,
      nk as any,
      '"{\\"tableId\\":\\"itest\\"}"'
    );
    const existing = JSON.parse(existingPayload);

    expect(existing.created).toBe(false);
    expect(existing.matchId).toBe('existing-pdh-match');
    expect(existing.tableId).toBe('itest');
  });

  it('records replay events and fetches last N via signal/RPC', () => {
    const { nk, dispatcher, state, presenceById } = setupThreePlayerMatch();
    const hand = state.table.hand;
    const actor = hand.players.find((p: any) => p.seat === hand.actionOnSeat);
    const sender = presenceById.get(actor.id);
    const payload = actionPayloadFor(hand, actor.id, 1);

    pdhMatchHandler.matchLoop({}, logger, nk, dispatcher, 3, state, [
      { opCode: 1, sender, data: encode(payload) },
      { opCode: 1, sender, data: encode(payload) },
    ]);

    const signalResult = pdhMatchHandler.matchSignal(
      {},
      logger,
      nk,
      dispatcher,
      4,
      state,
      JSON.stringify({ type: 'replay:get', limit: 2 })
    );
    const signalPayload = JSON.parse(signalResult.data);
    expect(signalPayload.type).toBe('replay');
    expect(signalPayload.count).toBe(2);
    expect(signalPayload.events[0].actionSeq).toBe(1);
    expect(signalPayload.events[1].outcome).toBe('rejected');

    const replayRpc = rpcGetPdhReplay(
      {},
      logger as any,
      nk as any,
      JSON.stringify({ matchId: state.matchId, limit: 1 })
    );
    const replay = JSON.parse(replayRpc);
    expect(replay.matchId).toBe(state.matchId);
    expect(replay.count).toBe(1);
    expect(replay.events[0].outcome).toBe('rejected');
  });

  it('auto-acts timed-out betting turns in match loop', () => {
    const { nk, dispatcher, state } = setupThreePlayerMatch();
    const hand = state.table.hand;
    const actorId = hand.players.find((p: any) => p.seat === hand.actionOnSeat)?.id;
    expect(actorId).toBeTruthy();
    hand.actionDeadline = Date.now() - 1;

    pdhMatchHandler.matchLoop({}, logger, nk, dispatcher, 3, state, []);

    const actor = state.table.hand.players.find((p: any) => p.id === actorId);
    expect(actor.status).toBe('folded');
    expect(
      state.table.hand.log.some((entry: any) => entry.message.includes('auto-folded (timeout)'))
    ).toBe(true);
  });

  it('signals and terminates a match via admin RPC/signal path', () => {
    const nk = makeNakamaMock();
    const rpcPayload = rpcTerminatePdhMatch(
      {},
      logger as any,
      nk as any,
      JSON.stringify({ matchId: 'match-123', reason: 'stuck table' })
    );
    const parsed = JSON.parse(rpcPayload);
    expect(parsed.matchId).toBe('match-123');
    expect(parsed.signalled).toBe(true);
    expect(nk.matchSignal).toHaveBeenCalledWith(
      'match-123',
      expect.stringContaining('"type":"admin:terminate"')
    );

    const { dispatcher, state } = setupThreePlayerMatch();
    pdhMatchHandler.matchSignal(
      {},
      logger,
      nk as any,
      dispatcher as any,
      10,
      state,
      JSON.stringify({ type: 'admin:terminate', reason: 'test' })
    );

    expect(state.terminateRequested).toBe(true);
    const loopResult = pdhMatchHandler.matchLoop(
      {},
      logger,
      nk as any,
      dispatcher as any,
      11,
      state,
      []
    );
    expect(loopResult).toBeNull();
  });
});
