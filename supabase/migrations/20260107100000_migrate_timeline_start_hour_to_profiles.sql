-- Remove timeline_start_hour from boards
ALTER TABLE boards DROP COLUMN IF EXISTS timeline_start_hour;

-- Add timeline_start_hour to profiles with default 5 (5:00)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS timeline_start_hour integer DEFAULT 5;
