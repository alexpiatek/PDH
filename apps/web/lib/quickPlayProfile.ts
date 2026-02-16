import type { QuickPlayRpcRequest, QuickPlayRpcResponse, QuickPlaySkillTier } from './nakamaClient';

const STORAGE_KEY = 'pdh.quick_play_profile';
const DEFAULT_BUY_IN = 10000;
const MIN_BUY_IN = 500;
const MAX_BUY_IN = 1_000_000;

interface QuickPlayProfile {
  preferredBuyIn: number;
  quickPlayResolves: number;
  sessionsJoined: number;
  createdAt: string;
  updatedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function normalizeBuyIn(value: unknown, fallback: number = DEFAULT_BUY_IN): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.trunc(value);
  if (normalized < MIN_BUY_IN || normalized > MAX_BUY_IN) {
    return fallback;
  }
  return normalized;
}

function normalizeDate(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  return fallback;
}

function normalizeProfile(value: unknown): QuickPlayProfile {
  const nowIso = new Date().toISOString();
  if (!isRecord(value)) {
    return {
      preferredBuyIn: DEFAULT_BUY_IN,
      quickPlayResolves: 0,
      sessionsJoined: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  }

  const quickPlayResolvesRaw = value.quickPlayResolves;
  const quickPlayResolves =
    typeof quickPlayResolvesRaw === 'number' && Number.isFinite(quickPlayResolvesRaw)
      ? Math.max(0, Math.trunc(quickPlayResolvesRaw))
      : 0;

  const sessionsJoinedRaw = value.sessionsJoined;
  const sessionsJoined =
    typeof sessionsJoinedRaw === 'number' && Number.isFinite(sessionsJoinedRaw)
      ? Math.max(0, Math.trunc(sessionsJoinedRaw))
      : 0;

  return {
    preferredBuyIn: normalizeBuyIn(value.preferredBuyIn, DEFAULT_BUY_IN),
    quickPlayResolves,
    sessionsJoined,
    createdAt: normalizeDate(value.createdAt, nowIso),
    updatedAt: normalizeDate(value.updatedAt, nowIso),
  };
}

function readProfile(): QuickPlayProfile {
  if (typeof window === 'undefined') {
    return normalizeProfile(null);
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return normalizeProfile(null);
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return normalizeProfile(parsed);
  } catch {
    return normalizeProfile(null);
  }
}

function writeProfile(profile: QuickPlayProfile): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}

export function inferQuickPlaySkillTier(): QuickPlaySkillTier {
  return inferQuickPlaySkillTierFromProfile(readProfile());
}

function inferQuickPlaySkillTierFromProfile(profile: QuickPlayProfile): QuickPlaySkillTier {
  const activityScore = profile.quickPlayResolves * 2 + profile.sessionsJoined;

  if (activityScore < 6) {
    return 'newcomer';
  }
  if (activityScore < 24) {
    return 'casual';
  }
  if (activityScore < 70) {
    return 'regular';
  }
  return 'pro';
}

export function buildQuickPlayRequest(maxPlayers = 6): QuickPlayRpcRequest {
  const profile = readProfile();
  return {
    maxPlayers,
    targetBuyIn: profile.preferredBuyIn,
    skillTier: inferQuickPlaySkillTierFromProfile(profile),
  };
}

export function recordQuickPlayResolved(result: Pick<QuickPlayRpcResponse, 'quickPlayBuyIn'>): void {
  const profile = readProfile();
  const nowIso = new Date().toISOString();
  const next: QuickPlayProfile = {
    ...profile,
    preferredBuyIn: normalizeBuyIn(result.quickPlayBuyIn, profile.preferredBuyIn),
    quickPlayResolves: profile.quickPlayResolves + 1,
    updatedAt: nowIso,
  };
  writeProfile(next);
}

export function recordTableJoin(tableBuyIn?: number): void {
  const profile = readProfile();
  const nowIso = new Date().toISOString();
  const next: QuickPlayProfile = {
    ...profile,
    preferredBuyIn: tableBuyIn ? normalizeBuyIn(tableBuyIn, profile.preferredBuyIn) : profile.preferredBuyIn,
    sessionsJoined: profile.sessionsJoined + 1,
    updatedAt: nowIso,
  };
  writeProfile(next);
}
