-- Add due_* scheduling columns for Timeline MVP

ALTER TABLE public.cards
  ADD COLUMN IF NOT EXISTS due_start TIME WITHOUT TIME ZONE,
  ADD COLUMN IF NOT EXISTS due_end TIME WITHOUT TIME ZONE,
  ADD COLUMN IF NOT EXISTS due_channel TEXT NOT NULL DEFAULT 'list-only',
  ADD COLUMN IF NOT EXISTS due_bucket TEXT;

ALTER TABLE public.cards
  ADD CONSTRAINT cards_due_channel_check
    CHECK (due_channel IN ('timeline', 'ab-list', 'list-only', 'archived'));

ALTER TABLE public.cards
  ADD CONSTRAINT cards_due_bucket_check
    CHECK (
      due_bucket IS NULL
      OR due_bucket IN ('today_a', 'today_b', 'tomorrow_a', 'tomorrow_b')
    );

CREATE INDEX IF NOT EXISTS idx_cards_board_due_date
  ON public.cards (board_id, due_date);

COMMENT ON COLUMN public.cards.due_start IS 'Optional start time for timeline scheduling (minutes resolution).';
COMMENT ON COLUMN public.cards.due_end IS 'Optional end time for timeline scheduling (minutes resolution).';
COMMENT ON COLUMN public.cards.due_channel IS 'Placement context for the card (timeline, ab-list, list-only, archived).';
COMMENT ON COLUMN public.cards.due_bucket IS 'Bucket identifier for A/B sections such as today_a or tomorrow_b.';
