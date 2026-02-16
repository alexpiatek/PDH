import type * as nkruntime from '@heroiclabs/nakama-runtime';
import { PokerTable, type TableState } from '@pdh/engine';
import { TABLE_CHAT_MAX_LENGTH } from '@pdh/protocol';
import {
  MatchOpCode,
  isMutatingClientMessage,
  parseClientMessagePayload,
  type ClientMessage,
  type MutatingClientMessage,
  type ServerMessage,
  withProtocolVersion,
} from './protocol';

const AUTO_DISCARD_INTERVAL_MS = 500;
const REACTION_COOLDOWN_MS = 2500;
const CHAT_COOLDOWN_MS = 800;
export const DEFAULT_TABLE_ID = 'main';
export const DEFAULT_MATCH_MODULE = 'pdh';
export const PDH_RPC_ENSURE_MATCH = 'pdh_ensure_match';
export const PDH_RPC_GET_REPLAY = 'pdh_debug_get_replay';
export const PDH_RPC_TERMINATE_MATCH = 'pdh_admin_terminate_match';
const REPLAY_MAX_EVENTS = 500;
const REPLAY_DEFAULT_LIMIT = 50;
const REPLAY_MAX_LIMIT = 500;

type ReplayEventKind = 'action' | 'discard' | 'nextHand';
type ReplayOutcome = 'accepted' | 'rejected';

interface ReplayEvent {
  ts: number;
  tick: number;
  matchId: string;
  tableId: string;
  userId: string;
  handIdBefore: string | null;
  handIdAfter: string | null;
  streetBefore: string | null;
  streetAfter: string | null;
  phaseBefore: string | null;
  phaseAfter: string | null;
  actionSeq: number | null;
  kind: ReplayEventKind;
  action?: string;
  amount?: number;
  discardIndex?: number;
  outcome: ReplayOutcome;
  error?: string;
}

interface ReplayState {
  maxEvents: number;
  events: ReplayEvent[];
}

const replayByMatch = new Map<string, ReplayEvent[]>();

interface MatchState {
  matchId: string;
  table: TableState;
  presences: Record<string, nkruntime.Presence>;
  lastSeqByPlayer: Record<string, number>;
  lastReactionAtByPlayer: Record<string, number>;
  lastChatAtByPlayer: Record<string, number>;
  replay: ReplayState;
  lastAutoDiscardMs: number;
  terminateRequested: boolean;
  terminateReason: string | null;
}

interface EnsurePdhMatchInput {
  tableId?: string;
  module?: string;
}

interface EnsurePdhMatchResult {
  tableId: string;
  module: string;
  matchId: string;
  created: boolean;
}

interface GetReplayInput {
  matchId?: string;
  tableId?: string;
  limit?: number;
}

interface TerminateMatchInput {
  matchId: string;
  reason?: string;
}

type NakamaWithMatchSignal = nkruntime.Nakama & {
  matchSignal?: (matchId: string, data: string) => string | void;
};

function readMatchId(ctx: unknown): string | null {
  const c = (ctx ?? {}) as { matchId?: unknown; match_id?: unknown };
  if (typeof c.matchId === 'string' && c.matchId.length > 0) {
    return c.matchId;
  }
  if (typeof c.match_id === 'string' && c.match_id.length > 0) {
    return c.match_id;
  }
  return null;
}

function nowIso() {
  return new Date().toISOString();
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === 'string') {
    return error.message.slice(0, 300);
  }
  if (typeof error === 'string') {
    return error.slice(0, 300);
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') {
      return message.slice(0, 300);
    }
  }
  return String(error ?? 'error').slice(0, 300);
}

function compactFields(fields: Record<string, unknown>) {
  const compact: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      compact[key] = value;
    }
  }
  return compact;
}

function logStructured(
  logger: nkruntime.Logger,
  level: 'info' | 'warn' | 'error',
  event: string,
  fields: Record<string, unknown>
) {
  const payload = JSON.stringify(
    compactFields({
      ts: nowIso(),
      event,
      component: 'pdh_match',
      ...fields,
    })
  );
  if (level === 'info') {
    logger.info('%v', payload);
    return;
  }
  if (level === 'warn') {
    logger.warn('%v', payload);
    return;
  }
  logger.error('%v', payload);
}

function hydrateTable(tableState: TableState): PokerTable {
  const table = new PokerTable(tableState.id);
  table.state = tableState;
  return table;
}

