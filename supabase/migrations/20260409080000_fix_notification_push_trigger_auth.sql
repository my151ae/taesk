-- Fix notification push trigger auth fallback.
-- The send-push-notification Edge Function has verify_jwt=false, but
-- Supabase Edge Gateway still requires an Authorization header. Recent
-- environments may not have app.settings.service_role_key configured,
-- which breaks trigger-initiated delivery while direct function calls work.

create extension if not exists pg_net;

create or replace function trigger_push_notification()
returns trigger
language plpgsql
security definer
as $$
declare
  edge_function_url text;
  auth_token text;
  payload json;
begin
  edge_function_url := current_setting('app.settings.supabase_url', true) || '/functions/v1/send-push-notification';

  if edge_function_url is null or edge_function_url = '/functions/v1/send-push-notification' then
    raise exception 'app.settings.edge_function_url must be configured before installing notification push trigger';
  end if;

  auth_token := nullif(current_setting('app.settings.anon_key', true), '');

  if auth_token is null then
    raise exception 'app.settings.anon_key must be configured before installing notification push trigger';
  end if;

  payload := json_build_object(
    'notification_id', NEW.id::text,
    'recipient_id', NEW.recipient_id::text,
    'type', NEW.type,
    'payload', NEW.payload
  );

  perform net.http_post(
    url := edge_function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || auth_token,
      'apikey', auth_token
    ),
    body := payload::jsonb
  );

  return NEW;
end;
$$;
