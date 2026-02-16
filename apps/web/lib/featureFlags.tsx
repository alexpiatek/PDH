import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';

export interface FeatureFlags {
  uiNeoLuxuryTheme: boolean;
  uiQuickPlay: boolean;
  uiTableV2: boolean;
  uiDiscardOverlayV2: boolean;
  socialFriendsLobby: boolean;
  progressionMissionsV1: boolean;
}

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  uiNeoLuxuryTheme: false,
  uiQuickPlay: true,
  uiTableV2: false,
  uiDiscardOverlayV2: false,
  socialFriendsLobby: false,
  progressionMissionsV1: false,
};

const REMOTE_FLAGS_ENDPOINT = '/api/feature-flags';
const STORAGE_OVERRIDE_KEY = 'pdh.feature_flags';
const REMOTE_LOAD_TIMEOUT_MS = 1200;

const FLAG_ALIASES: Record<string, keyof FeatureFlags> = {
  uiNeoLuxuryTheme: 'uiNeoLuxuryTheme',
  uiQuickPlay: 'uiQuickPlay',
  uiTableV2: 'uiTableV2',
  uiDiscardOverlayV2: 'uiDiscardOverlayV2',
  socialFriendsLobby: 'socialFriendsLobby',
  progressionMissionsV1: 'progressionMissionsV1',
  'ui.neo_luxury_theme': 'uiNeoLuxuryTheme',
  'ui.quick_play': 'uiQuickPlay',
  'ui.table_v2': 'uiTableV2',
  'ui.discard_overlay_v2': 'uiDiscardOverlayV2',
  'social.friends_lobby': 'socialFriendsLobby',
  'progression.missions_v1': 'progressionMissionsV1',
};

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function sanitizeFlagPayload(value: unknown): Partial<FeatureFlags> {
  if (!isRecord(value)) {
    return {};
  }

  const sanitized: Partial<FeatureFlags> = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    if (typeof rawValue !== 'boolean') {
      continue;
    }
    const mapped = FLAG_ALIASES[rawKey];
    if (!mapped) {
      continue;
    }
    sanitized[mapped] = rawValue;
  }

  return sanitized;
}

function mergeFlags(base: FeatureFlags, overrides: Partial<FeatureFlags>): FeatureFlags {
  return {
    ...base,
    ...overrides,
  };
}

export function resolveStaticFeatureFlags(): FeatureFlags {
  return {
    uiNeoLuxuryTheme: parseBoolean(
      process.env.NEXT_PUBLIC_FF_UI_NEO_LUXURY_THEME,
      DEFAULT_FEATURE_FLAGS.uiNeoLuxuryTheme
    ),
    uiQuickPlay: parseBoolean(
      process.env.NEXT_PUBLIC_FF_UI_QUICK_PLAY,
      DEFAULT_FEATURE_FLAGS.uiQuickPlay
    ),
    uiTableV2: parseBoolean(process.env.NEXT_PUBLIC_FF_UI_TABLE_V2, DEFAULT_FEATURE_FLAGS.uiTableV2),
    uiDiscardOverlayV2: parseBoolean(
      process.env.NEXT_PUBLIC_FF_UI_DISCARD_OVERLAY_V2,
      DEFAULT_FEATURE_FLAGS.uiDiscardOverlayV2
    ),
    socialFriendsLobby: parseBoolean(
      process.env.NEXT_PUBLIC_FF_SOCIAL_FRIENDS_LOBBY,
      DEFAULT_FEATURE_FLAGS.socialFriendsLobby
    ),
    progressionMissionsV1: parseBoolean(
      process.env.NEXT_PUBLIC_FF_PROGRESSION_MISSIONS_V1,
      DEFAULT_FEATURE_FLAGS.progressionMissionsV1
    ),
  };
}

function readStorageOverrides(): Partial<FeatureFlags> {
  if (typeof window === 'undefined') {
    return {};
  }

  const raw = window.localStorage.getItem(STORAGE_OVERRIDE_KEY);
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return sanitizeFlagPayload(parsed);
  } catch {
    return {};
  }
}

async function readRemoteOverrides(signal: AbortSignal): Promise<Partial<FeatureFlags>> {
  if (typeof window === 'undefined') {
    return {};
  }

  const response = await fetch(REMOTE_FLAGS_ENDPOINT, { method: 'GET', cache: 'no-store', signal });
  if (!response.ok) {
    return {};
  }
  const payload = (await response.json()) as unknown;
  if (isRecord(payload) && 'flags' in payload) {
    return sanitizeFlagPayload(payload.flags);
  }
  return sanitizeFlagPayload(payload);
}

export async function loadFeatureFlags(): Promise<FeatureFlags> {
  const base = resolveStaticFeatureFlags();
  let merged = base;

  if (typeof window !== 'undefined') {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), REMOTE_LOAD_TIMEOUT_MS);
    try {
      const remoteOverrides = await readRemoteOverrides(controller.signal);
      merged = mergeFlags(merged, remoteOverrides);
    } catch {
      // Remote flags are optional. Keep static defaults when unavailable.
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  const storageOverrides = readStorageOverrides();
  return mergeFlags(merged, storageOverrides);
}

const FeatureFlagsContext = createContext<FeatureFlags>(resolveStaticFeatureFlags());

export function FeatureFlagsProvider({ children }: PropsWithChildren) {
  const [flags, setFlags] = useState<FeatureFlags>(() => resolveStaticFeatureFlags());

  useEffect(() => {
    let active = true;
    loadFeatureFlags()
      .then((resolved) => {
        if (active) {
          setFlags(resolved);
        }
      })
      .catch(() => {
        // Keep static defaults when async loading fails.
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    document.documentElement.dataset.pdhTheme = flags.uiNeoLuxuryTheme ? 'neo-luxury' : 'classic';
  }, [flags.uiNeoLuxuryTheme]);

  const value = useMemo(() => flags, [flags]);

  return <FeatureFlagsContext.Provider value={value}>{children}</FeatureFlagsContext.Provider>;
}

export function useFeatureFlags(): FeatureFlags {
  return useContext(FeatureFlagsContext);
}
