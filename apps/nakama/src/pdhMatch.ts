import type * as nkruntime from '@heroiclabs/nakama-runtime';
import {
  computeLegalActionsForPlayer,
  PokerTable,
  type Seat,
  type TableState,
} from '../../../packages/engine/src';
import {
  MatchOpCode,
  TABLE_CHAT_MAX_LENGTH,
  isMutatingClientMessage,
  parseClientMessagePayload,
  type ClientMessage,
  type MutatingClientMessage,
  type ServerMessage,
  withProtocolVersion,
} from './protocol';

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
const DEFAULT_TABLE_BUY_IN = 10000;
const MIN_TABLE_BUY_IN = 1;
const MAX_TABLE_BUY_IN = 1_000_000;
const DEFAULT_MAX_PLAYERS = 9;
const MIN_MAX_PLAYERS = 2;
const MAX_MAX_PLAYERS = 9;
const DEFAULT_RECONNECT_GRACE_MS = 15_000;
const MIN_RECONNECT_GRACE_MS = 0;
const MAX_RECONNECT_GRACE_MS = 120_000;
const DEFAULT_BETWEEN_HAND_MIN_MS = 6_000;
const DEFAULT_BETWEEN_HAND_AUTO_START_MS = 12_000;
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';
export const PDH_CHECKPOINT_COLLECTION = 'pdh_match_checkpoints';
const CHECKPOINT_SCHEMA_VERSION = 1;
const CHECKPOINT_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const CHECKPOINT_MAX_REPLAY_EVENTS = 100;
const CHECKPOINT_MAX_LOG_ENTRIES = 100;

type ReplayEventKind = 'action' | 'discard' | 'nextHand' | 'rebuy' | 'sitOut';
type ReplayOutcome = 'accepted' | 'rejected';
type PlayerConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';
type CheckpointWriteReason =
  | 'match_init'
  | 'match_restore'
  | 'presence_joined'
  | 'presence_left'
  | 'player_joined'
  | 'hand_start'
  | 'accepted_action'
  | 'auto_action'
  | 'discard'
  | 'auto_discard'
  | 'street_transition'
  | 'showdown_settlement'
  | 'between_hand_start'
  | 'between_hand_ready_changed'
  | 'next_hand_start'
  | 'reconnect_grace_changed'
  | 'rebuy'
  | 'sit_out'
  | 'ready_for_hand';

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

interface PlayerConnectionState {
  status: PlayerConnectionStatus;
  graceDeadlineMs: number | null;
  lastSeenMs: number | null;
}

interface BetweenHandState {
  handId: string;
  startedAtMs: number;
  minUntilMs: number;
  autoStartAtMs: number;
  readyPlayerIds: string[];
}

interface MatchState {
  matchId: string;
  table: TableState;
  stateVersion: number;
  tableBuyIn: number;
  maxPlayers: number;
  reconnectGraceMs: number;
  presences: Record<string, nkruntime.Presence>;
  playerConnections: Record<string, PlayerConnectionState>;
  lastSeqByPlayer: Record<string, number>;
  lastReactionAtByPlayer: Record<string, number>;
  lastChatAtByPlayer: Record<string, number>;
  betweenHand: BetweenHandState | null;
  replay: ReplayState;
  terminateRequested: boolean;
  terminateReason: string | null;
}

interface TableMutationResult<T> {
  result: T;
  changed: boolean;
}

interface TimerMutationResult {
  shouldBroadcast: boolean;
  checkpointReasons: CheckpointWriteReason[];
}

