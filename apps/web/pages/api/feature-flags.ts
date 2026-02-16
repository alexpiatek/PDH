import type { NextApiRequest, NextApiResponse } from 'next';
import { loadFeatureFlagsFromDatabase } from '../../lib/featureFlagsServer';

interface FeatureFlagsApiResponse {
  flags: Record<string, boolean>;
  source: 'db' | 'static';
  updatedAt: string | null;
  error: string | null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<FeatureFlagsApiResponse | { error: string }>
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const result = await loadFeatureFlagsFromDatabase();

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    flags: result.flags,
    source: result.source,
    updatedAt: result.updatedAt,
    error: result.error,
  });
}

