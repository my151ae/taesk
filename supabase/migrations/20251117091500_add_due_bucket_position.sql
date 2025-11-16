-- Add ordering support for A/B buckets

ALTER TABLE public.cards
  ADD COLUMN IF NOT EXISTS due_bucket_position DOUBLE PRECISION;

COMMENT ON COLUMN public.cards.due_bucket_position IS 'Ordering hint for cards inside due_bucket sections (higher = newer).';

CREATE INDEX IF NOT EXISTS idx_cards_due_bucket_position
  ON public.cards (due_bucket, due_bucket_position DESC NULLS LAST);
