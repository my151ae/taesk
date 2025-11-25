-- Update bucket schema: remove due_channel, update due_bucket to 'a'/'b'

-- 1. Drop old constraints
ALTER TABLE public.cards DROP CONSTRAINT IF EXISTS cards_due_channel_check;
ALTER TABLE public.cards DROP CONSTRAINT IF EXISTS cards_due_bucket_check;

-- 2. Add temporary column for new bucket
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS due_bucket_new TEXT;

-- 3. Migrate data
UPDATE public.cards
SET due_bucket_new = CASE
  WHEN due_bucket IN ('today_a', 'tomorrow_a') THEN 'a'
  WHEN due_bucket IN ('today_b', 'tomorrow_b') THEN 'b'
  ELSE NULL -- Reset invalid or null buckets
END;

-- 4. Drop old columns and rename new one
ALTER TABLE public.cards DROP COLUMN IF EXISTS due_bucket;
ALTER TABLE public.cards RENAME COLUMN due_bucket_new TO due_bucket;
ALTER TABLE public.cards DROP COLUMN IF EXISTS due_channel;

-- 5. Add new constraint
ALTER TABLE public.cards
  ADD CONSTRAINT cards_due_bucket_check
    CHECK (due_bucket IS NULL OR due_bucket IN ('a', 'b'));

COMMENT ON COLUMN public.cards.due_bucket IS 'Bucket identifier for A/B sections (a or b).';
