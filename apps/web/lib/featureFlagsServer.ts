import { Pool, type PoolConfig } from 'pg';

type RemoteFlagMap = Record<string, boolean>;
type FeatureFlagSource = 'db' | 'static';

const DB_FLAG_KEYS = new Set([
  'ui.neo_luxury_theme',
  'ui.quick_play',
  'ui.table_v2',
  'ui.discard_overlay_v2',
  'social.friends_lobby',
  'progression.missions_v1',
]);

interface DbFlagRow {
  key: string;
  enabled: boolean;
  updated_at: string | null;
}

interface FeatureFlagLoadResult {
  flags: RemoteFlagMap;
  source: FeatureFlagSource;
  updatedAt: string | null;
  error: string | null;
}

type GlobalPool = typeof globalThis & {
  __PDH_FEATURE_FLAGS_POOL__?: Pool;
};

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

export function resolveStaticFeatureFlags(): RemoteFlagMap {
  return {
    'ui.neo_luxury_theme': parseBoolean(
      process.env.NEXT_PUBLIC_FF_UI_NEO_LUXURY_THEME,
      false
    ),
    'ui.quick_play': parseBoolean(process.env.NEXT_PUBLIC_FF_UI_QUICK_PLAY, true),
    'ui.table_v2': parseBoolean(process.env.NEXT_PUBLIC_FF_UI_TABLE_V2, false),
    'ui.discard_overlay_v2': parseBoolean(
      process.env.NEXT_PUBLIC_FF_UI_DISCARD_OVERLAY_V2,
      false
    ),
    'social.friends_lobby': parseBoolean(
      process.env.NEXT_PUBLIC_FF_SOCIAL_FRIENDS_LOBBY,
      false
    ),
    'progression.missions_v1': parseBoolean(
      process.env.NEXT_PUBLIC_FF_PROGRESSION_MISSIONS_V1,
      false
    ),
  };
}

function featureFlagsPoolConfig(): PoolConfig | null {
  const connectionString =
    process.env.FEATURE_FLAGS_DATABASE_URL || process.env.DATABASE_URL;
  if (connectionString) {
    return { connectionString };
  }

  const host =
    process.env.FEATURE_FLAGS_DB_HOST ||
    process.env.PGHOST ||
    process.env.POSTGRES_HOST ||
    process.env.POSTGRES_HOSTNAME ||
    undefined;
  const user =
    process.env.FEATURE_FLAGS_DB_USER ||
    process.env.PGUSER ||
    process.env.POSTGRES_USER ||
    undefined;
  const database =
    process.env.FEATURE_FLAGS_DB_NAME ||
    process.env.PGDATABASE ||
    process.env.POSTGRES_DB ||
    undefined;
  const password =
    process.env.FEATURE_FLAGS_DB_PASSWORD ||
    process.env.PGPASSWORD ||
    process.env.POSTGRES_PASSWORD ||
    undefined;
  const portRaw =
    process.env.FEATURE_FLAGS_DB_PORT || process.env.PGPORT || process.env.POSTGRES_PORT;
  const portParsed =
    portRaw && Number.isFinite(Number(portRaw)) ? Number(portRaw) : undefined;

  if (!user || !database) {
    return null;
  }

  return {
    host: host || '127.0.0.1',
    user,
    database,
    password,
    port: portParsed,
  };
}

function getFeatureFlagsPool(): Pool | null {
  const globalPool = globalThis as GlobalPool;
  if (globalPool.__PDH_FEATURE_FLAGS_POOL__) {
    return globalPool.__PDH_FEATURE_FLAGS_POOL__;
  }

  const config = featureFlagsPoolConfig();
  if (!config) {
    return null;
  }

  const pool = new Pool({
    ...config,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 1_500,
  });
  globalPool.__PDH_FEATURE_FLAGS_POOL__ = pool;
  return pool;
}

export async function loadFeatureFlagsFromDatabase(): Promise<FeatureFlagLoadResult> {
  const flags = resolveStaticFeatureFlags();
  const pool = getFeatureFlagsPool();
  if (!pool) {
    return {
      flags,
      source: 'static',
      updatedAt: null,
      error: 'feature flags database is not configured',
    };
  }

  try {
    const query = await pool.query<DbFlagRow>(
      'SELECT key, enabled, updated_at FROM public.pdh_feature_flags'
    );

    let updatedAt: string | null = null;
    for (const row of query.rows) {
      if (!DB_FLAG_KEYS.has(row.key)) {
        continue;
      }
      flags[row.key] = row.enabled;
      if (row.updated_at && (!updatedAt || row.updated_at > updatedAt)) {
        updatedAt = row.updated_at;
      }
    }

    return {
      flags,
      source: 'db',
      updatedAt,
      error: null,
    };
  } catch (error) {
    void error;
    return {
      flags,
      source: 'static',
      updatedAt: null,
      error: 'feature flag query failed',
    };
  }
}
