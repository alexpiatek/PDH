import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ pool: null as unknown, send: vi.fn() }));
vi.mock('../lib/earlyAccessServer', () => ({
  getEarlyAccessPool: () => mocks.pool,
  normalizeEmail: (email: unknown) =>
    typeof email === 'string' && /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(email)
      ? email.toLowerCase()
      : null,
}));
vi.mock('nodemailer', () => ({ createTransport: () => ({ sendMail: mocks.send }) }));
import {
  saveCampaign,
  sendCampaignTest,
  queueCampaign,
  processCampaignBatch,
  unsubscribe,
  cancelCampaign,
} from '../lib/campaignServer';

const connectionString = process.env.CAMPAIGN_TEST_DATABASE_URL;
if (connectionString && !new URL(connectionString).pathname.startsWith('/pdh_campaign_test')) {
  throw new Error('Campaign tests require a disposable database named pdh_campaign_test...');
}
describe.skipIf(!connectionString)('campaign queue with PostgreSQL and mocked SMTP', () => {
  const pool = new Pool({ connectionString });
  beforeAll(async () => {
    mocks.pool = pool;
    await pool.query(readFileSync('db/migrations/0002_create_early_access_signups.sql', 'utf8'));
    await pool.query(readFileSync('db/migrations/0004_email_campaigns.sql', 'utf8'));
    vi.stubEnv('CAMPAIGN_SEND_ENABLED', 'true');
    vi.stubEnv('CAMPAIGN_SMTP_HOST', 'smtp.example.com');
    vi.stubEnv('CAMPAIGN_SMTP_PORT', '587');
    vi.stubEnv('CAMPAIGN_SMTP_SECURE', 'false');
    vi.stubEnv('CAMPAIGN_SMTP_USER', 'test');
    vi.stubEnv('CAMPAIGN_SMTP_PASS', 'test');
    vi.stubEnv('CAMPAIGN_POSTAL_ADDRESS', '');
  });
  beforeEach(async () => {
    await pool.query(
      'TRUNCATE public.email_campaign_recipients, public.email_campaigns, public.early_access_signups'
    );
    await pool.query(
      'INSERT INTO public.email_campaign_worker VALUES (1,now()) ON CONFLICT(id) DO UPDATE SET heartbeat_at=now()'
    );
    await pool.query(
      "INSERT INTO public.early_access_signups(email,is_18_plus_confirmed,marketing_consent,campaign_excluded) VALUES ('active@example.com',true,true,false),('excluded@example.com',true,true,true),('left@example.com',true,true,false)"
    );
    await pool.query(
      "UPDATE public.early_access_signups SET unsubscribed_at=now() WHERE email='left@example.com'"
    );
    mocks.send
      .mockReset()
      .mockResolvedValue({ accepted: ['active@example.com'], messageId: 'test' });
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await pool.end();
  });
  async function draft() {
    return saveCampaign(null, 'News', 'Hello', 'admin');
  }
  async function testedDraft() {
    const id = await draft();
    await sendCampaignTest(id, 'admin@bondipoker.com');
    mocks.send.mockClear();
    return id;
  }
  it('requires a test, rejects changed audience counts, and freezes the recipient set once', async () => {
    const id = await draft();
    await expect(queueCampaign(id, 1)).rejects.toThrow('Send a test');
    await sendCampaignTest(id, 'admin@bondipoker.com');
    await expect(queueCampaign(id, 2)).rejects.toThrow('subscriber count');
    await queueCampaign(id, 1);
    await expect(queueCampaign(id, 1)).rejects.toThrow();
    expect((await pool.query('SELECT * FROM public.email_campaign_recipients')).rowCount).toBe(1);
  });
  it('sends individually and never resends an accepted recipient', async () => {
    const id = await testedDraft();
    await queueCampaign(id, 1);
    await processCampaignBatch();
    await processCampaignBatch();
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls[0][0]).toMatchObject({
      to: { address: 'active@example.com' },
      from: { address: 'admin@bondipoker.com' },
    });
    expect(mocks.send.mock.calls[0][0].text).toContain('/unsubscribe?token=');
    expect(mocks.send.mock.calls[0][0].text).toContain('Bondi Poker\nadmin@bondipoker.com');
    expect(
      (await pool.query('SELECT status FROM public.email_campaign_recipients')).rows[0].status
    ).toBe('accepted');
  });
  it('rechecks unsubscribes after a campaign is queued', async () => {
    const id = await testedDraft();
    await queueCampaign(id, 1);
    const token = (
      await pool.query(
        "SELECT unsubscribe_token FROM public.early_access_signups WHERE email='active@example.com'"
      )
    ).rows[0].unsubscribe_token;
    await unsubscribe(token);
    await processCampaignBatch();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('cancels pending messages without sending them', async () => {
    const id = await testedDraft();
    await queueCampaign(id, 1);
    await cancelCampaign(id);
    await processCampaignBatch();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(
      (await pool.query('SELECT status FROM public.email_campaign_recipients')).rows[0].status
    ).toBe('skipped');
  });
  it('records an interrupted attempt as uncertain instead of sending it again', async () => {
    const id = await testedDraft();
    await queueCampaign(id, 1);
    await pool.query("UPDATE public.email_campaign_recipients SET status='sending'");
    await processCampaignBatch();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(
      (await pool.query('SELECT status FROM public.email_campaign_recipients')).rows[0].status
    ).toBe('unknown');
  });
  it('invalidates the test after edits and does not automatically replay uncertain attempts', async () => {
    const id = await testedDraft();
    await saveCampaign(id, 'Changed', 'Hello', 'admin');
    await expect(queueCampaign(id, 1)).rejects.toThrow();
    await sendCampaignTest(id, 'admin@bondipoker.com');
    await queueCampaign(id, 1);
    mocks.send.mockClear().mockRejectedValue(new Error('Socket interrupted'));
    await processCampaignBatch();
    await processCampaignBatch();
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(
      (await pool.query('SELECT status FROM public.email_campaign_recipients')).rows[0].status
    ).toBe('unknown');
  });
});
