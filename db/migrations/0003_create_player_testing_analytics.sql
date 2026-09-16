CREATE TABLE IF NOT EXISTS public.player_testing_profiles (
  profile_key text PRIMARY KEY,
  display_name text,
  auth_mode text NOT NULL DEFAULT 'device',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.player_testing_sessions (
  session_key text PRIMARY KEY,
  profile_key text NOT NULL REFERENCES public.player_testing_profiles (profile_key) ON DELETE CASCADE,
  entry_point text NOT NULL,
  backend text,
  match_id text,
  table_id text,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  initial_stack integer,
  last_stack integer,
  hands_seen integer NOT NULL DEFAULT 0,
  actions_taken integer NOT NULL DEFAULT 0,
  rebuys integer NOT NULL DEFAULT 0,
  sit_outs integer NOT NULL DEFAULT 0,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.player_testing_events (
  id bigserial PRIMARY KEY,
  profile_key text NOT NULL REFERENCES public.player_testing_profiles (profile_key) ON DELETE CASCADE,
  session_key text REFERENCES public.player_testing_sessions (session_key) ON DELETE SET NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.player_chip_ledger (
  id bigserial PRIMARY KEY,
  profile_key text NOT NULL REFERENCES public.player_testing_profiles (profile_key) ON DELETE CASCADE,
  session_key text REFERENCES public.player_testing_sessions (session_key) ON DELETE SET NULL,
  match_id text,
  table_id text,
  hand_id text,
  phase text,
  stack integer NOT NULL,
  delta integer,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS player_testing_sessions_profile_started_idx
  ON public.player_testing_sessions (profile_key, started_at DESC);

CREATE INDEX IF NOT EXISTS player_testing_events_profile_occurred_idx
  ON public.player_testing_events (profile_key, occurred_at DESC);

CREATE INDEX IF NOT EXISTS player_testing_events_type_occurred_idx
  ON public.player_testing_events (event_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS player_chip_ledger_profile_occurred_idx
  ON public.player_chip_ledger (profile_key, occurred_at DESC);

