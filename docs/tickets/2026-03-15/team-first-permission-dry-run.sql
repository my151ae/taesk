-- Detect boards that still have no team_id.
SELECT
  b.id,
  b.name,
  b.user_id,
  b.created_at
FROM public.boards b
WHERE b.team_id IS NULL
ORDER BY b.created_at ASC;

-- Detect board_members that are not backed by a team_members row.
SELECT
  bm.board_id,
  b.name AS board_name,
  b.team_id,
  bm.profile_id,
  bm.role,
  bm.created_at
FROM public.board_members bm
JOIN public.boards b
  ON b.id = bm.board_id
LEFT JOIN public.team_members tm
  ON tm.team_id = b.team_id
 AND tm.profile_id = bm.profile_id
WHERE b.team_id IS NULL
   OR tm.profile_id IS NULL
ORDER BY bm.created_at ASC;

-- Detect legacy board invites that are still pending.
SELECT
  bi.id,
  bi.board_id,
  b.team_id,
  bi.email,
  bi.role,
  bi.created_at,
  bi.expires_at
FROM public.board_invites bi
JOIN public.boards b
  ON b.id = bi.board_id
WHERE bi.accepted_at IS NULL
  AND bi.revoked_at IS NULL
ORDER BY bi.created_at ASC;

-- Detect team members who are the sole owner of at least one board.
SELECT
  bm.profile_id,
  b.team_id,
  bm.board_id,
  b.name AS board_name
FROM public.board_members bm
JOIN public.boards b
  ON b.id = bm.board_id
WHERE bm.role = 'owner'
  AND NOT EXISTS (
    SELECT 1
    FROM public.board_members bm_other
    WHERE bm_other.board_id = bm.board_id
      AND bm_other.profile_id <> bm.profile_id
      AND bm_other.role = 'owner'
  )
ORDER BY b.team_id, b.created_at ASC;
