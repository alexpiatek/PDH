import crypto from 'node:crypto';
import type { NextApiRequest, NextApiResponse } from 'next';

export const ADMIN_SESSION_COOKIE = 'pdh_admin_session';

const SESSION_TTL_SECONDS = 8 * 60 * 60;

interface AdminSessionPayload {
  username: string;
  exp: number;
}

interface AdminUser {
  username: string;
  password: string;
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function parseBase64UrlJson<T>(value: string): T | null {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

function signingSecret(): string | null {
  const secret =
    process.env.ADMIN_ANALYTICS_SESSION_SECRET ||
    process.env.ADMIN_ANALYTICS_PASSCODE ||
    process.env.NAKAMA_SESSION_ENCRYPTION_KEY ||
    process.env.NAKAMA_CONSOLE_SIGNING_KEY ||
    '';
  return secret.trim() || null;
}

function signPayload(payload: string): string | null {
  const secret = signingSecret();
  if (!secret) {
    return null;
  }
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function parseAdminUsersFromJson(raw: string): AdminUser[] | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return null;
    }
    return parsed
      .map((item): AdminUser | null => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        const record = item as Record<string, unknown>;
        if (typeof record.username !== 'string' || typeof record.password !== 'string') {
          return null;
        }
        return {
          username: record.username.trim(),
          password: record.password,
        };
      })
      .filter((item): item is AdminUser => Boolean(item?.username && item.password));
  } catch {
    return null;
  }
}

export function parseAdminUsers(): AdminUser[] {
  const rawJson = process.env.ADMIN_ANALYTICS_USERS_JSON?.trim();
  if (rawJson) {
    return parseAdminUsersFromJson(rawJson) ?? [];
  }

  const raw = process.env.ADMIN_ANALYTICS_USERS?.trim();
  if (!raw) {
    return [];
  }

  return raw
    .split(',')
    .map((entry): AdminUser | null => {
      const separator = entry.indexOf(':');
      if (separator <= 0) {
        return null;
      }
      const username = entry.slice(0, separator).trim();
      const password = entry.slice(separator + 1);
      if (!username || !password) {
        return null;
      }
      return { username, password };
    })
    .filter((item): item is AdminUser => Boolean(item));
}

function parseCookies(req: NextApiRequest): Record<string, string> {
  const raw = req.headers.cookie;
  if (!raw) {
    return {};
  }
  const cookies: Record<string, string> = {};
  for (const part of raw.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) {
      cookies[key] = decodeURIComponent(value);
    }
  }
  return cookies;
}

function requestHost(req: NextApiRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return (raw || req.socket.remoteAddress || '').split(',')[0]?.trim() ?? '';
}

export function isLocalAdminRequest(req: NextApiRequest): boolean {
  const host = requestHost(req);
  return (
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '::ffff:127.0.0.1' ||
    host === '' ||
    req.headers.host?.startsWith('localhost:') ||
    req.headers.host?.startsWith('127.0.0.1:')
  );
}

export function verifyAdminCredentials(username: string, password: string): boolean {
  const normalizedUsername = username.trim();
  if (!normalizedUsername || !password) {
    return false;
  }

  const user = parseAdminUsers().find((candidate) => candidate.username === normalizedUsername);
  if (!user) {
    return false;
  }

  return safeEqual(user.password, password);
}

export function createAdminSessionCookie(username: string): string | null {
  const payload = base64UrlJson({
    username,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  } satisfies AdminSessionPayload);
  const signature = signPayload(payload);
  if (!signature) {
    return null;
  }
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(`${payload}.${signature}`)}; HttpOnly; Path=/; Max-Age=${SESSION_TTL_SECONDS}; SameSite=Lax${secure}`;
}

export function clearAdminSessionCookie(): string {
  return `${ADMIN_SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`;
}

export function readAdminSession(req: NextApiRequest): AdminSessionPayload | null {
  const token = parseCookies(req)[ADMIN_SESSION_COOKIE];
  if (!token) {
    return null;
  }

  const [payload, signature] = token.split('.');
  if (!payload || !signature) {
    return null;
  }

  const expected = signPayload(payload);
  if (!expected || !safeEqual(expected, signature)) {
    return null;
  }

  const parsed = parseBase64UrlJson<AdminSessionPayload>(payload);
  if (!parsed || typeof parsed.username !== 'string' || typeof parsed.exp !== 'number') {
    return null;
  }

  if (parsed.exp <= Math.floor(Date.now() / 1000)) {
    return null;
  }

  return parsed;
}

export function canViewAdminAnalytics(req: NextApiRequest): boolean {
  if (readAdminSession(req)) {
    return true;
  }

  return process.env.NODE_ENV !== 'production' && isLocalAdminRequest(req);
}

export function requireAdminAnalytics(
  req: NextApiRequest,
  res: NextApiResponse<{ error: string }>
): boolean {
  if (canViewAdminAnalytics(req)) {
    return true;
  }
  res.status(401).json({ error: 'Admin login required.' });
  return false;
}
