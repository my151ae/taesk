-- Team upper-container model (v1.7)
-- This migration is written in forward-compatible steps to avoid hard failures on existing data.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'team_type') THEN
    CREATE TYPE public.team_type AS ENUM ('personal', 'ops', 'test', 'custom');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'team_role') THEN
    CREATE TYPE public.team_role AS ENUM ('owner', 'admin', 'member', 'guest');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE,
  team_type public.team_type NOT NULL DEFAULT 'custom',
  allow_member_create_board boolean NOT NULL DEFAULT false,
  personal_for_profile_id uuid NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (team_type = 'personal' AND personal_for_profile_id IS NOT NULL)
    OR (team_type <> 'personal' AND personal_for_profile_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS teams_personal_for_profile_id_unique
  ON public.teams (personal_for_profile_id)
  WHERE personal_for_profile_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.team_members (
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role public.team_role NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_profile_team
  ON public.team_members (profile_id, team_id);

CREATE INDEX IF NOT EXISTS idx_team_members_team_profile
  ON public.team_members (team_id, profile_id);

CREATE TABLE IF NOT EXISTS public.team_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  email text NOT NULL,
  email_normalized text NULL,
  role public.team_role NOT NULL DEFAULT 'guest',
  token_hash text NULL,
  invited_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz NULL,
  revoked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_team_invites_token_hash
  ON public.team_invites (token_hash);

CREATE INDEX IF NOT EXISTS idx_team_invites_expires_at
  ON public.team_invites (expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_team_invites_pending_unique
  ON public.team_invites (team_id, email_normalized)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

ALTER TABLE public.boards
  ADD COLUMN IF NOT EXISTS team_id uuid NULL REFERENCES public.teams(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_boards_team_created
  ON public.boards (team_id, created_at);

ALTER TABLE public.board_invites
  ADD COLUMN IF NOT EXISTS email_normalized text NULL,
  ADD COLUMN IF NOT EXISTS token_hash text NULL,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_board_invites_token_hash
  ON public.board_invites (token_hash);

CREATE INDEX IF NOT EXISTS idx_board_invites_expires_at
  ON public.board_invites (expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_board_invites_pending_unique
  ON public.board_invites (board_id, email_normalized)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'board_invites_role_not_owner'
      AND conrelid = 'public.board_invites'::regclass
  ) THEN
    ALTER TABLE public.board_invites
      ADD CONSTRAINT board_invites_role_not_owner CHECK (role <> 'owner') NOT VALID;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'team_invites_role_not_owner'
      AND conrelid = 'public.team_invites'::regclass
  ) THEN
    ALTER TABLE public.team_invites
      ADD CONSTRAINT team_invites_role_not_owner CHECK (role <> 'owner');
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.normalize_email(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(trim(coalesce(input, '')));
$$;

UPDATE public.team_invites
SET email_normalized = public.normalize_email(email)
WHERE email_normalized IS NULL;

UPDATE public.board_invites
SET email_normalized = public.normalize_email(email)
WHERE email_normalized IS NULL;

CREATE OR REPLACE FUNCTION public.member_role_rank(input public.member_role)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE input
    WHEN 'owner' THEN 4
    WHEN 'editor' THEN 3
    WHEN 'commenter' THEN 2
    WHEN 'viewer' THEN 1
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION public.team_role_rank(input public.team_role)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE input
    WHEN 'owner' THEN 4
    WHEN 'admin' THEN 3
    WHEN 'member' THEN 2
    WHEN 'guest' THEN 1
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION public.set_invite_normalized_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.email_normalized := public.normalize_email(NEW.email);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_team_invites_normalize ON public.team_invites;
CREATE TRIGGER trg_team_invites_normalize
BEFORE INSERT OR UPDATE ON public.team_invites
FOR EACH ROW
EXECUTE FUNCTION public.set_invite_normalized_fields();

DROP TRIGGER IF EXISTS trg_board_invites_normalize ON public.board_invites;
CREATE TRIGGER trg_board_invites_normalize
BEFORE INSERT OR UPDATE ON public.board_invites
FOR EACH ROW
EXECUTE FUNCTION public.set_invite_normalized_fields();

ALTER TABLE public.team_invites
  DROP CONSTRAINT IF EXISTS team_invites_email_normalized_check;
ALTER TABLE public.team_invites
  ADD CONSTRAINT team_invites_email_normalized_check
  CHECK (email_normalized = public.normalize_email(email));

ALTER TABLE public.board_invites
  DROP CONSTRAINT IF EXISTS board_invites_email_normalized_check;
ALTER TABLE public.board_invites
  ADD CONSTRAINT board_invites_email_normalized_check
  CHECK (email_normalized = public.normalize_email(email));

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_teams_touch_updated_at ON public.teams;
CREATE TRIGGER trg_teams_touch_updated_at
BEFORE UPDATE ON public.teams
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_team_invites_touch_updated_at ON public.team_invites;
CREATE TRIGGER trg_team_invites_touch_updated_at
BEFORE UPDATE ON public.team_invites
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.prevent_board_team_id_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.team_id IS NOT NULL AND OLD.team_id IS DISTINCT FROM NEW.team_id THEN
    RAISE EXCEPTION 'board team_id is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_board_team_id_change ON public.boards;
CREATE TRIGGER trg_prevent_board_team_id_change
BEFORE UPDATE ON public.boards
FOR EACH ROW
EXECUTE FUNCTION public.prevent_board_team_id_change();

CREATE OR REPLACE FUNCTION public.ensure_team_membership_for_board_member()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_team_id uuid;
BEGIN
  SELECT b.team_id INTO v_team_id
  FROM public.boards b
  WHERE b.id = NEW.board_id;

  IF v_team_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.team_members (team_id, profile_id, role)
  VALUES (v_team_id, NEW.profile_id, 'guest')
  ON CONFLICT (team_id, profile_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_team_member_from_board_member ON public.board_members;
CREATE TRIGGER trg_sync_team_member_from_board_member
AFTER INSERT ON public.board_members
FOR EACH ROW
EXECUTE FUNCTION public.ensure_team_membership_for_board_member();

CREATE OR REPLACE FUNCTION public.enforce_last_team_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_remaining integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.role <> 'owner' OR NEW.role = 'owner' THEN
      RETURN NEW;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(OLD.team_id::text, 70217));

    IF NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = OLD.team_id) THEN
      RETURN NEW;
    END IF;

    SELECT count(*) INTO v_remaining
    FROM public.team_members tm
    WHERE tm.team_id = OLD.team_id
      AND tm.role = 'owner'
      AND tm.profile_id <> OLD.profile_id;

    IF v_remaining < 1 THEN
      RAISE EXCEPTION 'Cannot demote the last team owner';
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.role <> 'owner' THEN
      RETURN OLD;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(OLD.team_id::text, 70217));

    IF NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = OLD.team_id) THEN
      RETURN OLD;
    END IF;

    SELECT count(*) INTO v_remaining
    FROM public.team_members tm
    WHERE tm.team_id = OLD.team_id
      AND tm.role = 'owner'
      AND tm.profile_id <> OLD.profile_id;

    IF v_remaining < 1 THEN
      RAISE EXCEPTION 'Cannot remove the last team owner';
    END IF;

    RETURN OLD;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_last_team_owner ON public.team_members;
CREATE TRIGGER trg_enforce_last_team_owner
BEFORE UPDATE OR DELETE ON public.team_members
FOR EACH ROW
EXECUTE FUNCTION public.enforce_last_team_owner();

CREATE OR REPLACE FUNCTION public.enforce_last_board_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_remaining integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.role <> 'owner' OR NEW.role = 'owner' THEN
      RETURN NEW;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(OLD.board_id::text, 90217));

    IF NOT EXISTS (SELECT 1 FROM public.boards b WHERE b.id = OLD.board_id) THEN
      RETURN NEW;
    END IF;

    SELECT count(*) INTO v_remaining
    FROM public.board_members bm
    WHERE bm.board_id = OLD.board_id
      AND bm.role = 'owner'
      AND bm.profile_id <> OLD.profile_id;

    IF v_remaining < 1 THEN
      RAISE EXCEPTION 'Cannot demote the last board owner';
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.role <> 'owner' THEN
      RETURN OLD;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(OLD.board_id::text, 90217));

    IF NOT EXISTS (SELECT 1 FROM public.boards b WHERE b.id = OLD.board_id) THEN
      RETURN OLD;
    END IF;

    SELECT count(*) INTO v_remaining
    FROM public.board_members bm
    WHERE bm.board_id = OLD.board_id
      AND bm.role = 'owner'
      AND bm.profile_id <> OLD.profile_id;

    IF v_remaining < 1 THEN
      RAISE EXCEPTION 'Cannot remove the last board owner';
    END IF;

    RETURN OLD;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_last_board_owner ON public.board_members;
