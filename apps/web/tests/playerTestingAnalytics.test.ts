import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildAnonymousAnalyticsExport,
  getOrCreateTestingProfile,
  recordChipLedgerEntry,
  recordTestingEvent,
  startTestingSession,
} from '../lib/playerTestingAnalytics';

function createLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
}

describe('player testing analytics', () => {
  beforeEach(() => {
    let id = 0;
    vi.stubGlobal('crypto', {
      randomUUID: () => {
        id += 1;
        return `test-id-${id}`;
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    vi.stubGlobal('window', {
      localStorage: createLocalStorage(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a device profile and exports anonymous session data', () => {
    const profile = getOrCreateTestingProfile('Alex Player');
    const session = startTestingSession({
      entryPoint: 'quick_play',
      backend: 'nakama',
      matchId: 'match-123',
      tableId: 'ABC123',
    });

    recordTestingEvent('action', {
      action: 'raise',
      amount: 400,
      playerId: 'real-player-id',
      playerName: 'Alex Player',
      email: 'alex@example.com',
    });
    recordChipLedgerEntry({
      matchId: 'match-123',
      tableId: 'ABC123',
      handId: 'hand-1',
      phase: 'betting',
      stack: 10000,
      eventType: 'hand_snapshot',
      sessionKey: session.sessionKey,
    });
    recordChipLedgerEntry({
      matchId: 'match-123',
      tableId: 'ABC123',
      handId: 'hand-1',
      phase: 'showdown',
      stack: 11200,
      eventType: 'hand_snapshot',
      sessionKey: session.sessionKey,
    });

    const exported = buildAnonymousAnalyticsExport();

    expect(profile.authMode).toBe('device');
    expect(exported.profile.displayNameCaptured).toBe(true);
    expect(exported.summary.sessions).toBe(1);
    expect(exported.summary.handsSeen).toBe(1);
    expect(exported.summary.actionsTaken).toBe(1);
    expect(exported.summary.netChips).toBe(1200);
    expect(exported.events[0].payload).toEqual({
      action: 'raise',
      amount: 400,
    });
    expect(exported.sessions[0]).not.toHaveProperty('profileKey');
    expect(exported.chipLedger[0]).not.toHaveProperty('profileKey');
  });
});
