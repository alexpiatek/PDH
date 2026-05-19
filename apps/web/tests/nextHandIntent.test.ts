import { describe, expect, it, vi } from 'vitest';
import {
  canSubmitNextHandIntentNow,
  clearStoredNextHandIntent,
  nextHandIntentStorageKey,
  readStoredNextHandIntent,
  shouldClearNextHandIntent,
  writeStoredNextHandIntent,
} from '../lib/nextHandIntent';

const makeStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
};

describe('next hand intent persistence', () => {
  it('scopes queued intent by table id and player id', () => {
    expect(nextHandIntentStorageKey('BVAZU3', 'player-1')).toBe(
      'pdh:nextHandIntent:BVAZU3:player-1'
    );
    expect(nextHandIntentStorageKey('', 'player-1')).toBeNull();
    expect(nextHandIntentStorageKey('BVAZU3', null)).toBeNull();
  });

  it('stores, reads, changes, and clears queued intent', () => {
    const storage = makeStorage();

    writeStoredNextHandIntent(storage, 'table-1', 'player-1', 'rebuy');
    expect(readStoredNextHandIntent(storage, 'table-1', 'player-1')).toBe('rebuy');

    writeStoredNextHandIntent(storage, 'table-1', 'player-1', 'sitOut');
    expect(readStoredNextHandIntent(storage, 'table-1', 'player-1')).toBe('sitOut');

    clearStoredNextHandIntent(storage, 'table-1', 'player-1');
    expect(readStoredNextHandIntent(storage, 'table-1', 'player-1')).toBeNull();
  });

  it('ignores invalid or unavailable storage safely', () => {
    const throwingStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };

    expect(readStoredNextHandIntent(throwingStorage, 'table-1', 'player-1')).toBeNull();
    expect(() =>
      writeStoredNextHandIntent(throwingStorage, 'table-1', 'player-1', 'rebuy')
    ).not.toThrow();
    expect(() => clearStoredNextHandIntent(throwingStorage, 'table-1', 'player-1')).not.toThrow();
  });
});
describe('next hand intent submission window', () => {
  it('waits during active betting and discard phases', () => {
    expect(
      canSubmitNextHandIntentNow({ betweenHandActive: false, hasHand: true, handPhase: 'betting' })
    ).toBe(false);
    expect(
      canSubmitNextHandIntentNow({ betweenHandActive: false, hasHand: true, handPhase: 'discard' })
    ).toBe(false);
  });

  it('submits when the existing table flow allows between-hand actions', () => {
    expect(
      canSubmitNextHandIntentNow({ betweenHandActive: true, hasHand: true, handPhase: 'showdown' })
    ).toBe(true);
    expect(
      canSubmitNextHandIntentNow({ betweenHandActive: false, hasHand: true, handPhase: 'showdown' })
    ).toBe(true);
    expect(
      canSubmitNextHandIntentNow({ betweenHandActive: false, hasHand: false, handPhase: null })
    ).toBe(true);
  });
});

describe('next hand intent completion', () => {
  it('keeps a queued rebuy when an active hand hides rebuy controls before stack changes', () => {
    expect(
      shouldClearNextHandIntent({
        applying: 'rebuy',
        intent: 'rebuy',
        needsRebuy: false,
        seatStack: 0,
        seatStatus: 'busted',
        seated: true,
      })
    ).toBe(false);
  });

  it('clears a queued rebuy only after the stack is restored', () => {
    expect(
      shouldClearNextHandIntent({
        applying: 'rebuy',
        intent: 'rebuy',
        needsRebuy: false,
        seatStack: 10000,
        seatStatus: 'active',
        seated: true,
      })
    ).toBe(true);
  });

  it('clears a queued sit-out after the seat is confirmed sitting out', () => {
    expect(
      shouldClearNextHandIntent({
        applying: 'sitOut',
        intent: 'sitOut',
        needsRebuy: true,
        seatStack: 0,
        seatStatus: 'sitting_out',
        seated: true,
      })
    ).toBe(true);
  });
});
