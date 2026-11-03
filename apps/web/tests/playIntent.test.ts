import { describe, expect, it } from 'vitest';
import { inviteUrl, playIntentUrl, readPlayIntent } from '../lib/playIntent';

describe('table entry intent', () => {
  it('round-trips create, quick play and normalized invitations through account entry', () => {
    for (const intent of [
      { action: 'create' },
      { action: 'quick' },
      { action: 'join', code: 'RZ587G' },
    ] as const) {
      const url = new URL(playIntentUrl(intent), 'https://bondipoker.online');
      expect(url.pathname).toBe('/play');
      expect(readPlayIntent(Object.fromEntries(url.searchParams))).toEqual(intent);
    }
    expect(readPlayIntent({ code: ' rz587g ' })).toEqual({ action: 'join', code: 'RZ587G' });
    expect(inviteUrl('https://bondipoker.online', 'rz587g')).toBe(
      'https://bondipoker.online/play?code=RZ587G'
    );
  });

  it('rejects malformed or ambiguous query values and never follows arbitrary return URLs', () => {
    for (const query of [
      {},
      { code: 'ABC' },
      { code: ['RZ587G', 'ABC123'] },
      { code: 'https://evil.example' },
      { action: 'https://evil.example' },
      { action: ['create'] },
      { returnTo: 'https://evil.example' },
    ]) {
      expect(readPlayIntent(query)).toBeNull();
    }
  });
});
