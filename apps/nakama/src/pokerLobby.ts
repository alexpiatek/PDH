import type * as nkruntime from '@heroiclabs/nakama-runtime';

export const POKER_TABLE_MATCH_MODULE = 'poker_table';
export const LOBBY_GAMEPLAY_MATCH_MODULE = 'pdh';
export const RPC_CREATE_TABLE = 'rpc_create_table';
export const RPC_JOIN_BY_CODE = 'rpc_join_by_code';
export const RPC_QUICK_PLAY = 'rpc_quick_play';
export const RPC_LIST_TABLES = 'rpc_list_tables';

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
const DEFAULT_QUICK_PLAY_BUY_IN = 10000;
const MIN_QUICK_PLAY_BUY_IN = 500;
const MAX_QUICK_PLAY_BUY_IN = 1_000_000;

const QUICK_PLAY_SKILL_TIERS = ['newcomer', 'casual', 'regular', 'pro'] as const;
type QuickPlaySkillTier = (typeof QUICK_PLAY_SKILL_TIERS)[number];
const DEFAULT_QUICK_PLAY_SKILL_TIER: QuickPlaySkillTier = 'casual';
const QUICK_PLAY_SKILL_RANK: Record<QuickPlaySkillTier, number> = {
  newcomer: 0,
  casual: 1,
  regular: 2,
  pro: 3,
};

interface CreateTableInput {
  name: string;
  maxPlayers: number;
  isPrivate: boolean;
}

interface JoinByCodeInput {
  code: string;
}

interface QuickPlayInput {
  maxPlayers: number;
  targetBuyIn: number;
  skillTier: QuickPlaySkillTier;
}

interface QuickPlayMeta {
  buyIn: number;
  skillTier: QuickPlaySkillTier;
}

interface ListTablesInput {
  includePrivate: boolean;
  limit: number;
}

interface CreateTableResult {
  code: string;
  matchId: string;
}

interface JoinByCodeResult {
  matchId: string;
}

interface LobbyTableSummary {
  code: string;
  matchId: string;
  name: string;
  maxPlayers: number;
  isPrivate: boolean;
  createdAt: string;
  presenceCount: number;
  seatsOpen: number;
  quickPlayBuyIn: number;
  quickPlaySkillTier: QuickPlaySkillTier;
}

interface QuickPlayResult {
  code: string;
  matchId: string;
  name: string;
  maxPlayers: number;
  isPrivate: boolean;
  created: boolean;
  quickPlayBuyIn: number;
  quickPlaySkillTier: QuickPlaySkillTier;
}

interface ListTablesResult {
  tables: LobbyTableSummary[];
}

interface TableStorageValue {
  matchId: string;
  name: string;
  maxPlayers: number;
  isPrivate: boolean;
  createdAt: string;
  quickPlay: QuickPlayMeta | null;
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
    throw new Error(
      `Max players must be an integer between ${MIN_MAX_PLAYERS} and ${MAX_MAX_PLAYERS}.`
    );
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

function parseQuickPlayInput(payload: string | undefined): QuickPlayInput {
  const parsed = parseRpcPayload(payload);
  if (parsed === undefined) {
    return {
      maxPlayers: DEFAULT_MAX_PLAYERS,
      targetBuyIn: DEFAULT_QUICK_PLAY_BUY_IN,
      skillTier: DEFAULT_QUICK_PLAY_SKILL_TIER,
    };
  }
  if (!isRecord(parsed)) {
    throw new Error('Invalid quick-play payload.');
  }
  return {
    maxPlayers: parseMaxPlayers(parsed.maxPlayers),
    targetBuyIn: parseQuickPlayBuyIn(parsed.targetBuyIn),
    skillTier: parseQuickPlaySkillTier(parsed.skillTier),
  };
}

function parseQuickPlayBuyIn(value: unknown): number {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_QUICK_PLAY_BUY_IN;
  }
  if (!Number.isInteger(value)) {
    throw new Error(
      `Quick-play buy-in must be an integer between ${MIN_QUICK_PLAY_BUY_IN} and ${MAX_QUICK_PLAY_BUY_IN}.`
    );
  }
  const buyIn = Number(value);
  if (buyIn < MIN_QUICK_PLAY_BUY_IN || buyIn > MAX_QUICK_PLAY_BUY_IN) {
    throw new Error(
      `Quick-play buy-in must be between ${MIN_QUICK_PLAY_BUY_IN} and ${MAX_QUICK_PLAY_BUY_IN}.`
    );
  }
  return buyIn;
}

