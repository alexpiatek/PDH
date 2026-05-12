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

function stateMessagesFrom(broadcastMessage: ReturnType<typeof vi.fn>) {
  return broadcastMessage.mock.calls
    .map((call) => {
      try {
        const parsed = JSON.parse(call[1] as string);
        return parsed.type === 'state' ? parsed : null;
      } catch {
        return null;
      }
    })
    .filter((msg): msg is { type: 'state'; state: any } => Boolean(msg));
}

function stateMessagesTo(broadcastMessage: ReturnType<typeof vi.fn>, playerId: string) {
  return broadcastMessage.mock.calls
    .filter((call) => {
      const targets = call[2] as Array<{ userId?: string }> | undefined;
      return Array.isArray(targets) && targets.some((presence) => presence.userId === playerId);
    })
    .map((call) => {
      try {
        const parsed = JSON.parse(call[1] as string);
        return parsed.type === 'state' ? parsed : null;
      } catch {
        return null;
      }
    })
    .filter((msg): msg is { type: 'state'; state: any } => Boolean(msg));
}

function connectionFor(state: any, playerId: string) {
  return state.playerConnections[playerId];
}

function activeSessionCount(state: any, playerId: string) {
  return Object.values(state.presences).filter((presence: any) => presence.userId === playerId)
    .length;
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

function forceShowdown(state: any) {
  expect(state.table.hand).toBeTruthy();
  state.table.hand.phase = 'showdown';
  state.table.hand.street = 'showdown';
  state.table.hand.actionOnSeat = -1;
  state.table.hand.actionDeadline = null;
  state.table.hand.pendingNextPhaseAt = null;
  state.table.hand.discardPending = [];
  state.table.hand.discardDeadline = null;
}

function enterBetweenHand(nk: any, dispatcher: any, state: any, now = 100_000, tick = 10) {
  forceShowdown(state);
  const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);
  try {
    pdhMatchHandler.matchLoop({}, logger, nk, dispatcher, tick, state, []);
  } finally {
    nowSpy.mockRestore();
  }
  expect(state.betweenHand).toBeTruthy();
  return state.betweenHand;
}

