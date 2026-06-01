-- Enable pg_net extension for HTTP requests
create extension if not exists pg_net;

-- Function to trigger Edge Function for push notifications
create or replace function trigger_push_notification()
returns trigger
language plpgsql
security definer
as $$
declare
  edge_function_url text;
  payload json;
begin
  -- Get Edge Function URL from environment or construct it
  edge_function_url := current_setting('app.settings.supabase_url', true) || '/functions/v1/send-push-notification';

  -- If not set in config, use the default Supabase project URL
  if edge_function_url is null or edge_function_url = '/functions/v1/send-push-notification' then
    raise exception 'app.settings.edge_function_url must be configured before installing notification push trigger';
  end if;

  -- Build payload for Edge Function
  payload := json_build_object(
    'notification_id', NEW.id::text,
    'recipient_id', NEW.recipient_id::text,
    'type', NEW.type,
    'payload', NEW.payload
  );

  -- Call Edge Function asynchronously using pg_net
  perform net.http_post(
    url := edge_function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := payload::jsonb
  );

  return NEW;
end;
$$;

-- Create trigger on notifications table
drop trigger if exists on_notification_created on notifications;

create trigger on_notification_created
  after insert on notifications
  for each row
  execute function trigger_push_notification();

-- Grant necessary permissions
grant usage on schema net to postgres, anon, authenticated, service_role;
grant all on all tables in schema net to postgres, anon, authenticated, service_role;
grant all on all routines in schema net to postgres, anon, authenticated, service_role;
grant all on all sequences in schema net to postgres, anon, authenticated, service_role;

alter default privileges in schema net grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges in schema net grant all on routines to postgres, anon, authenticated, service_role;
alter default privileges in schema net grant all on sequences to postgres, anon, authenticated, service_role;
