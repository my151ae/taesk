-- Invite hash cutover (v1.7 / plan B)
-- Old board invite tokens are no longer accepted.

UPDATE public.board_invites
SET revoked_at = COALESCE(revoked_at, now())
WHERE accepted_at IS NULL;

-- Break linkage with legacy plain tokens so old links always resolve to 404.
UPDATE public.board_invites
SET token_hash = encode(digest(gen_random_uuid()::text || id::text, 'sha256'), 'hex')
WHERE token_hash IS NULL;

ALTER TABLE public.board_invites
  ALTER COLUMN token_hash SET NOT NULL;

ALTER TABLE public.team_invites
  DROP CONSTRAINT IF EXISTS team_invites_token_hash_required_for_pending;
ALTER TABLE public.team_invites
  ADD CONSTRAINT team_invites_token_hash_required_for_pending
  CHECK (
    token_hash IS NOT NULL
    OR accepted_at IS NOT NULL
    OR revoked_at IS NOT NULL
  );

ALTER TABLE public.board_invites
  DROP COLUMN IF EXISTS token;