function sendReadyForNextHand(
  nk: any,
  dispatcher: any,
  state: any,
  sender: any,
  now: number,
  tick: number,
  payload: any = { type: 'readyForNextHand', ready: true }
) {
  const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);
  try {
    pdhMatchHandler.matchLoop({}, logger, nk, dispatcher, tick, state, [
      { opCode: 1, sender, data: encode(payload) },
    ]);
  } finally {
    nowSpy.mockRestore();
  }
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

  it('releases expired disconnected seats outside a hand so new players can join', () => {
    const nk = makeNakamaMock();
    const broadcastMessage = vi.fn();
    const dispatcher = { broadcastMessage };
    const init = pdhMatchHandler.matchInit({}, logger, nk, {
      tableId: 'heads-up',
      buyIn: 5000,
      maxPlayers: 2,
    });
    const state = init.state as any;
    const firstPlayers = [
      { userId: 'u1', sessionId: 's1' },
      { userId: 'u2', sessionId: 's2' },
    ];

    pdhMatchHandler.matchJoin({}, logger, nk, dispatcher, 1, state, firstPlayers);
    for (const presence of firstPlayers) {
      pdhMatchHandler.matchLoop({}, logger, nk, dispatcher, 2, state, [
        {
          opCode: 1,
          sender: presence,
          data: encode({ type: 'join', name: presence.userId, buyIn: 5000 }),
        },
      ]);
    }

    expect(state.table.hand).toBeNull();
    expect(state.table.seats.filter(Boolean)).toHaveLength(2);

    const leaveNow = vi.spyOn(Date, 'now').mockReturnValue(10_000);
    try {
      pdhMatchHandler.matchLeave({}, logger, nk, dispatcher, 3, state, firstPlayers);
    } finally {
      leaveNow.mockRestore();
    }

    const expireNow = vi.spyOn(Date, 'now').mockReturnValue(25_001);
    try {
      pdhMatchHandler.matchLoop({}, logger, nk, dispatcher, 4, state, []);
    } finally {
      expireNow.mockRestore();
    }

    expect(state.table.seats.filter(Boolean)).toHaveLength(0);
    expect(state.playerConnections.u1).toBeUndefined();
    expect(state.playerConnections.u2).toBeUndefined();

    const nextPlayer = { userId: 'u3', sessionId: 's3' };
    pdhMatchHandler.matchJoin({}, logger, nk, dispatcher, 5, state, [nextPlayer]);
    broadcastMessage.mockClear();
    pdhMatchHandler.matchLoop({}, logger, nk, dispatcher, 6, state, [
      {
        opCode: 1,
        sender: nextPlayer,
        data: encode({ type: 'join', name: 'u3', buyIn: 5000 }),
      },
    ]);

    expect(errorMessagesFrom(broadcastMessage)).not.toContain('No open seats');
    expect(state.table.seats.filter(Boolean).map((seat: any) => seat.id)).toEqual(['u3']);
  });

  it('stages the first hand and starts early once all seated players are ready', () => {
    const nk = makeNakamaMock();
    const broadcastMessage = vi.fn();
    const dispatcher = { broadcastMessage };
    const init = pdhMatchHandler.matchInit({}, logger, nk, {
      tableId: 'quick',
      buyIn: 5000,
      maxPlayers: 6,
    });
    let state = init.state as any;
    const presences = [
      { userId: 'u1', sessionId: 's1' },
      { userId: 'u2', sessionId: 's2' },
    ];

    pdhMatchHandler.matchJoin({}, logger, nk, dispatcher, 1, state, presences);
    for (const presence of presences) {
      state = pdhMatchHandler.matchLoop({}, logger, nk, dispatcher, 2, state, [
        {
          opCode: 1,
          sender: presence,
          data: encode({ type: 'join', name: presence.userId, buyIn: 5000 }),
        },
      ]).state as any;
      expect(state.table.hand).toBeNull();
    }

    expect(state.table.startGate).toBeTruthy();

    for (const presence of presences) {
      state = pdhMatchHandler.matchLoop({}, logger, nk, dispatcher, 3, state, [
        {
          opCode: 1,
          sender: presence,
          data: encode({ type: 'readyForHand', ready: true }),
        },
      ]).state as any;
    }

    expect(state.table.startGate).toBeNull();
    expect(state.table.hand).toBeTruthy();
    expect(state.table.hand.players.map((player: any) => player.id)).toEqual(['u1', 'u2']);
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

  it('keeps a player active when one of multiple sessions leaves', () => {
    const { nk, dispatcher, state, presenceById, broadcastMessage } = setupThreePlayerMatch();
    const actor = state.table.hand.players.find(
      (p: any) => p.seat === state.table.hand.actionOnSeat
    );
    const secondSession = { userId: actor.id, sessionId: `${actor.id}-second` };

    pdhMatchHandler.matchJoin({}, logger, nk, dispatcher, 3, state, [secondSession]);
    expect(activeSessionCount(state, actor.id)).toBe(2);

    const handBefore = JSON.stringify(state.table.hand);
    broadcastMessage.mockClear();
    pdhMatchHandler.matchLeave({}, logger, nk, dispatcher, 4, state, [presenceById.get(actor.id)]);

    expect(activeSessionCount(state, actor.id)).toBe(1);
    expect(connectionFor(state, actor.id).status).toBe('connected');
    expect(JSON.stringify(state.table.hand)).toBe(handBefore);
    expect(state.table.seats[actor.seat]?.sittingOut).not.toBe(true);
  });

  it('puts an active player into reconnect grace without immediately folding', () => {
    const { dispatcher, state, presenceById } = setupThreePlayerMatch();
    const actor = state.table.hand.players.find(
      (p: any) => p.seat === state.table.hand.actionOnSeat
    );
    const versionBefore = state.stateVersion;
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(10_000);
    try {
      pdhMatchHandler.matchLeave({}, logger, makeNakamaMock(), dispatcher, 4, state, [
        presenceById.get(actor.id),
      ]);
    } finally {
      nowSpy.mockRestore();
    }

    const updatedActor = state.table.hand.players.find((p: any) => p.id === actor.id);
    expect(connectionFor(state, actor.id)).toMatchObject({
      status: 'reconnecting',
      graceDeadlineMs: 25_000,
    });
    expect(updatedActor.status).toBe('active');
    expect(state.table.seats[actor.seat]?.sittingOut).not.toBe(true);
    expect(state.stateVersion).toBeGreaterThan(versionBefore);
  });

  it('lets a player reconnect before grace expires without duplicating seats or resetting the hand', () => {
    const { nk, dispatcher, state, presenceById } = setupThreePlayerMatch();
    const actor = state.table.hand.players.find(
      (p: any) => p.seat === state.table.hand.actionOnSeat
    );
    const handId = state.table.hand.handId;
    const seatIndex = actor.seat;

    let nowSpy = vi.spyOn(Date, 'now').mockReturnValue(10_000);
    try {
      pdhMatchHandler.matchLeave({}, logger, nk, dispatcher, 4, state, [
        presenceById.get(actor.id),
      ]);
    } finally {
      nowSpy.mockRestore();
    }
    const graceVersion = state.stateVersion;

    nowSpy = vi.spyOn(Date, 'now').mockReturnValue(20_000);
    try {
      pdhMatchHandler.matchJoin({}, logger, nk, dispatcher, 5, state, [
        { userId: actor.id, sessionId: 'reconnected-session' },
      ]);
    } finally {
      nowSpy.mockRestore();
    }

    const seatsForPlayer = state.table.seats.filter((seat: any) => seat?.id === actor.id);
    const updatedActor = state.table.hand.players.find((p: any) => p.id === actor.id);
    expect(connectionFor(state, actor.id).status).toBe('connected');
    expect(connectionFor(state, actor.id).graceDeadlineMs).toBeNull();
    expect(seatsForPlayer).toHaveLength(1);
    expect(seatsForPlayer[0].seat).toBe(seatIndex);
    expect(state.table.hand.handId).toBe(handId);
    expect(updatedActor.status).toBe('active');
    expect(state.stateVersion).toBeGreaterThan(graceVersion);
  });

  it('expires reconnect grace with deterministic auto-action and sit-out policy', () => {
    const { nk, dispatcher, state, presenceById } = setupThreePlayerMatch();
    const actor = state.table.hand.players.find(
      (p: any) => p.seat === state.table.hand.actionOnSeat
    );

    let nowSpy = vi.spyOn(Date, 'now').mockReturnValue(10_000);
    try {
      pdhMatchHandler.matchLeave({}, logger, nk, dispatcher, 4, state, [
        presenceById.get(actor.id),
      ]);
    } finally {
      nowSpy.mockRestore();
    }
    const graceVersion = state.stateVersion;

    nowSpy = vi.spyOn(Date, 'now').mockReturnValue(25_001);
    try {
      pdhMatchHandler.matchLoop({}, logger, nk, dispatcher, 5, state, []);
    } finally {
      nowSpy.mockRestore();
    }

    const updatedActor = state.table.hand.players.find((p: any) => p.id === actor.id);
    expect(connectionFor(state, actor.id).status).toBe('disconnected');
    expect(connectionFor(state, actor.id).graceDeadlineMs).toBeNull();
    expect(updatedActor.status).toBe('folded');
    expect(state.table.seats[actor.seat]?.sittingOut).toBe(true);
    expect(
      state.table.hand.log.some((entry: any) => entry.message.includes('auto-folded (timeout)'))
    ).toBe(true);
    expect(state.stateVersion).toBeGreaterThan(graceVersion);
  });

  it('keeps a non-acting disconnected player in grace without corrupting the hand', () => {
    const { dispatcher, state, presenceById } = setupThreePlayerMatch();
    const actor = state.table.hand.players.find(
      (p: any) => p.seat === state.table.hand.actionOnSeat
    );
    const nonActor = state.table.hand.players.find((p: any) => p.id !== actor.id);
    const handBefore = JSON.stringify(state.table.hand);
    const versionBefore = state.stateVersion;

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(10_000);
    try {
      pdhMatchHandler.matchLeave({}, logger, makeNakamaMock(), dispatcher, 4, state, [
        presenceById.get(nonActor.id),
      ]);
    } finally {
      nowSpy.mockRestore();
    }

    expect(connectionFor(state, nonActor.id).status).toBe('reconnecting');
    expect(JSON.stringify(state.table.hand)).toBe(handBefore);
    expect(state.stateVersion).toBeGreaterThan(versionBefore);
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

  it('applies an expired betting timer before processing a late player action', () => {
    const { nk, dispatcher, state, presenceById, broadcastMessage } = setupThreePlayerMatch();
    const hand = state.table.hand;
    const actor = hand.players.find((p: any) => p.seat === hand.actionOnSeat);
    const sender = presenceById.get(actor.id);
    const deadline = 1_000_000;
    hand.actionDeadline = deadline;
    const versionBefore = state.stateVersion;

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(deadline + 1);
    try {
      broadcastMessage.mockClear();
      pdhMatchHandler.matchLoop({}, logger, nk, dispatcher, 3, state, [
        {
          opCode: 1,
          sender,
          data: encode({ type: 'action', action: 'call', seq: 1 }),
        },
      ]);
    } finally {
      nowSpy.mockRestore();
    }

    const updatedActor = state.table.hand.players.find((p: any) => p.id === actor.id);
    expect(updatedActor.status).toBe('folded');
    expect(
      state.table.hand.log.some((entry: any) => entry.message === `${actor.name} called 800`)
    ).toBe(false);
    expect(
      state.table.hand.log.some((entry: any) => entry.message.includes('auto-folded (timeout)'))
    ).toBe(true);
    expect(errorMessagesFrom(broadcastMessage)).toContain('Not your turn');
    expect(state.stateVersion).toBeGreaterThan(versionBefore);
  });

  it('accepts a valid betting action before the action deadline', () => {
    const { nk, dispatcher, state, presenceById, broadcastMessage } = setupThreePlayerMatch();
    const hand = state.table.hand;
    const actor = hand.players.find((p: any) => p.seat === hand.actionOnSeat);
    const sender = presenceById.get(actor.id);
    const versionBefore = state.stateVersion;
    const committedBefore = actor.totalCommitted;
    hand.actionDeadline = 1_000_000;

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(999_999);
    try {
      broadcastMessage.mockClear();
      pdhMatchHandler.matchLoop({}, logger, nk, dispatcher, 3, state, [
        {
          opCode: 1,
          sender,
          data: encode({ type: 'action', action: 'call', seq: 1 }),
        },
      ]);
    } finally {
      nowSpy.mockRestore();
    }

    const updatedActor = state.table.hand.players.find((p: any) => p.id === actor.id);
    expect(errorMessagesFrom(broadcastMessage)).toEqual([]);
    expect(updatedActor.status).not.toBe('folded');
    expect(updatedActor.totalCommitted).toBeGreaterThan(committedBefore);
    expect(state.stateVersion).toBeGreaterThan(versionBefore);
  });

  it('auto-discards before processing a late discard message', () => {
    const { nk, dispatcher, state, presenceById, broadcastMessage } = setupThreePlayerMatch();
    const hand = state.table.hand;
    hand.phase = 'discard';
    hand.street = 'flop';
    hand.actionOnSeat = -1;
    hand.actionDeadline = null;
    hand.pendingNextPhaseAt = null;
    hand.discardPending = hand.players.map((p: any) => p.id);
    hand.discardDeadline = 1_000_000;
    const playerId = hand.discardPending[0];
    const playerBefore = hand.players.find((p: any) => p.id === playerId);
    const cardsBefore = playerBefore.holeCards.length;
    const versionBefore = state.stateVersion;

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_001);
    try {
      broadcastMessage.mockClear();
      pdhMatchHandler.matchLoop({}, logger, nk, dispatcher, 3, state, [
        {
          opCode: 1,
          sender: presenceById.get(playerId),
          data: encode({ type: 'discard', index: 0, seq: 1 }),
        },
      ]);
    } finally {
      nowSpy.mockRestore();
    }

    const playerAfter = state.table.hand.players.find((p: any) => p.id === playerId);
    expect(playerAfter.holeCards.length).toBe(cardsBefore - 1);
    expect(errorMessagesFrom(broadcastMessage)).toContain('Not in discard phase');
    expect(state.stateVersion).toBeGreaterThan(versionBefore);
  });

  it('includes state version and server time in authoritative state snapshots', () => {
    const { nk, dispatcher, state, presenceById, broadcastMessage } = setupThreePlayerMatch();
    const hand = state.table.hand;
    const actor = hand.players.find((p: any) => p.seat === hand.actionOnSeat);
    const sender = presenceById.get(actor.id);

    broadcastMessage.mockClear();
    pdhMatchHandler.matchLoop({}, logger, nk, dispatcher, 3, state, [
      { opCode: 1, sender, data: encode(actionPayloadFor(hand, actor.id, 1)) },
    ]);

    const stateMessages = stateMessagesFrom(broadcastMessage);
    expect(stateMessages.length).toBeGreaterThan(0);
    const latest = stateMessages[stateMessages.length - 1].state;
    expect(latest.stateVersion).toBe(state.stateVersion);
    expect(Number.isInteger(latest.serverTimeMs)).toBe(true);
    expect(latest.serverTimeMs).toBeGreaterThan(0);
  });

  it('includes personalized legal actions in authoritative state snapshots', () => {
    const { nk, dispatcher, state, presenceById, broadcastMessage } = setupThreePlayerMatch();
    const hand = state.table.hand;
    const actor = hand.players.find((p: any) => p.seat === hand.actionOnSeat);
    const nonActor = hand.players.find((p: any) => p.id !== actor.id);

    broadcastMessage.mockClear();
    pdhMatchHandler.matchLoop({}, logger, nk, dispatcher, 3, state, [
      { opCode: 1, sender: presenceById.get(actor.id), data: encode({ type: 'requestState' }) },
      {
        opCode: 1,
        sender: presenceById.get(nonActor.id),
        data: encode({ type: 'requestState' }),
      },
    ]);

    const actorSnapshot = stateMessagesTo(broadcastMessage, actor.id).at(-1)?.state;
    expect(actorSnapshot?.you.playerId).toBe(actor.id);
    expect(actorSnapshot?.legalActions).toMatchObject({
      phase: 'betting',
      isActor: true,
      betting: {
        canFold: true,
        canCall: true,
        callAmount: 800,
        canRaise: true,
        minRaiseTo: 1600,
      },
    });

    const nonActorSnapshot = stateMessagesTo(broadcastMessage, nonActor.id).at(-1)?.state;
    expect(nonActorSnapshot?.you.playerId).toBe(nonActor.id);
    expect(nonActorSnapshot?.legalActions).toMatchObject({
      phase: 'betting',
      isActor: false,
      reason: 'not_your_turn',
    });
    expect(nonActorSnapshot?.legalActions.betting).toBeUndefined();
  });

  it('enters server-owned between-hand state after showdown settlement', () => {
    const { nk, dispatcher, state, broadcastMessage } = setupThreePlayerMatch();
    const versionBefore = state.stateVersion;
    const between = enterBetweenHand(nk, dispatcher, state, 100_000);

    expect(between.startedAtMs).toBe(100_000);
    expect(between.minUntilMs).toBe(106_000);
    expect(between.autoStartAtMs).toBe(112_000);
    expect(between.readyPlayerIds).toEqual([]);
    expect(state.table.hand.phase).toBe('showdown');
    expect(state.stateVersion).toBeGreaterThan(versionBefore);

    const stateMessages = stateMessagesFrom(broadcastMessage);
    const latest = stateMessages[stateMessages.length - 1]?.state;
    expect(latest.betweenHandStartedAtMs).toBe(100_000);
    expect(latest.betweenHandMinUntilMs).toBe(106_000);
    expect(latest.betweenHandAutoStartAtMs).toBe(112_000);
    expect(latest.readyForNextHandPlayerIds).toEqual([]);
  });

  it('treats nextHand before the minimum reveal window as readiness only', () => {
    const { nk, dispatcher, state, presenceById } = setupThreePlayerMatch();
    const between = enterBetweenHand(nk, dispatcher, state, 100_000);
    const handId = state.table.hand.handId;
    const versionBeforeReady = state.stateVersion;

    sendReadyForNextHand(
      nk,
      dispatcher,
      state,
      presenceById.get('u1'),
      between.minUntilMs - 1,
      11,
      {
        type: 'nextHand',
        seq: 1,
      }
    );

    expect(state.table.hand.handId).toBe(handId);
    expect(state.table.hand.phase).toBe('showdown');
    expect(state.betweenHand.readyPlayerIds).toEqual(['u1']);
    expect(state.stateVersion).toBeGreaterThan(versionBeforeReady);
  });

  it('starts the next hand after the minimum window once all eligible players are ready', () => {
    const { nk, dispatcher, state, presenceById } = setupThreePlayerMatch();
    const between = enterBetweenHand(nk, dispatcher, state, 100_000);
    const handId = state.table.hand.handId;

    sendReadyForNextHand(nk, dispatcher, state, presenceById.get('u1'), 101_000, 11);
    sendReadyForNextHand(nk, dispatcher, state, presenceById.get('u2'), between.minUntilMs + 1, 12);
    expect(state.table.hand.handId).toBe(handId);

    sendReadyForNextHand(nk, dispatcher, state, presenceById.get('u3'), between.minUntilMs + 2, 13);

    expect(state.betweenHand).toBeNull();
    expect(state.table.hand).toBeTruthy();
    expect(state.table.hand.handId).not.toBe(handId);
    expect(state.table.hand.phase).toBe('betting');
  });

  it('auto-starts after the maximum between-hand timeout when not all players are ready', () => {
    const { nk, dispatcher, state, presenceById } = setupThreePlayerMatch();
    const between = enterBetweenHand(nk, dispatcher, state, 100_000);
    const handId = state.table.hand.handId;

    sendReadyForNextHand(nk, dispatcher, state, presenceById.get('u1'), 101_000, 11);

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(between.autoStartAtMs + 1);
    try {
      pdhMatchHandler.matchLoop({}, logger, nk, dispatcher, 12, state, []);
    } finally {
      nowSpy.mockRestore();
    }

    expect(state.betweenHand).toBeNull();
    expect(state.table.hand).toBeTruthy();
    expect(state.table.hand.handId).not.toBe(handId);
    expect(state.table.hand.phase).toBe('betting');
  });

  it('moves to waiting state instead of starting when fewer than two eligible players remain', () => {
    const { nk, dispatcher, state } = setupThreePlayerMatch();
    const between = enterBetweenHand(nk, dispatcher, state, 100_000);

    state.table.seats[1].stack = 0;
    state.table.seats[1].status = 'busted';
    state.table.seats[1].sittingOut = true;
    state.table.seats[2].stack = 0;
    state.table.seats[2].status = 'busted';
    state.table.seats[2].sittingOut = true;

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(between.minUntilMs + 1);
    try {
      pdhMatchHandler.matchLoop({}, logger, nk, dispatcher, 11, state, []);
    } finally {
      nowSpy.mockRestore();
    }

    expect(state.betweenHand).toBeNull();
    expect(state.table.hand).toBeNull();
    expect(state.table.startGate).toBeNull();
  });

  it('increments stateVersion on between-hand start, readiness changes, and next-hand start', () => {
    const { nk, dispatcher, state, presenceById } = setupThreePlayerMatch();
    const versionBeforeBetween = state.stateVersion;
    const between = enterBetweenHand(nk, dispatcher, state, 100_000);
    const versionAfterBetween = state.stateVersion;

    sendReadyForNextHand(nk, dispatcher, state, presenceById.get('u1'), 101_000, 11);
    const versionAfterReady = state.stateVersion;
    sendReadyForNextHand(nk, dispatcher, state, presenceById.get('u2'), between.minUntilMs + 1, 12);
    sendReadyForNextHand(nk, dispatcher, state, presenceById.get('u3'), between.minUntilMs + 2, 13);

    expect(versionAfterBetween).toBeGreaterThan(versionBeforeBetween);
    expect(versionAfterReady).toBeGreaterThan(versionAfterBetween);
    expect(state.stateVersion).toBeGreaterThan(versionAfterReady);
  });

  it('preserves reconnect grace during between-hand state', () => {
    const { nk, dispatcher, state, presenceById } = setupThreePlayerMatch();
    const between = enterBetweenHand(nk, dispatcher, state, 100_000);
    const handId = state.table.hand.handId;

    let nowSpy = vi.spyOn(Date, 'now').mockReturnValue(101_000);
    try {
      pdhMatchHandler.matchLeave({}, logger, nk, dispatcher, 11, state, [presenceById.get('u1')]);
    } finally {
      nowSpy.mockRestore();
    }

    expect(connectionFor(state, 'u1')).toMatchObject({
      status: 'reconnecting',
      graceDeadlineMs: 116_000,
    });
    expect(state.table.hand.handId).toBe(handId);
    expect(state.betweenHand.handId).toBe(between.handId);

    nowSpy = vi.spyOn(Date, 'now').mockReturnValue(104_000);
    try {
      pdhMatchHandler.matchJoin({}, logger, nk, dispatcher, 12, state, [
        { userId: 'u1', sessionId: 'u1-reconnected' },
      ]);
    } finally {
      nowSpy.mockRestore();
    }

    expect(connectionFor(state, 'u1').status).toBe('connected');
    expect(connectionFor(state, 'u1').graceDeadlineMs).toBeNull();
    expect(state.table.hand.handId).toBe(handId);
    expect(state.betweenHand.handId).toBe(between.handId);
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
