import type { NextApiRequest, NextApiResponse } from 'next';
import { createAdminSessionCookie, verifyAdminCredentials } from '../../../lib/adminAuth';

type AdminLoginResponse =
  | {
      ok: true;
      username: string;
    }
  | {
      ok: false;
      error: string;
    };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<AdminLoginResponse>
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  if (!isPlainObject(req.body)) {
    return res.status(400).json({ ok: false, error: 'Enter your admin username and password.' });
  }

  const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';

  if (!verifyAdminCredentials(username, password)) {
    await new Promise((resolve) => setTimeout(resolve, 350));
    return res.status(401).json({ ok: false, error: 'Incorrect admin username or password.' });
  }

  const cookie = createAdminSessionCookie(username);
  if (!cookie) {
    return res.status(500).json({ ok: false, error: 'Admin session secret is not configured.' });
  }

  res.setHeader('Set-Cookie', cookie);
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, username });
}
