ALTER TABLE public.google_calendar_sync_states
  ADD COLUMN IF NOT EXISTS watch_channel_token text;

COMMENT ON COLUMN public.google_calendar_sync_states.watch_channel_token IS
  'Opaque token that must match x-goog-channel-token on webhook callbacks.';
