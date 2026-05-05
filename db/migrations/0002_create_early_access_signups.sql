CREATE TABLE IF NOT EXISTS public.early_access_signups (
  id bigserial PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text,
  is_18_plus_confirmed boolean NOT NULL,
  marketing_consent boolean NOT NULL,
  consent_text_version text NOT NULL DEFAULT 'early_access_v1',
  source text,
  referrer text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  created_at timestamptz NOT NULL DEFAULT now(),
  unsubscribed_at timestamptz,
  CONSTRAINT early_access_signups_email_normalized_chk CHECK (email = lower(email)),
  CONSTRAINT early_access_signups_is_18_plus_confirmed_chk CHECK (is_18_plus_confirmed = true),
  CONSTRAINT early_access_signups_marketing_consent_chk CHECK (marketing_consent = true)
);

CREATE INDEX IF NOT EXISTS early_access_signups_created_at_idx
  ON public.early_access_signups (created_at DESC);

CREATE INDEX IF NOT EXISTS early_access_signups_marketing_active_idx
  ON public.early_access_signups (marketing_consent, unsubscribed_at)
  WHERE marketing_consent = true AND unsubscribed_at IS NULL;
