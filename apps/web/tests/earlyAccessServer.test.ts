import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyEarlyAccessSignup, type EarlyAccessSignupRecord } from '../lib/earlyAccessServer';

const signup: EarlyAccessSignupRecord = {
  email: 'player@example.com',
  name: 'Player One',
  source: 'landing_page',
  referrer: 'https://example.com/somewhere',
  utmSource: 'newsletter',
  utmMedium: 'email',
  utmCampaign: 'launch',
  createdAt: '2026-05-05T05:00:00.000Z',
};

describe('notifyEarlyAccessSignup', () => {
  const originalWebhookUrl = process.env.EARLY_ACCESS_DISCORD_WEBHOOK_URL;
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    if (originalWebhookUrl === undefined) {
      delete process.env.EARLY_ACCESS_DISCORD_WEBHOOK_URL;
    } else {
      process.env.EARLY_ACCESS_DISCORD_WEBHOOK_URL = originalWebhookUrl;
    }
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('does not fail when the Discord webhook is missing', async () => {
    delete process.env.EARLY_ACCESS_DISCORD_WEBHOOK_URL;
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(notifyEarlyAccessSignup(signup)).resolves.toBeUndefined();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith('early access Discord webhook is not configured');
  });

  it('posts a formatted Discord message when configured', async () => {
    process.env.EARLY_ACCESS_DISCORD_WEBHOOK_URL = 'https://discord.test/webhook';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    global.fetch = fetchMock as unknown as typeof fetch;

    await notifyEarlyAccessSignup(signup);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://discord.test/webhook',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      })
    );

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(options.body)) as { content: string };
    expect(body.content).toContain('New Bondi Poker early access signup');
    expect(body.content).toContain('Email: player@example.com');
    expect(body.content).toContain('Name: Player One');
    expect(body.content).toContain('UTM Campaign: launch');
  });

  it('does not throw when Discord returns a failure response', async () => {
    process.env.EARLY_ACCESS_DISCORD_WEBHOOK_URL = 'https://discord.test/webhook';
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429 }) as unknown as typeof fetch;

    await expect(notifyEarlyAccessSignup(signup)).resolves.toBeUndefined();

    expect(console.warn).toHaveBeenCalledWith('early access Discord webhook request failed', {
      status: 429,
    });
  });

  it('truncates long user-provided values before sending', async () => {
    process.env.EARLY_ACCESS_DISCORD_WEBHOOK_URL = 'https://discord.test/webhook';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    global.fetch = fetchMock as unknown as typeof fetch;

    await notifyEarlyAccessSignup({
      ...signup,
      referrer: `https://example.com/${'x'.repeat(600)}`,
    });

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(options.body)) as { content: string };
    expect(body.content.length).toBeLessThan(1_000);
    expect(body.content).toContain('…');
  });
});
