import type * as nkruntime from '@heroiclabs/nakama-runtime';

export const POKER_TABLE_MATCH_MODULE = 'poker_table';
export const RPC_CREATE_TABLE = 'rpc_create_table';
export const RPC_JOIN_BY_CODE = 'rpc_join_by_code';

const TABLE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TABLE_CODE_LENGTH = 6;
const TABLE_CODE_REGEX = new RegExp(`^[${TABLE_CODE_ALPHABET}]{${TABLE_CODE_LENGTH}}$`);
const TABLES_COLLECTION = 'tables';
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';
const DEFAULT_MAX_PLAYERS = 6;
const MIN_MAX_PLAYERS = 2;
const MAX_MAX_PLAYERS = 9;
const DEFAULT_IS_PRIVATE = true;
const MAX_TABLE_NAME_LENGTH = 48;
const TABLE_LABEL_MODE = 'lobby_table';

interface CreateTableInput {
  name: string;
  maxPlayers: number;
  isPrivate: boolean;
}

interface JoinByCodeInput {
  code: string;
}

interface CreateTableResult {
  code: string;
  matchId: string;
}

interface JoinByCodeResult {
  matchId: string;
}

interface TableStorageValue {
  matchId: string;
  name: string;
  maxPlayers: number;
  isPrivate: boolean;
  createdAt: string;
}

interface PokerTableState {
  code: string;
  name: string;
  maxPlayers: number;
  isPrivate: boolean;
  createdAt: string;
  presences: Record<string, nkruntime.Presence>;
}

interface MatchSnapshot {
  found: boolean | null;
  size: number | null;
}

interface StorageReadRequest {
  collection: string;
  key: string;
  userId: string;
}

interface StorageWriteRequest {
  collection: string;
  key: string;
  userId: string;
  value: Record<string, unknown>;
  permissionRead: number;
  permissionWrite: number;
}

interface StorageObject {
  collection?: string;
  key?: string;
  userId?: string;
  value?: unknown;
  version?: string;
}

type NakamaWithStorage = nkruntime.Nakama & {
  storageRead?: (objects: StorageReadRequest[]) => StorageObject[];
  storageWrite?: (objects: StorageWriteRequest[]) => StorageObject[];
  matchGet?: (matchId: string) => nkruntime.MatchListEntry | null;
};

function normalizeTableCode(input: string): string {
  return input.replace(/[\s-]+/g, '').toUpperCase();
}

function isValidTableCodeFormat(code: string): boolean {
  return TABLE_CODE_REGEX.test(code);
}

function generateTableCode(random: () => number = Math.random): string {
  let value = '';
  for (let i = 0; i < TABLE_CODE_LENGTH; i += 1) {
    const raw = random();
    const normalized = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 0.999999999) : 0;
    const index = Math.floor(normalized * TABLE_CODE_ALPHABET.length);
    value += TABLE_CODE_ALPHABET[index];
  }
  return value;
}

function parseRpcPayload(payload: string | undefined): unknown {
  if (!payload || !payload.trim()) {
    return undefined;
  }

  const parsed = JSON.parse(payload) as unknown;
  if (typeof parsed === 'string') {
    return JSON.parse(parsed) as unknown;
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function parseTableName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Table name is required.');
  }
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    throw new Error('Table name is required.');
  }
  if (normalized.length > MAX_TABLE_NAME_LENGTH) {
    throw new Error(`Table name must be ${MAX_TABLE_NAME_LENGTH} characters or fewer.`);
  }
  return normalized;
}

function parseMaxPlayers(value: unknown): number {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_MAX_PLAYERS;
  }
  if (!Number.isInteger(value)) {
    throw new Error(`Max players must be an integer between ${MIN_MAX_PLAYERS} and ${MAX_MAX_PLAYERS}.`);
  }
  const maxPlayers = Number(value);
  if (maxPlayers < MIN_MAX_PLAYERS || maxPlayers > MAX_MAX_PLAYERS) {
    throw new Error(`Max players must be between ${MIN_MAX_PLAYERS} and ${MAX_MAX_PLAYERS}.`);
  }
  return maxPlayers;
}