function parseQuickPlaySkillTier(value: unknown): QuickPlaySkillTier {
  if (value === undefined || value === null) {
    return DEFAULT_QUICK_PLAY_SKILL_TIER;
  }
  if (typeof value !== 'string') {
    throw new Error('Quick-play skill tier must be a string.');
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return DEFAULT_QUICK_PLAY_SKILL_TIER;
  }

  if (normalized === 'new' || normalized === 'beginner') {
    return 'newcomer';
  }

  if (normalized === 'intermediate') {
    return 'regular';
  }

  if ((QUICK_PLAY_SKILL_TIERS as readonly string[]).includes(normalized)) {
    return normalized as QuickPlaySkillTier;
  }

  throw new Error('Quick-play skill tier must be one of newcomer, casual, regular, or pro.');
}

function normalizeQuickPlayMeta(value: unknown): QuickPlayMeta | null {
  if (!isRecord(value)) {
    return null;
  }

  try {
    return {
      buyIn: parseQuickPlayBuyIn(value.buyIn),
      skillTier: parseQuickPlaySkillTier(value.skillTier),
    };
  } catch {
    return null;
  }
}

function parseListTablesInput(payload: string | undefined): ListTablesInput {
  const parsed = parseRpcPayload(payload);
  if (parsed === undefined) {
    return { includePrivate: false, limit: 30 };
  }
  if (!isRecord(parsed)) {
    throw new Error('Invalid list-tables payload.');
  }

  const includePrivateRaw = parsed.includePrivate;
  if (
    includePrivateRaw !== undefined &&
    includePrivateRaw !== null &&
    typeof includePrivateRaw !== 'boolean'
  ) {
    throw new Error('includePrivate must be a boolean.');
  }
  const includePrivate = typeof includePrivateRaw === 'boolean' ? includePrivateRaw : false;

  const limitRaw = parsed.limit;
  if (limitRaw !== undefined && limitRaw !== null && !Number.isInteger(limitRaw)) {
    throw new Error('limit must be an integer.');
  }
  const limitParsed = typeof limitRaw === 'number' ? Number(limitRaw) : 30;
  const limit = Math.max(1, Math.min(100, limitParsed));

  return { includePrivate, limit };
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
  const quickPlay = normalizeQuickPlayMeta(value.quickPlay);

  return {
    matchId,
    name,
    maxPlayers,
    isPrivate,
    createdAt,
    quickPlay,
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

function resolveMatchSnapshot(nk: NakamaWithStorage, matchId: string): MatchSnapshot {
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
    const matches = nk.matchList(100, true, '', 0, MAX_MAX_PLAYERS, '') ?? [];
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

function tableCodeFromMatchLabel(rawLabel: unknown): string | null {
  if (typeof rawLabel !== 'string' || !rawLabel.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(rawLabel) as unknown;
    if (!isRecord(parsed) || typeof parsed.tableId !== 'string') {
      return null;
    }
    const code = normalizeTableCode(parsed.tableId);
    if (!isValidTableCodeFormat(code)) {
      return null;
    }
    return code;
  } catch {
    return null;
  }
}

function listActiveLobbyTables(nk: NakamaWithStorage): LobbyTableSummary[] {
  const matches = nk.matchList(100, true, '', 0, MAX_MAX_PLAYERS, '') ?? [];
  if (!matches.length) {
    return [];
  }

  const summaries: LobbyTableSummary[] = [];
  for (const match of matches) {
    const code = tableCodeFromMatchLabel(match.label);
    if (!code) {
      continue;
    }

    const matchId = extractMatchId(match);
    if (!matchId) {
      continue;
    }

    const stored = readTableByCode(nk, code);
    if (!stored) {
      continue;
    }
    if (stored.matchId !== matchId) {
      continue;
    }

    const presenceCountRaw = extractMatchSize(match) ?? 0;
    const presenceCount = Math.max(0, Math.min(stored.maxPlayers, presenceCountRaw));
    const seatsOpen = Math.max(0, stored.maxPlayers - presenceCount);

    summaries.push({
      code,
      matchId,
      name: stored.name,
      maxPlayers: stored.maxPlayers,
      isPrivate: stored.isPrivate,
      createdAt: stored.createdAt,
      presenceCount,
      seatsOpen,
      quickPlayBuyIn: stored.quickPlay?.buyIn ?? DEFAULT_QUICK_PLAY_BUY_IN,
      quickPlaySkillTier: stored.quickPlay?.skillTier ?? DEFAULT_QUICK_PLAY_SKILL_TIER,
    });
  }

  summaries.sort((a, b) => {
    if (b.presenceCount !== a.presenceCount) {
      return b.presenceCount - a.presenceCount;
    }
    if (a.seatsOpen !== b.seatsOpen) {
      return a.seatsOpen - b.seatsOpen;
    }
    return a.createdAt < b.createdAt ? -1 : 1;
  });

  return summaries;
}

function createQuickPlayTable(
  nk: NakamaWithStorage,
  maxPlayers: number,
  quickPlay: QuickPlayMeta
): QuickPlayResult {
  const code = createUniqueTableCode(nk);
  const createdAt = new Date().toISOString();
  const name = 'Quick Play';
  const matchId = nk.matchCreate(LOBBY_GAMEPLAY_MATCH_MODULE, { tableId: code });

  writeTableByCode(nk, code, {
    matchId,
    name,
    maxPlayers,
    isPrivate: false,
    createdAt,
    quickPlay,
  });

  return {
    code,
    matchId,
    name,
    maxPlayers,
    isPrivate: false,
    created: true,
    quickPlayBuyIn: quickPlay.buyIn,
    quickPlaySkillTier: quickPlay.skillTier,
  };
}

function preferredOccupancyForSkill(skillTier: QuickPlaySkillTier): number {
  if (skillTier === 'newcomer') {
    return 0.45;
  }
  if (skillTier === 'casual') {
    return 0.62;
  }
  if (skillTier === 'regular') {
    return 0.78;
  }
  return 0.9;
}

function scoreQuickPlayCandidate(table: LobbyTableSummary, input: QuickPlayInput): number {
  const buyInDelta =
    Math.abs(table.quickPlayBuyIn - input.targetBuyIn) / Math.max(1, input.targetBuyIn);
  const skillDelta = Math.abs(
    QUICK_PLAY_SKILL_RANK[table.quickPlaySkillTier] - QUICK_PLAY_SKILL_RANK[input.skillTier]
  );
  const fillRatio = table.maxPlayers > 0 ? table.presenceCount / table.maxPlayers : 0;
  const occupancyDelta = Math.abs(fillRatio - preferredOccupancyForSkill(input.skillTier));

  let score = buyInDelta * 2.2 + skillDelta * 0.9 + occupancyDelta * 1.1;
  if (table.seatsOpen === 1) {
    score += 0.12;
  }
  if (table.presenceCount === 0) {
    score += 0.08;
  }

  return score;
}

function chooseBestQuickPlayCandidate(
  candidates: LobbyTableSummary[],
  input: QuickPlayInput
): LobbyTableSummary | null {
  if (!candidates.length) {
    return null;
  }

  let best = candidates[0];
  let bestScore = scoreQuickPlayCandidate(best, input);

  for (let i = 1; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const candidateScore = scoreQuickPlayCandidate(candidate, input);
    if (candidateScore + 0.0001 < bestScore) {
      best = candidate;
      bestScore = candidateScore;
      continue;
    }

    if (Math.abs(candidateScore - bestScore) <= 0.0001) {
      if (candidate.presenceCount > best.presenceCount) {
        best = candidate;
        bestScore = candidateScore;
        continue;
      }
      if (candidate.presenceCount === best.presenceCount && candidate.createdAt < best.createdAt) {
        best = candidate;
        bestScore = candidateScore;
      }
    }
  }

  return best;
}

function listQuickPlayCandidates(
  nk: NakamaWithStorage,
  input: Pick<QuickPlayInput, 'maxPlayers'>
): LobbyTableSummary[] {
  return listActiveLobbyTables(nk).filter(
    (table) => !table.isPrivate && table.seatsOpen > 0 && table.maxPlayers === input.maxPlayers
  );
}

function quickPlayResultFromSummary(table: LobbyTableSummary, created: boolean): QuickPlayResult {
  return {
    code: table.code,
    matchId: table.matchId,
    name: table.name,
    maxPlayers: table.maxPlayers,
    isPrivate: table.isPrivate,
    created,
    quickPlayBuyIn: table.quickPlayBuyIn,
    quickPlaySkillTier: table.quickPlaySkillTier,
  };
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
  const matchId = nk.matchCreate(LOBBY_GAMEPLAY_MATCH_MODULE, {
    tableId: code,
  });

  writeTableByCode(runtimeNakama, code, {
    matchId,
    name: input.name,
    maxPlayers: input.maxPlayers,
    isPrivate: input.isPrivate,
    createdAt,
    quickPlay: input.isPrivate
      ? null
      : {
          buyIn: DEFAULT_QUICK_PLAY_BUY_IN,
          skillTier: DEFAULT_QUICK_PLAY_SKILL_TIER,
        },
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

  const snapshot = resolveMatchSnapshot(runtimeNakama, stored.matchId);
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

export function rpcQuickPlay(
  ctx: unknown,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string | undefined
) {
  const input = parseQuickPlayInput(payload);
  const runtimeNakama = nk as NakamaWithStorage;

  const candidates = listQuickPlayCandidates(runtimeNakama, input);

  const chosen = chooseBestQuickPlayCandidate(candidates, input);
  if (chosen) {
    logger.info(
      'Quick play resolved existing table code=%v matchId=%v presence=%v/%v buyIn=%v skill=%v targetBuyIn=%v targetSkill=%v',
      chosen.code,
      chosen.matchId,
      chosen.presenceCount,
      chosen.maxPlayers,
      chosen.quickPlayBuyIn,
      chosen.quickPlaySkillTier,
      input.targetBuyIn,
      input.skillTier
    );
    return JSON.stringify(quickPlayResultFromSummary(chosen, false));
  }

  const created = createQuickPlayTable(runtimeNakama, input.maxPlayers, {
    buyIn: input.targetBuyIn,
    skillTier: input.skillTier,
  });
  logger.info(
    'Quick play created new table code=%v matchId=%v maxPlayers=%v buyIn=%v skill=%v',
    created.code,
    created.matchId,
    created.maxPlayers,
    created.quickPlayBuyIn,
    created.quickPlaySkillTier
  );

  // Re-resolve after creation so concurrent first entrants deterministically
  // converge onto the same table selection rather than splitting.
  const convergedCandidates = listQuickPlayCandidates(runtimeNakama, input);
  const converged = chooseBestQuickPlayCandidate(convergedCandidates, input);
  if (!converged) {
    return JSON.stringify(created);
  }

  const createdByThisCall = converged.matchId === created.matchId;
  if (!createdByThisCall) {
    logger.info(
      'Quick play converged to existing table code=%v matchId=%v after create attempt code=%v matchId=%v',
      converged.code,
      converged.matchId,
      created.code,
      created.matchId
    );
  }
  return JSON.stringify(quickPlayResultFromSummary(converged, createdByThisCall));
}

export function rpcListTables(
  ctx: unknown,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string | undefined
) {
  const input = parseListTablesInput(payload);
  const runtimeNakama = nk as NakamaWithStorage;
  const tables = listActiveLobbyTables(runtimeNakama)
    .filter((table) => input.includePrivate || !table.isPrivate)
    .slice(0, input.limit);

  logger.info(
    'List tables includePrivate=%v limit=%v count=%v',
    input.includePrivate,
    input.limit,
    tables.length
  );

  const result: ListTablesResult = { tables };
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
    label: JSON.stringify({ mode: 'lobby_table', code }),
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
(globalThis as any).rpcQuickPlay = rpcQuickPlay;
(globalThis as any).rpcListTables = rpcListTables;
(globalThis as any).pokerTableMatchHandler = pokerTableMatchHandler;
