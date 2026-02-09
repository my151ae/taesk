CREATE OR REPLACE FUNCTION public.build_due_reminder_dedupe_key(
  p_recipient_id UUID,
  p_card_id UUID,
  p_kind TEXT,
  p_target_at TIMESTAMPTZ
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT format(
    'due_soon:%s:%s:%s:%s',
    p_recipient_id::text,
    p_card_id::text,
    p_kind,
    extract(epoch FROM p_target_at)::bigint
  );
$$;

CREATE OR REPLACE FUNCTION public.compute_due_at_jst(
  p_due_date TIMESTAMPTZ,
  p_due_time TIME WITHOUT TIME ZONE
)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
AS $$
  SELECT ((timezone('Asia/Tokyo', p_due_date)::date)::timestamp + p_due_time) AT TIME ZONE 'Asia/Tokyo';
$$;

CREATE OR REPLACE FUNCTION public.sync_card_reminders(p_card_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_card RECORD;
  v_recipients UUID[] := ARRAY[]::UUID[];
  v_recipient UUID;
  v_kind TEXT;
  v_minutes INTEGER;
  v_due_time TIME WITHOUT TIME ZONE;
  v_due_at TIMESTAMPTZ;
  v_target_at TIMESTAMPTZ;
  v_dedupe_key TEXT;
BEGIN
  UPDATE public.reminders_queue
  SET
    status = 'canceled',
    processing_started_at = NULL,
    last_error = COALESCE(last_error, 'canceled_by_card_update'),
    updated_at = NOW()
  WHERE card_id = p_card_id
    AND status IN ('pending', 'failed');

  SELECT
    id,
    board_id,
    user_id,
    assignee_id,
    assignee_ids,
    title,
    short_id,
    slug,
    due_date,
    due_start,
    due_end,
    start_reminder_enabled,
    start_reminder_minutes,
    end_reminder_enabled,
    end_reminder_minutes,
    updated_at
  INTO v_card
  FROM public.cards
  WHERE id = p_card_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_card.due_date IS NULL THEN
    RETURN;
  END IF;

  IF v_card.assignee_ids IS NOT NULL AND COALESCE(array_length(v_card.assignee_ids, 1), 0) > 0 THEN
    v_recipients := v_card.assignee_ids;
  ELSIF v_card.assignee_id IS NOT NULL THEN
    v_recipients := ARRAY[v_card.assignee_id];
  ELSIF v_card.user_id IS NOT NULL THEN
    v_recipients := ARRAY[v_card.user_id];
  END IF;

  IF COALESCE(array_length(v_recipients, 1), 0) = 0 THEN
    RETURN;
  END IF;

  FOR v_kind IN SELECT unnest(ARRAY['start', 'end']) LOOP
    IF v_kind = 'start' THEN
      IF NOT v_card.start_reminder_enabled OR v_card.due_start IS NULL THEN
        CONTINUE;
      END IF;
      v_minutes := v_card.start_reminder_minutes;
      v_due_time := v_card.due_start;
    ELSE
      IF NOT v_card.end_reminder_enabled OR v_card.due_end IS NULL THEN
        CONTINUE;
      END IF;
      v_minutes := v_card.end_reminder_minutes;
      v_due_time := v_card.due_end;
    END IF;

    v_due_at := public.compute_due_at_jst(v_card.due_date, v_due_time);
    v_target_at := v_due_at - make_interval(mins => v_minutes);

    FOREACH v_recipient IN ARRAY v_recipients LOOP
      v_dedupe_key := public.build_due_reminder_dedupe_key(v_recipient, v_card.id, v_kind, v_target_at);

      INSERT INTO public.reminders_queue (
        card_id,
        board_id,
        recipient_id,
        reminder_kind,
        remind_minutes,
        due_at,
        target_at,
        status,
        attempts,
        next_retry_at,
        last_error,
        processing_started_at,
        config_version,
        dedupe_key,
        payload
      ) VALUES (
        v_card.id,
        v_card.board_id,
        v_recipient,
        v_kind,
        v_minutes,
        v_due_at,
        v_target_at,
        'pending',
        0,
        NULL,
        NULL,
        NULL,
        v_card.updated_at,
        v_dedupe_key,
        jsonb_build_object(
          'card_title', v_card.title,
          'card_short_id', v_card.short_id,
          'card_slug', v_card.slug,
          'reminder_kind', v_kind,
          'remind_minutes', v_minutes,
          'due_at', v_due_at,
          'target_at', v_target_at
        )
      )
      ON CONFLICT (dedupe_key) DO UPDATE
      SET
        card_id = EXCLUDED.card_id,
        board_id = EXCLUDED.board_id,
        recipient_id = EXCLUDED.recipient_id,
        reminder_kind = EXCLUDED.reminder_kind,
        remind_minutes = EXCLUDED.remind_minutes,
        due_at = EXCLUDED.due_at,
        target_at = EXCLUDED.target_at,
        status = 'pending',
        attempts = 0,
        next_retry_at = NULL,
        last_error = NULL,
        processing_started_at = NULL,
        config_version = EXCLUDED.config_version,
        payload = EXCLUDED.payload,
        updated_at = NOW();
    END LOOP;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_card_reminders_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.sync_card_reminders(OLD.id);
    RETURN OLD;
  END IF;

  PERFORM public.sync_card_reminders(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cards_sync_reminders_upsert ON public.cards;
CREATE TRIGGER cards_sync_reminders_upsert
AFTER INSERT OR UPDATE OF
  due_date,
  due_start,
  due_end,
  start_reminder_enabled,
  start_reminder_minutes,
  end_reminder_enabled,
  end_reminder_minutes,
  assignee_ids,
  assignee_id,
  user_id,
  updated_at
ON public.cards
FOR EACH ROW
EXECUTE FUNCTION public.sync_card_reminders_trigger();

DROP TRIGGER IF EXISTS cards_sync_reminders_delete ON public.cards;
CREATE TRIGGER cards_sync_reminders_delete
AFTER DELETE ON public.cards
FOR EACH ROW
EXECUTE FUNCTION public.sync_card_reminders_trigger();

CREATE OR REPLACE FUNCTION public.claim_reminders(p_batch_size INTEGER DEFAULT 100)
RETURNS SETOF public.reminders_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_batch_size INTEGER := GREATEST(1, LEAST(COALESCE(p_batch_size, 100), 500));
BEGIN
  UPDATE public.reminders_queue
  SET
    status = 'pending',
    attempts = attempts + 1,
    next_retry_at = NOW() + INTERVAL '1 minute',
    last_error = 'processing lease expired',
    processing_started_at = NULL,
    updated_at = NOW()
  WHERE status = 'processing'
    AND processing_started_at IS NOT NULL
    AND processing_started_at < NOW() - INTERVAL '10 minutes';

  UPDATE public.reminders_queue
  SET
    status = 'skipped',
    last_error = 'missed_window',
    processing_started_at = NULL,
    updated_at = NOW()
  WHERE status = 'pending'
    AND target_at < NOW() - INTERVAL '15 minutes';

  RETURN QUERY
  WITH candidates AS (
    SELECT id
    FROM public.reminders_queue
    WHERE status = 'pending'
      AND target_at <= NOW()
      AND target_at >= NOW() - INTERVAL '15 minutes'
      AND (next_retry_at IS NULL OR next_retry_at <= NOW())
    ORDER BY target_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT v_batch_size
  )
  UPDATE public.reminders_queue q
  SET
    status = 'processing',
    processing_started_at = NOW(),
    updated_at = NOW()
  FROM candidates c
  WHERE q.id = c.id
  RETURNING q.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_reminders(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_reminders(INTEGER) TO service_role;
