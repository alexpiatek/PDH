export interface Campaign {
  id: string;
  subject: string;
  body: string;
  status: 'draft' | 'queued' | 'completed' | 'cancelled';
  tested: boolean;
  createdAt: string;
  pending: number;
  sending: number;
  accepted: number;
  failed: number;
  unknown: number;
  skipped: number;
}
export interface CampaignDashboard {
  campaigns: Campaign[];
  audience: number;
  ready: boolean;
  setupIssue: string | null;
  sender: string;
}
export function validateCampaign(subject: unknown, body: unknown) {
  if (
    typeof subject !== 'string' ||
    !subject.trim() ||
    subject.length > 180 ||
    /[\r\n]/.test(subject)
  )
    throw new Error('Enter a subject of 1–180 characters on one line.');
  if (typeof body !== 'string' || !body.trim() || body.length > 20000)
    throw new Error('Enter an email message of 1–20,000 characters.');
  return { subject: subject.trim(), body: body.trim() };
}
