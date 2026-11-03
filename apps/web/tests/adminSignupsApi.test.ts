import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn() }));
vi.mock('../lib/adminAuth', () => ({ requireAdminAnalytics: mocks.auth }));
vi.mock('../lib/earlyAccessServer', () => ({ loadEarlyAccessSignups: mocks.load }));
import handler from '../pages/api/admin/early-access';

async function request(page?: string) {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    setHeader: vi.fn(),
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  await handler(
    { method: 'GET', query: page ? { page } : {} } as NextApiRequest,
    res as unknown as NextApiResponse
  );
  return res;
}

describe('protected signup list', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  it('does not read signup data when access is denied', async () => {
    mocks.auth.mockResolvedValue(null);
    await request();
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it('returns the requested page for an approved administrator', async () => {
    mocks.auth.mockResolvedValue({ userId: 'admin' });
    mocks.load.mockResolvedValue({ total: 51, page: 2, signups: [] });
    const res = await request('2');
    expect(mocks.load).toHaveBeenCalledWith(2);
    expect(res.body).toEqual({ total: 51, page: 2, signups: [] });
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });
  it('rejects invalid pagination before reading the database', async () => {
    mocks.auth.mockResolvedValue({ userId: 'admin' });
    expect((await request('-1')).statusCode).toBe(400);
    expect(mocks.load).not.toHaveBeenCalled();
  });
});
