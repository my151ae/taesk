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
    RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'TEAM_REQUIRED', 'message', 'Board requires a team');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.team_members tm
    WHERE tm.team_id = v_board_team_id
      AND tm.profile_id = v_user_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'TEAM_MEMBERSHIP_REQUIRED', 'message', 'Join the team before accessing this board');
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
  SET accepted_at = now(),
      updated_at = now()
  WHERE id = v_invite.id;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 200,
    'board_id', v_invite.board_id,
    'role', v_next_role
  );
END;
$$;
