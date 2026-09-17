import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAdminAnalytics } from '../../../lib/adminAuth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  const identity = await requireAdminAnalytics(req, res);
  if (!identity) return;
  return res.status(200).json({ authenticated: true, ...identity });
}
