-- Security hardening for Supabase Advisor findings
-- 1) Remove overly permissive RLS policies
-- 2) Enable and define RLS on exposed tables
-- 3) Pin function search_path

-- ==============================
-- Remove permissive policies
-- ==============================
DO $$
BEGIN
  -- boards
  DROP POLICY IF EXISTS "Anon users can view all boards" ON public.boards;
  DROP POLICY IF EXISTS "Anon users can insert boards" ON public.boards;
  DROP POLICY IF EXISTS "Anon users can update all boards" ON public.boards;
  DROP POLICY IF EXISTS "Anon users can delete all boards" ON public.boards;
  DROP POLICY IF EXISTS "Authenticated users can view all boards" ON public.boards;
  DROP POLICY IF EXISTS "Authenticated users can insert boards" ON public.boards;
  DROP POLICY IF EXISTS "Authenticated users can update all boards" ON public.boards;
  DROP POLICY IF EXISTS "Authenticated users can delete all boards" ON public.boards;

  -- lists
  DROP POLICY IF EXISTS "Anon users can view all lists" ON public.lists;
  DROP POLICY IF EXISTS "Anon users can insert lists" ON public.lists;
  DROP POLICY IF EXISTS "Anon users can update all lists" ON public.lists;
  DROP POLICY IF EXISTS "Anon users can delete all lists" ON public.lists;
  DROP POLICY IF EXISTS "Authenticated users can view all lists" ON public.lists;
  DROP POLICY IF EXISTS "Authenticated users can insert lists" ON public.lists;
  DROP POLICY IF EXISTS "Authenticated users can update all lists" ON public.lists;
  DROP POLICY IF EXISTS "Authenticated users can delete all lists" ON public.lists;

  -- cards
  DROP POLICY IF EXISTS "Anon users can view all cards" ON public.cards;
  DROP POLICY IF EXISTS "Anon users can insert cards" ON public.cards;
  DROP POLICY IF EXISTS "Anon users can update all cards" ON public.cards;
  DROP POLICY IF EXISTS "Anon users can delete all cards" ON public.cards;
  DROP POLICY IF EXISTS "Authenticated users can view all cards" ON public.cards;
  DROP POLICY IF EXISTS "Authenticated users can insert cards" ON public.cards;
  DROP POLICY IF EXISTS "Authenticated users can update all cards" ON public.cards;
  DROP POLICY IF EXISTS "Authenticated users can delete all cards" ON public.cards;

  -- profiles
  DROP POLICY IF EXISTS "Anon users can manage profiles" ON public.profiles;
  DROP POLICY IF EXISTS "Authenticated users can manage profiles" ON public.profiles;

  -- activity logs
  DROP POLICY IF EXISTS "Authenticated users can insert activity logs" ON public.activity_logs;
  DROP POLICY IF EXISTS "Authenticated users can view all activity logs" ON public.activity_logs;
END
$$;

-- ==============================
-- RLS for board_members
-- ==============================
ALTER TABLE public.board_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view board members" ON public.board_members;
CREATE POLICY "Members can view board members"
  ON public.board_members
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.board_members bm
      WHERE bm.board_id = board_members.board_id
        AND bm.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Owners and editors can add board members" ON public.board_members;
CREATE POLICY "Owners and editors can add board members"
  ON public.board_members
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.board_members bm
      WHERE bm.board_id = board_members.board_id
        AND bm.profile_id = auth.uid()
        AND bm.role IN ('owner', 'editor')
    )
  );

DROP POLICY IF EXISTS "Owners can update board members" ON public.board_members;
CREATE POLICY "Owners can update board members"
  ON public.board_members
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.board_members bm
      WHERE bm.board_id = board_members.board_id
        AND bm.profile_id = auth.uid()
        AND bm.role = 'owner'
    )
  )
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
CREATE POLICY "Owners or self can remove board members"
  ON public.board_members
  FOR DELETE
  USING (
    board_members.profile_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.board_members bm
      WHERE bm.board_id = board_members.board_id
        AND bm.profile_id = auth.uid()
        AND bm.role = 'owner'
    )
  );

-- ==============================
-- RLS for board_invites
-- ==============================
ALTER TABLE public.board_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners and editors can read board invites" ON public.board_invites;
CREATE POLICY "Owners and editors can read board invites"
  ON public.board_invites
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.board_members bm
      WHERE bm.board_id = board_invites.board_id
        AND bm.profile_id = auth.uid()
        AND bm.role IN ('owner', 'editor')
    )
  );

