alter table public.cards
  add column if not exists started_at timestamptz;

comment on column public.cards.started_at is 'First timestamp when an overdue card was moved out of overdue state.';
