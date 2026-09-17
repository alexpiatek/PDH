import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAdminAnalytics } from '../lib/adminAuth';
import analyticsHandler from '../pages/api/admin/player-analytics';
import loginHandler from '../pages/api/admin/login';
import { loadPlayerTestingDashboard } from '../lib/playerTestingAnalyticsServer';

vi.mock('../lib/playerTestingAnalyticsServer', () => ({
  loadPlayerTestingDashboard: vi.fn(async () => ({ summary: {} })),
}));

function request(headers: Record<string, string | undefined> = {}) {
  return { method: 'GET', headers, socket: { remoteAddress: '127.0.0.1' } } as NextApiRequest;
}
function response() {
  return {
    setHeader: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as unknown as NextApiResponse;
}
function upstream(value: unknown, status = 200) {
  const fetchMock = vi
    .fn()
    .mockResolvedValue({
      ok: status === 200,
      status,
      json: async () => ({ payload: JSON.stringify(value) }),
    });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('player-account administration boundary', () => {
  it('rejects anonymous requests, old cookies and spoofed local headers without loading analytics', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const fetchMock = upstream({ authorized: true, userId: 'alex-id', username: 'Alex' });
    for (const headers of [
      {},
      {
        cookie: 'pdh_admin_session=old.signed.cookie',
        host: 'localhost:3001',
        'x-forwarded-for': '127.0.0.1',
      },
    ]) {
      const res = response();
      await analyticsHandler(request(headers), res);
      expect(res.status).toHaveBeenCalledWith(401);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(loadPlayerTestingDashboard).not.toHaveBeenCalled();
  });

  it('passes the current bearer session to Nakama before returning analytics', async () => {
    const fetchMock = upstream({ authorized: true, userId: 'alex-id', username: 'Alex' });
    const res = response();
    await analyticsHandler(request({ authorization: 'Bearer player-session' }), res);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        headers: { Authorization: 'Bearer player-session', 'Content-Type': 'application/json' },
        body: JSON.stringify('{}'),
      })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(loadPlayerTestingDashboard).toHaveBeenCalledTimes(1);
  });

  it('denies ordinary players and rechecks permissions on the next request', async () => {
    upstream({ authorized: true, userId: 'brad-id', username: 'Brad' });
    expect(
      await requireAdminAnalytics(request({ authorization: 'Bearer same-session' }), response())
    ).toEqual({ userId: 'brad-id', username: 'Brad' });
    upstream({ authorized: false });
    const res = response();
    await analyticsHandler(request({ authorization: 'Bearer same-session' }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(loadPlayerTestingDashboard).not.toHaveBeenCalled();
  });

  it('denies expired or revoked sessions', async () => {
    upstream({}, 401);
    const res = response();
    await analyticsHandler(request({ authorization: 'Bearer expired-token' }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(loadPlayerTestingDashboard).not.toHaveBeenCalled();
  });

  it('fails closed for service failure or malformed authorization responses', async () => {
    for (const value of [
      undefined,
      {},
      { authorized: true },
      { authorized: true, userId: '', username: 'Alex' },
    ]) {
      upstream(value);
      const res = response();
      await analyticsHandler(request({ authorization: 'Bearer token' }), res);
      expect(res.status).toHaveBeenCalledWith(503);
    }
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const res = response();
    await analyticsHandler(request({ authorization: 'Bearer token' }), res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(loadPlayerTestingDashboard).not.toHaveBeenCalled();
  });

  it('retires separate administrator passwords even when old settings remain', () => {
    vi.stubEnv('ADMIN_ANALYTICS_USERS', 'Alex:old-password');
    const req = request();
    req.method = 'POST';
    req.body = { username: 'Alex', password: 'old-password' };
    const res = response();
    loginHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(410);
    expect(res.setHeader).toHaveBeenCalledWith('Set-Cookie', expect.stringContaining('Max-Age=0'));
  });
});