interface MatchCheckpoint {
  schemaVersion: number;
  checkpointId: string;
  tableId: string;
  matchId: string;
  writeReason: CheckpointWriteReason;
  writeReasons: CheckpointWriteReason[];
  writtenAtMs: number;
  serverTimeMs: number;
  expiresAtMs: number;
  stateVersion: number;
  eventSeq: number;
  handId: string | null;
  handNumber: number;
  phase: string;
  street: string | null;
  tableBuyIn: number;
  maxPlayers: number;
  reconnectGraceMs: number;
  seatSummaries: Array<Record<string, unknown> | null>;
  playerConnections: Record<string, PlayerConnectionState>;
  betweenHand: BetweenHandState | null;
  recovery: {
    policy: 'restore_from_checkpoint';
    canRestore: boolean;
    privateStateStored: boolean;
  };
  replayEvents: ReplayEvent[];
  privateState: {
    tableState: TableState;
    lastSeqByPlayer: Record<string, number>;
    replayEvents: ReplayEvent[];
  };
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

type RuntimeContext = {
  userId?: unknown;
  user_id?: unknown;
  username?: unknown;
  env?: Record<string, unknown>;
};

const ADMIN_RPC_ENABLE_ENV = 'PDH_ENABLE_ADMIN_RPCS';
const ADMIN_RPC_ALLOWLIST_ENV = 'PDH_ADMIN_USER_IDS';

function readRuntimeEnvValue(ctx: unknown, key: string): string {
  const runtimeEnv = (ctx as RuntimeContext | null | undefined)?.env;
  const value = runtimeEnv && typeof runtimeEnv === 'object' ? runtimeEnv[key] : undefined;
  if (typeof value === 'string') {
    return value.trim();
  }

  const processEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env;
  return processEnv?.[key]?.trim() ?? '';
}

function isTruthyEnv(value: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function readCallerUserId(ctx: unknown): string {
  const c = (ctx ?? {}) as RuntimeContext;
  if (typeof c.userId === 'string' && c.userId.trim()) {
    return c.userId.trim();
  }
  if (typeof c.user_id === 'string' && c.user_id.trim()) {
    return c.user_id.trim();
  }
  return '';
}

function readAdminAllowlist(ctx: unknown): Set<string> {
  return new Set(
    readRuntimeEnvValue(ctx, ADMIN_RPC_ALLOWLIST_ENV)
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
}

export function arePdhAdminRpcsEnabled(ctx: unknown): boolean {
  return isTruthyEnv(readRuntimeEnvValue(ctx, ADMIN_RPC_ENABLE_ENV));
}

function assertPdhAdminRpcCaller(ctx: unknown): string {
  if (!arePdhAdminRpcsEnabled(ctx)) {
    throw new Error('PDH admin RPCs are disabled.');
  }

  const adminUserIds = readAdminAllowlist(ctx);
  if (adminUserIds.size === 0) {
    throw new Error('PDH admin RPC allowlist is empty.');
  }

  const userId = readCallerUserId(ctx);
  if (!userId) {
    throw new Error('PDH admin RPC requires an authenticated admin user.');
  }

  if (!adminUserIds.has(userId)) {
    throw new Error('PDH admin RPC forbidden for this user.');
  }

  return userId;
}

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

function parseIntegerParam(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  label: string
): number {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`${label} must be an integer`);
  }
  if (value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max}`);
  }
  return value;
}

function parseMatchBuyIn(params: Record<string, unknown> | undefined): number {
  return parseIntegerParam(
    params?.buyIn ?? params?.tableBuyIn ?? params?.quickPlayBuyIn,
    DEFAULT_TABLE_BUY_IN,
    MIN_TABLE_BUY_IN,
    MAX_TABLE_BUY_IN,
    'Table buy-in'
  );
}

function parseMatchMaxPlayers(params: Record<string, unknown> | undefined): number {
  return parseIntegerParam(
    params?.maxPlayers,
    DEFAULT_MAX_PLAYERS,
    MIN_MAX_PLAYERS,
    MAX_MAX_PLAYERS,
    'Max players'
  );
}

function parseReconnectGraceMs(params: Record<string, unknown> | undefined): number {
  return parseIntegerParam(
    params?.reconnectGraceMs,
    DEFAULT_RECONNECT_GRACE_MS,
    MIN_RECONNECT_GRACE_MS,
    MAX_RECONNECT_GRACE_MS,
    'Reconnect grace'
  );
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

function tableSnapshot(table: PokerTable) {
  return JSON.stringify(table.state);
}

function bumpStateVersion(state: MatchState) {
  state.stateVersion += 1;
}

function commitTableMutation<T>(
  state: MatchState,
  table: PokerTable,
  mutate: () => T
): TableMutationResult<T> {
  const before = tableSnapshot(table);
  const result = mutate();
  const changed = tableSnapshot(table) !== before;
  if (changed) {
    bumpStateVersion(state);
  }
  return { result, changed };
}

function isEligibleBetweenHandSeat(seat: Seat | null | undefined): seat is Seat {
  return Boolean(
    seat &&
    seat.stack > 0 &&
    !seat.sittingOut &&
    seat.status !== 'sitting_out' &&
    seat.status !== 'busted'
  );
}

function eligibleBetweenHandPlayerIds(table: PokerTable): string[] {
  return table.state.seats.filter(isEligibleBetweenHandSeat).map((seat) => seat.id);
}

function isEligibleBetweenHandPlayer(table: PokerTable, playerId: string) {
  return eligibleBetweenHandPlayerIds(table).includes(playerId);
}

function pruneBetweenHandReadyPlayers(state: MatchState, table: PokerTable) {
  if (!state.betweenHand) return false;
  const eligibleIds = new Set(eligibleBetweenHandPlayerIds(table));
  const nextReadyIds = state.betweenHand.readyPlayerIds.filter((id) => eligibleIds.has(id));
  if (nextReadyIds.length === state.betweenHand.readyPlayerIds.length) {
    return false;
  }
  state.betweenHand.readyPlayerIds = nextReadyIds;
  bumpStateVersion(state);
  return true;
}

function ensureBetweenHandState(
  logger: nkruntime.Logger,
  state: MatchState,
  table: PokerTable,
  tick: number,
  now: number
) {
  const hand = table.state.hand;
  if (!hand || hand.phase !== 'showdown') {
    if (!state.betweenHand) return false;
    state.betweenHand = null;
    bumpStateVersion(state);
    return true;
  }

  if (state.betweenHand?.handId === hand.handId) {
    return pruneBetweenHandReadyPlayers(state, table);
  }

  state.betweenHand = {
    handId: hand.handId,
    startedAtMs: now,
    minUntilMs: now + DEFAULT_BETWEEN_HAND_MIN_MS,
    autoStartAtMs: now + DEFAULT_BETWEEN_HAND_AUTO_START_MS,
    readyPlayerIds: [],
  };
  bumpStateVersion(state);
  logStructured(logger, 'info', 'match.between_hand.started', {
    matchId: state.matchId,
    tableId: table.state.id,
    tick,
    handId: hand.handId,
    startedAtMs: state.betweenHand.startedAtMs,
    minUntilMs: state.betweenHand.minUntilMs,
    autoStartAtMs: state.betweenHand.autoStartAtMs,
    stateVersion: state.stateVersion,
  });
  return true;
}

function advanceBetweenHandIfReady(
  logger: nkruntime.Logger,
  state: MatchState,
  table: PokerTable,
  tick: number,
  now: number
) {
  let changed = ensureBetweenHandState(logger, state, table, tick, now);
  const betweenHand = state.betweenHand;
  const hand = table.state.hand;
  if (!betweenHand || !hand || hand.phase !== 'showdown') {
    return changed;
  }

  const eligibleIds = eligibleBetweenHandPlayerIds(table);
  if (now < betweenHand.minUntilMs) {
    return changed;
  }

  const readyIds = new Set(betweenHand.readyPlayerIds);
  const allEligibleReady =
    eligibleIds.length >= 2 && eligibleIds.every((playerId) => readyIds.has(playerId));
  const autoStartElapsed = now >= betweenHand.autoStartAtMs;
  const shouldLeaveForWaiting = eligibleIds.length < 2;
  const shouldStartNextHand = allEligibleReady || (autoStartElapsed && eligibleIds.length >= 2);

  if (!shouldLeaveForWaiting && !shouldStartNextHand) {
    return changed;
  }

  const reason = shouldLeaveForWaiting
    ? 'waiting_for_players'
    : allEligibleReady
      ? 'all_ready'
      : 'auto_start';
  state.betweenHand = null;
  const nextHandMutation = commitTableMutation(state, table, () => table.advanceToNextHand());
  changed = nextHandMutation.changed || changed;

  logStructured(logger, 'info', 'match.between_hand.completed', {
    matchId: state.matchId,
    tableId: table.state.id,
    tick,
    handIdBefore: hand.handId,
    handIdAfter: table.state.hand?.handId ?? null,
    reason,
    eligiblePlayers: eligibleIds.length,
    readyPlayers: readyIds.size,
    stateVersion: state.stateVersion,
  });

  return changed;
}

function setReadyForNextHand(
  logger: nkruntime.Logger,
  state: MatchState,
  table: PokerTable,
  playerId: string,
  ready: boolean,
  tick: number,
  now: number
) {
  ensurePlayerSeated(table, playerId);
  const hand = table.state.hand;
  if (!hand || hand.phase !== 'showdown') {
    throw new Error('Hand not complete');
  }
  if (!isEligibleBetweenHandPlayer(table, playerId)) {
    throw new Error('Player not eligible for next hand');
  }

  let changed = ensureBetweenHandState(logger, state, table, tick, now);
  const betweenHand = state.betweenHand;
  if (!betweenHand) return changed;

  const readyIds = new Set(betweenHand.readyPlayerIds);
  const wasReady = readyIds.has(playerId);
  if (ready) {
    readyIds.add(playerId);
  } else {
    readyIds.delete(playerId);
  }

  if (readyIds.has(playerId) !== wasReady) {
    betweenHand.readyPlayerIds = [...readyIds].filter((id) =>
      isEligibleBetweenHandPlayer(table, id)
    );
    bumpStateVersion(state);
    changed = true;
    logStructured(logger, 'info', 'match.between_hand.ready_changed', {
      matchId: state.matchId,
      tableId: table.state.id,
      tick,
      handId: hand.handId,
      userId: playerId,
      ready,
      readyPlayers: betweenHand.readyPlayerIds.length,
      stateVersion: state.stateVersion,
    });
  }

  return advanceBetweenHandIfReady(logger, state, table, tick, now) || changed;
}

function presenceSessionKey(presence: nkruntime.Presence) {
  return presence.sessionId && typeof presence.sessionId === 'string'
    ? presence.sessionId
    : '__default__';
}

function presenceKey(presence: nkruntime.Presence) {
  return `${presence.userId}:${presenceSessionKey(presence)}`;
}

function activePresences(state: MatchState) {
  return Object.values(state.presences);
}

function activePresencesForUser(state: MatchState, userId: string) {
  return activePresences(state).filter((presence) => presence.userId === userId);
}

function hasActivePresenceForUser(state: MatchState, userId: string) {
  return activePresencesForUser(state, userId).length > 0;
}

function upsertPresence(state: MatchState, presence: nkruntime.Presence) {
  state.presences[presenceKey(presence)] = presence;
}

function removePresence(state: MatchState, presence: nkruntime.Presence) {
  delete state.presences[presenceKey(presence)];
}

function playerConnectionForSnapshot(state: MatchState, playerId: string): PlayerConnectionState {
  if (hasActivePresenceForUser(state, playerId)) {
    return {
      status: 'connected',
      graceDeadlineMs: null,
      lastSeenMs: state.playerConnections[playerId]?.lastSeenMs ?? null,
    };
  }
  return (
    state.playerConnections[playerId] ?? {
      status: 'disconnected',
      graceDeadlineMs: null,
      lastSeenMs: null,
    }
  );
}

function updatePlayerConnection(state: MatchState, playerId: string, next: PlayerConnectionState) {
  const previous = state.playerConnections[playerId] ?? null;
  if (JSON.stringify(previous) === JSON.stringify(next)) {
    return false;
  }
  state.playerConnections[playerId] = next;
  bumpStateVersion(state);
  return true;
}

function markPlayerConnected(state: MatchState, playerId: string, now: number) {
  return updatePlayerConnection(state, playerId, {
    status: 'connected',
    graceDeadlineMs: null,
    lastSeenMs: now,
  });
}

function markPlayerReconnecting(state: MatchState, playerId: string, now: number) {
  return updatePlayerConnection(state, playerId, {
    status: 'reconnecting',
    graceDeadlineMs: now + state.reconnectGraceMs,
    lastSeenMs: now,
  });
}

function markPlayerDisconnected(state: MatchState, playerId: string, now: number) {
  return updatePlayerConnection(state, playerId, {
    status: 'disconnected',
    graceDeadlineMs: null,
    lastSeenMs: now,
  });
}

function publicConnectionsForSeats(state: MatchState, seats: Array<{ id?: string } | null>) {
  const connections: Record<string, PlayerConnectionState> = {};
  for (const seat of seats) {
    if (!seat?.id) continue;
    connections[seat.id] = playerConnectionForSnapshot(state, seat.id);
  }
  return connections;
}

function annotateSeatsWithConnectionState(state: MatchState, seats: Array<any | null>) {
  const connections = publicConnectionsForSeats(state, seats);
  return seats.map((seat) => {
    if (!seat?.id) return seat;
    const connection = connections[seat.id];
    return {
      ...seat,
      connectionStatus: connection.status,
      reconnectGraceDeadlineMs: connection.graceDeadlineMs,
    };
  });
}

function stateSnapshotForPresence(state: MatchState, table: PokerTable, playerId: string) {
  const publicState = table.getPublicState(playerId);
  const connections = publicConnectionsForSeats(state, publicState.seats);
  const ownConnection = playerConnectionForSnapshot(state, playerId);
  return {
    ...publicState,
    seats: annotateSeatsWithConnectionState(state, publicState.seats),
    connections,
    stateVersion: state.stateVersion,
    serverTimeMs: Date.now(),
    betweenHandStartedAtMs: state.betweenHand?.startedAtMs ?? null,
    betweenHandMinUntilMs: state.betweenHand?.minUntilMs ?? null,
    betweenHandAutoStartAtMs: state.betweenHand?.autoStartAtMs ?? null,
    readyForNextHandPlayerIds: state.betweenHand ? [...state.betweenHand.readyPlayerIds] : [],
    legalActions: computeLegalActionsForPlayer(table.state, playerId, {
      betweenHand: Boolean(state.betweenHand),
      connectionStatus: ownConnection.status,
    }),
    you: { playerId },
  };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function compactCheckpointReasons(reasons: CheckpointWriteReason[]): CheckpointWriteReason[] {
  return [...new Set(reasons)];
}

function boundedReplayEvents(events: ReplayEvent[]) {
  return events.slice(-CHECKPOINT_MAX_REPLAY_EVENTS).map((event) => ({ ...event }));
}

function boundedTableState(tableState: TableState): TableState {
  const copy = cloneJson(tableState);
  copy.log = (copy.log ?? []).slice(-CHECKPOINT_MAX_LOG_ENTRIES);
  if (copy.auditLog) {
    copy.auditLog = copy.auditLog.slice(-CHECKPOINT_MAX_LOG_ENTRIES);
  }
  if (copy.auditHands) {
    copy.auditHands = copy.auditHands.slice(-5).map((hand) => ({
      ...hand,
      entries: hand.entries.slice(-CHECKPOINT_MAX_LOG_ENTRIES),
    }));
  }
  if (copy.hand) {
    copy.hand.log = (copy.hand.log ?? []).slice(-CHECKPOINT_MAX_LOG_ENTRIES);
    if (copy.hand.auditLog) {
      copy.hand.auditLog = copy.hand.auditLog.slice(-CHECKPOINT_MAX_LOG_ENTRIES);
    }
  }
  return copy;
}

function checkpointKeyForTable(tableId: string) {
  return tableId;
}

function handNumberForCheckpoint(tableState: TableState) {
  return (tableState.auditHands?.length ?? 0) + (tableState.hand ? 1 : 0);
}

function phaseForCheckpoint(state: MatchState, tableState: TableState) {
  if (state.betweenHand) return 'between_hands';
  if (tableState.hand) return tableState.hand.phase;
  if (tableState.startGate) return 'start_gate';
  return 'waiting';
}

function seatSummariesForCheckpoint(state: MatchState, tableState: TableState) {
  return tableState.seats.map((seat) => {
    if (!seat) return null;
    const connection = playerConnectionForSnapshot(state, seat.id);
    return {
      seat: seat.seat,
      playerId: seat.id,
      name: seat.name,
      stack: seat.stack,
      status: seat.status ?? (seat.sittingOut ? 'sitting_out' : 'active'),
      sittingOut: Boolean(seat.sittingOut),
      buyInTotal: seat.buyInTotal ?? null,
      rebuyCount: seat.rebuyCount ?? 0,
      connectionStatus: connection.status,
      graceDeadlineMs: connection.graceDeadlineMs,
      lastSeenMs: connection.lastSeenMs,
    };
  });
}

function buildCheckpoint(
  state: MatchState,
  reason: CheckpointWriteReason,
  now: number,
  writeReasons: CheckpointWriteReason[] = [reason]
): MatchCheckpoint {
  const reasons = compactCheckpointReasons(writeReasons.length ? writeReasons : [reason]);
  const tableState = boundedTableState(state.table);
  const hand = tableState.hand;
  const replayEvents = boundedReplayEvents(state.replay.events);
  return {
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    checkpointId: `${state.matchId}:${state.stateVersion}:${now}`,
    tableId: tableState.id,
    matchId: state.matchId,
    writeReason: reason,
    writeReasons: reasons,
    writtenAtMs: now,
    serverTimeMs: now,
    expiresAtMs: now + CHECKPOINT_MAX_AGE_MS,
    stateVersion: state.stateVersion,
    eventSeq: state.replay.events.length,
    handId: hand?.handId ?? state.betweenHand?.handId ?? null,
    handNumber: handNumberForCheckpoint(tableState),
    phase: phaseForCheckpoint(state, tableState),
    street: hand?.street ?? null,
    tableBuyIn: state.tableBuyIn,
    maxPlayers: state.maxPlayers,
    reconnectGraceMs: state.reconnectGraceMs,
    seatSummaries: seatSummariesForCheckpoint(state, tableState),
    playerConnections: cloneJson(state.playerConnections),
    betweenHand: state.betweenHand ? cloneJson(state.betweenHand) : null,
    recovery: {
      policy: 'restore_from_checkpoint',
      canRestore: true,
      privateStateStored: true,
    },
    replayEvents,
    privateState: {
      tableState,
      lastSeqByPlayer: cloneJson(state.lastSeqByPlayer),
      replayEvents,
    },
  };
}

function normalizeLoadedCheckpoint(value: unknown): MatchCheckpoint | null {
  if (!value || typeof value !== 'object') return null;
  const checkpoint = value as Partial<MatchCheckpoint>;
  if (checkpoint.schemaVersion !== CHECKPOINT_SCHEMA_VERSION) return null;
  if (typeof checkpoint.tableId !== 'string' || !checkpoint.tableId) return null;
  if (typeof checkpoint.matchId !== 'string' || !checkpoint.matchId) return null;
  if (
    typeof checkpoint.stateVersion !== 'number' ||
    !Number.isFinite(checkpoint.stateVersion) ||
    !Number.isInteger(checkpoint.stateVersion) ||
    checkpoint.stateVersion < 0
  ) {
    return null;
  }
  if (typeof checkpoint.writtenAtMs !== 'number' || !Number.isFinite(checkpoint.writtenAtMs)) {
    return null;
  }
  if (typeof checkpoint.expiresAtMs !== 'number' || !Number.isFinite(checkpoint.expiresAtMs)) {
    return null;
  }
  if (!checkpoint.privateState?.tableState) return null;
  if (checkpoint.privateState.tableState.id !== checkpoint.tableId) return null;
  if (checkpoint.recovery?.policy !== 'restore_from_checkpoint' || !checkpoint.recovery.canRestore) {
    return null;
  }
  return checkpoint as MatchCheckpoint;
}

function isRecentCheckpoint(checkpoint: MatchCheckpoint, tableId: string, now: number) {
  if (checkpoint.tableId !== tableId) return false;
  if (checkpoint.expiresAtMs && now > checkpoint.expiresAtMs) return false;
  return now - checkpoint.writtenAtMs <= CHECKPOINT_MAX_AGE_MS;
}

function readRecoverablePdhCheckpoint(
  nk: nkruntime.Nakama,
  tableId: string,
  now = Date.now()
): MatchCheckpoint | null {
  const object = readCheckpointObject(nk, tableId);
  const checkpoint = normalizeLoadedCheckpoint(object?.value);
  if (!checkpoint || !isRecentCheckpoint(checkpoint, tableId, now)) {
    return null;
  }
  return checkpoint;
}

function readCheckpointObject(
  nk: nkruntime.Nakama,
  tableId: string
): nkruntime.StorageObject | null {
  if (typeof nk.storageRead !== 'function') return null;
  const objects = nk.storageRead([
    {
      collection: PDH_CHECKPOINT_COLLECTION,
      key: checkpointKeyForTable(tableId),
      userId: SYSTEM_USER_ID,
    },
  ]);
  return objects?.[0] ?? null;
}

export function hasRecoverablePdhCheckpoint(
  nk: nkruntime.Nakama,
  tableId: string,
  now = Date.now()
) {
  try {
    return Boolean(readRecoverablePdhCheckpoint(nk, tableId, now));
  } catch {
    return false;
  }
}

function loadCheckpoint(
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  tableId: string,
  now: number
): MatchCheckpoint | null {
  if (typeof nk.storageRead !== 'function') {
    logStructured(logger, 'warn', 'match.checkpoint.storage_unavailable', {
      tableId,
      operation: 'read',
    });
    return null;
  }
  try {
    const checkpoint = readRecoverablePdhCheckpoint(nk, tableId, now);
    if (!checkpoint) return null;
    logStructured(logger, 'info', 'match.checkpoint.loaded', {
      matchId: checkpoint.matchId,
      tableId,
      checkpointMatchId: checkpoint.matchId,
      stateVersion: checkpoint.stateVersion,
      handId: checkpoint.handId,
      phase: checkpoint.phase,
      ageMs: Math.max(0, now - checkpoint.writtenAtMs),
    });
    return checkpoint;
  } catch (err) {
    logStructured(logger, 'error', 'match.checkpoint.load_failed', {
      tableId,
      error: safeErrorMessage(err),
    });
    return null;
  }
}

function seatedPlayerIds(tableState: TableState) {
  return tableState.seats
    .filter((seat): seat is Seat => Boolean(seat?.id))
    .map((seat) => seat.id);
}

function recoveredConnections(
  checkpoint: MatchCheckpoint,
  tableState: TableState,
  reconnectGraceMs: number,
  now: number
) {
  const connections: Record<string, PlayerConnectionState> = {};
  for (const playerId of seatedPlayerIds(tableState)) {
    const previous = checkpoint.playerConnections[playerId];
    if (previous?.status === 'disconnected') {
      connections[playerId] = {
        status: 'disconnected',
        graceDeadlineMs: null,
        lastSeenMs: previous.lastSeenMs ?? now,
      };
      continue;
    }
    connections[playerId] = {
      status: 'reconnecting',
      graceDeadlineMs: now + reconnectGraceMs,
      lastSeenMs: now,
    };
  }
  return connections;
}

function recoverFromCheckpoint(
  logger: nkruntime.Logger,
  checkpoint: MatchCheckpoint,
  matchId: string,
  tableId: string,
  fallbackBuyIn: number,
  fallbackMaxPlayers: number,
  fallbackReconnectGraceMs: number,
  now: number
): MatchState | null {
  const tableState = boundedTableState(checkpoint.privateState.tableState);
  if (tableState.id !== tableId) {
    logStructured(logger, 'warn', 'match.checkpoint.rejected', {
      tableId,
      checkpointTableId: tableState.id,
      reason: 'table_id_mismatch',
    });
    return null;
  }

  const reconnectGraceMs = checkpoint.reconnectGraceMs ?? fallbackReconnectGraceMs;
  const replayEvents = boundedReplayEvents(checkpoint.privateState.replayEvents ?? []);
  const state: MatchState = {
    matchId,
    table: tableState,
    stateVersion: Math.trunc(checkpoint.stateVersion) + 1,
    tableBuyIn: checkpoint.tableBuyIn ?? fallbackBuyIn,
    maxPlayers: checkpoint.maxPlayers ?? fallbackMaxPlayers,
    reconnectGraceMs,
    presences: {},
    playerConnections: recoveredConnections(checkpoint, tableState, reconnectGraceMs, now),
    lastSeqByPlayer: cloneJson(checkpoint.privateState.lastSeqByPlayer ?? {}),
    lastReactionAtByPlayer: {},
    lastChatAtByPlayer: {},
    betweenHand: checkpoint.betweenHand ? cloneJson(checkpoint.betweenHand) : null,
    replay: { maxEvents: REPLAY_MAX_EVENTS, events: replayEvents },
    terminateRequested: false,
    terminateReason: null,
  };
  replayByMatch.set(matchId, state.replay.events);
  logStructured(logger, 'warn', 'match.checkpoint.restored', {
    matchId,
    previousMatchId: checkpoint.matchId,
    tableId,
    stateVersion: state.stateVersion,
    checkpointStateVersion: checkpoint.stateVersion,
    handId: tableState.hand?.handId ?? null,
    phase: phaseForCheckpoint(state, tableState),
    seatedPlayers: seatedPlayerIds(tableState).length,
  });
  return state;
}

function persistCheckpoint(
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  state: MatchState,
  reason: CheckpointWriteReason,
  writeReasons: CheckpointWriteReason[] = [reason],
  now = Date.now()
) {
  if (typeof nk.storageWrite !== 'function') {
    logStructured(logger, 'error', 'match.checkpoint.persist_failed', {
      matchId: state.matchId,
      tableId: state.table.id,
      stateVersion: state.stateVersion,
      reason,
      error: 'storage_write_unavailable',
    });
    return;
  }
  try {
    const checkpoint = buildCheckpoint(state, reason, now, writeReasons);
    const existingObject = readCheckpointObject(nk, state.table.id);
    const existingCheckpoint = normalizeLoadedCheckpoint(existingObject?.value);
    if (
      existingCheckpoint &&
      isRecentCheckpoint(existingCheckpoint, state.table.id, now) &&
      existingCheckpoint.stateVersion > checkpoint.stateVersion
    ) {
      logStructured(logger, 'warn', 'match.checkpoint.persist_skipped', {
        matchId: state.matchId,
        tableId: state.table.id,
        stateVersion: state.stateVersion,
        existingStateVersion: existingCheckpoint.stateVersion,
        reason,
        skipReason: 'newer_checkpoint_exists',
      });
      return;
    }
    const writeRequest: nkruntime.StorageWriteRequest = {
      collection: PDH_CHECKPOINT_COLLECTION,
      key: checkpointKeyForTable(state.table.id),
      userId: SYSTEM_USER_ID,
      value: checkpoint as unknown as Record<string, unknown>,
      permissionRead: 0,
      permissionWrite: 0,
    };
    if (typeof existingObject?.version === 'string' && existingObject.version.length > 0) {
      writeRequest.version = existingObject.version;
    }
    nk.storageWrite([writeRequest]);
    logStructured(logger, 'info', 'match.checkpoint.persisted', {
      matchId: state.matchId,
      tableId: state.table.id,
      stateVersion: state.stateVersion,
      handId: checkpoint.handId,
      phase: checkpoint.phase,
      reason,
      reasons: checkpoint.writeReasons,
    });
  } catch (err) {
    logStructured(logger, 'error', 'match.checkpoint.persist_failed', {
      matchId: state.matchId,
      tableId: state.table.id,
      stateVersion: state.stateVersion,
      reason,
      error: safeErrorMessage(err),
    });
  }
}

function persistCheckpointForReasons(
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  state: MatchState,
  reasons: CheckpointWriteReason[]
) {
  const uniqueReasons = compactCheckpointReasons(reasons);
  if (!uniqueReasons.length) return;
  persistCheckpoint(logger, nk, state, uniqueReasons[0], uniqueReasons);
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
  const presences = activePresences(state);
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
  const presences = activePresences(state);
  for (const presence of presences) {
    const playerId = presence.userId;
    const msg: ServerMessage = {
      type: 'state',
      state: stateSnapshotForPresence(state, table, playerId),
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
  const active = state.presences[presenceKey(presence)];
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

function isPlayerSeated(table: PokerTable, playerId: string) {
  return table.state.seats.some((seat) => seat?.id === playerId);
}

function activeHandPlayerIds(table: PokerTable) {
  return new Set(table.state.hand?.players.map((player) => player.id) ?? []);
}

function releaseExpiredDisconnectedSeats(
  logger: nkruntime.Logger,
  state: MatchState,
  table: PokerTable,
  tick: number
) {
  const inHandPlayerIds = activeHandPlayerIds(table);
  const releasedSeats: Array<{ playerId: string; seat: number }> = [];

  const mutation = commitTableMutation(state, table, () => {
    for (const seat of table.state.seats) {
      if (!seat) continue;
      if (inHandPlayerIds.has(seat.id)) continue;
      if (hasActivePresenceForUser(state, seat.id)) continue;

      const connection = state.playerConnections[seat.id];
      if (connection?.status !== 'disconnected' || connection.graceDeadlineMs !== null) {
        continue;
      }

      releasedSeats.push({ playerId: seat.id, seat: seat.seat });
      table.removePlayer(seat.seat);
    }
  });

  if (!releasedSeats.length) {
    return false;
  }

  for (const released of releasedSeats) {
    delete state.playerConnections[released.playerId];
    delete state.lastSeqByPlayer[released.playerId];
    delete state.lastReactionAtByPlayer[released.playerId];
    delete state.lastChatAtByPlayer[released.playerId];
    logStructured(logger, 'info', 'match.seat.released_after_disconnect', {
      matchId: state.matchId,
      tableId: table.state.id,
      tick,
      userId: released.playerId,
      seat: released.seat,
      stateVersion: state.stateVersion,
    });
  }

  return mutation.changed;
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
  const seq = message.seq;
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 1) {
    throw new Error('Missing action sequence');
  }
  const lastSeq = state.lastSeqByPlayer[playerId] ?? 0;
  if (seq <= lastSeq) {
    throw new Error('Duplicate or stale action sequence');
  }
  // Reserve immediately so delayed/replayed packets from an older turn cannot apply later.
  state.lastSeqByPlayer[playerId] = seq;
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

function checkpointReasonsForTransition(
  baseReason: CheckpointWriteReason,
  before: ReturnType<typeof handSnapshot>,
  table: PokerTable,
  state: MatchState
) {
  const after = handSnapshot(table);
  const reasons: CheckpointWriteReason[] = [baseReason];
  if (before.handId !== after.handId && after.handId) {
    reasons.push(before.handId ? 'next_hand_start' : 'hand_start');
  }
  if (before.phase !== 'showdown' && after.phase === 'showdown') {
    reasons.push('showdown_settlement');
  } else if (before.street !== after.street || before.phase !== after.phase) {
    reasons.push('street_transition');
  }
  if (state.betweenHand && after.phase === 'showdown') {
    reasons.push('between_hand_start');
  }
  return reasons;
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
  const adminUserId = assertPdhAdminRpcCaller(ctx);
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
    adminUserId,
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
  const adminUserId = assertPdhAdminRpcCaller(ctx);
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
    adminUserId,
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
  const matchParams = (params ?? {}) as Record<string, unknown>;
  const tableBuyIn = parseMatchBuyIn(matchParams);
  const maxPlayers = parseMatchMaxPlayers(matchParams);
  const reconnectGraceMs = parseReconnectGraceMs(matchParams);
  const now = Date.now();
  const checkpoint = loadCheckpoint(logger, nk, tableId, now);
  const recoveredState = checkpoint
    ? recoverFromCheckpoint(
        logger,
        checkpoint,
        matchId,
        tableId,
        tableBuyIn,
        maxPlayers,
        reconnectGraceMs,
        now
      )
    : null;
  const table = recoveredState ? null : new PokerTable(tableId, undefined, maxPlayers);
  const state: MatchState =
    recoveredState ??
    ({
      matchId,
      table: table!.state,
      stateVersion: 0,
      tableBuyIn,
      maxPlayers,
      reconnectGraceMs,
      presences: {},
      playerConnections: {},
      lastSeqByPlayer: {},
      lastReactionAtByPlayer: {},
      lastChatAtByPlayer: {},
      betweenHand: null,
      replay: { maxEvents: REPLAY_MAX_EVENTS, events: [] },
      terminateRequested: false,
      terminateReason: null,
    } satisfies MatchState);
  replayByMatch.set(matchId, state.replay.events);
  logStructured(logger, 'info', 'match.init', {
    matchId,
    tableId,
    tableBuyIn,
    maxPlayers,
    reconnectGraceMs,
    recoveredFromCheckpoint: Boolean(recoveredState),
    stateVersion: state.stateVersion,
    tickRate: 10,
  });
  persistCheckpoint(logger, nk, state, recoveredState ? 'match_restore' : 'match_init', [
    recoveredState ? 'match_restore' : 'match_init',
  ]);
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
  let shouldBroadcast = false;
  const now = Date.now();
  for (const presence of presences) {
    upsertPresence(state, presence);
    shouldBroadcast = markPlayerConnected(state, presence.userId, now) || shouldBroadcast;
    const sittingOutMutation = commitTableMutation(state, table, () =>
      table.setSittingOut(presence.userId, false)
    );
    shouldBroadcast = sittingOutMutation.changed || shouldBroadcast;
    logStructured(logger, 'info', 'match.join', {
      matchId: state.matchId,
      tableId: table.state.id,
      tick,
      userId: presence.userId,
      sessionId: presence.sessionId ?? null,
      activeSessions: activePresencesForUser(state, presence.userId).length,
      handId: table.state.hand?.handId ?? null,
    });
    sendToPresence(dispatcher, presence, {
      type: 'welcome',
      playerId: presence.userId,
      tableId: table.state.id,
    });
  }
  const startMutation = commitTableMutation(state, table, () => table.beginNextHandIfReady());
  shouldBroadcast = startMutation.changed || shouldBroadcast;
  state.table = table.state;
  if (presences.length > 0 || shouldBroadcast) {
    const reasons: CheckpointWriteReason[] = ['presence_joined'];
    if (startMutation.changed) reasons.push('hand_start');
    persistCheckpointForReasons(logger, nk, state, reasons);
  }
  if (shouldBroadcast || presences.length > 0) {
    broadcastState(dispatcher, state);
  }
  return { state };
}

function matchLeave(ctx, logger, nk, dispatcher, tick, state, presences) {
  const table = hydrateTable(state.table);
  let shouldBroadcast = false;
  const now = Date.now();
  for (const presence of presences) {
    removePresence(state, presence);
    const activeSessions = activePresencesForUser(state, presence.userId).length;
    if (activeSessions === 0) {
      delete state.lastReactionAtByPlayer[presence.userId];
      delete state.lastChatAtByPlayer[presence.userId];
      if (isPlayerSeated(table, presence.userId)) {
        shouldBroadcast = markPlayerReconnecting(state, presence.userId, now) || shouldBroadcast;
      } else {
        shouldBroadcast = markPlayerDisconnected(state, presence.userId, now) || shouldBroadcast;
      }
    }
    logStructured(logger, 'info', 'match.leave', {
      matchId: state.matchId,
      tableId: table.state.id,
      tick,
      userId: presence.userId,
      sessionId: presence.sessionId ?? null,
      activeSessions,
      graceDeadlineMs: state.playerConnections[presence.userId]?.graceDeadlineMs ?? null,
      handId: table.state.hand?.handId ?? null,
    });
  }
  state.table = table.state;
  if (presences.length > 0 || shouldBroadcast) {
    const reasons: CheckpointWriteReason[] = ['presence_left'];
    if (shouldBroadcast) reasons.push('reconnect_grace_changed');
    persistCheckpointForReasons(logger, nk, state, reasons);
  }
  if (shouldBroadcast || presences.length > 0) {
    broadcastState(dispatcher, state);
  }
  return { state };
}

function applyGraceExpiryPolicy(table: PokerTable, playerId: string, now: number) {
  const hand = table.state.hand;
  const player = hand?.players.find((p) => p.id === playerId) ?? null;
  let autoAction: { playerId: string; action: 'fold' | 'check' } | null = null;

  if (!hand || hand.phase === 'showdown' || !player) {
    table.setSittingOut(playerId, true);
    return { autoAction };
  }

  if (hand.phase === 'betting' && hand.actionOnSeat === player.seat) {
    hand.actionDeadline = now;
    autoAction = table.autoAction(now);
  }

  if (table.state.hand && table.state.hand.phase !== 'showdown') {
    table.handleDisconnect(playerId);
  } else {
    table.setSittingOut(playerId, true);
  }

  return { autoAction };
}

function applyExpiredReconnectGrace(
  logger: nkruntime.Logger,
  state: MatchState,
  table: PokerTable,
  tick: number,
  now: number
) {
  let shouldBroadcast = false;
  const checkpointReasons: CheckpointWriteReason[] = [];
  const expiredUserIds = Object.entries(state.playerConnections)
    .filter(
      ([userId, connection]) =>
        connection.status === 'reconnecting' &&
        connection.graceDeadlineMs !== null &&
        now >= connection.graceDeadlineMs &&
        !hasActivePresenceForUser(state, userId)
    )
    .map(([userId]) => userId);

  for (const userId of expiredUserIds) {
    const previousDeadline = state.playerConnections[userId]?.graceDeadlineMs ?? null;
    shouldBroadcast = markPlayerDisconnected(state, userId, now) || shouldBroadcast;
    const beforeExpiry = handSnapshot(table);
    const expiryMutation = commitTableMutation(state, table, () =>
      applyGraceExpiryPolicy(table, userId, now)
    );
    shouldBroadcast = expiryMutation.changed || shouldBroadcast;
    checkpointReasons.push(
      ...checkpointReasonsForTransition('reconnect_grace_changed', beforeExpiry, table, state)
    );
    if (expiryMutation.result.autoAction) {
      checkpointReasons.push('auto_action');
    }
    logStructured(logger, 'info', 'match.reconnect_grace.expired', {
      matchId: state.matchId,
      tableId: table.state.id,
      tick,
      userId,
      graceDeadlineMs: previousDeadline,
      autoAction: expiryMutation.result.autoAction?.action,
      handId: table.state.hand?.handId ?? null,
      stateVersion: state.stateVersion,
    });
  }

  return { shouldBroadcast, checkpointReasons };
}

function applyExpiredTableTimers(
  logger: nkruntime.Logger,
  state: MatchState,
  table: PokerTable,
  tick: number,
  now: number
) {
  let shouldBroadcast = false;
  const checkpointReasons: CheckpointWriteReason[] = [];

  const startGateMutation = commitTableMutation(state, table, () => table.advanceStartGate(now));
  if (startGateMutation.changed) {
    logStructured(logger, 'info', 'match.start_gate.updated', {
      matchId: state.matchId,
      tableId: table.state.id,
      tick,
      handId: table.state.hand?.handId ?? null,
      started: startGateMutation.result,
      stateVersion: state.stateVersion,
    });
    shouldBroadcast = true;
    checkpointReasons.push(startGateMutation.result ? 'hand_start' : 'ready_for_hand');
  }

  const beforePhase = handSnapshot(table);
  const phaseMutation = commitTableMutation(state, table, () => table.advancePendingPhase(now));
  if (phaseMutation.result || phaseMutation.changed) {
    const hand = table.state.hand;
    logStructured(logger, 'info', 'match.phase_advanced', {
      matchId: state.matchId,
      tableId: table.state.id,
      tick,
      handId: hand?.handId ?? null,
      street: hand?.street ?? null,
      phase: hand?.phase ?? null,
      stateVersion: state.stateVersion,
    });
    shouldBroadcast = true;
    if (hand?.phase === 'showdown') {
      checkpointReasons.push('showdown_settlement');
    } else if (beforePhase.phase !== hand?.phase || beforePhase.street !== hand?.street) {
      checkpointReasons.push('street_transition');
    }
  }

  const graceResult = applyExpiredReconnectGrace(logger, state, table, tick, now);
  shouldBroadcast = graceResult.shouldBroadcast || shouldBroadcast;
  checkpointReasons.push(...graceResult.checkpointReasons);
  const releasedDisconnectedSeats = releaseExpiredDisconnectedSeats(logger, state, table, tick);
  shouldBroadcast = releasedDisconnectedSeats || shouldBroadcast;
  if (releasedDisconnectedSeats) {
    checkpointReasons.push('presence_left');
  }

  const beforeAutoAction = handSnapshot(table);
  const autoActionMutation = commitTableMutation(state, table, () => table.autoAction(now));
  if (autoActionMutation.result) {
    const hand = table.state.hand;
    logStructured(logger, 'info', 'match.auto_action', {
      matchId: state.matchId,
      tableId: table.state.id,
      tick,
      handId: hand?.handId ?? null,
      action: autoActionMutation.result.action,
      userId: autoActionMutation.result.playerId,
      stateVersion: state.stateVersion,
    });
    shouldBroadcast = true;
    checkpointReasons.push(
      ...checkpointReasonsForTransition('auto_action', beforeAutoAction, table, state)
    );
  } else if (autoActionMutation.changed) {
    shouldBroadcast = true;
  }

  const beforeAutoDiscard = handSnapshot(table);
  const autoDiscardMutation = commitTableMutation(state, table, () => table.autoDiscard(now));
  if (autoDiscardMutation.changed) {
    const hand = table.state.hand;
    logStructured(logger, 'info', 'match.auto_discard', {
      matchId: state.matchId,
      tableId: table.state.id,
      tick,
      handId: hand?.handId ?? null,
      stateVersion: state.stateVersion,
    });
    shouldBroadcast = true;
    checkpointReasons.push(
      ...checkpointReasonsForTransition('auto_discard', beforeAutoDiscard, table, state)
    );
  }

  const beforeBetweenHand = state.betweenHand ? cloneJson(state.betweenHand) : null;
  const beforeBetweenHandSnapshot = handSnapshot(table);
  const betweenHandChanged = advanceBetweenHandIfReady(logger, state, table, tick, now);
  shouldBroadcast = betweenHandChanged || shouldBroadcast;
  if (betweenHandChanged) {
    if (!beforeBetweenHand && state.betweenHand) {
      checkpointReasons.push('between_hand_start');
    } else if (
      beforeBetweenHand &&
      (!state.betweenHand || beforeBetweenHandSnapshot.handId !== table.state.hand?.handId)
    ) {
      checkpointReasons.push('next_hand_start');
    } else {
      checkpointReasons.push('between_hand_ready_changed');
    }
  }

  if (!table.state.hand) {
    if (state.betweenHand) {
      state.betweenHand = null;
      bumpStateVersion(state);
      shouldBroadcast = true;
      checkpointReasons.push('between_hand_ready_changed');
    }
    const nextHandMutation = commitTableMutation(state, table, () => table.beginNextHandIfReady());
    if (nextHandMutation.changed) {
      shouldBroadcast = true;
      checkpointReasons.push('hand_start');
    }
  }

  return { shouldBroadcast, checkpointReasons };
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
  const initialTimerResult = applyExpiredTableTimers(logger, state, table, tick, Date.now());
  shouldBroadcast = initialTimerResult.shouldBroadcast || shouldBroadcast;
  if (initialTimerResult.checkpointReasons.length) {
    state.table = table.state;
    persistCheckpointForReasons(logger, nk, state, initialTimerResult.checkpointReasons);
  }

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
            : data.type === 'rebuy'
              ? {
                  kind: 'rebuy' as const,
                  action: undefined,
                  amount: data.amount,
                  discardIndex: undefined,
                  actionSeq: typeof data.seq === 'number' ? data.seq : null,
                }
              : data.type === 'sitOut'
                ? {
                    kind: 'sitOut' as const,
                    action: undefined,
                    amount: undefined,
                    discardIndex: undefined,
                    actionSeq: typeof data.seq === 'number' ? data.seq : null,
                  }
                : null;
    const before = handSnapshot(table);
    let messageCheckpointReasons: CheckpointWriteReason[] = [];

    try {
      if (isMutatingClientMessage(data)) {
        reserveSequence(state, presence.userId, data);
      }

      switch (data.type) {
        case 'join': {
          const mutation = commitTableMutation(state, table, () => {
            if (isPlayerSeated(table, presence.userId)) {
              table.setSittingOut(presence.userId, false);
              table.beginNextHandIfReady();
              return;
            }
            seatPlayer(table, presence.userId, data.name, state.tableBuyIn, data.seat);
            table.setSittingOut(presence.userId, false);
          });
          sendToPresence(dispatcher, presence, {
            type: 'welcome',
            playerId: presence.userId,
            tableId: table.state.id,
          });
          shouldBroadcast = mutation.changed || shouldBroadcast;
          if (mutation.changed) {
            messageCheckpointReasons.push(
              ...checkpointReasonsForTransition('player_joined', before, table, state)
            );
          }
          break;
        }
        case 'reconnect': {
          if (data.playerId !== presence.userId) {
            throw new Error('Reconnect identity mismatch');
          }
          const connectionChanged = markPlayerConnected(state, presence.userId, Date.now());
          shouldBroadcast = connectionChanged || shouldBroadcast;
          const mutation = commitTableMutation(state, table, () => {
            table.setSittingOut(presence.userId, false);
            table.beginNextHandIfReady();
          });
          sendToPresence(dispatcher, presence, {
            type: 'welcome',
            playerId: presence.userId,
            tableId: table.state.id,
          });
          shouldBroadcast = mutation.changed || shouldBroadcast;
          if (connectionChanged || mutation.changed) {
            messageCheckpointReasons.push(
              ...checkpointReasonsForTransition('presence_joined', before, table, state)
            );
            if (connectionChanged) messageCheckpointReasons.push('reconnect_grace_changed');
          }
          break;
        }
        case 'action': {
          ensureBettingTurn(table, presence.userId);
          const mutation = commitTableMutation(state, table, () =>
            table.applyAction(presence.userId, {
              type: data.action as any,
              amount: data.amount,
            })
          );
          shouldBroadcast = mutation.changed || shouldBroadcast;
          if (mutation.changed) {
            messageCheckpointReasons.push(
              ...checkpointReasonsForTransition('accepted_action', before, table, state)
            );
          }
          break;
        }
        case 'discard': {
          ensureDiscardTurn(table, presence.userId);
          const mutation = commitTableMutation(state, table, () =>
            table.applyDiscard(presence.userId, data.index)
          );
          shouldBroadcast = mutation.changed || shouldBroadcast;
          if (mutation.changed) {
            messageCheckpointReasons.push(
              ...checkpointReasonsForTransition('discard', before, table, state)
            );
          }
          break;
        }
        case 'nextHand': {
          const mutationChanged = setReadyForNextHand(
            logger,
            state,
            table,
            presence.userId,
            true,
            tick,
            Date.now()
          );
          shouldBroadcast = mutationChanged || shouldBroadcast;
          if (mutationChanged) {
            messageCheckpointReasons.push(
              ...checkpointReasonsForTransition('between_hand_ready_changed', before, table, state)
            );
          }
          break;
        }
        case 'rebuy': {
          ensurePlayerSeated(table, presence.userId);
          const mutation = commitTableMutation(state, table, () =>
            table.rebuy(presence.userId, state.tableBuyIn)
          );
          shouldBroadcast = mutation.changed || shouldBroadcast;
          if (mutation.changed) {
            messageCheckpointReasons.push(
              ...checkpointReasonsForTransition('rebuy', before, table, state)
            );
          }
          break;
        }
        case 'sitOut': {
          ensurePlayerSeated(table, presence.userId);
          const mutation = commitTableMutation(state, table, () => table.sitOut(presence.userId));
          shouldBroadcast = mutation.changed || shouldBroadcast;
          if (mutation.changed) {
            messageCheckpointReasons.push(
              ...checkpointReasonsForTransition('sit_out', before, table, state)
            );
          }
          break;
        }
        case 'readyForHand': {
          ensurePlayerSeated(table, presence.userId);
          const mutation = commitTableMutation(state, table, () => {
            table.setReadyForHand(presence.userId, data.ready);
            table.advanceStartGate();
          });
          shouldBroadcast = mutation.changed || shouldBroadcast;
          if (mutation.changed) {
            messageCheckpointReasons.push(
              ...checkpointReasonsForTransition('ready_for_hand', before, table, state)
            );
          }
          break;
        }
        case 'readyForNextHand': {
          const mutationChanged = setReadyForNextHand(
            logger,
            state,
            table,
            presence.userId,
            data.ready,
            tick,
            Date.now()
          );
          shouldBroadcast = mutationChanged || shouldBroadcast;
          if (mutationChanged) {
            messageCheckpointReasons.push(
              ...checkpointReasonsForTransition('between_hand_ready_changed', before, table, state)
            );
          }
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
          sendToPresence(dispatcher, presence, {
            type: 'state',
            state: stateSnapshotForPresence(state, table, presence.userId),
          });
          break;
        }
        default:
          throw new Error('Unknown message');
      }

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
          stateVersion: state.stateVersion,
        });
      }
      if (messageCheckpointReasons.length) {
        state.table = table.state;
        persistCheckpointForReasons(logger, nk, state, messageCheckpointReasons);
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
          stateVersion: state.stateVersion,
        });
      }
      sendToPresence(dispatcher, presence, {
        type: 'error',
        message: err?.message ?? 'error',
      });
    }
  }

  const finalTimerResult = applyExpiredTableTimers(logger, state, table, tick, Date.now());
  shouldBroadcast = finalTimerResult.shouldBroadcast || shouldBroadcast;

  state.table = table.state;
  if (finalTimerResult.checkpointReasons.length) {
    persistCheckpointForReasons(logger, nk, state, finalTimerResult.checkpointReasons);
  }
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
