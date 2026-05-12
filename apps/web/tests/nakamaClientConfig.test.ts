import { afterEach, describe, expect, it, vi } from 'vitest';
import { getNakamaConfig } from '../lib/nakamaClient';

describe('Nakama client config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses only the public client key name for browser configuration', () => {
    vi.stubEnv('NEXT_PUBLIC_NAKAMA_CLIENT_KEY', 'public-client-key');
    vi.stubEnv('NEXT_PUBLIC_NAKAMA_SERVER_KEY', 'deprecated-server-key');

    expect(getNakamaConfig().clientKey).toBe('public-client-key');
  });

  it('does not fall back to the deprecated public server key name', () => {
    vi.stubEnv('NEXT_PUBLIC_NAKAMA_SERVER_KEY', 'deprecated-server-key');

    expect(getNakamaConfig().clientKey).toBe('defaultkey');
  });
});
