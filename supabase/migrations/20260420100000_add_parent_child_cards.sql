ALTER TABLE public.cards
  ADD COLUMN IF NOT EXISTS parent_card_id uuid NULL,
  ADD COLUMN IF NOT EXISTS is_parent boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cards_parent_card_id_fkey'
      AND conrelid = 'public.cards'::regclass
  ) THEN
    ALTER TABLE public.cards
      ADD CONSTRAINT cards_parent_card_id_fkey
      FOREIGN KEY (parent_card_id)
      REFERENCES public.cards (id)
      ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cards_parent_not_self_check'
      AND conrelid = 'public.cards'::regclass
  ) THEN
    ALTER TABLE public.cards
      ADD CONSTRAINT cards_parent_not_self_check
      CHECK (parent_card_id IS NULL OR parent_card_id <> id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cards_parent_invariant_check'
      AND conrelid = 'public.cards'::regclass
  ) THEN
    ALTER TABLE public.cards
      ADD CONSTRAINT cards_parent_invariant_check
      CHECK (NOT (is_parent AND parent_card_id IS NOT NULL));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cards_board_parent_active
  ON public.cards (board_id, parent_card_id)
  WHERE deleted_at IS NULL;
