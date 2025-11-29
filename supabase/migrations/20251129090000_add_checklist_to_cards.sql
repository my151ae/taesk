-- Add structured checklist content and remove legacy description text
ALTER TABLE public.cards
  ADD COLUMN IF NOT EXISTS checklist jsonb
    DEFAULT jsonb_build_object('version', 1, 'lines', '[]'::jsonb)
    NOT NULL;

UPDATE public.cards
  SET checklist = jsonb_build_object('version', 1, 'lines', '[]'::jsonb)
  WHERE checklist IS NULL;

COMMENT ON COLUMN public.cards.checklist IS 'Structured checklist content for inline editing (versioned JSON).';

-- Drop legacy description field (Notion風チェックリストへ移行)
ALTER TABLE public.cards DROP COLUMN IF EXISTS description;
