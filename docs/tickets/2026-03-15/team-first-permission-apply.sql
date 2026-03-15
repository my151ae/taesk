-- Backfill orphan board_members into team_members as guest.
-- Re-runnable: ON CONFLICT prevents duplicate rows.
INSERT INTO public.team_members (team_id, profile_id, role)
SELECT DISTINCT
  b.team_id,
  bm.profile_id,
  'guest'::public.team_role
FROM public.board_members bm
JOIN public.boards b
  ON b.id = bm.board_id
LEFT JOIN public.team_members tm
  ON tm.team_id = b.team_id
 AND tm.profile_id = bm.profile_id
WHERE b.team_id IS NOT NULL
  AND tm.profile_id IS NULL
ON CONFLICT (team_id, profile_id) DO NOTHING;

-- Mark legacy board invites as revoked once the Team-first pending model is ready.
-- Comment out if you still need a compatibility window for accept_board_invite().
UPDATE public.board_invites
SET revoked_at = COALESCE(revoked_at, now())
WHERE accepted_at IS NULL
  AND revoked_at IS NULL;
