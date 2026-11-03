ALTER TABLE public.early_access_signups
  ADD COLUMN IF NOT EXISTS unsubscribe_token uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS campaign_excluded boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS early_access_unsubscribe_token_idx
  ON public.early_access_signups(unsubscribe_token);

CREATE TABLE IF NOT EXISTS public.email_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','queued','completed','cancelled')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1,
  tested_at timestamptz,
  queued_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.email_campaign_recipients (
  campaign_id uuid NOT NULL REFERENCES public.email_campaigns(id),
  signup_id bigint NOT NULL REFERENCES public.early_access_signups(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','accepted','failed','unknown','skipped')),
  attempted_at timestamptz,
  message_id text,
  PRIMARY KEY(campaign_id, signup_id)
);
CREATE INDEX IF NOT EXISTS email_campaign_pending_idx
  ON public.email_campaign_recipients(status) WHERE status = 'pending';
CREATE TABLE IF NOT EXISTS public.email_campaign_worker (
  id integer PRIMARY KEY CHECK(id=1),
  heartbeat_at timestamptz NOT NULL
);
