-- Create trigger to send push notifications when a notification is created
-- This trigger invokes the send-push-notification Edge Function

-- Note: Edge Function invocation from triggers requires Supabase v2.40.0+
-- and the pg_net extension to be enabled

-- Enable pg_net extension for HTTP requests (if not already enabled)
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Create function to invoke Edge Function
CREATE OR REPLACE FUNCTION send_push_notification_trigger()
RETURNS TRIGGER AS $$
DECLARE
  edge_function_url TEXT;
  supabase_url TEXT;
  anon_key TEXT;
  payload JSONB;
BEGIN
  -- Only send push for new notifications (not updates)
  IF (TG_OP = 'INSERT') THEN
    -- Construct Edge Function URL
    -- Note: In production, use environment variables or configuration
    -- For now, this is a placeholder
    supabase_url := current_setting('app.supabase_url', true);

    IF supabase_url IS NULL OR supabase_url = '' THEN
      -- Skip if not configured (local development)
      RAISE NOTICE 'Supabase URL not configured, skipping push notification';
      RETURN NEW;
    END IF;

    edge_function_url := supabase_url || '/functions/v1/send-push-notification';

    -- Prepare payload
    payload := jsonb_build_object(
      'notification_id', NEW.id::text,
      'recipient_id', NEW.recipient_id::text,
      'type', NEW.type,
      'payload', NEW.payload
    );

    -- Invoke Edge Function asynchronously using pg_net
    -- Note: This requires the pg_net extension
    PERFORM net.http_post(
      url := edge_function_url,
      body := payload,
      headers := jsonb_build_object(
        'Content-Type', 'application/json'
        -- Add Authorization header if needed
      )
    );

    RAISE NOTICE 'Triggered push notification for notification %', NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on notifications table
DROP TRIGGER IF EXISTS on_notification_created ON notifications;
CREATE TRIGGER on_notification_created
  AFTER INSERT ON notifications
  FOR EACH ROW
  EXECUTE FUNCTION send_push_notification_trigger();

COMMENT ON FUNCTION send_push_notification_trigger() IS
'Trigger function to send push notifications via Edge Function when a new notification is created';

COMMENT ON TRIGGER on_notification_created ON notifications IS
'Automatically sends push notifications when a new notification is inserted';