function parseIsPrivate(value: unknown): boolean {
  if (value === undefined || value === null) {
    return DEFAULT_IS_PRIVATE;
  }
  if (typeof value !== 'boolean') {
    throw new Error('Private flag must be a boolean.');
  }
  return value;
}

function parseCreateTableInput(payload: string | undefined): CreateTableInput {
  const parsed = parseRpcPayload(payload);
  if (!isRecord(parsed)) {
    throw new Error('Invalid create-table payload.');
  }

  return {
    name: parseTableName(parsed.name),
    maxPlayers: parseMaxPlayers(parsed.maxPlayers),
    isPrivate: parseIsPrivate(parsed.isPrivate),
  };
}

function parseJoinByCodeInput(payload: string | undefined): JoinByCodeInput {
  const parsed = parseRpcPayload(payload);
  const rawCode =
    typeof parsed === 'string' ? parsed : isRecord(parsed) ? (parsed.code as unknown) : undefined;

  if (typeof rawCode !== 'string') {
    throw new Error('Table code is required.');
  }

  const code = normalizeTableCode(rawCode);
  if (!isValidTableCodeFormat(code)) {
    throw new Error('Invalid table code format.');
  }

  return { code };
}

function extractMatchId(match: nkruntime.MatchListEntry | null | undefined): string | null {
  if (!match) return null;
  if (typeof match.matchId === 'string' && match.matchId.length > 0) {
    return match.matchId;
  }
  if (typeof match.match_id === 'string' && match.match_id.length > 0) {
    return match.match_id;
  }
  return null;
}

function extractMatchSize(match: nkruntime.MatchListEntry | null | undefined): number | null {
  const size = match?.size;
  if (typeof size !== 'number' || !Number.isFinite(size)) {
    return null;
  }
  return Math.max(0, Math.floor(size));
}

function tableLabel(code: string) {
  return JSON.stringify({ mode: TABLE_LABEL_MODE, code });
}

function normalizeStoredTableValue(value: unknown): TableStorageValue | null {
  if (!isRecord(value)) {
    return null;
  }

  const matchId = typeof value.matchId === 'string' ? value.matchId.trim() : '';
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const createdAt =
    typeof value.createdAt === 'string' && value.createdAt.trim().length > 0
      ? value.createdAt
      : new Date().toISOString();

  if (!matchId || !name) {
    return null;
  }

  const maxPlayers = parseMaxPlayers(value.maxPlayers);
  const isPrivate = parseIsPrivate(value.isPrivate);

  return {
    matchId,
    name,
    maxPlayers,
    isPrivate,
    createdAt,
  };
}

function readTableByCode(nk: NakamaWithStorage, code: string): TableStorageValue | null {
  if (typeof nk.storageRead !== 'function') {
    throw new Error('Nakama storageRead is unavailable in runtime.');
  }

  const objects = nk.storageRead([
    {
      collection: TABLES_COLLECTION,
      key: code,
      userId: SYSTEM_USER_ID,
    },
  ]);

  const object = objects?.[0];
  if (!object) {
    return null;
  }

  return normalizeStoredTableValue(object.value);
}

function writeTableByCode(nk: NakamaWithStorage, code: string, value: TableStorageValue): void {
  if (typeof nk.storageWrite !== 'function') {
    throw new Error('Nakama storageWrite is unavailable in runtime.');
  }

  nk.storageWrite([
    {
      collection: TABLES_COLLECTION,
      key: code,
      userId: SYSTEM_USER_ID,
      value,
      permissionRead: 2,
      permissionWrite: 0,
    },
  ]);
}

