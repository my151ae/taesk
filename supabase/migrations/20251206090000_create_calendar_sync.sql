-- Calendar sync table for Taesk → Google Calendar write synchronization (v2)
-- Tracks the relationship between Taesk cards and Google Calendar events

CREATE TABLE IF NOT EXISTS calendar_sync (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  google_account_id UUID NOT NULL REFERENCES google_calendar_accounts(id) ON DELETE CASCADE,
  google_event_id TEXT,              -- NULL until event is created
  calendar_id TEXT NOT NULL,         -- Actual calendar ID (not 'primary' alias)
  etag TEXT,                         -- Optimistic locking (Google event ETag)
  status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'unlinked' | 'deleted'
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(card_id, google_account_id)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_calendar_sync_card ON calendar_sync(card_id);
CREATE INDEX IF NOT EXISTS idx_calendar_sync_account ON calendar_sync(google_account_id);

-- Enable Row Level Security
ALTER TABLE calendar_sync ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only access their own sync records (via google_calendar_accounts)
CREATE POLICY "Users can read own calendar sync"
  ON calendar_sync FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM google_calendar_accounts gca
      WHERE gca.id = calendar_sync.google_account_id
        AND gca.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own calendar sync"
  ON calendar_sync FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM google_calendar_accounts gca
      WHERE gca.id = calendar_sync.google_account_id
        AND gca.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own calendar sync"
  ON calendar_sync FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM google_calendar_accounts gca
      WHERE gca.id = calendar_sync.google_account_id
        AND gca.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own calendar sync"
  ON calendar_sync FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM google_calendar_accounts gca
      WHERE gca.id = calendar_sync.google_account_id
        AND gca.user_id = auth.uid()
    )
  );

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION set_calendar_sync_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS calendar_sync_set_updated_at ON calendar_sync;
CREATE TRIGGER calendar_sync_set_updated_at
  BEFORE UPDATE ON calendar_sync
  FOR EACH ROW
  EXECUTE FUNCTION set_calendar_sync_updated_at();

-- Comments for documentation
COMMENT ON TABLE calendar_sync IS 'Tracks Taesk card to Google Calendar event synchronization (v2 write sync)';
COMMENT ON COLUMN calendar_sync.card_id IS 'Reference to the Taesk card';
COMMENT ON COLUMN calendar_sync.google_account_id IS 'Reference to the Google account used for sync';
COMMENT ON COLUMN calendar_sync.google_event_id IS 'Google Calendar event ID (null until created)';
COMMENT ON COLUMN calendar_sync.calendar_id IS 'Actual Google Calendar ID (not primary alias)';
COMMENT ON COLUMN calendar_sync.etag IS 'Google event ETag for optimistic locking';
COMMENT ON COLUMN calendar_sync.status IS 'Sync status: active, unlinked, or deleted';
COMMENT ON COLUMN calendar_sync.last_synced_at IS 'Timestamp of last successful sync';
