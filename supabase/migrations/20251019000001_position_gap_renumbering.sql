-- Position gap strategy + renumbering functions

-- Function: renumber_card_positions
-- Renumbers all cards in a list with gap strategy (1000, 1010, 1020, ...)
CREATE OR REPLACE FUNCTION renumber_card_positions(
  p_board_id UUID,
  p_list_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_updated_count INTEGER := 0;
  v_card_record RECORD;
  v_new_position INTEGER := 1000;
  v_gap INTEGER := 10;
BEGIN
  -- Lock all cards in the list for update
  FOR v_card_record IN
    SELECT id
    FROM cards
    WHERE board_id = p_board_id AND list_id = p_list_id
    ORDER BY position ASC, created_at ASC
    FOR UPDATE
  LOOP
    UPDATE cards
    SET position = v_new_position, updated_at = NOW()
    WHERE id = v_card_record.id;

    v_new_position := v_new_position + v_gap;
    v_updated_count := v_updated_count + 1;
  END LOOP;

  RETURN jsonb_build_object('updated_count', v_updated_count);
END;
$$;

-- Function: renumber_list_positions
-- Renumbers all lists in a board with gap strategy (1000, 1010, 1020, ...)
CREATE OR REPLACE FUNCTION renumber_list_positions(
  p_board_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_updated_count INTEGER := 0;
  v_list_record RECORD;
  v_new_position INTEGER := 1000;
  v_gap INTEGER := 10;
BEGIN
  -- Lock all lists in the board for update
  FOR v_list_record IN
    SELECT id
    FROM lists
    WHERE board_id = p_board_id
    ORDER BY position ASC, created_at ASC
    FOR UPDATE
  LOOP
    UPDATE lists
    SET position = v_new_position, updated_at = NOW()
    WHERE id = v_list_record.id;

    v_new_position := v_new_position + v_gap;
    v_updated_count := v_updated_count + 1;
  END LOOP;

  RETURN jsonb_build_object('updated_count', v_updated_count);
END;
$$;

-- Function: detect_position_density
-- Detects if positions are too dense (gap <= 2) in a list/board
CREATE OR REPLACE FUNCTION detect_position_density(
  p_board_id UUID,
  p_list_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_min_gap INTEGER;
  v_needs_renumber BOOLEAN := false;
  v_threshold INTEGER := 2;
BEGIN
  IF p_list_id IS NOT NULL THEN
    -- Check card positions in a specific list
    SELECT MIN(next_pos - position) INTO v_min_gap
    FROM (
      SELECT position, LEAD(position) OVER (ORDER BY position) AS next_pos
      FROM cards
      WHERE board_id = p_board_id AND list_id = p_list_id
    ) t
    WHERE next_pos IS NOT NULL;
  ELSE
    -- Check list positions in a board
    SELECT MIN(next_pos - position) INTO v_min_gap
    FROM (
      SELECT position, LEAD(position) OVER (ORDER BY position) AS next_pos
      FROM lists
      WHERE board_id = p_board_id
    ) t
    WHERE next_pos IS NOT NULL;
  END IF;

  IF v_min_gap IS NOT NULL AND v_min_gap <= v_threshold THEN
    v_needs_renumber := true;
  END IF;

  RETURN jsonb_build_object(
    'needs_renumber', v_needs_renumber,
    'min_gap', COALESCE(v_min_gap, -1)
  );
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION renumber_card_positions TO authenticated;
GRANT EXECUTE ON FUNCTION renumber_list_positions TO authenticated;
GRANT EXECUTE ON FUNCTION detect_position_density TO authenticated;
