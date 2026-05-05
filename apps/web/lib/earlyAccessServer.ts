import { Pool, type PoolConfig } from 'pg';

export const EARLY_ACCESS_CONSENT_TEXT_VERSION = 'early_access_v1';

export interface EarlyAccessSignupInput {
  email: string;
  name?: string;
  is18PlusConfirmed: boolean;
  marketingConsent: boolean;
  source?: string;
  referrer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
}

export interface EarlyAccessSignupResult {
  created: boolean;
  signup: EarlyAccessSignupRecord | null;
}

export interface EarlyAccessSignupRecord {
  email: string;
  name: string | null;
  source: string | null;
  referrer: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  createdAt: string;
}

type GlobalPool = typeof globalThis & {
  __PDH_EARLY_ACCESS_POOL__?: Pool;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DISCORD_FIELD_LIMIT = 350;
const EARLY_ACCESS_DISCORD_WEBHOOK_ENV_KEYS = [
  'EARLY_ACCESS_DISCORD_WEBHOOK_URL',
  'DISCORD_WEBHOOK_URL',
] as const;

type EarlyAccessDiscordWebhookEnvKey = (typeof EARLY_ACCESS_DISCORD_WEBHOOK_ENV_KEYS)[number];

export function resolveEarlyAccessDiscordWebhook(): {
  url: string;
  envKey: EarlyAccessDiscordWebhookEnvKey;
} | null {
  for (const envKey of EARLY_ACCESS_DISCORD_WEBHOOK_ENV_KEYS) {
    const url = process.env[envKey]?.trim();
    if (url) {
      return { url, envKey };
    }
  }

  return null;
}

function earlyAccessPoolConfig(): PoolConfig | null {
  const connectionString = process.env.EARLY_ACCESS_DATABASE_URL || process.env.DATABASE_URL;
  if (connectionString) {
    return { connectionString };
  }

  const host =
    process.env.EARLY_ACCESS_DB_HOST ||
    process.env.PGHOST ||
    process.env.POSTGRES_HOST ||
    process.env.POSTGRES_HOSTNAME ||
    undefined;
  const user =
    process.env.EARLY_ACCESS_DB_USER ||
    process.env.PGUSER ||
    process.env.POSTGRES_USER ||
    undefined;
  const database =
    process.env.EARLY_ACCESS_DB_NAME ||
    process.env.PGDATABASE ||
    process.env.POSTGRES_DB ||
    undefined;
  const password =
    process.env.EARLY_ACCESS_DB_PASSWORD ||
    process.env.PGPASSWORD ||
    process.env.POSTGRES_PASSWORD ||
    undefined;
  const portRaw =
    process.env.EARLY_ACCESS_DB_PORT || process.env.PGPORT || process.env.POSTGRES_PORT;
  const portParsed = portRaw && Number.isFinite(Number(portRaw)) ? Number(portRaw) : undefined;

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

function getEarlyAccessPool(): Pool | null {
  const globalPool = globalThis as GlobalPool;
  if (globalPool.__PDH_EARLY_ACCESS_POOL__) {
    return globalPool.__PDH_EARLY_ACCESS_POOL__;
  }

  const config = earlyAccessPoolConfig();
  if (!config) {
    return null;
  }

  const pool = new Pool({
    ...config,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 1_500,
  });
  globalPool.__PDH_EARLY_ACCESS_POOL__ = pool;
  return pool;
}

export function normalizeEmail(rawEmail: unknown): string | null {
  if (typeof rawEmail !== 'string') {
    return null;
  }

  const email = rawEmail.trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return null;
  }

  return email;
}

function optionalText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, maxLength);
}

function formatDiscordValue(value: string | null | undefined): string {
  if (!value) {
    return 'Not provided';
  }

  const singleLine = value.replace(/[\r\n]+/g, ' ').trim();
  if (!singleLine) {
    return 'Not provided';
  }

  if (singleLine.length <= DISCORD_FIELD_LIMIT) {
    return singleLine;
  }

  return `${singleLine.slice(0, DISCORD_FIELD_LIMIT - 1)}…`;
}

function buildEarlyAccessDiscordContent(signup: EarlyAccessSignupRecord): string {
  return [
    '🎴 New Bondi Poker early access signup',
    '',
    `Email: ${formatDiscordValue(signup.email)}`,
    `Name: ${formatDiscordValue(signup.name)}`,
    `Source: ${formatDiscordValue(signup.source)}`,
    `Referrer: ${formatDiscordValue(signup.referrer)}`,
    `UTM Source: ${formatDiscordValue(signup.utmSource)}`,
    `UTM Medium: ${formatDiscordValue(signup.utmMedium)}`,
    `UTM Campaign: ${formatDiscordValue(signup.utmCampaign)}`,
    `Created: ${formatDiscordValue(signup.createdAt)}`,
  ].join('\n');
}

export async function notifyEarlyAccessSignup(signup: EarlyAccessSignupRecord): Promise<void> {
  const webhook = resolveEarlyAccessDiscordWebhook();
  if (!webhook) {
    console.warn('early access Discord webhook is not configured');
    return;
  }

  try {
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: buildEarlyAccessDiscordContent(signup),
      }),
    });

    if (!response.ok) {
      console.warn('early access Discord webhook request failed', {
        status: response.status,
      });
    }
  } catch (error) {
    void error;
    console.warn('early access Discord webhook request failed');
  }
}

export async function createEarlyAccessSignup(
  input: EarlyAccessSignupInput
): Promise<EarlyAccessSignupResult> {
  const pool = getEarlyAccessPool();
  if (!pool) {
    throw new Error('early access database is not configured');
  }

  const result = await pool.query<{
    email: string;
    name: string | null;
    source: string | null;
    referrer: string | null;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    created_at: string | Date;
  }>(
    `
      INSERT INTO public.early_access_signups (
        email,
        name,
        is_18_plus_confirmed,
        marketing_consent,
        consent_text_version,
        source,
        referrer,
        utm_source,
        utm_medium,
        utm_campaign
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (email) DO NOTHING
      RETURNING email, name, source, referrer, utm_source, utm_medium, utm_campaign, created_at
    `,
    [
      input.email,
      optionalText(input.name, 100),
      input.is18PlusConfirmed,
      input.marketingConsent,
      EARLY_ACCESS_CONSENT_TEXT_VERSION,
      optionalText(input.source, 80),
      optionalText(input.referrer, 500),
      optionalText(input.utmSource, 120),
      optionalText(input.utmMedium, 120),
      optionalText(input.utmCampaign, 120),
    ]
  );
  const row = result.rows[0];

  return {
    created: result.rowCount === 1,
    signup: row
      ? {
          email: row.email,
          name: row.name,
          source: row.source,
          referrer: row.referrer,
          utmSource: row.utm_source,
          utmMedium: row.utm_medium,
          utmCampaign: row.utm_campaign,
          createdAt:
            row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
        }
      : null,
  };
}
