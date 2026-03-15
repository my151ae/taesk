CREATE TABLE IF NOT EXISTS public.pending_board_access_invites (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  board_id uuid NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  team_invite_id uuid NULL REFERENCES public.team_invites(id) ON DELETE SET NULL,
  email text NOT NULL,
  normalized_email text NOT NULL,
  board_role public.member_role NOT NULL,
  invited_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'revoked')),
  accepted_at timestamptz NULL,
  revoked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pending_board_access_invites_role_not_owner CHECK (board_role <> 'owner'),
  CONSTRAINT pending_board_access_invites_normalized_email_check
    CHECK (normalized_email = public.normalize_email(email))
);

CREATE INDEX IF NOT EXISTS idx_pending_board_access_invites_board
  ON public.pending_board_access_invites (board_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pending_board_access_invites_team_email
  ON public.pending_board_access_invites (team_id, normalized_email);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_board_access_invites_pending_unique
  ON public.pending_board_access_invites (team_id, board_id, normalized_email)
  WHERE status = 'pending' AND accepted_at IS NULL AND revoked_at IS NULL;

DROP TRIGGER IF EXISTS trg_pending_board_access_invites_touch_updated_at ON public.pending_board_access_invites;
CREATE TRIGGER trg_pending_board_access_invites_touch_updated_at
BEFORE UPDATE ON public.pending_board_access_invites
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.pending_board_access_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Team admins can read pending board access invites" ON public.pending_board_access_invites;
CREATE POLICY "Team admins can read pending board access invites"
  ON public.pending_board_access_invites
  FOR SELECT
  TO authenticated
  USING (public.has_team_role(team_id, ARRAY['owner','admin']::public.team_role[]));

DROP POLICY IF EXISTS "Team admins can create pending board access invites" ON public.pending_board_access_invites;
CREATE POLICY "Team admins can create pending board access invites"
  ON public.pending_board_access_invites
  FOR INSERT
  TO authenticated
  WITH CHECK (
    board_role <> 'owner'
    AND public.has_team_role(team_id, ARRAY['owner','admin']::public.team_role[])
  );

DROP POLICY IF EXISTS "Team admins can update pending board access invites" ON public.pending_board_access_invites;
CREATE POLICY "Team admins can update pending board access invites"
  ON public.pending_board_access_invites
  FOR UPDATE
  TO authenticated
  USING (public.has_team_role(team_id, ARRAY['owner','admin']::public.team_role[]))
  WITH CHECK (public.has_team_role(team_id, ARRAY['owner','admin']::public.team_role[]));

DROP POLICY IF EXISTS "Team admins can delete pending board access invites" ON public.pending_board_access_invites;
CREATE POLICY "Team admins can delete pending board access invites"
  ON public.pending_board_access_invites
  FOR DELETE
  TO authenticated
  USING (public.has_team_role(team_id, ARRAY['owner','admin']::public.team_role[]));

DROP POLICY IF EXISTS "Owners can create board invites" ON public.board_invites;
DROP POLICY IF EXISTS "Owners can update board invites" ON public.board_invites;
DROP POLICY IF EXISTS "Owners can delete board invites" ON public.board_invites;
DROP POLICY IF EXISTS "Owners and editors can create board invites" ON public.board_invites;
DROP POLICY IF EXISTS "Owners and editors can update board invites" ON public.board_invites;
DROP POLICY IF EXISTS "Owners and editors can delete board invites" ON public.board_invites;

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

DROP TRIGGER IF EXISTS trg_sync_team_member_from_board_member ON public.board_members;
DROP TRIGGER IF EXISTS trg_validate_team_membership_for_board_member ON public.board_members;
CREATE TRIGGER trg_validate_team_membership_for_board_member
BEFORE INSERT OR UPDATE OF board_id, profile_id ON public.board_members
FOR EACH ROW
EXECUTE FUNCTION public.validate_team_membership_for_board_member();

DROP FUNCTION IF EXISTS public.ensure_team_membership_for_board_member();

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

DROP TRIGGER IF EXISTS trg_prevent_last_board_owner_team_removal ON public.team_members;
CREATE TRIGGER trg_prevent_last_board_owner_team_removal
BEFORE DELETE ON public.team_members
FOR EACH ROW
EXECUTE FUNCTION public.prevent_last_board_owner_team_removal();

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

DROP TRIGGER IF EXISTS trg_cleanup_board_members_for_team_member ON public.team_members;
CREATE TRIGGER trg_cleanup_board_members_for_team_member
AFTER DELETE ON public.team_members
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_board_members_for_team_member();

CREATE OR REPLACE FUNCTION public.consume_pending_board_access_invites(
  p_team_id uuid,
  p_email text,
  p_profile_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.pending_board_access_invites%ROWTYPE;
  v_existing_role public.member_role;
  v_next_role public.member_role;
  v_count integer := 0;
BEGIN
  FOR v_row IN
    SELECT *
    FROM public.pending_board_access_invites
    WHERE team_id = p_team_id
      AND normalized_email = public.normalize_email(p_email)
      AND status = 'pending'
      AND accepted_at IS NULL
      AND revoked_at IS NULL
    ORDER BY created_at ASC
    FOR UPDATE
  LOOP
    SELECT bm.role INTO v_existing_role
    FROM public.board_members bm
    WHERE bm.board_id = v_row.board_id
      AND bm.profile_id = p_profile_id;

    IF v_existing_role IS NULL THEN
      v_next_role := v_row.board_role;
    ELSIF public.member_role_rank(v_existing_role) >= public.member_role_rank(v_row.board_role) THEN
      v_next_role := v_existing_role;
    ELSE
      v_next_role := v_row.board_role;
    END IF;

    INSERT INTO public.board_members (board_id, profile_id, role)
    VALUES (v_row.board_id, p_profile_id, v_next_role)
    ON CONFLICT (board_id, profile_id)
    DO UPDATE SET role = EXCLUDED.role;

    UPDATE public.pending_board_access_invites
    SET status = 'accepted',
        accepted_at = now(),
        revoked_at = NULL,
        updated_at = now()
    WHERE id = v_row.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_team_invite(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash text;
  v_user_id uuid;
  v_email text;
  v_invite public.team_invites%ROWTYPE;
  v_existing_role public.team_role;
  v_next_role public.team_role;
  v_consumed integer := 0;
BEGIN
  v_user_id := auth.uid();
  v_email := public.normalize_email(auth.jwt() ->> 'email');

  IF v_user_id IS NULL OR v_email = '' THEN
    RETURN jsonb_build_object('ok', false, 'status', 401, 'code', 'UNAUTHENTICATED', 'message', 'Login required');
  END IF;

  v_hash := encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');

  SELECT * INTO v_invite
  FROM public.team_invites ti
  WHERE ti.token_hash = v_hash
  ORDER BY ti.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'status', 404, 'code', 'NOT_FOUND', 'message', 'Invite not found');
  END IF;

  IF v_invite.accepted_at IS NOT NULL OR v_invite.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'CONFLICT', 'message', 'Invite already used');
  END IF;

  IF v_invite.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'status', 410, 'code', 'GONE', 'message', 'Invite expired');
  END IF;

  IF v_invite.email_normalized IS DISTINCT FROM v_email THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'code', 'FORBIDDEN', 'message', 'Invite email mismatch');
  END IF;

  SELECT tm.role INTO v_existing_role
  FROM public.team_members tm
  WHERE tm.team_id = v_invite.team_id
    AND tm.profile_id = v_user_id;

  IF v_existing_role IS NULL THEN
    v_next_role := v_invite.role;
  ELSIF public.team_role_rank(v_existing_role) >= public.team_role_rank(v_invite.role) THEN
    v_next_role := v_existing_role;
  ELSE
    v_next_role := v_invite.role;
  END IF;

  INSERT INTO public.team_members (team_id, profile_id, role)
  VALUES (v_invite.team_id, v_user_id, v_next_role)
  ON CONFLICT (team_id, profile_id)
  DO UPDATE SET role = EXCLUDED.role;

  v_consumed := public.consume_pending_board_access_invites(v_invite.team_id, v_email, v_user_id);

  UPDATE public.team_invites
  SET accepted_at = now(),
      updated_at = now()
  WHERE id = v_invite.id;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 200,
    'team_id', v_invite.team_id,
    'role', v_next_role,
    'consumed_board_accesses', v_consumed
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_board_invite(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash text;
  v_user_id uuid;
  v_email text;
  v_invite public.board_invites%ROWTYPE;
  v_board_team_id uuid;
  v_existing_role public.member_role;
  v_next_role public.member_role;
BEGIN
  v_user_id := auth.uid();
  v_email := public.normalize_email(auth.jwt() ->> 'email');

  IF v_user_id IS NULL OR v_email = '' THEN
    RETURN jsonb_build_object('ok', false, 'status', 401, 'code', 'UNAUTHENTICATED', 'message', 'Login required');
  END IF;

  v_hash := encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');

  SELECT * INTO v_invite
  FROM public.board_invites bi
  WHERE bi.token_hash = v_hash
  ORDER BY bi.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'status', 404, 'code', 'NOT_FOUND', 'message', 'Invite not found');
  END IF;

  IF v_invite.accepted_at IS NOT NULL OR v_invite.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'CONFLICT', 'message', 'Invite already used');
  END IF;

  IF v_invite.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'status', 410, 'code', 'GONE', 'message', 'Invite expired');
  END IF;

  IF v_invite.email_normalized IS DISTINCT FROM v_email THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'code', 'FORBIDDEN', 'message', 'Invite email mismatch');
  END IF;

  IF v_invite.role = 'owner' THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'CONFLICT', 'message', 'Owner role via invite is not allowed');
  END IF;

  SELECT b.team_id INTO v_board_team_id
  FROM public.boards b
  WHERE b.id = v_invite.board_id;

  IF v_board_team_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'BOARD_TEAM_REQUIRED', 'message', 'Board must belong to a team before invite acceptance');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.team_members tm
    WHERE tm.team_id = v_board_team_id
      AND tm.profile_id = v_user_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'TEAM_MEMBERSHIP_REQUIRED', 'message', 'User must join the team before board access can be granted.' );
  END IF;

  SELECT bm.role INTO v_existing_role
  FROM public.board_members bm
  WHERE bm.board_id = v_invite.board_id
    AND bm.profile_id = v_user_id;

  IF v_existing_role IS NULL THEN
    v_next_role := v_invite.role;
  ELSIF public.member_role_rank(v_existing_role) >= public.member_role_rank(v_invite.role) THEN
    v_next_role := v_existing_role;
  ELSE
    v_next_role := v_invite.role;
  END IF;

  INSERT INTO public.board_members (board_id, profile_id, role)
  VALUES (v_invite.board_id, v_user_id, v_next_role)
  ON CONFLICT (board_id, profile_id)
  DO UPDATE SET role = EXCLUDED.role;

  UPDATE public.board_invites
  SET accepted_at = now()
  WHERE id = v_invite.id;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 200,
    'board_id', v_invite.board_id,
    'role', v_next_role
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_team_invite(p_team_id uuid, p_invite_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite public.team_invites%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 401, 'code', 'UNAUTHENTICATED', 'message', 'Login required');
  END IF;

  IF NOT public.has_team_role(p_team_id, ARRAY['owner','admin']::public.team_role[]) THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'code', 'FORBIDDEN', 'message', 'Insufficient permissions');
  END IF;

  SELECT * INTO v_invite
  FROM public.team_invites
  WHERE id = p_invite_id
    AND team_id = p_team_id
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

  UPDATE public.team_invites
  SET revoked_at = now(),
      updated_at = now()
  WHERE id = v_invite.id;

  UPDATE public.pending_board_access_invites
  SET status = 'revoked',
      revoked_at = now(),
      updated_at = now()
  WHERE team_invite_id = v_invite.id
    AND status = 'pending'
    AND accepted_at IS NULL;

  RETURN jsonb_build_object('ok', true, 'status', 200);
END;
$$;