function sendToPresence(
  dispatcher: nkruntime.MatchDispatcher,
  presence: nkruntime.Presence,
  msg: ServerMessage
) {
  dispatcher.broadcastMessage(
    MatchOpCode.ServerMessage,
    JSON.stringify(withProtocolVersion(msg)),
    [presence],
    null,
    true
  );
}

function broadcastServerMessage(
  dispatcher: nkruntime.MatchDispatcher,
  state: MatchState,
  message: ServerMessage
) {
  const presences = Object.values(state.presences);
  if (!presences.length) {
    return;
  }
  dispatcher.broadcastMessage(
    MatchOpCode.ServerMessage,
    JSON.stringify(withProtocolVersion(message)),
    presences,
    null,
    true
  );
}

function broadcastState(dispatcher: nkruntime.MatchDispatcher, state: MatchState) {
  const table = hydrateTable(state.table);
  const presences = Object.values(state.presences);
  for (const presence of presences) {
    const playerId = presence.userId;
    const publicState = table.getPublicState(playerId);
    const msg: ServerMessage = {
      type: 'state',
      state: { ...publicState, you: { playerId } },
    };
    dispatcher.broadcastMessage(
      MatchOpCode.ServerMessage,
      JSON.stringify(withProtocolVersion(msg)),
      [presence],
      null,
      true
    );
  }
}

function seatPlayer(
  table: PokerTable,
  playerId: string,
  name: string,
  buyIn: number,
  desiredSeat?: number
) {
  const alreadySeated = table.state.seats.some((seat) => seat && seat.id === playerId);
  if (alreadySeated) {
    throw new Error('Already seated');
  }
  const seatIndex =
    desiredSeat !== undefined ? desiredSeat : table.state.seats.findIndex((seat) => seat === null);
  if (seatIndex < 0) throw new Error('No open seats');
  table.seatPlayer(seatIndex, { id: playerId, name, stack: buyIn });
  table.beginNextHandIfReady();
  return { seatIndex };
}

function parseClientMessage(nk: nkruntime.Nakama, message: nkruntime.MatchMessage): ClientMessage {
  const payload = nk.binaryToString(message.data);
  const parsed = JSON.parse(payload) as unknown;
  return parseClientMessagePayload(parsed);
}

function ensurePresenceBound(state: MatchState, presence: nkruntime.Presence) {
  const active = state.presences[presence.userId];
  if (!active) {
    throw new Error('Presence not joined');
  }
  if (active.sessionId && presence.sessionId && active.sessionId !== presence.sessionId) {
    throw new Error('Stale session');
  }
}

function ensurePlayerSeated(table: PokerTable, playerId: string) {
  if (!table.state.seats.some((seat) => seat?.id === playerId)) {
    throw new Error('Join required');
  }
}

function ensureBettingTurn(table: PokerTable, playerId: string) {
  ensurePlayerSeated(table, playerId);
  const hand = table.state.hand;
  if (!hand) throw new Error('No hand in progress');
  if (hand.phase !== 'betting') throw new Error('Not in betting phase');
  const actor = hand.players.find((player) => player.seat === hand.actionOnSeat);
  if (!actor || actor.id !== playerId) throw new Error('Not your turn');
}

function ensureDiscardTurn(table: PokerTable, playerId: string) {
  ensurePlayerSeated(table, playerId);
  const hand = table.state.hand;
  if (!hand) throw new Error('No hand in progress');
  if (hand.phase !== 'discard') throw new Error('Not in discard phase');
  if (!hand.discardPending.includes(playerId)) {
    throw new Error('Player not pending discard');
  }
}

function ensureCanAdvanceHand(table: PokerTable, playerId: string) {
  ensurePlayerSeated(table, playerId);
  const hand = table.state.hand;
  if (hand && hand.phase !== 'showdown') {
    throw new Error('Hand not complete');
  }
}

function reserveReactionWindow(state: MatchState, playerId: string, nowMs: number) {
  const last = state.lastReactionAtByPlayer[playerId] ?? 0;
  if (nowMs - last < REACTION_COOLDOWN_MS) {
    throw new Error('Reaction cooldown active');
  }
  state.lastReactionAtByPlayer[playerId] = nowMs;
}

