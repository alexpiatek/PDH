import type * as nkruntime from '@heroiclabs/nakama-runtime';

const enum SmokeOpCode {
  ClientMessage = 1,
  ServerMessage = 2,
}

export const SMOKE_MATCH_MODULE = 'pdh_smoke';
export const SMOKE_RPC_ENSURE_MATCH = 'pdh_smoke_ensure_match';
export const SMOKE_DEFAULT_TABLE_ID = 'smoke-main';
const SMOKE_LABEL_MODE = 'smoke';

interface SmokeClientMessage {
  type: 'inc' | 'requestState';
  amount?: number;
}

interface SmokeServerState {
  tableId: string;
  tick: number;
  counter: number;
  connectedPlayers: number;
  players: string[];
  lastActor: string | null;
}

interface SmokeServerMessage {
  type: 'state' | 'error';
  state?: SmokeServerState;
  message?: string;
}

export interface SmokeMatchState {
  tableId: string;
  tick: number;
  counter: number;
  lastActor: string | null;
  presences: Record<string, nkruntime.Presence>;
}

interface EnsureSmokeMatchInput {
  tableId?: string;
  module?: string;
}

interface EnsureSmokeMatchResult {
  tableId: string;
  module: string;
  matchId: string;
  created: boolean;
}

function normalizeTableId(tableId?: string) {
  const normalized = (tableId ?? '').trim();
  if (!normalized) {
    return SMOKE_DEFAULT_TABLE_ID;
  }
  return normalized;
}

function smokeLabel(tableId: string) {
  return JSON.stringify({ tableId, mode: SMOKE_LABEL_MODE });
}

function decodeClientMessage(nk: nkruntime.Nakama, message: nkruntime.MatchMessage): SmokeClientMessage {
  const payload = nk.binaryToString(message.data);
  return JSON.parse(payload) as SmokeClientMessage;
}

function extractMatchId(match: nkruntime.MatchListEntry): string | null {
  if (typeof match.matchId === 'string' && match.matchId.length > 0) {
    return match.matchId;
  }
  if (typeof match.match_id === 'string' && match.match_id.length > 0) {
    return match.match_id;
  }
  return null;
}

export function findSmokeMatchId(nk: nkruntime.Nakama, tableId: string): string | null {
  const label = smokeLabel(tableId);
  const matches = nk.matchList(100, true, '', 0, 64, '') ?? [];
  for (const match of matches) {
    if (match.label !== label) {
      continue;
    }
    const matchId = extractMatchId(match);
    if (matchId) {
      return matchId;
    }
  }
  return null;
}

export function ensureSmokeMatch(
  nk: nkruntime.Nakama,
  input?: EnsureSmokeMatchInput
): EnsureSmokeMatchResult {
  const tableId = normalizeTableId(input?.tableId);
  const module = (input?.module ?? SMOKE_MATCH_MODULE).trim() || SMOKE_MATCH_MODULE;
  const existing = findSmokeMatchId(nk, tableId);
  if (existing) {
    return {
      tableId,
      module,
      matchId: existing,
      created: false,
    };
  }
  return {
    tableId,
    module,
    matchId: nk.matchCreate(module, { tableId }),
    created: true,
  };
}

function serializeState(state: SmokeMatchState): SmokeServerState {
  const players = Object.keys(state.presences).sort();
  return {
    tableId: state.tableId,
    tick: state.tick,
    counter: state.counter,
    connectedPlayers: players.length,
    players,
    lastActor: state.lastActor,
  };
}

function sendToPresence(
  dispatcher: nkruntime.MatchDispatcher,
  presence: nkruntime.Presence,
  msg: SmokeServerMessage
) {
  dispatcher.broadcastMessage(SmokeOpCode.ServerMessage, JSON.stringify(msg), [presence], null, true);
}

function broadcastState(dispatcher: nkruntime.MatchDispatcher, state: SmokeMatchState) {
  const presences = Object.values(state.presences);
  if (!presences.length) {
    return;
  }
  const msg: SmokeServerMessage = {
    type: 'state',
    state: serializeState(state),
  };
  dispatcher.broadcastMessage(SmokeOpCode.ServerMessage, JSON.stringify(msg), presences, null, true);
}

