create table if not exists public.card_content_history (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards(id) on delete cascade,
  board_id uuid not null references public.boards(id) on delete cascade,
  content jsonb not null,
  excerpt text not null default '',
  saved_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists idx_card_content_history_card_created
  on public.card_content_history (card_id, created_at desc, id desc);

alter table public.card_content_history enable row level security;

create policy "Board members can read card content history"
  on public.card_content_history for select
  using (
    exists (
      select 1
      from public.board_members bm
      where bm.board_id = card_content_history.board_id
        and bm.profile_id = auth.uid()
    )
  );

create policy "Owners and editors can insert card content history"
  on public.card_content_history for insert
  with check (
    exists (
      select 1
      from public.board_members bm
      where bm.board_id = card_content_history.board_id
        and bm.profile_id = auth.uid()
        and bm.role in ('owner', 'editor')
    )
  );

comment on table public.card_content_history is 'Card body history snapshots for modal restore flow';
comment on column public.card_content_history.content is 'Normalized tiptap JSON content snapshot';
comment on column public.card_content_history.excerpt is 'Derived excerpt at save time for lightweight history list';