function resolveMatchSnapshot(nk: NakamaWithStorage, tableCode: string, matchId: string): MatchSnapshot {
  if (typeof nk.matchGet === 'function') {
    const match = nk.matchGet(matchId);
    if (!match) {
      return { found: false, size: null };
    }

    const foundMatchId = extractMatchId(match);
    if (foundMatchId && foundMatchId !== matchId) {
      return { found: false, size: null };
    }

    return {
      found: true,
      size: extractMatchSize(match),
    };
  }

  try {
    const matches = nk.matchList(100, true, tableLabel(tableCode), 0, MAX_MAX_PLAYERS, '') ?? [];
    if (!matches.length) {
      return { found: false, size: null };
    }
    for (const match of matches) {
      if (extractMatchId(match) !== matchId) {
        continue;
      }
      return {
        found: true,
        size: extractMatchSize(match),
      };
    }
    return { found: false, size: null };
  } catch {
    return { found: null, size: null };
  }
}

function createUniqueTableCode(nk: NakamaWithStorage): string {
  const maxAttempts = 64;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const code = generateTableCode();
    if (!readTableByCode(nk, code)) {
      return code;
    }
  }
  throw new Error('Could not allocate a unique table code. Please try again.');
}

export function rpcCreateTable(
  ctx: unknown,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string | undefined
) {
  const input = parseCreateTableInput(payload);
  const runtimeNakama = nk as NakamaWithStorage;

  const code = createUniqueTableCode(runtimeNakama);
  const createdAt = new Date().toISOString();
  const matchId = nk.matchCreate(POKER_TABLE_MATCH_MODULE, {
    code,
    name: input.name,
    maxPlayers: input.maxPlayers,
    isPrivate: input.isPrivate,
    createdAt,
  });

  writeTableByCode(runtimeNakama, code, {
    matchId,
    name: input.name,
    maxPlayers: input.maxPlayers,
    isPrivate: input.isPrivate,
    createdAt,
  });

  logger.info(
    'Lobby table created code=%v matchId=%v maxPlayers=%v private=%v',
    code,
    matchId,
    input.maxPlayers,
    input.isPrivate
  );

  const result: CreateTableResult = { code, matchId };
  return JSON.stringify(result);
}

export function rpcJoinByCode(
  ctx: unknown,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string | undefined
) {
  const input = parseJoinByCodeInput(payload);
  const runtimeNakama = nk as NakamaWithStorage;

  const stored = readTableByCode(runtimeNakama, input.code);
  if (!stored) {
    throw new Error('We could not find a table with that code.');
  }

  const snapshot = resolveMatchSnapshot(runtimeNakama, input.code, stored.matchId);
  if (snapshot.found === false) {
    throw new Error('This table is no longer active.');
  }

  if (snapshot.size !== null && snapshot.size >= stored.maxPlayers) {
    throw new Error('This table is already full.');
  }

  logger.info('Resolved table code=%v to matchId=%v', input.code, stored.matchId);

  const result: JoinByCodeResult = { matchId: stored.matchId };
  return JSON.stringify(result);
}

function normalizeMatchInitName(nameValue: unknown, code: string): string {
  if (typeof nameValue !== 'string') {
    return `Table ${code}`;
  }
  const normalized = nameValue.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return `Table ${code}`;
  }
  return normalized.slice(0, MAX_TABLE_NAME_LENGTH);
}

function normalizeMatchInitMaxPlayers(maxPlayersValue: unknown): number {
  try {
    return parseMaxPlayers(maxPlayersValue);
  } catch {
    return DEFAULT_MAX_PLAYERS;
  }
}

function normalizeMatchInitCode(codeValue: unknown): string {
  if (typeof codeValue === 'string') {
    const normalized = normalizeTableCode(codeValue);
    if (isValidTableCodeFormat(normalized)) {
      return normalized;
    }
  }
  return generateTableCode();
}

