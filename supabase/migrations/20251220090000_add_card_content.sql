ALTER TABLE cards
  ADD COLUMN content jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN excerpt text NOT NULL DEFAULT '';
