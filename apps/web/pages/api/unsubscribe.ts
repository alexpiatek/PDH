import type { NextApiRequest, NextApiResponse } from 'next';
import { unsubscribe } from '../../lib/campaignServer';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  const token = req.query.token;
  if (typeof token !== 'string' || !/^[0-9a-f-]{36}$/i.test(token))
    return res.status(400).json({ error: 'Invalid unsubscribe link.' });
  try {
    await unsubscribe(token);
    return res.status(200).json({ ok: true });
  } catch {
    return res
      .status(503)
      .json({ error: 'Unable to unsubscribe. Please try again or contact admin@bondipoker.com.' });
  }
}
