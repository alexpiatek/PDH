import type { NextApiRequest, NextApiResponse } from 'next';
import { getNakamaConfig } from './nakamaClient';

export interface AdminIdentity {
  userId: string;
  username: string;
}

export function clearAdminSessionCookie(): string {
  return 'pdh_admin_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax';
}

// Verify every request with Nakama and its server-only account-ID allowlist.
// Legacy cookies and credentials grant no access, including in development.
// Never trust a decoded client JWT alone.
export async function requireAdminAnalytics(
  req: NextApiRequest,
  res: NextApiResponse<{ error: string }>
): Promise<AdminIdentity | null> {
  res.setHeader('Cache-Control', 'no-store');
  const authorization = req.headers.authorization;
  if (typeof authorization !== 'string' || !/^Bearer \S+$/i.test(authorization)) {
    res.status(401).json({ error: 'Sign in with your player account.' });
    return null;
  }
  try {
    const config = getNakamaConfig();
    const url = new URL(
      '/v2/rpc/pdh_admin_access',
      `${config.useSSL ? 'https' : 'http'}://${config.host}:${config.port}`
    );
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify('{}'),
      cache: 'no-store',
      signal: AbortSignal.timeout(7000),
    });
    if (response.status === 401) {
      res.status(401).json({ error: 'Your sign-in has expired. Sign in again.' });
      return null;
    }
    if (!response.ok) throw new Error('Account access check unavailable');
    const result = await response.json();
    const access = typeof result.payload === 'string' ? JSON.parse(result.payload) : result.payload;
    if (access?.authorized === false) {
      res
        .status(403)
        .json({ error: 'Administrator access is restricted to approved player accounts.' });
      return null;
    }
    if (
      access?.authorized !== true ||
      typeof access.userId !== 'string' ||
      !access.userId ||
      typeof access.username !== 'string'
    )
      throw new Error('Invalid account access response');
    return { userId: access.userId, username: access.username };
  } catch {
    res.status(503).json({ error: 'Account access could not be checked. Please try again.' });
    return null;
  }
}
