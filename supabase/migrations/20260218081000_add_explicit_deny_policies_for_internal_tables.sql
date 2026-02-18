-- Add explicit deny policies for internal queue/log tables
-- Keeps RLS posture explicit and clears "RLS enabled no policy" advisor info.

DROP POLICY IF EXISTS "No direct access to notification delivery logs" ON public.notification_delivery_logs;
CREATE POLICY "No direct access to notification delivery logs"
  ON public.notification_delivery_logs
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "No direct access to reminders queue" ON public.reminders_queue;
CREATE POLICY "No direct access to reminders queue"
  ON public.reminders_queue
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);
