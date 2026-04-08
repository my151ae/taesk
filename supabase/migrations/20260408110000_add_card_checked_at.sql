alter table public.cards
  add column if not exists checked_at timestamptz null;

comment on column public.cards.checked_at is 'Timestamp of the latest transition into checked/completed state.';

update public.cards
set checked_at = updated_at
where checked = true
  and checked_at is null;
