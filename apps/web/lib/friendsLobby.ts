import { normalizeTableCode } from '@pdh/protocol';

export interface TrackedLobbyFriend {
  alias: string;
  tableCode: string;
  updatedAt: string;
}

const STORAGE_KEY = 'pdh.lobby.tracked_friends';
const MAX_TRACKED_FRIENDS = 16;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function normalizeTrackedLobbyFriend(value: unknown): TrackedLobbyFriend | null {
  if (!isRecord(value)) {
    return null;
  }

  const alias = typeof value.alias === 'string' ? value.alias.trim() : '';
  const tableCode = typeof value.tableCode === 'string' ? normalizeTableCode(value.tableCode) : '';
  if (!alias || !tableCode) {
    return null;
  }

  const updatedAt =
    typeof value.updatedAt === 'string' && value.updatedAt.trim().length > 0
      ? value.updatedAt
      : new Date().toISOString();

  return {
    alias,
    tableCode,
    updatedAt,
  };
}

function saveTrackedFriends(entries: TrackedLobbyFriend[]): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_TRACKED_FRIENDS)));
}

export function getTrackedFriends(): TrackedLobbyFriend[] {
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
      .map((entry) => normalizeTrackedLobbyFriend(entry))
      .filter((entry): entry is TrackedLobbyFriend => Boolean(entry))
      .sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1))
      .slice(0, MAX_TRACKED_FRIENDS);
  } catch {
    return [];
  }
}

export function upsertTrackedFriend(entry: Omit<TrackedLobbyFriend, 'updatedAt'>): TrackedLobbyFriend[] {
  const normalized = normalizeTrackedLobbyFriend({
    ...entry,
    updatedAt: new Date().toISOString(),
  });
  if (!normalized) {
    return getTrackedFriends();
  }

  const existing = getTrackedFriends().filter(
    (friend) => friend.alias.toLowerCase() !== normalized.alias.toLowerCase()
  );
  const next = [normalized, ...existing].slice(0, MAX_TRACKED_FRIENDS);
  saveTrackedFriends(next);
  return next;
}

export function removeTrackedFriend(alias: string): TrackedLobbyFriend[] {
  const normalizedAlias = alias.trim().toLowerCase();
  if (!normalizedAlias) {
    return getTrackedFriends();
  }
  const next = getTrackedFriends().filter(
    (friend) => friend.alias.toLowerCase() !== normalizedAlias
  );
  saveTrackedFriends(next);
  return next;
}
