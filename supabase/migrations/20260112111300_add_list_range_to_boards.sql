-- Add list_range column to boards table
ALTER TABLE boards ADD COLUMN IF NOT EXISTS list_range integer DEFAULT 30;
