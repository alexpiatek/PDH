import { createTransport } from 'nodemailer';
import type { EarlyAccessSignupRecord } from './earlyAccessServer';

const EMAIL_ALERTS_ENABLED_ENV_KEY = 'EMAIL_ALERTS_ENABLED';
const REQUIRED_EMAIL_ALERT_ENV_KEYS = [
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASS',
  'ALERT_EMAIL_FROM',
  'ALERT_EMAIL_TO',
] as const;

interface EmailAlertConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  to: string;
}

function readEnvValue(key: string): string {
  return process.env[key]?.trim() ?? '';
}

function parseBoolean(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return null;
}

function formatAlertValue(value: string | null | undefined): string {
  if (!value) {
    return 'Not provided';
  }

  const singleLine = value.replace(/[\r\n]+/g, ' ').trim();
  return singleLine || 'Not provided';
}

function formatMarketingConsent(value: boolean): string {
  return value ? 'Yes' : 'No';
}

export function resolveEmailAlertConfig(): EmailAlertConfig | null {
  const enabled = parseBoolean(readEnvValue(EMAIL_ALERTS_ENABLED_ENV_KEY));
  if (enabled !== true) {
    return null;
  }

  const missingEnvKeys = REQUIRED_EMAIL_ALERT_ENV_KEYS.filter((key) => !readEnvValue(key));
  if (missingEnvKeys.length > 0) {
    console.warn('early access email alerts are enabled but required env vars are missing', {
      missingEnvKeys,
    });
    return null;
  }

  const port = Number(readEnvValue('SMTP_PORT'));
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    console.warn('early access email alerts are enabled but SMTP_PORT is invalid');
    return null;
  }

  const secure = parseBoolean(readEnvValue('SMTP_SECURE'));
  if (secure === null) {
    console.warn('early access email alerts are enabled but SMTP_SECURE is invalid');
    return null;
  }

  return {
    host: readEnvValue('SMTP_HOST'),
    port,
    secure,
    user: readEnvValue('SMTP_USER'),
    pass: readEnvValue('SMTP_PASS'),
    from: readEnvValue('ALERT_EMAIL_FROM'),
    to: readEnvValue('ALERT_EMAIL_TO'),
  };
}

function buildEarlyAccessEmailText(signup: EarlyAccessSignupRecord): string {
  return [
    'New Bondi Poker early access signup',
    '',
    `Email: ${formatAlertValue(signup.email)}`,
    `First name: ${formatAlertValue(signup.name)}`,
    `Source: ${formatAlertValue(signup.source)}`,
    `Referrer: ${formatAlertValue(signup.referrer)}`,
    `UTM Source: ${formatAlertValue(signup.utmSource)}`,
    `UTM Medium: ${formatAlertValue(signup.utmMedium)}`,
    `UTM Campaign: ${formatAlertValue(signup.utmCampaign)}`,
    `Marketing consent: ${formatMarketingConsent(signup.marketingConsent)}`,
    `Timestamp: ${formatAlertValue(signup.createdAt)}`,
  ].join('\n');
}

export async function sendEarlyAccessEmailAlert(signup: EarlyAccessSignupRecord): Promise<void> {
  const config = resolveEmailAlertConfig();
  if (!config) {
    return;
  }

  try {
    const transporter = createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.pass,
      },
    });

    await transporter.sendMail({
      from: config.from,
      to: config.to,
      subject: `New Bondi Poker early access signup: ${signup.email}`,
      text: buildEarlyAccessEmailText(signup),
    });
  } catch (error) {
    console.error('early access email alert failed', error);
  }
}
