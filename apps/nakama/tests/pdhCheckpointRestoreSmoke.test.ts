import { describe, expect, it, vi } from 'vitest';
import { PDH_CHECKPOINT_COLLECTION, pdhMatchHandler } from '../src/pdhMatch';
import { LOBBY_GAMEPLAY_MATCH_MODULE, rpcCreateTable, rpcJoinByCode } from '../src/pokerLobby';
import { MatchOpCode } from '../src/protocol';

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

interface MockMatchRecord {
  matchId: string;
  label: string;
  size: number;
}

function makeSmokeNakamaMock() {
  const storage = new Map<string, Record<string, unknown>>();
  const versions = new Map<string, string>();
  const matches = new Map<string, MockMatchRecord>();
  let nextMatchNumber = 1;

  const storageKey = (object: { collection: string; key: string; userId: string }) =>
    `${object.collection}:${object.userId}:${object.key}`;

  const nextVersion = (key: string) => {
    const current = Number(versions.get(key) ?? '0');
    const next = String(current + 1);
    versions.set(key, next);
    return next;
  };

  const nk = {
    binaryToString: (data: Uint8Array) => new TextDecoder().decode(data),
    matchCreate: vi.fn((module: string, params: Record<string, unknown>) => {
      if (module !== LOBBY_GAMEPLAY_MATCH_MODULE) {
        throw new Error(`Unexpected module: ${module}`);
      }
      const matchId = `match-${nextMatchNumber}`;
      nextMatchNumber += 1;
      const tableId = typeof params.tableId === 'string' ? params.tableId : 'main';
      matches.set(matchId, {
        matchId,
        label: JSON.stringify({ tableId }),
        size: 0,
      });
      return matchId;
    }),
    matchList: vi.fn(
      (limit: number, authoritative: boolean, label: string, minSize: number, maxSize: number) => {
        return [...matches.values()]
          .filter((match) => (label ? match.label === label : true))
          .filter((match) => match.size >= minSize && match.size <= maxSize)
          .slice(0, limit)
          .map((match) => ({
            matchId: match.matchId,
            label: match.label,
            size: match.size,
            authoritative,
          }));
      }
    ),
    matchGet: vi.fn((matchId: string) => {
      const match = matches.get(matchId);
      return match
        ? {
            matchId: match.matchId,
            label: match.label,
            size: match.size,
          }
        : null;
    }),
    storageRead: vi.fn((objects: Array<{ collection: string; key: string; userId: string }>) =>
      objects
        .map((object) => {
          const key = storageKey(object);
          const value = storage.get(key);
          return value
            ? {
                collection: object.collection,
                key: object.key,
                userId: object.userId,
                value,
                version: versions.get(key) ?? '1',
              }
            : null;
        })
        .filter((object): object is Record<string, unknown> => Boolean(object))
    ),
    storageWrite: vi.fn(
      (
        objects: Array<{
          collection: string;
          key: string;
          userId: string;
          value: Record<string, unknown>;
          version?: string;
        }>
      ) => {
        for (const object of objects) {
          const key = storageKey(object);
          const currentVersion = versions.get(key);
          if (object.version !== undefined && currentVersion && object.version !== currentVersion) {
            throw new Error('storage version conflict');
          }
          storage.set(key, object.value);
          nextVersion(key);
        }
        return objects.map((object) => ({
          collection: object.collection,
          key: object.key,
          userId: object.userId,
          value: object.value,
          version: versions.get(storageKey(object)) ?? '1',
        }));
      }
    ),
  };

  return {
    nk,
    storage,
    matches,
    removeMatch(matchId: string) {
      matches.delete(matchId);
    },
    checkpointFor(tableId: string) {
      return storage.get(`${PDH_CHECKPOINT_COLLECTION}:${SYSTEM_USER_ID}:${tableId}`) as any;
    },
  };
}

function encode(payload: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload));
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
        return parsed.type === 'state' ? parsed.state : null;
      } catch {
        return null;
      }
    })
    .filter((state): state is any => Boolean(state));
}

function sendClientMessage(
  nk: any,
  dispatcher: any,
  state: any,
  tick: number,
  sender: { userId: string; sessionId: string },
  payload: unknown
) {
  pdhMatchHandler.matchLoop({}, logger, nk, dispatcher, tick, state, [
    {
      opCode: MatchOpCode.ClientMessage,
      sender,
      data: encode(payload),
    },
  ]);
}

function expireStartGate(nk: any, dispatcher: any, state: any) {
  expect(state.table.startGate).toBeTruthy();
  const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(state.table.startGate.startsAt + 1);
  try {
    pdhMatchHandler.matchLoop({}, logger, nk, dispatcher, 10, state, []);
  } finally {
    nowSpy.mockRestore();
  }
}