function pokerTableMatchInit(ctx, logger, nk, params) {
  const code = normalizeMatchInitCode(params?.code);
  const maxPlayers = normalizeMatchInitMaxPlayers(params?.maxPlayers);
  const state: PokerTableState = {
    code,
    name: normalizeMatchInitName(params?.name, code),
    maxPlayers,
    isPrivate: typeof params?.isPrivate === 'boolean' ? params.isPrivate : DEFAULT_IS_PRIVATE,
    createdAt:
      typeof params?.createdAt === 'string' && params.createdAt.trim().length > 0
        ? params.createdAt
        : new Date().toISOString(),
    presences: {},
  };

  return {
    state,
    tickRate: 1,
    label: tableLabel(code),
  };
}

function pokerTableMatchJoinAttempt(ctx, logger, nk, dispatcher, tick, state, presence, metadata) {
  const alreadyPresent = Boolean(state.presences[presence.userId]);
  const presenceCount = Object.keys(state.presences).length;

  if (!alreadyPresent && presenceCount >= state.maxPlayers) {
    return {
      state,
      accept: false,
      rejectMessage: 'Table is full.',
    };
  }

  return {
    state,
    accept: true,
  };
}

function pokerTableMatchJoin(ctx, logger, nk, dispatcher, tick, state, presences) {
  for (const presence of presences) {
    state.presences[presence.userId] = presence;
  }
  return { state };
}

function pokerTableMatchLeave(ctx, logger, nk, dispatcher, tick, state, presences) {
  for (const presence of presences) {
    delete state.presences[presence.userId];
  }
  return { state };
}

function pokerTableMatchLoop(ctx, logger, nk, dispatcher, tick, state, messages) {
  return { state };
}

function pokerTableMatchTerminate(ctx, logger, nk, dispatcher, tick, state, graceSeconds) {
  return { state };
}

function pokerTableMatchSignal(ctx, logger, nk, dispatcher, tick, state, data) {
  return {
    state,
    data: JSON.stringify({
      code: state.code,
      name: state.name,
      maxPlayers: state.maxPlayers,
      presenceCount: Object.keys(state.presences).length,
    }),
  };
}

export const pokerTableMatchHandler = {
  matchInit: pokerTableMatchInit,
  matchJoinAttempt: pokerTableMatchJoinAttempt,
  matchJoin: pokerTableMatchJoin,
  matchLeave: pokerTableMatchLeave,
  matchLoop: pokerTableMatchLoop,
  matchTerminate: pokerTableMatchTerminate,
  matchSignal: pokerTableMatchSignal,
};

(globalThis as any).pokerTableMatchInit = pokerTableMatchInit;
(globalThis as any).pokerTableMatchJoinAttempt = pokerTableMatchJoinAttempt;
(globalThis as any).pokerTableMatchJoin = pokerTableMatchJoin;
(globalThis as any).pokerTableMatchLeave = pokerTableMatchLeave;
(globalThis as any).pokerTableMatchLoop = pokerTableMatchLoop;
(globalThis as any).pokerTableMatchTerminate = pokerTableMatchTerminate;
(globalThis as any).pokerTableMatchSignal = pokerTableMatchSignal;

// Nakama JS runtime resolves additional match handlers by auto-suffixed callback keys.
(globalThis as any).matchInit3 = pokerTableMatchInit;
(globalThis as any).matchJoinAttempt3 = pokerTableMatchJoinAttempt;
(globalThis as any).matchJoin3 = pokerTableMatchJoin;
(globalThis as any).matchLeave3 = pokerTableMatchLeave;
(globalThis as any).matchLoop3 = pokerTableMatchLoop;
(globalThis as any).matchTerminate3 = pokerTableMatchTerminate;
(globalThis as any).matchSignal3 = pokerTableMatchSignal;

(globalThis as any).rpcCreateTable = rpcCreateTable;
(globalThis as any).rpcJoinByCode = rpcJoinByCode;
(globalThis as any).pokerTableMatchHandler = pokerTableMatchHandler;
