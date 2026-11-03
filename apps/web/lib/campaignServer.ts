import { createTransport } from 'nodemailer';
import { getEarlyAccessPool, normalizeEmail } from './earlyAccessServer';
import { validateCampaign, type Campaign, type CampaignDashboard } from './campaigns';

const SENDER = 'admin@bondipoker.com';
const ELIGIBLE =
  'marketing_consent = true AND unsubscribed_at IS NULL AND campaign_excluded = false';
function db() {
  const pool = getEarlyAccessPool();
  if (!pool) throw new Error('Signup database is not configured.');
  return pool;
}
function mailConfig() {
  const env = process.env;
  const port = Number(env.CAMPAIGN_SMTP_PORT);
  if (env.CAMPAIGN_SEND_ENABLED !== 'true')
    throw new Error('Campaign sending has not been enabled.');
  if (
    !env.CAMPAIGN_SMTP_HOST ||
    !env.CAMPAIGN_SMTP_USER ||
    !env.CAMPAIGN_SMTP_PASS ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !['true', 'false'].includes(env.CAMPAIGN_SMTP_SECURE || '')
  )
    throw new Error('Campaign SMTP settings are incomplete.');
  const origin = new URL(env.CAMPAIGN_PUBLIC_ORIGIN || 'https://play.bondipoker.online');
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/')
    throw new Error('Campaign public origin must be an HTTPS origin.');
  return {
    origin: origin.origin,
    smtp: {
      host: env.CAMPAIGN_SMTP_HOST,
      port,
      secure: env.CAMPAIGN_SMTP_SECURE === 'true',
      requireTLS: env.CAMPAIGN_SMTP_SECURE !== 'true',
      auth: { user: env.CAMPAIGN_SMTP_USER, pass: env.CAMPAIGN_SMTP_PASS },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
      disableFileAccess: true,
      disableUrlAccess: true,
    },
  };
}
export async function campaignDashboard(): Promise<CampaignDashboard> {
  let setupIssue: string | null = null;
  try {
    mailConfig();
  } catch (error) {
    setupIssue = (error as Error).message;
  }
  const worker = await db().query(
    "SELECT 1 FROM public.email_campaign_worker WHERE id=1 AND heartbeat_at > now()-interval '2 minutes'"
  );
  if (!setupIssue && !worker.rowCount) setupIssue = 'The email sending worker is not running.';
  const audience = await db().query<{ count: number }>(
    `SELECT count(*)::int AS count FROM public.early_access_signups WHERE ${ELIGIBLE}`
  );
  const campaigns = await db().query<Campaign>(`
    SELECT c.id,c.subject,c.body,c.status,c.tested_at IS NOT NULL AS tested,c.created_at AS "createdAt",
      count(r.*) FILTER (WHERE r.status='pending')::int AS pending,
      count(r.*) FILTER (WHERE r.status='sending')::int AS sending,
      count(r.*) FILTER (WHERE r.status='accepted')::int AS accepted,
      count(r.*) FILTER (WHERE r.status='failed')::int AS failed,
      count(r.*) FILTER (WHERE r.status='unknown')::int AS unknown,
      count(r.*) FILTER (WHERE r.status='skipped')::int AS skipped
    FROM public.email_campaigns c LEFT JOIN public.email_campaign_recipients r ON r.campaign_id=c.id
    GROUP BY c.id ORDER BY c.created_at DESC LIMIT 50`);
  return {
    campaigns: campaigns.rows,
    audience: audience.rows[0].count,
    ready: !setupIssue,
    setupIssue,
    sender: SENDER,
  };
}
export async function saveCampaign(id: unknown, subject: unknown, body: unknown, admin: string) {
  const content = validateCampaign(subject, body);
  if (id) {
    const result = await db().query(
      `UPDATE public.email_campaigns SET subject=$2,body=$3,
      tested_at=NULL,updated_at=now(),revision=revision+1 WHERE id=$1 AND status='draft' RETURNING id`,
      [id, content.subject, content.body]
    );
    if (!result.rowCount) throw new Error('Only drafts can be edited.');
    return result.rows[0].id as string;
  }
  const result = await db().query(
    'INSERT INTO public.email_campaigns(subject,body,created_by) VALUES ($1,$2,$3) RETURNING id',
    [content.subject, content.body, admin]
  );
  return result.rows[0].id as string;
}
export async function sendCampaignTest(id: string, recipient: unknown) {
  const to = normalizeEmail(recipient);
  if (!to || /[<>,;]/.test(to)) throw new Error('Enter one valid test email address.');
  const config = mailConfig();
  const result = await db().query(
    'SELECT subject,body,revision FROM public.email_campaigns WHERE id=$1 AND status=$2',
    [id, 'draft']
  );
  const draft = result.rows[0];
  if (!draft) throw new Error('Draft not found.');
  const transport = createTransport(config.smtp);
  const sent = await transport.sendMail({
    from: { name: 'Bondi Poker', address: SENDER },
    replyTo: SENDER,
    to: { name: '', address: to },
    subject: `[TEST] ${draft.subject}`,
    text: `${draft.body}\n\nBondi Poker\n${SENDER}\n\nTest email only. No subscribers were contacted.`,
  });
  if (!sent.accepted?.length) throw new Error('The SMTP server did not accept the test email.');
  await db().query(
    'UPDATE public.email_campaigns SET tested_at=now() WHERE id=$1 AND status=$2 AND revision=$3',
    [id, 'draft', draft.revision]
  );
}
export async function queueCampaign(id: string, expectedAudience: unknown) {
  mailConfig();
  const worker = await db().query(
    "SELECT 1 FROM public.email_campaign_worker WHERE id=1 AND heartbeat_at > now()-interval '2 minutes'"
  );
  if (!worker.rowCount) throw new Error('Campaign sending worker is not running.');
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      'SELECT status,tested_at FROM public.email_campaigns WHERE id=$1 FOR UPDATE',
      [id]
    );
    if (result.rows[0]?.status !== 'draft' || !result.rows[0]?.tested_at)
      throw new Error('Send a test of this draft before sending to subscribers.');
    const audience = await client.query(
      `INSERT INTO public.email_campaign_recipients(campaign_id,signup_id)
      SELECT $1,id FROM public.early_access_signups WHERE ${ELIGIBLE}`,
      [id]
    );
    if (!audience.rowCount || audience.rowCount !== expectedAudience)
      throw new Error('The subscriber count changed. Refresh and review it before sending.');
    await client.query(
      "UPDATE public.email_campaigns SET status='queued',queued_at=now() WHERE id=$1",
      [id]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
export async function cancelCampaign(id: string) {
  await db().query(
    `WITH cancelled AS (
      UPDATE public.email_campaigns SET status='cancelled' WHERE id=$1 AND status='queued' RETURNING id
    ) UPDATE public.email_campaign_recipients r SET status='skipped' FROM cancelled c
      WHERE r.campaign_id=c.id AND r.status='pending'`,
    [id]
  );
}
export async function excludeSignup(email: unknown, excluded: unknown) {
  if (!normalizeEmail(email) || typeof excluded !== 'boolean')
    throw new Error('Invalid subscriber selection.');
  await db().query('UPDATE public.early_access_signups SET campaign_excluded=$2 WHERE email=$1', [
    email,
    excluded,
  ]);
}
export async function unsubscribe(token: string) {
  if (!/^[0-9a-f-]{36}$/i.test(token)) throw new Error('Invalid unsubscribe link.');
  const result = await db().query(
    'UPDATE public.early_access_signups SET unsubscribed_at=COALESCE(unsubscribed_at,now()) WHERE unsubscribe_token=$1 RETURNING id',
    [token]
  );
  if (!result.rowCount) throw new Error('Invalid unsubscribe link.');
}

// One durable worker owns this lock. An interrupted SMTP attempt is never replayed automatically.
export async function processCampaignBatch() {
  const config = mailConfig();
  const client = await db().connect();
  let locked = false;
  try {
    locked = (await client.query('SELECT pg_try_advisory_lock(7261042) AS locked')).rows[0].locked;
    if (!locked) return;
    await client.query(
      'INSERT INTO public.email_campaign_worker(id,heartbeat_at) VALUES (1,now()) ON CONFLICT(id) DO UPDATE SET heartbeat_at=now()'
    );
    await client.query(
      "UPDATE public.email_campaign_recipients SET status='unknown' WHERE status='sending'"
    );
    const recipients =
      await client.query(`SELECT r.campaign_id,r.signup_id,c.subject,c.body,s.email,s.unsubscribe_token
      FROM public.email_campaign_recipients r JOIN public.email_campaigns c ON c.id=r.campaign_id
      JOIN public.early_access_signups s ON s.id=r.signup_id
      WHERE r.status='pending' AND c.status='queued' ORDER BY c.queued_at,r.signup_id LIMIT 10`);
    const transport = createTransport(config.smtp);
    for (const recipient of recipients.rows) {
      await client.query('UPDATE public.email_campaign_worker SET heartbeat_at=now() WHERE id=1');
      const eligibility = await client.query(
        `SELECT 1 FROM public.early_access_signups s JOIN public.email_campaigns c ON c.id=$2
        WHERE s.id=$1 AND ${ELIGIBLE} AND c.status='queued'`,
        [recipient.signup_id, recipient.campaign_id]
      );
      if (!eligibility.rowCount) {
        await client.query(
          "UPDATE public.email_campaign_recipients SET status='skipped' WHERE campaign_id=$1 AND signup_id=$2",
          [recipient.campaign_id, recipient.signup_id]
        );
        continue;
      }
      await client.query(
        "UPDATE public.email_campaign_recipients SET status='sending',attempted_at=now() WHERE campaign_id=$1 AND signup_id=$2",
        [recipient.campaign_id, recipient.signup_id]
      );
      const url = `${config.origin}/unsubscribe?token=${recipient.unsubscribe_token}`;
      let status = 'unknown';
      let messageId: string | null = null;
      try {
        const info = await transport.sendMail({
          from: { name: 'Bondi Poker', address: SENDER },
          replyTo: SENDER,
          to: { name: '', address: recipient.email },
          subject: recipient.subject,
          text: `${recipient.body}\n\nBondi Poker\n${SENDER}\n\nYou signed up for Bondi Poker updates.\nUnsubscribe: ${url}`,
          headers: {
            'List-Unsubscribe': `<${config.origin}/api/unsubscribe?token=${recipient.unsubscribe_token}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        });
        status = info.accepted?.length ? 'accepted' : 'failed';
        messageId = info.messageId || null;
      } catch (error) {
        const smtpError = error as { code?: string; responseCode?: number };
        status =
          smtpError.responseCode ||
          ['EAUTH', 'EENVELOPE', 'ECONNECTION'].includes(smtpError.code || '')
            ? 'failed'
            : 'unknown';
      }
      await client.query(
        'UPDATE public.email_campaign_recipients SET status=$3,message_id=$4 WHERE campaign_id=$1 AND signup_id=$2',
        [recipient.campaign_id, recipient.signup_id, status, messageId]
      );
    }
    await client.query(`UPDATE public.email_campaigns c SET status='completed' WHERE status='queued' AND NOT EXISTS
      (SELECT 1 FROM public.email_campaign_recipients r WHERE r.campaign_id=c.id AND r.status IN ('pending','sending'))`);
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock(7261042)');
    client.release();
  }
}
