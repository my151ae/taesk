-- Add cron secret helper function for Edge Functions.
-- Secret value itself is managed in Vault and not stored in migrations.

CREATE EXTENSION IF NOT EXISTS supabase_vault;

CREATE OR REPLACE FUNCTION public.get_cron_secret()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_secret TEXT;
BEGIN
  SELECT decrypted_secret
  INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'CRON_SECRET'
  ORDER BY created_at DESC
  LIMIT 1;

  RETURN COALESCE(v_secret, NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.get_cron_secret() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_cron_secret() TO service_role;

COMMENT ON FUNCTION public.get_cron_secret() IS 'Returns CRON_SECRET from vault.decrypted_secrets for internal dispatch authentication.';