function reserveChatWindow(state: MatchState, playerId: string, nowMs: number) {
  const last = state.lastChatAtByPlayer[playerId] ?? 0;
  if (nowMs - last < CHAT_COOLDOWN_MS) {
    throw new Error('Chat cooldown active');
  }
  state.lastChatAtByPlayer[playerId] = nowMs;
}

function reserveSequence(state: MatchState, playerId: string, message: MutatingClientMessage) {
  if (!Number.isInteger(message.seq) || message.seq < 1) {
    throw new Error('Missing action sequence');
  }
  const lastSeq = state.lastSeqByPlayer[playerId] ?? 0;
  if (message.seq <= lastSeq) {
    throw new Error('Duplicate or stale action sequence');
  }
  // Reserve immediately so delayed/replayed packets from an older turn cannot apply later.
  state.lastSeqByPlayer[playerId] = message.seq;
}

function replayLimit(limit: unknown) {
  const raw = typeof limit === 'number' && Number.isFinite(limit) ? Math.floor(limit) : null;
  if (raw === null) return REPLAY_DEFAULT_LIMIT;
  return Math.max(1, Math.min(REPLAY_MAX_LIMIT, raw));
}

function pushReplay(state: MatchState, event: ReplayEvent) {
  state.replay.events.push(event);
  if (state.replay.events.length > state.replay.maxEvents) {
    state.replay.events.splice(0, state.replay.events.length - state.replay.maxEvents);
  }
  replayByMatch.set(state.matchId, state.replay.events);
}

function handSnapshot(table: PokerTable) {
  const hand = table.state.hand;
  return {
    handId: hand?.handId ?? null,
    street: hand?.street ?? null,
    phase: hand?.phase ?? null,
  };
}

export function findExistingAuthoritativeMatchId(
  nk: nkruntime.Nakama,
  tableId: string
): string | null {
  const label = JSON.stringify({ tableId });
  const matches = nk.matchList(100, true, '', 0, 9, '') ?? [];
  for (const match of matches) {
    if (match.label !== label) {
      continue;
    }
    const matchId =
      (typeof match.matchId === 'string' ? match.matchId : undefined) ??
      (typeof match.match_id === 'string' ? match.match_id : undefined);
    if (matchId) return matchId;
  }
  return null;
}

function normalizeTableId(tableId?: string) {
  const normalized = (tableId ?? '').trim();
  if (!normalized) return DEFAULT_TABLE_ID;
  return normalized;
}

