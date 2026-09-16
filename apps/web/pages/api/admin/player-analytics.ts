import type { NextApiRequest, NextApiResponse } from 'next';
import {
  loadPlayerTestingDashboard,
  type PlayerTestingDashboard,
} from '../../../lib/playerTestingAnalyticsServer';
import { requireAdminAnalytics } from '../../../lib/adminAuth';

type AdminAnalyticsResponse = PlayerTestingDashboard | { error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<AdminAnalyticsResponse>
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  if (!requireAdminAnalytics(req, res as NextApiResponse<{ error: string }>)) {
    return;
  }

  const dashboard = await loadPlayerTestingDashboard();
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json(dashboard);
}
