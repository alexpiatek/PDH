import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSystemHealth } from '../lib/systemHealthServer';
import { checkPlayerTestingDatabase } from '../lib/playerTestingAnalyticsServer';

vi.mock('../lib/playerTestingAnalyticsServer', () => ({
  checkPlayerTestingDatabase: vi.fn(async () => undefined),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('system health', () => {
  it('reports healthy internal services and an unconfigured external monitor', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    const result = await loadSystemHealth();
    expect(result.status).toBe('operational');
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'game-backend', status: 'operational' }),
        expect.objectContaining({ id: 'analytics-database', status: 'operational' }),
        expect.objectContaining({ id: 'external-monitor', status: 'unconfigured' }),
      ])
    );
  });

  it('reports a service failure without throwing away the other checks', async () => {
    vi.mocked(checkPlayerTestingDatabase).mockRejectedValueOnce(new Error('Database unavailable'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const result = await loadSystemHealth();
    expect(result.status).toBe('down');
    expect(result.checks.find((check) => check.id === 'analytics-database')).toMatchObject({
      status: 'down',
      detail: 'Database unavailable',
    });
    expect(result.checks.find((check) => check.id === 'game-backend')).toMatchObject({
      status: 'down',
      detail: 'Health endpoint returned HTTP 503',
    });
  });
});
