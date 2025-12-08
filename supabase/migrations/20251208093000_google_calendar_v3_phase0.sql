-- Google Calendar v3 Phase0: data model for cached GCards, sync state, and audit logs

-- Cached Google events (GCard)。Google から取得したイベントを DB にキャッシュし、
-- 後続の差分同期や再シンク候補検索に利用する。
create table if not exists google_calendar_events (
  id uuid primary key default gen_random_uuid(),
  google_account_id uuid not null references google_calendar_accounts(id) on delete cascade,
  calendar_id text not null,
  google_event_id text not null,
  recurring_event_id text,
  original_start_time timestamptz,
  summary text,
  description text,
  location text,
  status text default 'confirmed', -- confirmed | tentative | cancelled など
  is_all_day boolean not null default false,
  display_tz text, -- date をどのタイムゾーンで解釈するか
  start_date date, -- all-day の表示日付（Google 表示と一致させる）
  end_date date,   -- all-day の終了日付（Google 仕様で end は排他的）
  start_utc timestamptz not null, -- dateTime / date+tz を UTC へ正規化
  end_utc timestamptz not null,
  html_link text,
  conference_data jsonb,
  attendees jsonb,
  raw jsonb, -- Google からの元レスポンス（デバッグ用）
  etag text,
  updated_at_google timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (google_account_id, google_event_id)
);

create index if not exists idx_google_calendar_events_account_time
  on google_calendar_events (google_account_id, start_utc, end_utc);

create index if not exists idx_google_calendar_events_account_date
  on google_calendar_events (google_account_id, start_date, end_date);

alter table google_calendar_events enable row level security;

create policy "Users can read own gcal events"
  on google_calendar_events for select
  using (
    exists (
      select 1 from google_calendar_accounts gca
      where gca.id = google_calendar_events.google_account_id
        and gca.user_id = auth.uid()
    )
  );

create policy "Users can insert own gcal events"
  on google_calendar_events for insert
  with check (
    exists (
      select 1 from google_calendar_accounts gca
      where gca.id = google_calendar_events.google_account_id
        and gca.user_id = auth.uid()
    )
  );

create policy "Users can update own gcal events"
  on google_calendar_events for update
  using (
    exists (
      select 1 from google_calendar_accounts gca
      where gca.id = google_calendar_events.google_account_id
        and gca.user_id = auth.uid()
    )
  );

create policy "Users can delete own gcal events"
  on google_calendar_events for delete
  using (
    exists (
      select 1 from google_calendar_accounts gca
      where gca.id = google_calendar_events.google_account_id
        and gca.user_id = auth.uid()
    )
  );

create or replace function set_google_calendar_events_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists google_calendar_events_set_updated_at on google_calendar_events;
create trigger google_calendar_events_set_updated_at
  before update on google_calendar_events
  for each row
  execute function set_google_calendar_events_updated_at();

comment on table google_calendar_events is 'Cached Google Calendar events (GCard cache)';
comment on column google_calendar_events.google_account_id is 'Linked Google account (per user)';
comment on column google_calendar_events.calendar_id is 'Google Calendar ID for the event';
comment on column google_calendar_events.google_event_id is 'Google event id (stable across sync)';
comment on column google_calendar_events.recurring_event_id is 'recurringEventId for instances';
comment on column google_calendar_events.original_start_time is 'originalStartTime for exceptions';
comment on column google_calendar_events.display_tz is 'TZ used to interpret date-only events';
comment on column google_calendar_events.start_date is 'Local start date for all-day events';
comment on column google_calendar_events.end_date is 'Local end date (exclusive) for all-day events';
comment on column google_calendar_events.start_utc is 'Start timestamp normalized to UTC';
comment on column google_calendar_events.end_utc is 'End timestamp normalized to UTC';
comment on column google_calendar_events.raw is 'Raw Google payload for debugging/parity checks';