function matchInit(ctx, logger, nk, params) {
  const tableId = normalizeTableId(params?.tableId as string | undefined);
  const state: SmokeMatchState = {
    tableId,
    tick: 0,
    counter: 0,
    lastActor: null,
    presences: {},
  };

  return {
    state,
    tickRate: 10,
    label: smokeLabel(tableId),
  };
}

function matchJoinAttempt(ctx, logger, nk, dispatcher, tick, state, presence, metadata) {
  return {
    state,
    accept: true,
  };
}

function matchJoin(ctx, logger, nk, dispatcher, tick, state, presences) {
  for (const presence of presences) {
    state.presences[presence.userId] = presence;
  }
  broadcastState(dispatcher, state);
  return { state };
}

function matchLeave(ctx, logger, nk, dispatcher, tick, state, presences) {
  for (const presence of presences) {
    delete state.presences[presence.userId];
  }
  broadcastState(dispatcher, state);
  return { state };
}

function matchLoop(ctx, logger, nk, dispatcher, tick, state, messages) {
  state.tick += 1;
  let broadcast = false;

  for (const message of messages) {
    if (message.opCode !== SmokeOpCode.ClientMessage) {
      continue;
    }

    let payload: SmokeClientMessage;
    try {
      payload = decodeClientMessage(nk, message);
    } catch (error: any) {
      sendToPresence(dispatcher, message.sender, {
        type: 'error',
        message: `invalid payload: ${error?.message ?? 'parse failure'}`,
      });
      continue;
    }

    if (payload.type === 'requestState') {
      sendToPresence(dispatcher, message.sender, {
        type: 'state',
        state: serializeState(state),
      });
      continue;
    }

    if (payload.type === 'inc') {
      const amount = Number.isFinite(payload.amount) ? Math.floor(Number(payload.amount)) : 1;
      const delta = amount > 0 ? amount : 1;
      state.counter += delta;
      state.lastActor = message.sender.userId;
      broadcast = true;
      continue;
    }

    sendToPresence(dispatcher, message.sender, {
      type: 'error',
      message: `unknown message type: ${(payload as any).type}`,
    });
  }

  if (broadcast) {
    broadcastState(dispatcher, state);
  }

  return { state };
}

function matchTerminate(ctx, logger, nk, dispatcher, tick, state, graceSeconds) {
  return { state };
}

function matchSignal(ctx, logger, nk, dispatcher, tick, state, data) {
  return { state, data: 'ok' };
}

export function rpcEnsureSmokeMatch(
  ctx: unknown,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string | undefined
) {
  let input: EnsureSmokeMatchInput | undefined;

  if (payload && payload.trim()) {
    try {
      input = JSON.parse(payload) as EnsureSmokeMatchInput;
    } catch (error: any) {
      throw new Error(`invalid payload JSON: ${error?.message ?? 'parse failure'}`);
    }
  }

  const result = ensureSmokeMatch(nk, input);
  return JSON.stringify(result);
}

export const smokeMatchHandler = {
  matchInit,
  matchJoinAttempt,
  matchJoin,
  matchLeave,
  matchLoop,
  matchTerminate,
  matchSignal,
};

(globalThis as any).smokeMatchInit = matchInit;
(globalThis as any).smokeMatchJoinAttempt = matchJoinAttempt;
(globalThis as any).smokeMatchJoin = matchJoin;
(globalThis as any).smokeMatchLeave = matchLeave;
(globalThis as any).smokeMatchLoop = matchLoop;
(globalThis as any).smokeMatchTerminate = matchTerminate;
(globalThis as any).smokeMatchSignal = matchSignal;
(globalThis as any).rpcEnsureSmokeMatch = rpcEnsureSmokeMatch;

// Nakama JS runtime resolves additional match handlers by auto-suffixed callback keys.
(globalThis as any).matchInit2 = matchInit;
(globalThis as any).matchJoinAttempt2 = matchJoinAttempt;
(globalThis as any).matchJoin2 = matchJoin;
(globalThis as any).matchLeave2 = matchLeave;
(globalThis as any).matchLoop2 = matchLoop;
(globalThis as any).matchTerminate2 = matchTerminate;
(globalThis as any).matchSignal2 = matchSignal;
