import type { NextApiRequest, NextApiResponse } from 'next';
import { clearAdminSessionCookie } from '../../../lib/adminAuth';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ ok: true } | { error: string }>
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  res.setHeader('Set-Cookie', clearAdminSessionCookie());
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true });
}
