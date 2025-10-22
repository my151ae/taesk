-- Add Web Push delivery tracking and subscription management
-- Part of 0302: Web Push 送信ロジック実装

-- 1. Create notification_delivery_logs table for tracking push notification delivery
CREATE TABLE IF NOT EXISTS notification_delivery_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id UUID REFERENCES notifications(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES push_subscriptions(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failure', 'retrying')),
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_delivery_logs_notification
  ON notification_delivery_logs(notification_id);

CREATE INDEX IF NOT EXISTS idx_delivery_logs_subscription
  ON notification_delivery_logs(subscription_id);

CREATE INDEX IF NOT EXISTS idx_delivery_logs_created_at
  ON notification_delivery_logs(created_at DESC);

-- Index for rate limiting queries
CREATE INDEX IF NOT EXISTS idx_delivery_logs_sub_created
  ON notification_delivery_logs(subscription_id, created_at DESC);

-- 2. Add tracking columns to push_subscriptions
ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failure_count INTEGER DEFAULT 0;

-- Index for finding subscriptions with failures
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_failure_count
  ON push_subscriptions(failure_count)
  WHERE failure_count > 0;

-- Comments for documentation
COMMENT ON TABLE notification_delivery_logs IS
  'Tracks Web Push notification delivery attempts, successes, and failures';

COMMENT ON COLUMN notification_delivery_logs.status IS
  'Delivery status: success, failure, or retrying';

COMMENT ON COLUMN push_subscriptions.last_sent_at IS
  'Timestamp of the last successful push notification sent to this subscription';

COMMENT ON COLUMN push_subscriptions.failure_count IS
  'Number of consecutive delivery failures. Auto-deletes subscription after 5 failures.';
