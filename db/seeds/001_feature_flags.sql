INSERT INTO public.pdh_feature_flags (key, enabled, description)
VALUES
  ('observability.hand_replay', true, 'Expose replay ring-buffer retrieval in debug/admin flows'),
  ('security.protocol_v1_enforced', true, 'Reject unsupported client protocol versions'),
  ('ui.reconnect_backoff', true, 'Enable websocket reconnect backoff and telemetry')
ON CONFLICT (key) DO UPDATE
SET enabled = EXCLUDED.enabled,
    description = EXCLUDED.description,
    updated_at = now();
