import { Pool, type PoolConfig } from 'pg';
import type {
  ChipLedgerEntry,
  TestingEvent,
  TestingProfile,
  TestingSession,
} from './playerTestingAnalytics';

type GlobalPool = typeof globalThis & {
  __PDH_PLAYER_TESTING_POOL__?: Pool;
};

export interface PlayerTestingAnalyticsBatch {
  profile: TestingProfile;
  sessions?: TestingSession[];
  events?: TestingEvent[];
  chipLedger?: ChipLedgerEntry[];
}

export interface PlayerTestingDashboard {
  source: 'db' | 'unconfigured' | 'error';
  updatedAt: string;
  error: string | null;
  summary: {
    profiles: number;
    sessions: number;
    activeSessions: number;
    events: number;
    ledgerEntries: number;
    handsSeen: number;
    actionsTaken: number;
    rebuys: number;
    sitOuts: number;
    avgSessionMinutes: number | null;
    avgHandsPerSession: number | null;
    avgActionsPerSession: number | null;
  };
  decisions: Array<{
    area: 'stats' | 'leaderboards' | 'progression' | 'bankroll' | 'smoothness';
    label: string;
    signal: 'low' | 'medium' | 'high';
    score: number;
    recommendation: string;
  }>;
  entryPoints: Array<{
    entryPoint: string;
    sessions: number;
  }>;
  topEvents: Array<{
    eventType: string;
    events: number;
  }>;
  recentSessions: Array<{
    sessionKey: string;
    profileKey: string;
    displayName: string | null;
    entryPoint: string;
    backend: string | null;
    matchId: string | null;
    tableId: string | null;
    startedAt: string;
    endedAt: string | null;
    initialStack: number | null;
    lastStack: number | null;
    handsSeen: number;
    actionsTaken: number;
    rebuys: number;
    sitOuts: number;
  }>;
  chipTrend: Array<{
    bucket: string;
    samples: number;
    avgStack: number;
    netDelta: number;
  }>;
}

function testingPoolConfig(): PoolConfig | null {
  const connectionString = process.env.PLAYER_TESTING_DATABASE_URL || process.env.DATABASE_URL;
  if (connectionString) {
    return { connectionString };
  }

  const host =
    process.env.PLAYER_TESTING_DB_HOST ||
    process.env.PGHOST ||
    process.env.POSTGRES_HOST ||
    process.env.POSTGRES_HOSTNAME ||
    undefined;
  const user =
    process.env.PLAYER_TESTING_DB_USER ||
    process.env.PGUSER ||
    process.env.POSTGRES_USER ||
    undefined;
  const database =
    process.env.PLAYER_TESTING_DB_NAME ||
    process.env.PGDATABASE ||
    process.env.POSTGRES_DB ||
    undefined;
  const password =
    process.env.PLAYER_TESTING_DB_PASSWORD ||
    process.env.PGPASSWORD ||
    process.env.POSTGRES_PASSWORD ||
    undefined;
  const portRaw =
    process.env.PLAYER_TESTING_DB_PORT || process.env.PGPORT || process.env.POSTGRES_PORT;
  const portParsed = portRaw && Number.isFinite(Number(portRaw)) ? Number(portRaw) : undefined;

  if ((!user || !database) && process.env.NODE_ENV !== 'production') {
    return {
      host: host || '127.0.0.1',
      user: user || 'nakama',
      database: database || 'nakama',
      password: password || 'localdb',
      port: portParsed || 5432,
    };
  }

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

function getTestingPool(): Pool | null {
  const globalPool = globalThis as GlobalPool;
  if (globalPool.__PDH_PLAYER_TESTING_POOL__) {
    return globalPool.__PDH_PLAYER_TESTING_POOL__;
  }

  const config = testingPoolConfig();
  if (!config) {
    return null;
  }

  const pool = new Pool({
    ...config,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 1_500,
  });
  globalPool.__PDH_PLAYER_TESTING_POOL__ = pool;
  return pool;
}

function optionalText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function optionalInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.trunc(value);
}

