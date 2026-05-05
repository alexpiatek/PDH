import type { NextApiRequest, NextApiResponse } from 'next';
import { createEarlyAccessSignup, normalizeEmail } from '../../lib/earlyAccessServer';

const SUCCESS_MESSAGE =
  'You\u2019re on the list. We\u2019ll send early access invites, test-night announcements, and launch updates.';

type EarlyAccessResponse =
  | {
      ok: true;
      message: string;
    }
  | {
      ok: false;
      error: string;
    };

type EarlyAccessRequestBody = {
  email?: unknown;
  name?: unknown;
  is18PlusConfirmed?: unknown;
  marketingConsent?: unknown;
  source?: unknown;
  referrer?: unknown;
  utmSource?: unknown;
  utmMedium?: unknown;
  utmCampaign?: unknown;
};

function isPlainObject(value: unknown): value is EarlyAccessRequestBody {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<EarlyAccessResponse>
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  if (!isPlainObject(req.body)) {
    return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });
  }

  const email = normalizeEmail(req.body.email);
  if (!email) {
    return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });
  }

  if (req.body.is18PlusConfirmed !== true) {
    return res.status(400).json({ ok: false, error: 'Please confirm you are 18 or older.' });
  }

  if (req.body.marketingConsent !== true) {
    return res.status(400).json({
      ok: false,
      error: 'Please agree to receive Bondi Poker updates before joining the list.',
    });
  }

  try {
    const result = await createEarlyAccessSignup({
      email,
      name: typeof req.body.name === 'string' ? req.body.name : undefined,
      is18PlusConfirmed: true,
      marketingConsent: true,
      source: typeof req.body.source === 'string' ? req.body.source : undefined,
      referrer: typeof req.body.referrer === 'string' ? req.body.referrer : undefined,
      utmSource: typeof req.body.utmSource === 'string' ? req.body.utmSource : undefined,
      utmMedium: typeof req.body.utmMedium === 'string' ? req.body.utmMedium : undefined,
      utmCampaign: typeof req.body.utmCampaign === 'string' ? req.body.utmCampaign : undefined,
    });

    res.setHeader('Cache-Control', 'no-store');
    return res.status(result.created ? 201 : 200).json({
      ok: true,
      message: SUCCESS_MESSAGE,
    });
  } catch (error) {
    console.error('early access signup failed', error);
    return res.status(500).json({
      ok: false,
      error: 'Something went wrong while joining the list. Please try again.',
    });
  }
}
