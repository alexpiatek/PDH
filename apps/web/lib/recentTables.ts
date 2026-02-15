export interface RecentLobbyTable {
  code: string;
  name: string;
  matchId?: string;
  maxPlayers?: number;
  isPrivate?: boolean;
  updatedAt: string;
}

const STORAGE_KEY = 'pdh.lobby.recent_tables';
const MAX_RECENT_TABLES = 10;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function normalizeRecentTable(value: unknown): RecentLobbyTable | null {
  if (!isRecord(value)) {
    return null;
  }

  const code = typeof value.code === 'string' ? value.code.trim().toUpperCase() : '';
  if (!code) {
    return null;
  }

  const name = typeof value.name === 'string' && value.name.trim().length > 0 ? value.name : code;
  const matchId = typeof value.matchId === 'string' && value.matchId.trim().length > 0 ? value.matchId : undefined;
  const maxPlayers =
    typeof value.maxPlayers === 'number' && Number.isInteger(value.maxPlayers)
      ? value.maxPlayers
      : undefined;
  const isPrivate = typeof value.isPrivate === 'boolean' ? value.isPrivate : undefined;
  const updatedAt =
    typeof value.updatedAt === 'string' && value.updatedAt.trim().length > 0
      ? value.updatedAt
      : new Date().toISOString();

  return {
    code,
    name,
    matchId,
    maxPlayers,
    isPrivate,
    updatedAt,
  };
}

export function getRecentTables(): RecentLobbyTable[] {
  if (typeof window === 'undefined') {
    return [];
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry) => normalizeRecentTable(entry))
      .filter((entry): entry is RecentLobbyTable => Boolean(entry))
      .sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1))
      .slice(0, MAX_RECENT_TABLES);
  } catch {
    return [];
  }
}

function saveRecentTables(entries: RecentLobbyTable[]): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_RECENT_TABLES)));
}

export function upsertRecentTable(entry: Omit<RecentLobbyTable, 'updatedAt'>): RecentLobbyTable[] {
  const normalized = normalizeRecentTable({
    ...entry,
    updatedAt: new Date().toISOString(),
  });
  if (!normalized) {
    return getRecentTables();
  }

  const deduped = getRecentTables().filter((existing) => existing.code !== normalized.code);
  const next = [normalized, ...deduped].slice(0, MAX_RECENT_TABLES);
  saveRecentTables(next);
  return next;
}
