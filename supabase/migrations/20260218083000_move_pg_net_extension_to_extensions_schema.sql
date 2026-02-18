-- Move pg_net extension out of public schema to satisfy advisor lint.
-- pg_net is non-relocatable, so we re-install it in extensions schema.
-- Note: this resets pg_net internal queue/response unlogged tables.

CREATE SCHEMA IF NOT EXISTS extensions;

DO $$
DECLARE
  current_schema text;
BEGIN
  SELECT n.nspname
  INTO current_schema
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pg_net';

  IF current_schema = 'public' THEN
    DROP EXTENSION IF EXISTS pg_net CASCADE;
    CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
  END IF;
END
$$;
