export type TestingAuthMode = 'device' | 'magic_link';

export interface TestingProfile {
  profileKey: string;
  displayName: string | null;
  authMode: TestingAuthMode;
  createdAt: string;
  updatedAt: string;
}

export interface TestingSession {
  sessionKey: string;
  profileKey: string;
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
  maxStack: number | null;
  minStack: number | null;
}

export interface TestingEvent {
  eventKey: string;
  profileKey: string;
  sessionKey: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export interface ChipLedgerEntry {
  entryKey: string;
  profileKey: string;
  sessionKey: string | null;
  matchId: string | null;
  tableId: string | null;
  handId: string | null;
  phase: string | null;
  stack: number;
  delta: number | null;
  eventType: string;
  occurredAt: string;
}

export interface AnonymousAnalyticsExport {
  exportedAt: string;
  schemaVersion: 1;
  profile: Omit<TestingProfile, 'displayName'> & {
    displayNameCaptured: boolean;
  };
  summary: {
    sessions: number;
    handsSeen: number;
    actionsTaken: number;
    rebuys: number;
    sitOuts: number;
    netChips: number | null;
    events: number;
    ledgerEntries: number;
  };
  hypothesisSignals: {
    stats: 'low' | 'medium' | 'high';
    leaderboards: 'low' | 'medium' | 'high';
    progression: 'low' | 'medium' | 'high';
    bankrollTracking: 'low' | 'medium' | 'high';
    smootherGameplay: 'low' | 'medium' | 'high';
  };
  sessions: Array<Omit<TestingSession, 'profileKey'>>;
  events: Array<Omit<TestingEvent, 'profileKey'> & { payload: Record<string, unknown> }>;
  chipLedger: Array<Omit<ChipLedgerEntry, 'profileKey'>>;
}

const PROFILE_STORAGE_KEY = 'pdh.testing.profile';
const SESSIONS_STORAGE_KEY = 'pdh.testing.sessions';
const EVENTS_STORAGE_KEY = 'pdh.testing.events';
const LEDGER_STORAGE_KEY = 'pdh.testing.chip_ledger';
const CURRENT_SESSION_STORAGE_KEY = 'pdh.testing.current_session';
const MAX_EVENTS = 800;
const MAX_LEDGER_ENTRIES = 1200;
const MAX_SESSIONS = 120;

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function nowIso(): string {
  return new Date().toISOString();
}

function createKey(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1_000_000_000)}`;
}

function readJson<T>(key: string, fallback: T): T {
  if (!canUseStorage()) {
    return fallback;
  }
  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  if (!canUseStorage()) {
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(value));
}

function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().replace(/\s+/g, ' ').slice(0, 24);
  return normalized || null;
}

function clampInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.trunc(value);
}

function sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey.includes('name') || lowerKey.includes('email') || lowerKey.includes('playerid')) {
      continue;
    }
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function postAnalytics(payload: Record<string, unknown>): void {
  if (typeof window === 'undefined' || typeof fetch === 'undefined') {
    return;
  }
  void fetch('/api/player-analytics', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => undefined);
}

export function getOrCreateTestingProfile(displayName?: string): TestingProfile {
  const existing = readJson<Partial<TestingProfile> | null>(PROFILE_STORAGE_KEY, null);
  const createdAt = typeof existing?.createdAt === 'string' ? existing.createdAt : nowIso();
  const next: TestingProfile = {
    profileKey:
      typeof existing?.profileKey === 'string' && existing.profileKey
        ? existing.profileKey
        : createKey('device'),
    displayName: normalizeDisplayName(displayName) ?? normalizeDisplayName(existing?.displayName),
    authMode: existing?.authMode === 'magic_link' ? 'magic_link' : 'device',
    createdAt,
    updatedAt: nowIso(),
  };
  writeJson(PROFILE_STORAGE_KEY, next);
  return next;
}

export function updateTestingProfileDisplayName(displayName: string): TestingProfile {
  const profile = getOrCreateTestingProfile(displayName);
  postAnalytics({
    profile,
    sessions: [],
    events: [
      {
        eventKey: createKey('event'),
        profileKey: profile.profileKey,
        sessionKey: readCurrentSessionKey(),
        eventType: 'profile_name_updated',
        payload: {},
        occurredAt: nowIso(),
      },
    ],
    chipLedger: [],
  });
  return profile;
}

export function readTestingProfile(): TestingProfile {
  return getOrCreateTestingProfile();
}

export function readTestingSessions(): TestingSession[] {
  return readJson<TestingSession[]>(SESSIONS_STORAGE_KEY, []);
}

export function readTestingEvents(): TestingEvent[] {
  return readJson<TestingEvent[]>(EVENTS_STORAGE_KEY, []);
}

export function readChipLedger(): ChipLedgerEntry[] {
  return readJson<ChipLedgerEntry[]>(LEDGER_STORAGE_KEY, []);
}

export function readCurrentSessionKey(): string | null {
  if (!canUseStorage()) {
    return null;
  }
  return window.localStorage.getItem(CURRENT_SESSION_STORAGE_KEY);
}

function writeSessions(sessions: TestingSession[]): void {
  writeJson(SESSIONS_STORAGE_KEY, sessions.slice(-MAX_SESSIONS));
}

function upsertSession(session: TestingSession): void {
  const sessions = readTestingSessions();
  const existingIndex = sessions.findIndex((item) => item.sessionKey === session.sessionKey);
  if (existingIndex >= 0) {
    sessions[existingIndex] = session;
  } else {
    sessions.push(session);
  }
  writeSessions(sessions);
}

export function startTestingSession(input: {
  entryPoint: string;
  backend?: string | null;
  matchId?: string | null;
  tableId?: string | null;
  displayName?: string;
}): TestingSession {
  const profile = getOrCreateTestingProfile(input.displayName);
  const currentKey = readCurrentSessionKey();
  const sessions = readTestingSessions();
  const existing =
    currentKey &&
    sessions.find((session) => {
      if (session.sessionKey !== currentKey || session.endedAt) {
        return false;
      }
      const sameMatch = !input.matchId || !session.matchId || session.matchId === input.matchId;
      const sameTable = !input.tableId || !session.tableId || session.tableId === input.tableId;
      return sameMatch && sameTable;
    });

  const next: TestingSession = existing
    ? {
        ...existing,
        backend: input.backend ?? existing.backend,
        matchId: input.matchId ?? existing.matchId,
        tableId: input.tableId ?? existing.tableId,
      }
    : {
        sessionKey: createKey('session'),
        profileKey: profile.profileKey,
        entryPoint: input.entryPoint,
        backend: input.backend ?? null,
        matchId: input.matchId ?? null,
        tableId: input.tableId ?? null,
        startedAt: nowIso(),
        endedAt: null,
        initialStack: null,
        lastStack: null,
        handsSeen: 0,
        actionsTaken: 0,
        rebuys: 0,
        sitOuts: 0,
        maxStack: null,
        minStack: null,
      };

  upsertSession(next);
  if (canUseStorage()) {
    window.localStorage.setItem(CURRENT_SESSION_STORAGE_KEY, next.sessionKey);
  }
  postAnalytics({ profile, sessions: [next], events: [], chipLedger: [] });
  return next;
}

export function endTestingSession(): void {
  const currentKey = readCurrentSessionKey();
  if (!currentKey) {
    return;
  }
  const sessions = readTestingSessions();
  const session = sessions.find((item) => item.sessionKey === currentKey);
  if (!session || session.endedAt) {
    return;
  }
  const next = { ...session, endedAt: nowIso() };
  upsertSession(next);
  postAnalytics({ profile: readTestingProfile(), sessions: [next], events: [], chipLedger: [] });
  if (canUseStorage()) {
    window.localStorage.removeItem(CURRENT_SESSION_STORAGE_KEY);
  }
}

export function recordTestingEvent(
  eventType: string,
  payload: Record<string, unknown> = {},
  sessionKey = readCurrentSessionKey()
): TestingEvent {
  const profile = readTestingProfile();
  const event: TestingEvent = {
    eventKey: createKey('event'),
    profileKey: profile.profileKey,
    sessionKey,
    eventType,
    payload: sanitizePayload(payload),
    occurredAt: nowIso(),
  };
  const events = [...readTestingEvents(), event].slice(-MAX_EVENTS);
  writeJson(EVENTS_STORAGE_KEY, events);

  if (sessionKey) {
    const session = readTestingSessions().find((item) => item.sessionKey === sessionKey);
    if (session) {
      const next: TestingSession = {
        ...session,
        actionsTaken:
          eventType === 'action' || eventType === 'discard'
            ? session.actionsTaken + 1
            : session.actionsTaken,
        rebuys: eventType === 'rebuy_queued' ? session.rebuys + 1 : session.rebuys,
        sitOuts: eventType === 'sit_out_queued' ? session.sitOuts + 1 : session.sitOuts,
      };
      upsertSession(next);
    }
  }

  postAnalytics({ profile, sessions: [], events: [event], chipLedger: [] });
  return event;
}

export function recordChipLedgerEntry(input: {
  matchId?: string | null;
  tableId?: string | null;
  handId?: string | null;
  phase?: string | null;
  stack: number;
  eventType: string;
  sessionKey?: string | null;
}): ChipLedgerEntry | null {
  const stack = clampInteger(input.stack);
  if (stack === null) {
    return null;
  }
  const profile = readTestingProfile();
  const sessionKey = input.sessionKey ?? readCurrentSessionKey();
  const session = sessionKey
    ? readTestingSessions().find((item) => item.sessionKey === sessionKey)
    : null;
  const previousStack = session?.lastStack ?? null;
  const entry: ChipLedgerEntry = {
    entryKey: createKey('ledger'),
    profileKey: profile.profileKey,
    sessionKey,
    matchId: input.matchId ?? null,
    tableId: input.tableId ?? null,
    handId: input.handId ?? null,
    phase: input.phase ?? null,
    stack,
    delta: previousStack === null ? null : stack - previousStack,
    eventType: input.eventType,
    occurredAt: nowIso(),
  };
  const ledger = [...readChipLedger(), entry].slice(-MAX_LEDGER_ENTRIES);
  writeJson(LEDGER_STORAGE_KEY, ledger);

  if (session) {
    const seenHands = new Set(
      ledger
        .filter((item) => item.sessionKey === session.sessionKey && item.handId)
        .map((item) => item.handId)
    );
    const next: TestingSession = {
      ...session,
      matchId: input.matchId ?? session.matchId,
      tableId: input.tableId ?? session.tableId,
      initialStack: session.initialStack ?? stack,
      lastStack: stack,
      handsSeen: seenHands.size,
      maxStack: session.maxStack === null ? stack : Math.max(session.maxStack, stack),
      minStack: session.minStack === null ? stack : Math.min(session.minStack, stack),
    };
    upsertSession(next);
    postAnalytics({ profile, sessions: [next], events: [], chipLedger: [entry] });
  } else {
    postAnalytics({ profile, sessions: [], events: [], chipLedger: [entry] });
  }

  return entry;
}

function level(score: number): 'low' | 'medium' | 'high' {
  if (score >= 6) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
}

export function buildAnonymousAnalyticsExport(): AnonymousAnalyticsExport {
  const profile = readTestingProfile();
  const sessions = readTestingSessions();
  const events = readTestingEvents();
  const chipLedger = readChipLedger();
  const firstStack = chipLedger.find((entry) => entry.stack >= 0)?.stack ?? null;
  const lastStack = chipLedger.length ? chipLedger[chipLedger.length - 1].stack : null;
  const handsSeen = sessions.reduce((sum, session) => sum + session.handsSeen, 0);
  const actionsTaken = sessions.reduce((sum, session) => sum + session.actionsTaken, 0);
  const rebuys = sessions.reduce((sum, session) => sum + session.rebuys, 0);
  const sitOuts = sessions.reduce((sum, session) => sum + session.sitOuts, 0);
  const quickPlayEvents = events.filter((event) => event.eventType.includes('quick_play')).length;
  const joinEvents = events.filter((event) => event.eventType.includes('join')).length;

  return {
    exportedAt: nowIso(),
    schemaVersion: 1,
    profile: {
      profileKey: profile.profileKey,
      authMode: profile.authMode,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
      displayNameCaptured: Boolean(profile.displayName),
    },
    summary: {
      sessions: sessions.length,
      handsSeen,
      actionsTaken,
      rebuys,
      sitOuts,
      netChips: firstStack === null || lastStack === null ? null : lastStack - firstStack,
      events: events.length,
      ledgerEntries: chipLedger.length,
    },
    hypothesisSignals: {
      stats: level(handsSeen + actionsTaken / 8),
      leaderboards: level(Math.max(0, sessions.length - 1) + Math.max(0, handsSeen - 5) / 5),
      progression: level(sessions.length + handsSeen / 6),
      bankrollTracking: level(
        rebuys * 2 + chipLedger.filter((entry) => entry.delta !== 0).length / 6
      ),
      smootherGameplay: level(quickPlayEvents + joinEvents + Math.max(0, sitOuts - 1)),
    },
    sessions: sessions.map(({ profileKey: _profileKey, ...session }) => session),
    events: events.map(({ profileKey: _profileKey, payload, ...event }) => ({
      ...event,
      payload: sanitizePayload(payload),
    })),
    chipLedger: chipLedger.map(({ profileKey: _profileKey, ...entry }) => entry),
  };
}

export function downloadAnonymousAnalyticsExport(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }
  const exported = buildAnonymousAnalyticsExport();
  const blob = new Blob([JSON.stringify(exported, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `bondi-poker-analytics-${exported.profile.profileKey.slice(-8)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
