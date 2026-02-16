const PLAYER_NAME_MAX_LENGTH = 24;

export const PLAYER_NAME_STORAGE_KEY = 'pdh.player.name';

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function normalizePlayerName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, PLAYER_NAME_MAX_LENGTH);
}

export function readStoredPlayerName(): string {
  if (!canUseStorage()) {
    return '';
  }
  const raw = window.localStorage.getItem(PLAYER_NAME_STORAGE_KEY);
  if (!raw) {
    return '';
  }
  return normalizePlayerName(raw);
}

export function storePlayerName(name: string): string {
  const normalized = normalizePlayerName(name);
  if (!canUseStorage()) {
    return normalized;
  }
  if (!normalized) {
    window.localStorage.removeItem(PLAYER_NAME_STORAGE_KEY);
    return '';
  }
  window.localStorage.setItem(PLAYER_NAME_STORAGE_KEY, normalized);
  return normalized;
}
