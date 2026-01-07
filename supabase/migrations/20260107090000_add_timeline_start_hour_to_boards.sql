-- Add timeline_start_hour to boards table
ALTER TABLE boards ADD COLUMN IF NOT EXISTS timeline_start_hour INTEGER NOT NULL DEFAULT 0;

-- COMMENT ON COLUMN boards.timeline_start_hour IS 'The hour (0-23) at which the timeline starts for this board.';
