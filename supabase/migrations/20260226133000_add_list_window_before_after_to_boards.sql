-- Add list window before/after columns and backfill from legacy list_range.
ALTER TABLE boards
  ADD COLUMN IF NOT EXISTS list_window_before_days integer,
  ADD COLUMN IF NOT EXISTS list_window_after_days integer;

UPDATE boards
SET
  list_window_before_days = CASE
    WHEN COALESCE(list_range, 30) = 31 THEN 15
    WHEN COALESCE(list_range, 30) >= 90 THEN 0
    WHEN COALESCE(list_range, 30) >= 60 THEN 0
    ELSE 0
  END,
  list_window_after_days = CASE
    WHEN COALESCE(list_range, 30) = 31 THEN 15
    WHEN COALESCE(list_range, 30) >= 90 THEN 89
    WHEN COALESCE(list_range, 30) >= 60 THEN 59
    ELSE 29
  END
WHERE list_window_before_days IS NULL OR list_window_after_days IS NULL;

ALTER TABLE boards
  ALTER COLUMN list_window_before_days SET DEFAULT 15,
  ALTER COLUMN list_window_after_days SET DEFAULT 15;

UPDATE boards
SET
  list_window_before_days = COALESCE(list_window_before_days, 15),
  list_window_after_days = COALESCE(list_window_after_days, 15);

ALTER TABLE boards
  ALTER COLUMN list_window_before_days SET NOT NULL,
  ALTER COLUMN list_window_after_days SET NOT NULL;

ALTER TABLE boards DROP CONSTRAINT IF EXISTS boards_list_window_non_negative_chk;
ALTER TABLE boards DROP CONSTRAINT IF EXISTS boards_list_window_max_range_chk;

ALTER TABLE boards
  ADD CONSTRAINT boards_list_window_non_negative_chk
    CHECK (list_window_before_days >= 0 AND list_window_after_days >= 0),
  ADD CONSTRAINT boards_list_window_max_range_chk
    CHECK (list_window_before_days + list_window_after_days + 1 <= 120);

-- Keep legacy list_range synchronized as derived value.
UPDATE boards
SET list_range = list_window_before_days + list_window_after_days + 1;
