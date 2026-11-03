import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  dashboard: vi.fn(),
  save: vi.fn(),
  test: vi.fn(),
  queue: vi.fn(),
  cancel: vi.fn(),
  exclude: vi.fn(),
  unsubscribe: vi.fn(),
}));
vi.mock('../lib/adminAuth', () => ({ requireAdminAnalytics: mocks.auth }));
vi.mock('../lib/campaignServer', () => ({
  campaignDashboard: mocks.dashboard,
  saveCampaign: mocks.save,
  sendCampaignTest: mocks.test,
  queueCampaign: mocks.queue,
  cancelCampaign: mocks.cancel,
  excludeSignup: mocks.exclude,
  unsubscribe: mocks.unsubscribe,
}));
import handler from '../pages/api/admin/campaigns';
import unsubscribeHandler from '../pages/api/unsubscribe';
import { validateCampaign } from '../lib/campaigns';
function response() {
  return {
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
}
describe('email campaign endpoints', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });
  it('never loads or sends campaign data without administrator access', async () => {
    mocks.auth.mockResolvedValue(null);
    for (const method of ['GET', 'POST'])
      await handler(
        { method, body: { action: 'queue', id: '123' } } as NextApiRequest,
        response() as unknown as NextApiResponse
      );
    expect(mocks.dashboard).not.toHaveBeenCalled();
    expect(mocks.queue).not.toHaveBeenCalled();
  });
  it('requires an explicit queue action distinct from saving and testing', async () => {
    mocks.auth.mockResolvedValue({ userId: 'admin' });
    for (const action of ['save', 'test'])
      await handler(
        {
          method: 'POST',
          body: {
            action,
            id: '12345678-1234-1234-1234-123456789abc',
            subject: 'News',
            body: 'Hello',
            recipient: 'admin@bondipoker.com',
          },
        } as NextApiRequest,
        response() as unknown as NextApiResponse
      );
    expect(mocks.save).toHaveBeenCalled();
    expect(mocks.test).toHaveBeenCalled();
    expect(mocks.queue).not.toHaveBeenCalled();
  });
  it('does not unsubscribe on a GET or email scanner visit', async () => {
    const res = response();
    await unsubscribeHandler(
      {
        method: 'GET',
        query: { token: '12345678-1234-1234-1234-123456789abc' },
      } as unknown as NextApiRequest,
      res as unknown as NextApiResponse
    );
    expect(res.statusCode).toBe(405);
    expect(mocks.unsubscribe).not.toHaveBeenCalled();
  });
  it('rejects missing unsubscribe tokens', async () => {
    const res = response();
    await unsubscribeHandler(
      { method: 'POST', query: {} } as NextApiRequest,
      res as unknown as NextApiResponse
    );
    expect(res.statusCode).toBe(400);
    expect(mocks.unsubscribe).not.toHaveBeenCalled();
  });
  it('rejects subject header injection and empty messages', () => {
    expect(() => validateCampaign('Hello\r\nBcc: other@example.com', 'Hi')).toThrow();
    expect(() => validateCampaign('Hello', ' ')).toThrow();
    expect(validateCampaign(' News ', ' Hello ')).toEqual({ subject: 'News', body: 'Hello' });
  });
});