-- Sync状態（syncToken / watch / fallback 設定）。カレンダー単位（ユーザー×カレンダー）。
create table if not exists google_calendar_sync_states (
  id uuid primary key default gen_random_uuid(),
  google_account_id uuid not null references google_calendar_accounts(id) on delete cascade,
  calendar_id text not null,
  sync_token text,
  last_full_sync_at timestamptz,
  last_synced_at timestamptz,
  window_start timestamptz,
  window_end timestamptz,
  watch_channel_id text,
  watch_resource_id text,
  watch_expiration timestamptz,
  watch_status text not null default 'inactive', -- inactive | active | stale | polling
  polling_disabled_until timestamptz,
  p95_ingest_latency_ms integer,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (google_account_id, calendar_id)
);

alter table google_calendar_sync_states enable row level security;

create policy "Users can read own gcal sync states"
  on google_calendar_sync_states for select
  using (
    exists (
      select 1 from google_calendar_accounts gca
      where gca.id = google_calendar_sync_states.google_account_id
        and gca.user_id = auth.uid()
    )
  );

create policy "Users can insert own gcal sync states"
  on google_calendar_sync_states for insert
  with check (
    exists (
      select 1 from google_calendar_accounts gca
      where gca.id = google_calendar_sync_states.google_account_id
        and gca.user_id = auth.uid()
    )
  );

create policy "Users can update own gcal sync states"
  on google_calendar_sync_states for update
  using (
    exists (
      select 1 from google_calendar_accounts gca
      where gca.id = google_calendar_sync_states.google_account_id
        and gca.user_id = auth.uid()
    )
  );

create policy "Users can delete own gcal sync states"
  on google_calendar_sync_states for delete
  using (
    exists (
      select 1 from google_calendar_accounts gca
      where gca.id = google_calendar_sync_states.google_account_id
        and gca.user_id = auth.uid()
    )
  );

create or replace function set_google_calendar_sync_states_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists google_calendar_sync_states_set_updated_at on google_calendar_sync_states;
create trigger google_calendar_sync_states_set_updated_at
  before update on google_calendar_sync_states
  for each row
  execute function set_google_calendar_sync_states_updated_at();

comment on table google_calendar_sync_states is 'Sync tokens, watch channels, and polling/backoff state per user×calendar';
comment on column google_calendar_sync_states.watch_status is 'active|inactive|stale|polling status flag';
comment on column google_calendar_sync_states.p95_ingest_latency_ms is 'Rolling p95 ingest latency (ms) for fallback decision';

-- 監査ログ（最小限）。後続フェーズで DLQ/再試行ログにも流用可能。
create table if not exists google_calendar_sync_logs (
  id uuid primary key default gen_random_uuid(),
  google_account_id uuid not null references google_calendar_accounts(id) on delete cascade,
  calendar_id text,
  google_event_id text,
  action text not null, -- ingest | update | delete | watch | poll | error 等
  detail jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_google_calendar_sync_logs_account_created
  on google_calendar_sync_logs (google_account_id, created_at desc);

alter table google_calendar_sync_logs enable row level security;

create policy "Users can read own gcal sync logs"
  on google_calendar_sync_logs for select
  using (
    exists (
      select 1 from google_calendar_accounts gca
      where gca.id = google_calendar_sync_logs.google_account_id
        and gca.user_id = auth.uid()
    )
  );

create policy "Users can insert own gcal sync logs"
  on google_calendar_sync_logs for insert
  with check (
    exists (
      select 1 from google_calendar_accounts gca
      where gca.id = google_calendar_sync_logs.google_account_id
        and gca.user_id = auth.uid()
    )
  );

create policy "Users can delete own gcal sync logs"
  on google_calendar_sync_logs for delete
  using (
    exists (
      select 1 from google_calendar_accounts gca
      where gca.id = google_calendar_sync_logs.google_account_id
        and gca.user_id = auth.uid()
    )
  );

comment on table google_calendar_sync_logs is 'Audit log for Google Calendar sync operations per user account';
comment on column google_calendar_sync_logs.action is 'Operation name (ingest/update/delete/watch/poll/error)';