CREATE TRIGGER trg_enforce_last_board_owner
BEFORE UPDATE OR DELETE ON public.board_members
FOR EACH ROW
EXECUTE FUNCTION public.enforce_last_board_owner();

CREATE OR REPLACE FUNCTION public.is_team_member(target_team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.team_members tm
    WHERE tm.team_id = target_team_id
      AND tm.profile_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.has_team_role(
  target_team_id uuid,
  allowed_roles public.team_role[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.team_members tm
    WHERE tm.team_id = target_team_id
      AND tm.profile_id = auth.uid()
      AND tm.role = ANY(allowed_roles)
  );
$$;

CREATE OR REPLACE FUNCTION public.can_read_profile_via_team(target_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.team_members tm_self
    JOIN public.team_members tm_target ON tm_self.team_id = tm_target.team_id
    WHERE tm_self.profile_id = auth.uid()
      AND tm_self.role IN ('owner', 'admin')
      AND tm_target.profile_id = target_profile_id
  );
$$;

REVOKE ALL ON FUNCTION public.is_team_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_team_role(uuid, public.team_role[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_read_profile_via_team(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_team_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_team_role(uuid, public.team_role[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_profile_via_team(uuid) TO authenticated;

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Team members can read teams" ON public.teams;
CREATE POLICY "Team members can read teams"
  ON public.teams
  FOR SELECT
  TO authenticated
  USING (public.is_team_member(id));

DROP POLICY IF EXISTS "Users can create teams" ON public.teams;
CREATE POLICY "Users can create teams"
  ON public.teams
  FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "Owners and admins can update teams" ON public.teams;
CREATE POLICY "Owners and admins can update teams"
  ON public.teams
  FOR UPDATE
  TO authenticated
  USING (public.has_team_role(id, ARRAY['owner','admin']::public.team_role[]))
  WITH CHECK (public.has_team_role(id, ARRAY['owner','admin']::public.team_role[]));

DROP POLICY IF EXISTS "Owners can delete custom teams" ON public.teams;
CREATE POLICY "Owners can delete custom teams"
  ON public.teams
  FOR DELETE
  TO authenticated
  USING (
    team_type = 'custom'
    AND public.has_team_role(id, ARRAY['owner']::public.team_role[])
  );

DROP POLICY IF EXISTS "Team members can read own membership or admins all" ON public.team_members;
CREATE POLICY "Team members can read own membership or admins all"
  ON public.team_members
  FOR SELECT
  TO authenticated
  USING (
    profile_id = auth.uid()
    OR public.has_team_role(team_id, ARRAY['owner','admin']::public.team_role[])
  );

DROP POLICY IF EXISTS "Owners and admins can manage members" ON public.team_members;
CREATE POLICY "Owners and admins can manage members"
  ON public.team_members
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_team_role(team_id, ARRAY['owner','admin']::public.team_role[]));

DROP POLICY IF EXISTS "Owners and admins can update members" ON public.team_members;
CREATE POLICY "Owners and admins can update members"
  ON public.team_members
  FOR UPDATE
  TO authenticated
  USING (public.has_team_role(team_id, ARRAY['owner','admin']::public.team_role[]))
  WITH CHECK (public.has_team_role(team_id, ARRAY['owner','admin']::public.team_role[]));

DROP POLICY IF EXISTS "Owners and admins can delete members" ON public.team_members;
CREATE POLICY "Owners and admins can delete members"
  ON public.team_members
  FOR DELETE
  TO authenticated
  USING (
    profile_id = auth.uid()
    OR public.has_team_role(team_id, ARRAY['owner','admin']::public.team_role[])
  );

DROP POLICY IF EXISTS "Owners and admins can read invites" ON public.team_invites;
CREATE POLICY "Owners and admins can read invites"
  ON public.team_invites
  FOR SELECT
  TO authenticated
  USING (public.has_team_role(team_id, ARRAY['owner','admin']::public.team_role[]));

DROP POLICY IF EXISTS "Owners and admins can create invites" ON public.team_invites;
CREATE POLICY "Owners and admins can create invites"
  ON public.team_invites
  FOR INSERT
  TO authenticated
  WITH CHECK (
    role <> 'owner'
    AND public.has_team_role(team_id, ARRAY['owner','admin']::public.team_role[])
  );

DROP POLICY IF EXISTS "Owners and admins can update invites" ON public.team_invites;
CREATE POLICY "Owners and admins can update invites"
  ON public.team_invites
  FOR UPDATE
  TO authenticated
  USING (public.has_team_role(team_id, ARRAY['owner','admin']::public.team_role[]))
  WITH CHECK (public.has_team_role(team_id, ARRAY['owner','admin']::public.team_role[]));

DROP POLICY IF EXISTS "Owners and admins can delete invites" ON public.team_invites;
CREATE POLICY "Owners and admins can delete invites"
  ON public.team_invites
  FOR DELETE
  TO authenticated
  USING (public.has_team_role(team_id, ARRAY['owner','admin']::public.team_role[]));

DROP POLICY IF EXISTS "Authenticated users can read own and board-related profiles" ON public.profiles;
CREATE POLICY "Authenticated users can read own and board-related profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    profiles.id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.board_members bm_self
      JOIN public.board_members bm_target
        ON bm_self.board_id = bm_target.board_id
      WHERE bm_self.profile_id = auth.uid()
        AND bm_target.profile_id = profiles.id
    )
    OR public.can_read_profile_via_team(profiles.id)
  );

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
BEGIN
  v_user_id := auth.uid();
  v_email := public.normalize_email(auth.jwt() ->> 'email');

  IF v_user_id IS NULL OR v_email = '' THEN
    RETURN jsonb_build_object('ok', false, 'status', 401, 'code', 'UNAUTHENTICATED', 'message', 'Login required');
  END IF;

  v_hash := encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');

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

  UPDATE public.team_invites
  SET accepted_at = now(),
      updated_at = now()
  WHERE id = v_invite.id;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 200,
    'team_id', v_invite.team_id,
    'role', v_next_role
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

  v_hash := encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');

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

  IF v_board_team_id IS NOT NULL THEN
    INSERT INTO public.team_members (team_id, profile_id, role)
    VALUES (v_board_team_id, v_user_id, 'guest')
    ON CONFLICT (team_id, profile_id)
    DO NOTHING;
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

  RETURN jsonb_build_object('ok', true, 'status', 200);
END;
$$;

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

  IF NOT public.has_board_role(p_board_id, ARRAY['owner','editor']::public.member_role[]) THEN
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

REVOKE ALL ON FUNCTION public.accept_team_invite(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_board_invite(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_team_invite(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_board_invite(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_team_invite(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_board_invite(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_team_invite(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_board_invite(uuid, uuid) TO authenticated;