function asDateText(value: unknown): string {
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  return new Date().toISOString();
}

function plainPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export async function persistPlayerTestingAnalytics(
  batch: PlayerTestingAnalyticsBatch
): Promise<{ stored: boolean }> {
  const pool = getTestingPool();
  if (!pool) {
    return { stored: false };
  }

  const profile = batch.profile;
  await pool.query(
    `
      INSERT INTO public.player_testing_profiles (profile_key, display_name, auth_mode, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (profile_key) DO UPDATE SET
        display_name = COALESCE(EXCLUDED.display_name, public.player_testing_profiles.display_name),
        auth_mode = EXCLUDED.auth_mode,
        updated_at = EXCLUDED.updated_at
    `,
    [
      optionalText(profile.profileKey, 120),
      optionalText(profile.displayName, 80),
      profile.authMode === 'magic_link' ? 'magic_link' : 'device',
      asDateText(profile.createdAt),
      asDateText(profile.updatedAt),
    ]
  );

  for (const session of batch.sessions ?? []) {
    await pool.query(
      `
        INSERT INTO public.player_testing_sessions (
          session_key,
          profile_key,
          entry_point,
          backend,
          match_id,
          table_id,
          started_at,
          ended_at,
          initial_stack,
          last_stack,
          hands_seen,
          actions_taken,
          rebuys,
          sit_outs,
          payload,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now())
        ON CONFLICT (session_key) DO UPDATE SET
          backend = COALESCE(EXCLUDED.backend, public.player_testing_sessions.backend),
          match_id = COALESCE(EXCLUDED.match_id, public.player_testing_sessions.match_id),
          table_id = COALESCE(EXCLUDED.table_id, public.player_testing_sessions.table_id),
          ended_at = COALESCE(EXCLUDED.ended_at, public.player_testing_sessions.ended_at),
          initial_stack = COALESCE(public.player_testing_sessions.initial_stack, EXCLUDED.initial_stack),
          last_stack = COALESCE(EXCLUDED.last_stack, public.player_testing_sessions.last_stack),
          hands_seen = GREATEST(public.player_testing_sessions.hands_seen, EXCLUDED.hands_seen),
          actions_taken = GREATEST(public.player_testing_sessions.actions_taken, EXCLUDED.actions_taken),
          rebuys = GREATEST(public.player_testing_sessions.rebuys, EXCLUDED.rebuys),
          sit_outs = GREATEST(public.player_testing_sessions.sit_outs, EXCLUDED.sit_outs),
          payload = public.player_testing_sessions.payload || EXCLUDED.payload,
          updated_at = now()
      `,
      [
        optionalText(session.sessionKey, 120),
        optionalText(profile.profileKey, 120),
        optionalText(session.entryPoint, 80) ?? 'unknown',
        optionalText(session.backend, 40),
        optionalText(session.matchId, 160),
        optionalText(session.tableId, 80),
        asDateText(session.startedAt),
        session.endedAt ? asDateText(session.endedAt) : null,
        optionalInteger(session.initialStack),
        optionalInteger(session.lastStack),
        optionalInteger(session.handsSeen) ?? 0,
        optionalInteger(session.actionsTaken) ?? 0,
        optionalInteger(session.rebuys) ?? 0,
        optionalInteger(session.sitOuts) ?? 0,
        {
          maxStack: session.maxStack,
          minStack: session.minStack,
        },
      ]
    );
  }

  for (const event of batch.events ?? []) {
    await pool.query(
      `
        INSERT INTO public.player_testing_events (
          profile_key,
          session_key,
          event_type,
          payload,
          occurred_at
        )
        VALUES ($1, $2, $3, $4, $5)
      `,
      [
        optionalText(profile.profileKey, 120),
        optionalText(event.sessionKey, 120),
        optionalText(event.eventType, 120) ?? 'unknown',
        plainPayload(event.payload),
        asDateText(event.occurredAt),
      ]
    );
  }

  for (const entry of batch.chipLedger ?? []) {
    await pool.query(
      `
        INSERT INTO public.player_chip_ledger (
          profile_key,
          session_key,
          match_id,
          table_id,
          hand_id,
          phase,
          stack,
          delta,
          event_type,
          occurred_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        optionalText(profile.profileKey, 120),
        optionalText(entry.sessionKey, 120),
        optionalText(entry.matchId, 160),
        optionalText(entry.tableId, 80),
        optionalText(entry.handId, 80),
        optionalText(entry.phase, 40),
        optionalInteger(entry.stack) ?? 0,
        optionalInteger(entry.delta),
        optionalText(entry.eventType, 80) ?? 'snapshot',
        asDateText(entry.occurredAt),
      ]
    );
  }

  return { stored: true };
}

function toInteger(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
  }
  return 0;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIso(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  return new Date().toISOString();
}

function signalFromScore(score: number): 'low' | 'medium' | 'high' {
  if (score >= 70) return 'high';
  if (score >= 35) return 'medium';
  return 'low';
}

function buildDecisions(
  summary: PlayerTestingDashboard['summary']
): PlayerTestingDashboard['decisions'] {
  const replayRate = summary.profiles > 0 ? summary.sessions / summary.profiles : 0;
  const handsPerSession = summary.avgHandsPerSession ?? 0;
  const actionsPerSession = summary.avgActionsPerSession ?? 0;
  const rebuyRate = summary.sessions > 0 ? summary.rebuys / summary.sessions : 0;
  const sitOutRate = summary.sessions > 0 ? summary.sitOuts / summary.sessions : 0;

  const statsScore = Math.min(100, handsPerSession * 9 + actionsPerSession * 2);
  const leaderboardScore = Math.min(100, Math.max(0, replayRate - 1) * 28 + handsPerSession * 5);
  const progressionScore = Math.min(100, replayRate * 24 + handsPerSession * 4);
  const bankrollScore = Math.min(100, rebuyRate * 38 + summary.ledgerEntries / 8);
  const smoothnessScore = Math.min(100, 100 - sitOutRate * 24 + Math.min(18, handsPerSession * 2));

  return [
    {
      area: 'stats',
      label: 'Stats',
      signal: signalFromScore(statsScore),
      score: Math.round(statsScore),
      recommendation:
        statsScore >= 70
          ? 'Players are generating enough hand/action data to justify visible personal stats.'
          : 'Keep stats lightweight until players complete more hands per session.',
    },
    {
      area: 'leaderboards',
      label: 'Leaderboards',
      signal: signalFromScore(leaderboardScore),
      score: Math.round(leaderboardScore),
      recommendation:
        leaderboardScore >= 70
          ? 'Repeat sessions are strong enough to test leaderboards with a small cohort.'
          : 'Wait for stronger repeat-play behavior before prioritizing leaderboards.',
    },
    {
      area: 'progression',
      label: 'Progression',
      signal: signalFromScore(progressionScore),
      score: Math.round(progressionScore),
      recommendation:
        progressionScore >= 70
          ? 'Progression could increase return play; test missions or weekly goals next.'
          : 'Use interviews to validate progression interest before building systems.',
    },
    {
      area: 'bankroll',
      label: 'Bankroll',
      signal: signalFromScore(bankrollScore),
      score: Math.round(bankrollScore),
      recommendation:
        bankrollScore >= 70
          ? 'Chip movement and rebuys suggest bankroll tracking is worth exploring.'
          : 'Track bankroll privately for now; do not make it a headline feature yet.',
    },
    {
      area: 'smoothness',
      label: 'Smoother Gameplay',
      signal: signalFromScore(smoothnessScore),
      score: Math.round(smoothnessScore),
      recommendation:
        smoothnessScore < 70
          ? 'Prioritize table flow, seating, and friction fixes before adding meta features.'
          : 'Core flow looks healthy enough to test one visible meta feature.',
    },
  ];
}

export async function loadPlayerTestingDashboard(): Promise<PlayerTestingDashboard> {
  const pool = getTestingPool();
  const emptySummary: PlayerTestingDashboard['summary'] = {
    profiles: 0,
    sessions: 0,
    activeSessions: 0,
    events: 0,
    ledgerEntries: 0,
    handsSeen: 0,
    actionsTaken: 0,
    rebuys: 0,
    sitOuts: 0,
    avgSessionMinutes: null,
    avgHandsPerSession: null,
    avgActionsPerSession: null,
  };

  if (!pool) {
    return {
      source: 'unconfigured',
      updatedAt: new Date().toISOString(),
      error: 'player testing database is not configured',
      summary: emptySummary,
      decisions: buildDecisions(emptySummary),
      entryPoints: [],
      topEvents: [],
      recentSessions: [],
      chipTrend: [],
    };
  }

  try {
    const [summaryResult, entryPointResult, topEventResult, recentSessionResult, chipTrendResult] =
      await Promise.all([
        pool.query<{
          profiles: string;
          sessions: string;
          active_sessions: string;
          events: string;
          ledger_entries: string;
          hands_seen: string;
          actions_taken: string;
          rebuys: string;
          sit_outs: string;
          avg_session_minutes: string | null;
          avg_hands_per_session: string | null;
          avg_actions_per_session: string | null;
        }>(`
          SELECT
            (SELECT count(*) FROM public.player_testing_profiles)::text AS profiles,
            (SELECT count(*) FROM public.player_testing_sessions)::text AS sessions,
            (SELECT count(*) FROM public.player_testing_sessions WHERE ended_at IS NULL)::text AS active_sessions,
            (SELECT count(*) FROM public.player_testing_events)::text AS events,
            (SELECT count(*) FROM public.player_chip_ledger)::text AS ledger_entries,
            COALESCE((SELECT sum(hands_seen) FROM public.player_testing_sessions), 0)::text AS hands_seen,
            COALESCE((SELECT sum(actions_taken) FROM public.player_testing_sessions), 0)::text AS actions_taken,
            COALESCE((SELECT sum(rebuys) FROM public.player_testing_sessions), 0)::text AS rebuys,
            COALESCE((SELECT sum(sit_outs) FROM public.player_testing_sessions), 0)::text AS sit_outs,
            (
              SELECT round(avg(EXTRACT(EPOCH FROM (COALESCE(ended_at, now()) - started_at))) / 60, 1)::text
              FROM public.player_testing_sessions
            ) AS avg_session_minutes,
            (
              SELECT round(avg(hands_seen), 1)::text
              FROM public.player_testing_sessions
            ) AS avg_hands_per_session,
            (
              SELECT round(avg(actions_taken), 1)::text
              FROM public.player_testing_sessions
            ) AS avg_actions_per_session
        `),
        pool.query<{ entry_point: string; sessions: string }>(`
          SELECT entry_point, count(*)::text AS sessions
          FROM public.player_testing_sessions
          GROUP BY entry_point
          ORDER BY count(*) DESC, entry_point ASC
          LIMIT 8
        `),
        pool.query<{ event_type: string; events: string }>(`
          SELECT event_type, count(*)::text AS events
          FROM public.player_testing_events
          GROUP BY event_type
          ORDER BY count(*) DESC, event_type ASC
          LIMIT 12
        `),
        pool.query<{
          session_key: string;
          profile_key: string;
          display_name: string | null;
          entry_point: string;
          backend: string | null;
          match_id: string | null;
          table_id: string | null;
          started_at: Date | string;
          ended_at: Date | string | null;
          initial_stack: number | null;
          last_stack: number | null;
          hands_seen: number;
          actions_taken: number;
          rebuys: number;
          sit_outs: number;
        }>(`
          SELECT
            s.session_key,
            s.profile_key,
            p.display_name,
            s.entry_point,
            s.backend,
            s.match_id,
            s.table_id,
            s.started_at,
            s.ended_at,
            s.initial_stack,
            s.last_stack,
            s.hands_seen,
            s.actions_taken,
            s.rebuys,
            s.sit_outs
          FROM public.player_testing_sessions s
          LEFT JOIN public.player_testing_profiles p ON p.profile_key = s.profile_key
          ORDER BY s.started_at DESC
          LIMIT 20
        `),
        pool.query<{
          bucket: Date | string;
          samples: string;
          avg_stack: string;
          net_delta: string;
        }>(`
          SELECT
            date_trunc('hour', occurred_at) AS bucket,
            count(*)::text AS samples,
            round(avg(stack))::text AS avg_stack,
            COALESCE(sum(delta), 0)::text AS net_delta
          FROM public.player_chip_ledger
          GROUP BY bucket
          ORDER BY bucket DESC
          LIMIT 24
        `),
      ]);

    const summaryRow = summaryResult.rows[0];
    const summary: PlayerTestingDashboard['summary'] = summaryRow
      ? {
          profiles: toInteger(summaryRow.profiles),
          sessions: toInteger(summaryRow.sessions),
          activeSessions: toInteger(summaryRow.active_sessions),
          events: toInteger(summaryRow.events),
          ledgerEntries: toInteger(summaryRow.ledger_entries),
          handsSeen: toInteger(summaryRow.hands_seen),
          actionsTaken: toInteger(summaryRow.actions_taken),
          rebuys: toInteger(summaryRow.rebuys),
          sitOuts: toInteger(summaryRow.sit_outs),
          avgSessionMinutes: toNullableNumber(summaryRow.avg_session_minutes),
          avgHandsPerSession: toNullableNumber(summaryRow.avg_hands_per_session),
          avgActionsPerSession: toNullableNumber(summaryRow.avg_actions_per_session),
        }
      : emptySummary;

    return {
      source: 'db',
      updatedAt: new Date().toISOString(),
      error: null,
      summary,
      decisions: buildDecisions(summary),
      entryPoints: entryPointResult.rows.map((row) => ({
        entryPoint: row.entry_point,
        sessions: toInteger(row.sessions),
      })),
      topEvents: topEventResult.rows.map((row) => ({
        eventType: row.event_type,
        events: toInteger(row.events),
      })),
      recentSessions: recentSessionResult.rows.map((row) => ({
        sessionKey: row.session_key,
        profileKey: row.profile_key,
        displayName: row.display_name,
        entryPoint: row.entry_point,
        backend: row.backend,
        matchId: row.match_id,
        tableId: row.table_id,
        startedAt: toIso(row.started_at),
        endedAt: row.ended_at ? toIso(row.ended_at) : null,
        initialStack: row.initial_stack,
        lastStack: row.last_stack,
        handsSeen: row.hands_seen,
        actionsTaken: row.actions_taken,
        rebuys: row.rebuys,
        sitOuts: row.sit_outs,
      })),
      chipTrend: chipTrendResult.rows
        .map((row) => ({
          bucket: toIso(row.bucket),
          samples: toInteger(row.samples),
          avgStack: toInteger(row.avg_stack),
          netDelta: toInteger(row.net_delta),
        }))
        .reverse(),
    };
  } catch (error) {
    void error;
    return {
      source: 'error',
      updatedAt: new Date().toISOString(),
      error: 'player testing dashboard query failed',
      summary: emptySummary,
      decisions: buildDecisions(emptySummary),
      entryPoints: [],
      topEvents: [],
      recentSessions: [],
      chipTrend: [],
    };
  }
}
