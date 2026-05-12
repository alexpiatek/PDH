export type NextHandIntent = 'rebuy' | 'sitOut';

export type NextHandIntentSubmissionWindow = {
  betweenHandActive: boolean;
  handPhase: string | null | undefined;
  hasHand: boolean;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const nextHandIntentStorageKey = (tableId: string | null | undefined, playerId: string | null | undefined) => {
  const normalizedTableId = tableId?.trim();
  const normalizedPlayerId = playerId?.trim();
  if (!normalizedTableId || !normalizedPlayerId) {
    return null;
  }
  return `pdh:nextHandIntent:${normalizedTableId}:${normalizedPlayerId}`;
};

export const isNextHandIntent = (value: unknown): value is NextHandIntent =>
  value === 'rebuy' || value === 'sitOut';

export const readStoredNextHandIntent = (
  storage: StorageLike | null | undefined,
  tableId: string | null | undefined,
  playerId: string | null | undefined
): NextHandIntent | null => {
  const key = nextHandIntentStorageKey(tableId, playerId);
  if (!storage || !key) {
    return null;
  }
  try {
    const value = storage.getItem(key);
    return isNextHandIntent(value) ? value : null;
  } catch {
    return null;
  }
};

export const writeStoredNextHandIntent = (
  storage: StorageLike | null | undefined,
  tableId: string | null | undefined,
  playerId: string | null | undefined,
  intent: NextHandIntent
) => {
  const key = nextHandIntentStorageKey(tableId, playerId);
  if (!storage || !key) {
    return;
  }
  try {
    storage.setItem(key, intent);
  } catch {
    // Local persistence is best-effort; gameplay still relies on server state.
  }
};

export const clearStoredNextHandIntent = (
  storage: StorageLike | null | undefined,
  tableId: string | null | undefined,
  playerId: string | null | undefined
) => {
  const key = nextHandIntentStorageKey(tableId, playerId);
  if (!storage || !key) {
    return;
  }
  try {
    storage.removeItem(key);
  } catch {
    // Ignore localStorage failures.
  }
};

export const canSubmitNextHandIntentNow = ({
  betweenHandActive,
  handPhase,
  hasHand,
}: NextHandIntentSubmissionWindow) => betweenHandActive || !hasHand || handPhase === 'showdown';
