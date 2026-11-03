import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAdminAnalytics } from '../../../lib/adminAuth';
import { loadEarlyAccessSignups } from '../../../lib/earlyAccessServer';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  if (!(await requireAdminAnalytics(req, res))) return;
  const page = req.query.page === undefined ? 1 : Number(req.query.page);
  if (Array.isArray(req.query.page) || !Number.isSafeInteger(page) || page < 1 || page > 1000000) {
    return res.status(400).json({ error: 'Invalid page' });
  }
  try {
    return res.status(200).json(await loadEarlyAccessSignups(page));
  } catch (error) {
    console.error('Admin signup list failed', error);
    return res.status(503).json({ error: 'Signup list is unavailable. Please try again.' });
  }
}
