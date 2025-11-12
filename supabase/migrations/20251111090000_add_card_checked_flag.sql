-- Add persistent completion flag for kanban cards
alter table public.cards
  add column if not exists checked boolean not null default false;

comment on column public.cards.checked is 'Marks whether the card is checked/completed in the board UI.';
