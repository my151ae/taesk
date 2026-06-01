-- Fix Daily Digest cron auth and URL fallback.
-- Some environments do not expose app.settings.supabase_url / anon_key,
-- which breaks cron-triggered dispatch before the Edge Function is reached.

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

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
        url := NULLIF(current_setting('app.settings.supabase_url', true), '') || '/functions/v1/dispatch-daily-digests',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || NULLIF(current_setting('app.settings.anon_key', true), ''),
          'apikey', NULLIF(current_setting('app.settings.anon_key', true), ''),
          'X-Cron-Secret', public.get_cron_secret()
        ),
        body := '{}'::jsonb
      );
    $cron$
  );
END;
$$;
