import type { NextApiRequest, NextApiResponse } from 'next';
import {
  persistPlayerTestingAnalytics,
  type PlayerTestingAnalyticsBatch,
} from '../../lib/playerTestingAnalyticsServer';

type PlayerAnalyticsResponse =
  | {
      ok: true;
      stored: boolean;
      queued?: boolean;
    }
  | {
      ok: false;
      error: string;
    };

const PERSIST_RESPONSE_DEADLINE_MS = 750;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidBatch(value: unknown): value is PlayerTestingAnalyticsBatch {
  if (!isPlainObject(value) || !isPlainObject(value.profile)) {
    return false;
  }
  return typeof value.profile.profileKey === 'string' && value.profile.profileKey.length > 0;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<PlayerAnalyticsResponse>
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  if (!isValidBatch(req.body)) {
    return res.status(400).json({ ok: false, error: 'Invalid analytics payload.' });
  }

  try {
    const result: { stored: boolean; queued?: boolean } = await Promise.race([
      persistPlayerTestingAnalytics(req.body),
      new Promise<{ stored: boolean; queued: boolean }>((resolve) => {
        setTimeout(() => resolve({ stored: false, queued: true }), PERSIST_RESPONSE_DEADLINE_MS);
      }),
    ]);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, stored: result.stored, queued: result.queued });
  } catch (error) {
    console.warn('player testing analytics persist failed', error);
    return res.status(200).json({ ok: true, stored: false });
  }
}
