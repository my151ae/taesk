-- Phase 2: Reorder transaction functions with advisory locks + CTE bulk updates

-- Function: reorder_cards_tx
-- Atomically updates card positions (and optionally list_id) with advisory lock
CREATE OR REPLACE FUNCTION reorder_cards_tx(
  p_board_id UUID,
  p_lock_key INTEGER,
  p_updates JSONB
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_updated_count INTEGER := 0;
  v_update JSONB;
BEGIN
  -- Acquire advisory lock for the board (transaction-scoped)
  PERFORM pg_advisory_xact_lock(p_lock_key);

  -- Bulk update using CTE
  WITH updates_cte AS (
    SELECT
      (value->>'id')::UUID AS id,
      (value->>'position')::INTEGER AS position,
      CASE
        WHEN value->>'list_id' IS NOT NULL AND value->>'list_id' != 'null'
        THEN (value->>'list_id')::UUID
        ELSE NULL
      END AS list_id
    FROM jsonb_array_elements(p_updates)
  )
  UPDATE cards c
  SET
    position = u.position,
    list_id = COALESCE(u.list_id, c.list_id), -- only update if provided
    updated_at = NOW()
  FROM updates_cte u
  WHERE c.id = u.id AND c.board_id = p_board_id;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  RETURN jsonb_build_object('updated_count', v_updated_count);
END;
$$;

-- Function: reorder_lists_tx
-- Atomically updates list positions with advisory lock
CREATE OR REPLACE FUNCTION reorder_lists_tx(
  p_board_id UUID,
  p_lock_key INTEGER,
  p_updates JSONB
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_updated_count INTEGER := 0;
BEGIN
  -- Acquire advisory lock for the board (transaction-scoped)
  PERFORM pg_advisory_xact_lock(p_lock_key);

  -- Bulk update using CTE
  WITH updates_cte AS (
    SELECT
      (value->>'id')::UUID AS id,
      (value->>'position')::INTEGER AS position
    FROM jsonb_array_elements(p_updates)
  )
  UPDATE lists l
  SET
    position = u.position,
    updated_at = NOW()
  FROM updates_cte u
  WHERE l.id = u.id AND l.board_id = p_board_id;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  RETURN jsonb_build_object('updated_count', v_updated_count);
END;
$$;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION reorder_cards_tx TO authenticated;
GRANT EXECUTE ON FUNCTION reorder_lists_tx TO authenticated;
