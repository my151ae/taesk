CREATE TABLE IF NOT EXISTS public.reminders_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id UUID NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
  board_id UUID NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reminder_kind TEXT NOT NULL CHECK (reminder_kind IN ('start', 'end')),
  remind_minutes INTEGER NOT NULL CHECK (remind_minutes IN (0, 5, 10, 15, 30, 60)),
  due_at TIMESTAMPTZ NOT NULL,
  target_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'processed', 'skipped', 'canceled', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  last_error TEXT,
  processing_started_at TIMESTAMPTZ,
  config_version TIMESTAMPTZ NOT NULL,
  dedupe_key TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reminders_queue_dedupe_key_unique UNIQUE (dedupe_key)
);

ALTER TABLE public.reminders_queue DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_reminders_pending_target_at
  ON public.reminders_queue(target_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_reminders_pending_retry
  ON public.reminders_queue(next_retry_at)
  WHERE status = 'pending' AND next_retry_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reminders_queue_card_id
  ON public.reminders_queue(card_id);

CREATE OR REPLACE FUNCTION public.set_reminders_queue_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reminders_queue_set_updated_at ON public.reminders_queue;
CREATE TRIGGER reminders_queue_set_updated_at
  BEFORE UPDATE ON public.reminders_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.set_reminders_queue_updated_at();

COMMENT ON TABLE public.reminders_queue IS 'Precomputed reminder jobs for START/END notifications.';
COMMENT ON COLUMN public.reminders_queue.dedupe_key IS 'Queue-level dedupe key based on recipient/card/kind/target epoch.';
