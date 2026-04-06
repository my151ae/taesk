alter table public.cards
  add column if not exists deleted_at timestamptz null,
  add column if not exists purge_after_at timestamptz null;

create index if not exists idx_cards_board_deleted_at
  on public.cards(board_id, deleted_at);

create index if not exists idx_cards_purge_after_at
  on public.cards(purge_after_at)
  where deleted_at is not null;

alter table public.activity_logs
  drop constraint if exists activity_logs_action_check;

alter table public.activity_logs
  add constraint activity_logs_action_check
  check (action in ('created', 'updated', 'deleted', 'moved', 'restored'));