function nextSeq(seqByPlayer: Map<string, number>, playerId: string) {
  const next = (seqByPlayer.get(playerId) ?? 0) + 1;
  seqByPlayer.set(playerId, next);
  return next;
}

function bettingPayloadFor(hand: any, playerId: string, seqByPlayer: Map<string, number>) {
  const player = hand.players.find((p: any) => p.id === playerId);
  const toCall = hand.currentBet - player.betThisStreet;
  return {
    type: 'action',
    action: toCall > 0 ? 'call' : 'check',
    seq: nextSeq(seqByPlayer, playerId),
  };
}

function currentActor(state: any) {
  const hand = state.table.hand;
  const actor = hand.players.find((player: any) => player.seat === hand.actionOnSeat);
  if (!actor) {
    throw new Error(`No actor for actionOnSeat=${hand.actionOnSeat}`);
  }
  return actor;
}

function advancePendingPhase(nk: any, dispatcher: any, state: any, tick: number) {
  const pendingAt = state.table.hand?.pendingNextPhaseAt;
  if (!pendingAt) return;
  const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(pendingAt + 1);
  try {
    pdhMatchHandler.matchLoop({}, logger, nk, dispatcher, tick, state, []);
  } finally {
    nowSpy.mockRestore();
  }
}

function advanceRestoredHandToShowdown(
  nk: any,
  dispatcher: any,
  state: any,
  presenceById: Map<string, { userId: string; sessionId: string }>
) {
  const seqByPlayer = new Map<string, number>();
  let tick = 30;
  let safety = 96;

  while (state.table.hand?.phase !== 'showdown' && safety > 0) {
    const hand = state.table.hand;
    if (!hand) throw new Error('No hand in progress');

    if (hand.phase === 'betting') {
      if (hand.pendingNextPhaseAt) {
        advancePendingPhase(nk, dispatcher, state, tick);
        tick += 1;
      } else {
        const actor = currentActor(state);
        sendClientMessage(
          nk,
          dispatcher,
          state,
          tick,
          presenceById.get(actor.id)!,
          bettingPayloadFor(hand, actor.id, seqByPlayer)
        );
        tick += 1;
      }
    } else if (hand.phase === 'discard') {
      const pending = [...hand.discardPending];
      if (!pending.length) {
        throw new Error('Discard phase has no pending players');
      }
      for (const playerId of pending) {
        sendClientMessage(nk, dispatcher, state, tick, presenceById.get(playerId)!, {
          type: 'discard',
          index: 0,
          seq: nextSeq(seqByPlayer, playerId),
        });
        tick += 1;
      }
    } else {
      throw new Error(`Unexpected hand phase ${hand.phase}`);
    }

    safety -= 1;
  }

  expect(state.table.hand?.phase).toBe('showdown');
  return tick;
}

