import type { NextApiRequest, NextApiResponse } from 'next';
import { clearAdminSessionCookie } from '../../../lib/adminAuth';

// Retire the separate administrator password without changing player accounts.
export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Set-Cookie', clearAdminSessionCookie());
  return res
    .status(410)
    .json({
      ok: false,
      error: 'Use your regular player account to sign in.',
      signInUrl: '/admin/analytics',
    });
}
