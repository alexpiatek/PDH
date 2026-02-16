INSERT INTO public.pdh_feature_flags (key, enabled, description)
VALUES
  ('observability.hand_replay', true, 'Expose replay ring-buffer retrieval in debug/admin flows'),
  ('security.protocol_v1_enforced', true, 'Reject unsupported client protocol versions'),
  ('ui.reconnect_backoff', true, 'Enable websocket reconnect backoff and telemetry'),
  ('ui.neo_luxury_theme', false, 'Enable neo-luxury visual theme tokens'),
  ('ui.quick_play', true, 'Enable one-tap quick play path in lobby'),
  ('ui.table_v2', false, 'Enable redesigned high-clarity table UI'),
  ('ui.discard_overlay_v2', false, 'Enable signature discard overlay with improved interactions'),
  ('social.friends_lobby', false, 'Enable friends presence and join-friend entry points'),
  ('progression.missions_v1', false, 'Enable daily missions and progression surfaces')
ON CONFLICT (key) DO UPDATE
SET enabled = EXCLUDED.enabled,
    description = EXCLUDED.description,
    updated_at = now();