describe('pdh checkpoint restore smoke', () => {
  it('restores an interrupted table and plays through the next hand boundary', () => {
    const { nk, removeMatch, checkpointFor } = makeSmokeNakamaMock();
    const originalDispatcher = { broadcastMessage: vi.fn() };
    const restoreDispatcher = { broadcastMessage: vi.fn() };
    const createPayload = rpcCreateTable(
      {},
      logger as any,
      nk as any,
      JSON.stringify({ name: 'Restore Smoke', maxPlayers: 2, isPrivate: true })
    );
    const created = JSON.parse(createPayload) as { code: string; matchId: string };
    const presences = [
      { userId: 'u1', sessionId: 's1' },
      { userId: 'u2', sessionId: 's2' },
    ];
    const restoredPresences = [
      { userId: 'u1', sessionId: 's1-restored' },
      { userId: 'u2', sessionId: 's2-restored' },
    ];
    const presenceById = new Map(restoredPresences.map((presence) => [presence.userId, presence]));

    const init = pdhMatchHandler.matchInit(
      { matchId: created.matchId },
      logger,
      nk,
      { tableId: created.code, maxPlayers: 2 }
    );
    const originalState = init.state as any;
    pdhMatchHandler.matchJoin({}, logger, nk, originalDispatcher, 1, originalState, presences);

    for (const presence of presences) {
      sendClientMessage(nk, originalDispatcher, originalState, 2, presence, {
        type: 'join',
        name: presence.userId,
        buyIn: 10000,
      });
    }
    expireStartGate(nk, originalDispatcher, originalState);

    expect(originalState.table.hand?.phase).toBe('betting');
    const checkpoint = checkpointFor(created.code);
    expect(checkpoint).toBeTruthy();
    expect(checkpoint.privateState.tableState.hand.handId).toBe(originalState.table.hand.handId);
    expect(checkpoint.stateVersion).toBe(originalState.stateVersion);
    const originalSeatOwners = originalState.table.seats.map((seat: any) => seat?.id ?? null);
    const originalHandId = originalState.table.hand.handId;

    removeMatch(created.matchId);
    const joinPayload = rpcJoinByCode(
      {},
      logger as any,
      nk as any,
      JSON.stringify({ code: created.code })
    );
    const recoveredJoin = JSON.parse(joinPayload) as { matchId: string; recovered?: boolean };
    expect(recoveredJoin.recovered).toBe(true);
    expect(recoveredJoin.matchId).not.toBe(created.matchId);

    const restoredInit = pdhMatchHandler.matchInit(
      { matchId: recoveredJoin.matchId },
      logger,
      nk,
      { tableId: created.code, maxPlayers: 2 }
    );
    const restoredState = restoredInit.state as any;
    expect(restoredState.matchId).toBe(recoveredJoin.matchId);
    expect(restoredState.stateVersion).toBeGreaterThan(checkpoint.stateVersion);
    expect(restoredState.table.hand.handId).toBe(originalHandId);
    expect(restoredState.table.seats.map((seat: any) => seat?.id ?? null)).toEqual(
      originalSeatOwners
    );

    pdhMatchHandler.matchJoin(
      {},
      logger,
      nk,
      restoreDispatcher,
      20,
      restoredState,
      restoredPresences
    );
    for (const presence of restoredPresences) {
      sendClientMessage(nk, restoreDispatcher, restoredState, 21, presence, {
        type: 'requestState',
      });
    }

    const u1Snapshot = stateMessagesTo(restoreDispatcher.broadcastMessage, 'u1').at(-1);
    const u2Snapshot = stateMessagesTo(restoreDispatcher.broadcastMessage, 'u2').at(-1);
    const restoredHand = restoredState.table.hand;
    const u1Private = restoredHand.players.find((player: any) => player.id === 'u1');
    const u2Private = restoredHand.players.find((player: any) => player.id === 'u2');

    expect(u1Snapshot.hand.deck).toEqual([]);
    expect(u2Snapshot.hand.deck).toEqual([]);
    expect(u1Snapshot.hand.players.find((player: any) => player.id === 'u1').holeCards).toEqual(
      u1Private.holeCards
    );
    expect(u1Snapshot.hand.players.find((player: any) => player.id === 'u2').holeCards).toEqual(
      u2Private.holeCards.map(() => ({ rank: 'X', suit: 'X' }))
    );
    expect(u2Snapshot.hand.players.find((player: any) => player.id === 'u2').holeCards).toEqual(
      u2Private.holeCards
    );
    expect(u2Snapshot.hand.players.find((player: any) => player.id === 'u1').holeCards).toEqual(
      u1Private.holeCards.map(() => ({ rank: 'X', suit: 'X' }))
    );

    const actor = currentActor(restoredState);
    const actorSnapshot =
      actor.id === 'u1'
        ? stateMessagesTo(restoreDispatcher.broadcastMessage, 'u1').at(-1)
        : stateMessagesTo(restoreDispatcher.broadcastMessage, 'u2').at(-1);
    expect(actorSnapshot.legalActions).toMatchObject({
      phase: 'betting',
      isActor: true,
    });
    expect(actorSnapshot.legalActions.betting).toBeTruthy();

    const showdownTick = advanceRestoredHandToShowdown(
      nk,
      restoreDispatcher,
      restoredState,
      presenceById
    );
    const showdownHandId = restoredState.table.hand.handId;
    expect(restoredState.table.hand.phase).toBe('showdown');

    pdhMatchHandler.matchLoop({}, logger, nk, restoreDispatcher, showdownTick + 1, restoredState, []);
    expect(restoredState.betweenHand?.handId).toBe(showdownHandId);
    const readyAt = restoredState.betweenHand.minUntilMs + 1;
    const readyNow = vi.spyOn(Date, 'now').mockReturnValue(readyAt);
    try {
      for (const presence of restoredPresences) {
        sendClientMessage(nk, restoreDispatcher, restoredState, showdownTick + 2, presence, {
          type: 'readyForNextHand',
          ready: true,
        });
      }
    } finally {
      readyNow.mockRestore();
    }

    expect(restoredState.betweenHand).toBeNull();
    expect(restoredState.table.hand?.handId).not.toBe(showdownHandId);
    expect(restoredState.table.hand?.phase).toBe('betting');
  });
});
