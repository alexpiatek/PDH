import type { NextApiRequest, NextApiResponse } from 'next';
import { afterEach, describe, expect, it, vi } from 'vitest';

const createEarlyAccessSignup = vi.fn();
const notifyEarlyAccessSignup = vi.fn();
const sendEarlyAccessEmailAlert = vi.fn();

vi.mock('../lib/earlyAccessServer', () => ({
  createEarlyAccessSignup,
  notifyEarlyAccessSignup,
  normalizeEmail: (value: unknown) => {
    if (typeof value !== 'string') {
      return null;
    }

    const email = value.trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
  },
}));

vi.mock('../lib/emailAlerts', () => ({
  sendEarlyAccessEmailAlert,
}));

async function callHandler(body: Record<string, unknown>) {
  const { default: handler } = await import('../pages/api/early-access');
  const req = {
    method: 'POST',
    body,
  } as NextApiRequest;

  const response = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    jsonBody: undefined as unknown,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(bodyValue: unknown) {
      this.jsonBody = bodyValue;
      return this;
    },
  };

  await handler(req, response as unknown as NextApiResponse);
  return response;
}

describe('early access API notifications', () => {
  afterEach(() => {
    createEarlyAccessSignup.mockReset();
    notifyEarlyAccessSignup.mockReset();
    sendEarlyAccessEmailAlert.mockReset();
    vi.resetModules();
  });

  it('notifies Discord and email alerts for new inserts only', async () => {
    createEarlyAccessSignup.mockResolvedValueOnce({
      created: true,
      signup: {
        email: 'player@example.com',
        name: null,
        source: 'landing_page',
        referrer: null,
        utmSource: null,
        utmMedium: null,
        utmCampaign: null,
        marketingConsent: true,
        createdAt: '2026-05-05T05:00:00.000Z',
      },
    });

    const response = await callHandler({
      email: 'PLAYER@example.com',
      is18PlusConfirmed: true,
      marketingConsent: true,
      source: 'landing_page',
    });

    expect(response.statusCode).toBe(201);
    expect(notifyEarlyAccessSignup).toHaveBeenCalledTimes(1);
    expect(sendEarlyAccessEmailAlert).toHaveBeenCalledTimes(1);
  });

  it('does not notify Discord or email alerts for duplicate submissions', async () => {
    createEarlyAccessSignup.mockResolvedValueOnce({
      created: false,
      signup: null,
    });

    const response = await callHandler({
      email: 'player@example.com',
      is18PlusConfirmed: true,
      marketingConsent: true,
      source: 'landing_page',
    });

    expect(response.statusCode).toBe(200);
    expect(notifyEarlyAccessSignup).not.toHaveBeenCalled();
    expect(sendEarlyAccessEmailAlert).not.toHaveBeenCalled();
  });

  it('still succeeds when the email alert fails', async () => {
    createEarlyAccessSignup.mockResolvedValueOnce({
      created: true,
      signup: {
        email: 'player@example.com',
        name: 'Player',
        source: 'landing_page',
        referrer: null,
        utmSource: null,
        utmMedium: null,
        utmCampaign: null,
        marketingConsent: true,
        createdAt: '2026-05-05T05:00:00.000Z',
      },
    });
    sendEarlyAccessEmailAlert.mockRejectedValueOnce(new Error('smtp failed'));

    const response = await callHandler({
      email: 'player@example.com',
      is18PlusConfirmed: true,
      marketingConsent: true,
      source: 'landing_page',
    });

    expect(response.statusCode).toBe(201);
    expect(response.jsonBody).toEqual(
      expect.objectContaining({
        ok: true,
      })
    );
    expect(notifyEarlyAccessSignup).toHaveBeenCalledTimes(1);
    expect(sendEarlyAccessEmailAlert).toHaveBeenCalledTimes(1);
  });
});
