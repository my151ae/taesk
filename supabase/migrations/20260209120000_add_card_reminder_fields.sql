ALTER TABLE public.cards
  ADD COLUMN IF NOT EXISTS start_reminder_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS start_reminder_minutes INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS end_reminder_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS end_reminder_minutes INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.cards
  DROP CONSTRAINT IF EXISTS cards_start_reminder_minutes_check;

ALTER TABLE public.cards
  ADD CONSTRAINT cards_start_reminder_minutes_check
  CHECK (start_reminder_minutes IN (0, 5, 10, 15, 30, 60));

ALTER TABLE public.cards
  DROP CONSTRAINT IF EXISTS cards_end_reminder_minutes_check;

ALTER TABLE public.cards
  ADD CONSTRAINT cards_end_reminder_minutes_check
  CHECK (end_reminder_minutes IN (0, 5, 10, 15, 30, 60));

COMMENT ON COLUMN public.cards.start_reminder_enabled IS 'Whether reminder for due_start is enabled.';
COMMENT ON COLUMN public.cards.start_reminder_minutes IS 'Minutes before due_start to notify. Allowed values: 0,5,10,15,30,60.';
COMMENT ON COLUMN public.cards.end_reminder_enabled IS 'Whether reminder for due_end is enabled.';
COMMENT ON COLUMN public.cards.end_reminder_minutes IS 'Minutes before due_end to notify. Allowed values: 0,5,10,15,30,60.';
