DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.boards
    WHERE team_id IS NULL
  ) THEN
    RAISE EXCEPTION 'boards.team_id contains NULL values';
  END IF;
END;
$$;

ALTER TABLE public.boards
  ALTER COLUMN team_id SET NOT NULL;