export function ensurePdhMatch(
  nk: nkruntime.Nakama,
  input?: EnsurePdhMatchInput
): EnsurePdhMatchResult {
  const tableId = normalizeTableId(input?.tableId);
  const module = (input?.module ?? DEFAULT_MATCH_MODULE).trim() || DEFAULT_MATCH_MODULE;
  const existing = findExistingAuthoritativeMatchId(nk, tableId);
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

export function ensureDefaultMatch(nk: nkruntime.Nakama): string {
  return ensurePdhMatch(nk, { tableId: DEFAULT_TABLE_ID, module: DEFAULT_MATCH_MODULE }).matchId;
}

export function ensureDefaultMatchAfterAuthenticate(
  ctx: unknown,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama
) {
  try {
    ensureDefaultMatch(nk);
  } catch (err: any) {
    logger.error('Failed to ensure default authoritative match: %v', err?.message ?? err);
  }
}

export function rpcEnsurePdhMatch(
  ctx: unknown,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string | undefined
) {
  let input: EnsurePdhMatchInput | undefined;

  if (payload && payload.trim()) {
    try {
      const parsed = JSON.parse(payload) as EnsurePdhMatchInput | string;
      if (typeof parsed === 'string') {
        input = JSON.parse(parsed) as EnsurePdhMatchInput;
      } else {
        input = parsed;
      }
    } catch (err: any) {
      throw new Error(`invalid payload JSON: ${err?.message ?? 'parse failure'}`);
    }
  }

  const result = ensurePdhMatch(nk, input);
  return JSON.stringify(result);
}

export function rpcGetPdhReplay(
  ctx: unknown,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string | undefined
) {
  let input: GetReplayInput | undefined;

  if (payload && payload.trim()) {
    try {
      const parsed = JSON.parse(payload) as GetReplayInput | string;
      if (typeof parsed === 'string') {
        input = JSON.parse(parsed) as GetReplayInput;
      } else {
        input = parsed;
      }
    } catch (err: any) {
      throw new Error(`invalid payload JSON: ${err?.message ?? 'parse failure'}`);
    }
  }

  const requestedMatchId = (input?.matchId ?? '').trim();
  const tableId = normalizeTableId(input?.tableId);
  const resolvedMatchId =
    requestedMatchId || findExistingAuthoritativeMatchId(nk, tableId) || `pdh:${tableId}`;
  const limit = replayLimit(input?.limit);
  const events = (replayByMatch.get(resolvedMatchId) ?? []).slice(-limit);
  logStructured(logger, 'info', 'rpc.replay.get', {
    matchId: resolvedMatchId,
    tableId,
    limit,
    returned: events.length,
  });
  return JSON.stringify({
    matchId: resolvedMatchId,
    tableId,
    count: events.length,
    events,
  });
}

export function rpcTerminatePdhMatch(
  ctx: unknown,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string | undefined
) {
  if (!payload || !payload.trim()) {
    throw new Error('matchId is required');
  }

  let input: TerminateMatchInput;
  try {
    const parsed = JSON.parse(payload) as TerminateMatchInput | string;
    input = typeof parsed === 'string' ? (JSON.parse(parsed) as TerminateMatchInput) : parsed;
  } catch (err: any) {
    throw new Error(`invalid payload JSON: ${err?.message ?? 'parse failure'}`);
  }

  const matchId = (input?.matchId ?? '').trim();
  if (!matchId) {
    throw new Error('matchId is required');
  }
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';

  const runtimeNakama = nk as NakamaWithMatchSignal;
  if (typeof runtimeNakama.matchSignal !== 'function') {
    throw new Error('matchSignal API is unavailable in this runtime.');
  }

  const response = runtimeNakama.matchSignal(
    matchId,
    JSON.stringify({
      type: 'admin:terminate',
      reason: reason || 'admin rpc',
    })
  );

  logStructured(logger, 'warn', 'rpc.admin.terminate_match', {
    matchId,
    reason: reason || 'admin rpc',
  });

  return JSON.stringify({
    matchId,
    signalled: true,
    response: typeof response === 'string' ? response : null,
  });
}

function matchInit(ctx, logger, nk, params) {
  const tableId = (params?.tableId as string | undefined) ?? DEFAULT_TABLE_ID;
  const matchId = readMatchId(ctx) ?? `pdh:${tableId}`;
  const table = new PokerTable(tableId);
  const state: MatchState = {
    matchId,
    table: table.state,
    presences: {},
    lastSeqByPlayer: {},
    lastReactionAtByPlayer: {},
    lastChatAtByPlayer: {},
    replay: { maxEvents: REPLAY_MAX_EVENTS, events: [] },
    lastAutoDiscardMs: 0,
    terminateRequested: false,
    terminateReason: null,
  };
  replayByMatch.set(matchId, state.replay.events);
  logStructured(logger, 'info', 'match.init', {
    matchId,
    tableId,
    tickRate: 10,
  });
  return {
    state,
    tickRate: 10,
    label: JSON.stringify({ tableId }),
  };
}

function matchJoinAttempt(ctx, logger, nk, dispatcher, tick, state, presence, metadata) {
  logStructured(logger, 'info', 'match.join_attempt', {
    matchId: state.matchId,
    tableId: state.table.id,
    tick,
    userId: presence.userId,
  });
  return { state, accept: true };
}

function matchJoin(ctx, logger, nk, dispatcher, tick, state, presences) {
  const table = hydrateTable(state.table);
  for (const presence of presences) {
    state.presences[presence.userId] = presence;
    table.setSittingOut(presence.userId, false);
    logStructured(logger, 'info', 'match.join', {
      matchId: state.matchId,
      tableId: table.state.id,
      tick,
      userId: presence.userId,
      handId: table.state.hand?.handId ?? null,
    });
    sendToPresence(dispatcher, presence, {
      type: 'welcome',
      playerId: presence.userId,
      tableId: table.state.id,
    });
  }
  state.table = table.state;
  broadcastState(dispatcher, state);
  return { state };
}

function matchLeave(ctx, logger, nk, dispatcher, tick, state, presences) {
  const table = hydrateTable(state.table);
  for (const presence of presences) {
    delete state.presences[presence.userId];
    delete state.lastReactionAtByPlayer[presence.userId];
    delete state.lastChatAtByPlayer[presence.userId];
    table.handleDisconnect(presence.userId);
    logStructured(logger, 'info', 'match.leave', {
      matchId: state.matchId,
      tableId: table.state.id,
      tick,
      userId: presence.userId,
      handId: table.state.hand?.handId ?? null,
    });
  }
  state.table = table.state;
  broadcastState(dispatcher, state);
  return { state };
}

function matchLoop(ctx, logger, nk, dispatcher, tick, state, messages) {
  if (state.terminateRequested) {
    logStructured(logger, 'warn', 'match.terminate_requested', {
      matchId: state.matchId,
      tableId: state.table.id,
      tick,
      reason: state.terminateReason ?? 'unspecified',
    });
    return null;
  }

  const table = hydrateTable(state.table);
  let shouldBroadcast = false;

  for (const message of messages) {
    if (message.opCode !== MatchOpCode.ClientMessage) continue;

    const presence = message.sender;
    try {
      ensurePresenceBound(state, presence);
    } catch (err: any) {
      logStructured(logger, 'warn', 'match.presence_rejected', {
        matchId: state.matchId,
        tableId: table.state.id,
        tick,
        userId: presence.userId,
        error: safeErrorMessage(err),
      });
      sendToPresence(dispatcher, presence, {
        type: 'error',
        message: err?.message ?? 'error',
      });
      continue;
    }

    let data: ClientMessage;
    try {
      data = parseClientMessage(nk, message);
    } catch (err) {
      logStructured(logger, 'warn', 'match.invalid_payload', {
        matchId: state.matchId,
        tableId: table.state.id,
        tick,
        userId: presence.userId,
        error: safeErrorMessage(err),
      });
      sendToPresence(dispatcher, presence, { type: 'error', message: 'Invalid payload' });
      continue;
    }

    const mutatingMeta =
      data.type === 'action'
        ? {
            kind: 'action' as const,
            action: data.action,
            amount: data.amount,
            discardIndex: undefined,
            actionSeq: typeof data.seq === 'number' ? data.seq : null,
          }
        : data.type === 'discard'
          ? {
              kind: 'discard' as const,
              action: undefined,
              amount: undefined,
              discardIndex: data.index,
              actionSeq: typeof data.seq === 'number' ? data.seq : null,
            }
          : data.type === 'nextHand'
            ? {
                kind: 'nextHand' as const,
                action: undefined,
                amount: undefined,
                discardIndex: undefined,
                actionSeq: typeof data.seq === 'number' ? data.seq : null,
              }
            : null;
    const before = handSnapshot(table);

    try {
      if (isMutatingClientMessage(data)) {
        reserveSequence(state, presence.userId, data);
      }

      switch (data.type) {
        case 'join': {
          seatPlayer(table, presence.userId, data.name, data.buyIn, data.seat);
          table.setSittingOut(presence.userId, false);
          sendToPresence(dispatcher, presence, {
            type: 'welcome',
            playerId: presence.userId,
            tableId: table.state.id,
          });
          shouldBroadcast = true;
          break;
        }
        case 'reconnect': {
          if (data.playerId !== presence.userId) {
            throw new Error('Reconnect identity mismatch');
          }
          table.setSittingOut(presence.userId, false);
          sendToPresence(dispatcher, presence, {
            type: 'welcome',
            playerId: presence.userId,
            tableId: table.state.id,
          });
          shouldBroadcast = true;
          break;
        }
        case 'action': {
          ensureBettingTurn(table, presence.userId);
          table.applyAction(presence.userId, {
            type: data.action as any,
            amount: data.amount,
          });
          shouldBroadcast = true;
          break;
        }
        case 'discard': {
          ensureDiscardTurn(table, presence.userId);
          table.applyDiscard(presence.userId, data.index);
          shouldBroadcast = true;
          break;
        }
        case 'nextHand': {
          ensureCanAdvanceHand(table, presence.userId);
          table.advanceToNextHand();
          shouldBroadcast = true;
          break;
        }
        case 'reaction': {
          ensurePlayerSeated(table, presence.userId);
          const reactionTs = Date.now();
          reserveReactionWindow(state, presence.userId, reactionTs);
          broadcastServerMessage(dispatcher, state, {
            type: 'reaction',
            playerId: presence.userId,
            emoji: data.emoji,
            ts: reactionTs,
          });
          logStructured(logger, 'info', 'match.reaction', {
            matchId: state.matchId,
            tableId: table.state.id,
            tick,
            userId: presence.userId,
            emoji: data.emoji,
          });
          break;
        }
        case 'chat': {
          ensurePlayerSeated(table, presence.userId);
          const text = data.message.trim().replace(/\s+/g, ' ').slice(0, TABLE_CHAT_MAX_LENGTH);
          if (!text) {
            throw new Error('Chat message cannot be empty');
          }
          const chatTs = Date.now();
          reserveChatWindow(state, presence.userId, chatTs);
          broadcastServerMessage(dispatcher, state, {
            type: 'chat',
            playerId: presence.userId,
            message: text,
            ts: chatTs,
          });
          logStructured(logger, 'info', 'match.chat', {
            matchId: state.matchId,
            tableId: table.state.id,
            tick,
            userId: presence.userId,
            messageLength: text.length,
          });
          break;
        }
        case 'requestState': {
          const publicState = table.getPublicState(presence.userId);
          sendToPresence(dispatcher, presence, {
            type: 'state',
            state: { ...publicState, you: { playerId: presence.userId } },
          });
          break;
        }
        default:
          throw new Error('Unknown message');
      }
      table.beginNextHandIfReady();

      if (mutatingMeta) {
        const after = handSnapshot(table);
        const event: ReplayEvent = {
          ts: Date.now(),
          tick,
          matchId: state.matchId,
          tableId: table.state.id,
          userId: presence.userId,
          handIdBefore: before.handId,
          handIdAfter: after.handId,
          streetBefore: before.street,
          streetAfter: after.street,
          phaseBefore: before.phase,
          phaseAfter: after.phase,
          actionSeq: mutatingMeta.actionSeq,
          kind: mutatingMeta.kind,
          action: mutatingMeta.action,
          amount: mutatingMeta.amount,
          discardIndex: mutatingMeta.discardIndex,
          outcome: 'accepted',
        };
        pushReplay(state, event);
        logStructured(logger, 'info', 'match.action.accepted', {
          matchId: state.matchId,
          tableId: table.state.id,
          tick,
          userId: presence.userId,
          handId: event.handIdAfter ?? event.handIdBefore,
          actionSeq: event.actionSeq,
          kind: event.kind,
          action: event.action,
          amount: event.amount,
          discardIndex: event.discardIndex,
          phaseBefore: event.phaseBefore,
          phaseAfter: event.phaseAfter,
          streetBefore: event.streetBefore,
          streetAfter: event.streetAfter,
        });
      }
    } catch (err: any) {
      if (mutatingMeta) {
        const after = handSnapshot(table);
        const event: ReplayEvent = {
          ts: Date.now(),
          tick,
          matchId: state.matchId,
          tableId: table.state.id,
          userId: presence.userId,
          handIdBefore: before.handId,
          handIdAfter: after.handId,
          streetBefore: before.street,
          streetAfter: after.street,
          phaseBefore: before.phase,
          phaseAfter: after.phase,
          actionSeq: mutatingMeta.actionSeq,
          kind: mutatingMeta.kind,
          action: mutatingMeta.action,
          amount: mutatingMeta.amount,
          discardIndex: mutatingMeta.discardIndex,
          outcome: 'rejected',
          error: safeErrorMessage(err),
        };
        pushReplay(state, event);
        logStructured(logger, 'warn', 'match.action.rejected', {
          matchId: state.matchId,
          tableId: table.state.id,
          tick,
          userId: presence.userId,
          handId: event.handIdAfter ?? event.handIdBefore,
          actionSeq: event.actionSeq,
          kind: event.kind,
          action: event.action,
          amount: event.amount,
          discardIndex: event.discardIndex,
          error: event.error,
          phaseBefore: event.phaseBefore,
          phaseAfter: event.phaseAfter,
          streetBefore: event.streetBefore,
          streetAfter: event.streetAfter,
        });
      }
      sendToPresence(dispatcher, presence, {
        type: 'error',
        message: err?.message ?? 'error',
      });
    }
  }

  const now = Date.now();
  const advanced = table.advancePendingPhase(now);
  if (advanced) {
    const hand = table.state.hand;
    logStructured(logger, 'info', 'match.phase_advanced', {
      matchId: state.matchId,
      tableId: table.state.id,
      tick,
      handId: hand?.handId ?? null,
      street: hand?.street ?? null,
      phase: hand?.phase ?? null,
    });
    shouldBroadcast = true;
  }

  const autoAction = table.autoAction(now);
  if (autoAction) {
    const hand = table.state.hand;
    logStructured(logger, 'info', 'match.auto_action', {
      matchId: state.matchId,
      tableId: table.state.id,
      tick,
      handId: hand?.handId ?? null,
      action: autoAction.action,
      userId: autoAction.playerId,
    });
    shouldBroadcast = true;
  }

  if (!state.lastAutoDiscardMs) state.lastAutoDiscardMs = now;
  if (now - state.lastAutoDiscardMs >= AUTO_DISCARD_INTERVAL_MS) {
    const before = JSON.stringify(table.state.hand?.discardPending ?? []);
    table.autoDiscard(now);
    const after = JSON.stringify(table.state.hand?.discardPending ?? []);
    if (before !== after) {
      const hand = table.state.hand;
      logStructured(logger, 'info', 'match.auto_discard', {
        matchId: state.matchId,
        tableId: table.state.id,
        tick,
        handId: hand?.handId ?? null,
      });
      shouldBroadcast = true;
    }
    if (!table.state.hand) {
      table.beginNextHandIfReady();
      if (table.state.hand) {
        shouldBroadcast = true;
      }
    }
    state.lastAutoDiscardMs = now;
  }

  state.table = table.state;
  if (shouldBroadcast) {
    broadcastState(dispatcher, state);
  }

  return { state };
}

function matchTerminate(ctx, logger, nk, dispatcher, tick, state, graceSeconds) {
  logStructured(logger, 'info', 'match.terminate', {
    matchId: state.matchId,
    tableId: state.table.id,
    tick,
    graceSeconds,
    replayEvents: state.replay.events.length,
  });
  return { state };
}

function matchSignal(ctx, logger, nk, dispatcher, tick, state, data) {
  try {
    const parsed = JSON.parse(data ?? '{}') as { type?: string; limit?: number };
    if (parsed.type === 'admin:terminate') {
      const reason =
        parsed && typeof (parsed as { reason?: unknown }).reason === 'string'
          ? String((parsed as { reason?: string }).reason)
          : 'admin signal';
      state.terminateRequested = true;
      state.terminateReason = reason;
      logStructured(logger, 'warn', 'match.signal.terminate', {
        matchId: state.matchId,
        tableId: state.table.id,
        tick,
        reason,
      });
      return { state, data: JSON.stringify({ type: 'ok', terminateRequested: true }) };
    }

    if (parsed.type === 'replay:get') {
      const limit = replayLimit(parsed.limit);
      const events = state.replay.events.slice(-limit);
      logStructured(logger, 'info', 'match.signal.replay_get', {
        matchId: state.matchId,
        tableId: state.table.id,
        tick,
        limit,
        returned: events.length,
      });
      return {
        state,
        data: JSON.stringify({
          type: 'replay',
          matchId: state.matchId,
          tableId: state.table.id,
          count: events.length,
          events,
        }),
      };
    }
  } catch (err) {
    logStructured(logger, 'warn', 'match.signal.invalid_payload', {
      matchId: state.matchId,
      tableId: state.table.id,
      tick,
      error: safeErrorMessage(err),
    });
    return { state, data: JSON.stringify({ type: 'error', message: 'Invalid signal payload' }) };
  }
  return { state, data: JSON.stringify({ type: 'ok' }) };
}

export const pdhMatchHandler = {
  matchInit,
  matchJoinAttempt,
  matchJoin,
  matchLeave,
  matchLoop,
  matchTerminate,
  matchSignal,
};

(globalThis as any).matchInit = matchInit;
(globalThis as any).matchJoinAttempt = matchJoinAttempt;
(globalThis as any).matchJoin = matchJoin;
(globalThis as any).matchLeave = matchLeave;
(globalThis as any).matchLoop = matchLoop;
(globalThis as any).matchTerminate = matchTerminate;
(globalThis as any).matchSignal = matchSignal;
(globalThis as any).ensureDefaultMatchAfterAuthenticate = ensureDefaultMatchAfterAuthenticate;
(globalThis as any).rpcEnsurePdhMatch = rpcEnsurePdhMatch;
(globalThis as any).rpcGetPdhReplay = rpcGetPdhReplay;
(globalThis as any).rpcTerminatePdhMatch = rpcTerminatePdhMatch;