DROP POLICY IF EXISTS "Owners and editors can create board invites" ON public.board_invites;
CREATE POLICY "Owners and editors can create board invites"
  ON public.board_invites
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.board_members bm
      WHERE bm.board_id = board_invites.board_id
        AND bm.profile_id = auth.uid()
        AND bm.role IN ('owner', 'editor')
    )
  );

DROP POLICY IF EXISTS "Owners and editors can update board invites" ON public.board_invites;
CREATE POLICY "Owners and editors can update board invites"
  ON public.board_invites
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.board_members bm
      WHERE bm.board_id = board_invites.board_id
        AND bm.profile_id = auth.uid()
        AND bm.role IN ('owner', 'editor')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.board_members bm
      WHERE bm.board_id = board_invites.board_id
        AND bm.profile_id = auth.uid()
        AND bm.role IN ('owner', 'editor')
    )
  );

DROP POLICY IF EXISTS "Owners and editors can delete board invites" ON public.board_invites;
CREATE POLICY "Owners and editors can delete board invites"
  ON public.board_invites
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.board_members bm
      WHERE bm.board_id = board_invites.board_id
        AND bm.profile_id = auth.uid()
        AND bm.role IN ('owner', 'editor')
    )
  );

-- ==============================
-- RLS for reminders_queue / notification_delivery_logs
-- ==============================
ALTER TABLE public.reminders_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_delivery_logs ENABLE ROW LEVEL SECURITY;

-- No policy is intentionally defined on these internal tables.
-- Service role can still access them; anon/authenticated clients are denied.

-- ==============================
-- Replace profiles/activity_logs policies
-- ==============================
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
  );

DROP POLICY IF EXISTS "Authenticated users can insert own profile" ON public.profiles;
CREATE POLICY "Authenticated users can insert own profile"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (profiles.id = auth.uid());

DROP POLICY IF EXISTS "Authenticated users can update own profile" ON public.profiles;
CREATE POLICY "Authenticated users can update own profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (profiles.id = auth.uid())
  WITH CHECK (profiles.id = auth.uid());

DROP POLICY IF EXISTS "Board members can read activity logs" ON public.activity_logs;
CREATE POLICY "Board members can read activity logs"
  ON public.activity_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.board_members bm
      WHERE bm.board_id = activity_logs.board_id
        AND bm.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Board members can insert own activity logs" ON public.activity_logs;
CREATE POLICY "Board members can insert own activity logs"
  ON public.activity_logs
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.board_members bm
      WHERE bm.board_id = activity_logs.board_id
        AND bm.profile_id = auth.uid()
    )
    AND (activity_logs.user_id IS NULL OR activity_logs.user_id = auth.uid())
  );

-- ==============================
-- Function search_path hardening
-- ==============================
ALTER FUNCTION public.handle_new_user() SET search_path = public, extensions;
ALTER FUNCTION public.set_notification_preferences_updated_at() SET search_path = public, extensions;
ALTER FUNCTION public.set_reminders_queue_updated_at() SET search_path = public, extensions;
ALTER FUNCTION public.set_google_calendar_accounts_updated_at() SET search_path = public, extensions;
ALTER FUNCTION public.set_calendar_sync_updated_at() SET search_path = public, extensions;
ALTER FUNCTION public.set_google_calendar_events_updated_at() SET search_path = public, extensions;
ALTER FUNCTION public.set_google_calendar_sync_states_updated_at() SET search_path = public, extensions;
ALTER FUNCTION public.build_due_reminder_dedupe_key(uuid, uuid, text, timestamptz) SET search_path = public, extensions;
ALTER FUNCTION public.compute_due_at_jst(timestamptz, time) SET search_path = public, extensions;
ALTER FUNCTION public.reorder_cards_tx(uuid, integer, jsonb) SET search_path = public, extensions;
ALTER FUNCTION public.reorder_lists_tx(uuid, integer, jsonb) SET search_path = public, extensions;
ALTER FUNCTION public.renumber_card_positions(uuid, uuid) SET search_path = public, extensions;
ALTER FUNCTION public.renumber_list_positions(uuid) SET search_path = public, extensions;
ALTER FUNCTION public.detect_position_density(uuid, uuid) SET search_path = public, extensions;
ALTER FUNCTION public.trigger_push_notification() SET search_path = public, extensions;
ALTER FUNCTION public.handle_updated_at() SET search_path = public, extensions;

-- ==============================
-- pg_net extension note
-- ==============================
-- pg_net is non-relocatable (extrelocatable=false), so ALTER EXTENSION ... SET SCHEMA
-- is not supported. This must be handled separately if Supabase provides a supported path.
