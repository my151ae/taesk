ALTER TABLE public.boards
  ADD COLUMN IF NOT EXISTS is_personal boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_boards_personal_team_unique
  ON public.boards (team_id)
  WHERE is_personal = true;

ALTER TABLE public.board_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners and editors can add board members" ON public.board_members;
CREATE POLICY "Owners can add board members"
  ON public.board_members
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.board_members bm
      WHERE bm.board_id = board_members.board_id
        AND bm.profile_id = auth.uid()
        AND bm.role = 'owner'
    )
  );

DROP POLICY IF EXISTS "Owners or self can remove board members" ON public.board_members;
CREATE POLICY "Owners can delete board members"
  ON public.board_members
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.board_members bm
      WHERE bm.board_id = board_members.board_id
        AND bm.profile_id = auth.uid()
        AND bm.role = 'owner'
    )
  );

ALTER TABLE public.board_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners and editors can read board invites" ON public.board_invites;
CREATE POLICY "Owners can read board invites"
  ON public.board_invites
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.board_members bm
      WHERE bm.board_id = board_invites.board_id
        AND bm.profile_id = auth.uid()
        AND bm.role = 'owner'
    )
  );

DROP POLICY IF EXISTS "Owners and editors can create board invites" ON public.board_invites;
CREATE POLICY "Owners can create board invites"
  ON public.board_invites
  FOR INSERT
  TO authenticated
  WITH CHECK (
    role <> 'owner'
    AND EXISTS (
      SELECT 1
      FROM public.board_members bm
      WHERE bm.board_id = board_invites.board_id
        AND bm.profile_id = auth.uid()
        AND bm.role = 'owner'
    )
  );

DROP POLICY IF EXISTS "Owners and editors can update board invites" ON public.board_invites;
CREATE POLICY "Owners can update board invites"
  ON public.board_invites
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.board_members bm
      WHERE bm.board_id = board_invites.board_id
        AND bm.profile_id = auth.uid()
        AND bm.role = 'owner'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.board_members bm
      WHERE bm.board_id = board_invites.board_id
        AND bm.profile_id = auth.uid()
        AND bm.role = 'owner'
    )
  );

DROP POLICY IF EXISTS "Owners and editors can delete board invites" ON public.board_invites;
CREATE POLICY "Owners can delete board invites"
  ON public.board_invites
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.board_members bm
      WHERE bm.board_id = board_invites.board_id
        AND bm.profile_id = auth.uid()
        AND bm.role = 'owner'
    )
  );

CREATE OR REPLACE FUNCTION public.revoke_board_invite(p_board_id uuid, p_invite_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite public.board_invites%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 401, 'code', 'UNAUTHENTICATED', 'message', 'Login required');
  END IF;

  IF NOT public.has_board_role(p_board_id, ARRAY['owner']::public.member_role[]) THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'code', 'FORBIDDEN', 'message', 'Insufficient permissions');
  END IF;

  SELECT * INTO v_invite
  FROM public.board_invites
  WHERE id = p_invite_id
    AND board_id = p_board_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'status', 404, 'code', 'NOT_FOUND', 'message', 'Invite not found');
  END IF;

  IF v_invite.accepted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'CONFLICT', 'message', 'Invite already accepted');
  END IF;

  IF v_invite.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'status', 200);
  END IF;

  UPDATE public.board_invites
  SET revoked_at = now()
  WHERE id = v_invite.id;

  RETURN jsonb_build_object('ok', true, 'status', 200);
END;
$$;
