import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAdminAnalytics } from '../../../lib/adminAuth';
import { loadSystemHealth, type SystemHealthSnapshot } from '../../../lib/systemHealthServer';

type SystemHealthResponse = SystemHealthSnapshot | { error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SystemHealthResponse>
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  if (!(await requireAdminAnalytics(req, res as NextApiResponse<{ error: string }>))) return;

  const health = await loadSystemHealth();
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json(health);
}
