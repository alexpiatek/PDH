import os from 'node:os';
import type { NextApiRequest, NextApiResponse } from 'next';
import { LOCAL_BROWSER_HOSTS } from '../../lib/localAccess';

type LocalAccessResponse =
  | { available: true; lanHost: string; origin: string; playUrl: string }
  | { available: false };

const isPrivateIpv4 = (address: string) => {
  if (address.startsWith('10.')) return true;
  if (address.startsWith('192.168.')) return true;
  const match = /^172\.(\d{1,3})\./.exec(address);
  if (!match) return false;
  const second = Number.parseInt(match[1], 10);
  return second >= 16 && second <= 31;
};

const buildLocalAccessInfo = (port: string | number) => {
  const candidates: string[] = [];
  const interfaces = os.networkInterfaces();

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      candidates.push(entry.address);
    }
  }

  const lanHost = candidates.find(isPrivateIpv4) ?? candidates[0] ?? null;
  if (!lanHost) return null;

  const normalizedPort = String(port || 3001);
  const origin = `http://${lanHost}:${normalizedPort}`;
  return {
    lanHost,
    origin,
    playUrl: `${origin}/play`,
  };
};

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<LocalAccessResponse>
) {
  const hostHeader = req.headers.host ?? '';
  const [hostname, rawPort] = hostHeader.split(':');
  const hostnameLower = hostname.trim().toLowerCase();

  if (hostnameLower && !LOCAL_BROWSER_HOSTS.has(hostnameLower)) {
    res.status(200).json({ available: false });
    return;
  }

  const info = buildLocalAccessInfo(rawPort || 3001);
  if (!info) {
    res.status(200).json({ available: false });
    return;
  }

  res.status(200).json({
    available: true,
    lanHost: info.lanHost,
    origin: info.origin,
    playUrl: info.playUrl,
  });
}
