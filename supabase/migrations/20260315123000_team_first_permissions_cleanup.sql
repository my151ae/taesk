CREATE OR REPLACE FUNCTION public.validate_team_membership_for_board_member()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_team_id uuid;
BEGIN
  SELECT b.team_id INTO v_team_id
  FROM public.boards b
  WHERE b.id = NEW.board_id;

  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'BOARD_TEAM_REQUIRED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.team_members tm
    WHERE tm.team_id = v_team_id
      AND tm.profile_id = NEW.profile_id
  ) THEN
    RAISE EXCEPTION 'TEAM_MEMBERSHIP_REQUIRED';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_last_board_owner_team_removal()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_blocking_board_id uuid;
BEGIN
  SELECT bm.board_id
  INTO v_blocking_board_id
  FROM public.board_members bm
  JOIN public.boards b ON b.id = bm.board_id
  WHERE b.team_id = OLD.team_id
    AND bm.profile_id = OLD.profile_id
    AND bm.role = 'owner'
    AND NOT EXISTS (
      SELECT 1
      FROM public.board_members bm_other
      WHERE bm_other.board_id = bm.board_id
        AND bm_other.profile_id <> OLD.profile_id
        AND bm_other.role = 'owner'
    )
  LIMIT 1;

  IF v_blocking_board_id IS NOT NULL THEN
    RAISE EXCEPTION 'LAST_BOARD_OWNER_TRANSFER_REQUIRED';
  END IF;

  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_board_members_for_team_member()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.board_members bm
  USING public.boards b
  WHERE b.id = bm.board_id
    AND b.team_id = OLD.team_id
    AND bm.profile_id = OLD.profile_id;

  RETURN OLD;
END;
$$;

DROP FUNCTION IF EXISTS public.ensure_team_membership_for_board_member();
