import type { NextApiRequest, NextApiResponse } from 'next';
import { isLocalAdminRequest, readAdminSession } from '../../../lib/adminAuth';

type AdminMeResponse =
  | {
      authenticated: true;
      username: string;
      localDev: boolean;
    }
  | {
      authenticated: false;
    };

export default async function handler(req: NextApiRequest, res: NextApiResponse<AdminMeResponse>) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ authenticated: false });
  }

  const session = readAdminSession(req);
  if (session) {
    return res.status(200).json({
      authenticated: true,
      username: session.username,
      localDev: false,
    });
  }

  if (process.env.NODE_ENV !== 'production' && isLocalAdminRequest(req)) {
    return res.status(200).json({
      authenticated: true,
      username: 'local-admin',
      localDev: true,
    });
  }

  return res.status(401).json({ authenticated: false });
}
