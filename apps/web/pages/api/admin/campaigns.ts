import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAdminAnalytics } from '../../../lib/adminAuth';
import {
  campaignDashboard,
  saveCampaign,
  sendCampaignTest,
  queueCampaign,
  cancelCampaign,
  excludeSignup,
} from '../../../lib/campaignServer';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST'].includes(req.method || '')) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  const admin = await requireAdminAnalytics(req, res);
  if (!admin) return;
  try {
    if (req.method === 'GET') return res.status(200).json(await campaignDashboard());
    const { action, id, subject, body, recipient, audience, email, excluded } = req.body || {};
    if (action === 'save')
      return res.status(200).json({ id: await saveCampaign(id, subject, body, admin.userId) });
    if (action === 'exclude') {
      await excludeSignup(email, excluded);
      return res.status(200).json({ ok: true });
    }
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id))
      return res.status(400).json({ error: 'Invalid campaign.' });
    if (action === 'test') await sendCampaignTest(id, recipient);
    else if (action === 'queue') await queueCampaign(id, audience);
    else if (action === 'cancel') await cancelCampaign(id);
    else return res.status(400).json({ error: 'Invalid action.' });
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Campaign request failed', (error as { code?: string }).code || 'request');
    const message = error instanceof Error ? error.message : '';
    const safe =
      /^(Enter |Only drafts|Draft not found|Send a test|The subscriber count|Campaign sending|Campaign SMTP|Add the sender|Campaign public origin|Invalid subscriber|The SMTP server)/.test(
        message
      );
    return res.status(safe ? 400 : 503).json({
      error: safe
        ? message
        : 'Email campaigns are unavailable. Check the database migration and email configuration.',
    });
  }
}
export const config = { api: { bodyParser: { sizeLimit: '32kb' } } };
