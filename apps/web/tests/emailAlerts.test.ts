import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EarlyAccessSignupRecord } from '../lib/earlyAccessServer';

const nodemailerMock = vi.hoisted(() => {
  const sendMail = vi.fn();
  const createTransport = vi.fn(() => ({ sendMail }));

  return {
    createTransport,
    sendMail,
  };
});

vi.mock('nodemailer', () => ({
  createTransport: nodemailerMock.createTransport,
}));

import { resolveEmailAlertConfig, sendEarlyAccessEmailAlert } from '../lib/emailAlerts';

const EMAIL_ENV_KEYS = [
  'EMAIL_ALERTS_ENABLED',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASS',
  'ALERT_EMAIL_FROM',
  'ALERT_EMAIL_TO',
] as const;

const originalEnv = EMAIL_ENV_KEYS.reduce<Record<string, string | undefined>>((values, key) => {
  values[key] = process.env[key];
  return values;
}, {});

const signup: EarlyAccessSignupRecord = {
  email: 'player@example.com',
  name: 'Player One',
  source: 'landing_page',
  referrer: 'https://bondipoker.online/?utm_source=newsletter',
  utmSource: 'newsletter',
  utmMedium: 'email',
  utmCampaign: 'launch',
  marketingConsent: true,
  createdAt: '2026-05-05T05:00:00.000Z',
};

function clearEmailEnv() {
  for (const key of EMAIL_ENV_KEYS) {
    delete process.env[key];
  }
}

function setCompleteEmailEnv() {
  process.env.EMAIL_ALERTS_ENABLED = 'true';
  process.env.SMTP_HOST = 'smtp.gmail.com';
  process.env.SMTP_PORT = '465';
  process.env.SMTP_SECURE = 'true';
  process.env.SMTP_USER = 'sender@example.com';
  process.env.SMTP_PASS = 'app-password';
  process.env.ALERT_EMAIL_FROM = 'Bondi Poker <sender@example.com>';
  process.env.ALERT_EMAIL_TO = 'ops@example.com';
}

describe('email early access alerts', () => {
  beforeEach(() => {
    clearEmailEnv();
    nodemailerMock.createTransport.mockClear();
    nodemailerMock.sendMail.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    for (const key of EMAIL_ENV_KEYS) {
      const originalValue = originalEnv[key];
      if (originalValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalValue;
      }
    }

    vi.restoreAllMocks();
  });

  it('skips email alerts when the feature flag is not enabled', async () => {
    await sendEarlyAccessEmailAlert(signup);

    expect(resolveEmailAlertConfig()).toBeNull();
    expect(nodemailerMock.createTransport).not.toHaveBeenCalled();
  });

  it('skips email alerts when required SMTP env vars are missing', async () => {
    process.env.EMAIL_ALERTS_ENABLED = 'true';
    process.env.SMTP_HOST = 'smtp.gmail.com';

    await sendEarlyAccessEmailAlert(signup);

    expect(nodemailerMock.createTransport).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      'early access email alerts are enabled but required env vars are missing',
      {
        missingEnvKeys: expect.arrayContaining([
          'SMTP_PORT',
          'SMTP_SECURE',
          'SMTP_USER',
          'SMTP_PASS',
          'ALERT_EMAIL_FROM',
          'ALERT_EMAIL_TO',
        ]),
      }
    );
  });

  it('sends the early access signup details to the internal alert address', async () => {
    setCompleteEmailEnv();
    nodemailerMock.sendMail.mockResolvedValueOnce({ messageId: 'test' });

    await sendEarlyAccessEmailAlert(signup);

    expect(nodemailerMock.createTransport).toHaveBeenCalledWith({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: 'sender@example.com',
        pass: 'app-password',
      },
    });
    expect(nodemailerMock.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Bondi Poker <sender@example.com>',
        to: 'ops@example.com',
        subject: 'New Bondi Poker early access signup: player@example.com',
        text: expect.stringContaining('Email: player@example.com'),
      })
    );

    const message = nodemailerMock.sendMail.mock.calls[0][0] as { text: string };
    expect(message.text).toContain('First name: Player One');
    expect(message.text).toContain('Source: landing_page');
    expect(message.text).toContain('Referrer: https://bondipoker.online/?utm_source=newsletter');
    expect(message.text).toContain('UTM Source: newsletter');
    expect(message.text).toContain('UTM Medium: email');
    expect(message.text).toContain('UTM Campaign: launch');
    expect(message.text).toContain('Marketing consent: Yes');
    expect(message.text).toContain('Timestamp: 2026-05-05T05:00:00.000Z');
  });

  it('logs email send failures without throwing', async () => {
    setCompleteEmailEnv();
    const sendError = new Error('smtp failed');
    nodemailerMock.sendMail.mockRejectedValueOnce(sendError);

    await expect(sendEarlyAccessEmailAlert(signup)).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledWith('early access email alert failed', sendError);
  });
});
