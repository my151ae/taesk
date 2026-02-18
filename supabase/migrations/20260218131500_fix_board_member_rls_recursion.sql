-- Fix infinite recursion in board_members RLS (42P17)
-- Introduce SECURITY DEFINER helpers and rewrite policies to use them.

CREATE OR REPLACE FUNCTION public.is_board_member(target_board_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.board_members bm
    WHERE bm.board_id = target_board_id
      AND bm.profile_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.has_board_role(
  target_board_id uuid,
  allowed_roles public.member_role[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.board_members bm
    WHERE bm.board_id = target_board_id
      AND bm.profile_id = auth.uid()
      AND bm.role = ANY(allowed_roles)
  );
$$;

REVOKE ALL ON FUNCTION public.is_board_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_board_role(uuid, public.member_role[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_board_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_board_role(uuid, public.member_role[]) TO authenticated;

ALTER TABLE public.board_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view board members" ON public.board_members;
CREATE POLICY "Members can view board members"
  ON public.board_members
  FOR SELECT
  TO authenticated
  USING (public.is_board_member(board_id));

DROP POLICY IF EXISTS "Owners and editors can add board members" ON public.board_members;
CREATE POLICY "Owners and editors can add board members"
  ON public.board_members
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_board_role(board_id, ARRAY['owner','editor']::public.member_role[]));

DROP POLICY IF EXISTS "Owners can update board members" ON public.board_members;
CREATE POLICY "Owners can update board members"
  ON public.board_members
  FOR UPDATE
  TO authenticated
  USING (public.has_board_role(board_id, ARRAY['owner']::public.member_role[]))
  WITH CHECK (public.has_board_role(board_id, ARRAY['owner']::public.member_role[]));

DROP POLICY IF EXISTS "Owners or self can remove board members" ON public.board_members;
CREATE POLICY "Owners or self can remove board members"
  ON public.board_members
  FOR DELETE
  TO authenticated
  USING (
    profile_id = auth.uid()
    OR public.has_board_role(board_id, ARRAY['owner']::public.member_role[])
  );

DROP POLICY IF EXISTS "select_boards_for_members" ON public.boards;
CREATE POLICY "select_boards_for_members"
  ON public.boards
  FOR SELECT
  TO authenticated
  USING (public.is_board_member(id));
