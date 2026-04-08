CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE TABLE IF NOT EXISTS public.daily_digest_preferences (
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  board_id UUID NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  delivery_time TEXT NOT NULL DEFAULT '09:00',
  timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  include_overdue BOOLEAN NOT NULL DEFAULT TRUE,
  notify_when_empty BOOLEAN NOT NULL DEFAULT TRUE,
  last_sent_local_date DATE NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (profile_id, board_id),
  CONSTRAINT daily_digest_preferences_delivery_time_format
    CHECK (delivery_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);

ALTER TABLE public.daily_digest_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own daily digest preferences"
  ON public.daily_digest_preferences
  FOR SELECT
  USING (
    auth.uid() = profile_id
    AND EXISTS (
      SELECT 1
      FROM public.board_members
      WHERE board_members.board_id = daily_digest_preferences.board_id
        AND board_members.profile_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own daily digest preferences"
  ON public.daily_digest_preferences
  FOR INSERT
  WITH CHECK (
    auth.uid() = profile_id
    AND EXISTS (
      SELECT 1
      FROM public.board_members
      WHERE board_members.board_id = daily_digest_preferences.board_id
        AND board_members.profile_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own daily digest preferences"
  ON public.daily_digest_preferences
  FOR UPDATE
  USING (
    auth.uid() = profile_id
    AND EXISTS (
      SELECT 1
      FROM public.board_members
      WHERE board_members.board_id = daily_digest_preferences.board_id
        AND board_members.profile_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.uid() = profile_id
    AND EXISTS (
      SELECT 1
      FROM public.board_members
      WHERE board_members.board_id = daily_digest_preferences.board_id
        AND board_members.profile_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.set_daily_digest_preferences_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS daily_digest_preferences_set_updated_at ON public.daily_digest_preferences;
CREATE TRIGGER daily_digest_preferences_set_updated_at
  BEFORE UPDATE ON public.daily_digest_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.set_daily_digest_preferences_updated_at();

COMMENT ON TABLE public.daily_digest_preferences IS
'Per-user, per-board preferences for daily digest notifications.';

COMMENT ON COLUMN public.daily_digest_preferences.delivery_time IS
'Local notification delivery time in HH:mm for the preference timezone.';

DO $$
DECLARE
  existing_job_id BIGINT;
BEGIN
  SELECT jobid
  INTO existing_job_id
  FROM cron.job
  WHERE jobname = 'dispatch-daily-digests-every-5-minutes';

  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;

  PERFORM cron.schedule(
    'dispatch-daily-digests-every-5-minutes',
    '*/5 * * * *',
    $cron$
      SELECT net.http_post(
        url := current_setting('app.settings.supabase_url', true) || '/functions/v1/dispatch-daily-digests',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
          'X-Cron-Secret', public.get_cron_secret()
        ),
        body := '{}'::jsonb
      );
    $cron$
  );
END;
$$;
