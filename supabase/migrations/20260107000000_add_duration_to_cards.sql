-- Add duration column to cards table
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS duration INTEGER DEFAULT 60;
COMMENT ON COLUMN public.cards.duration IS '所要時間（分単位）';
