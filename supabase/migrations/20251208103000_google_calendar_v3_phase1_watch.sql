-- Phase1 additions: watch renewal/fallback + dedup logging

-- Extend sync states with watch timestamps and TTL hints
alter table google_calendar_sync_states
  add column if not exists last_watch_at timestamptz,
  add column if not exists watch_checked_at timestamptz,
  add column if not exists watch_ttl_seconds integer default 86400,
  add column if not exists last_poll_started_at timestamptz;

-- Extend sync logs for deduplication
alter table google_calendar_sync_logs
  add column if not exists channel_id text,
  add column if not exists message_number text;

-- Deduplicate by channel_id + message_number when available
create unique index if not exists idx_gcal_sync_logs_channel_message_unique
  on google_calendar_sync_logs (channel_id, message_number)
  where message_number is not null;

comment on column google_calendar_sync_states.last_watch_at is 'Last time a watch notification was observed';
comment on column google_calendar_sync_states.watch_checked_at is 'Last time watch renewal check ran';
comment on column google_calendar_sync_states.watch_ttl_seconds is 'TTL hint for watch renewal (seconds)';
comment on column google_calendar_sync_states.last_poll_started_at is 'When polling fallback was started';
comment on column google_calendar_sync_logs.channel_id is 'Watch channel id from Google';
comment on column google_calendar_sync_logs.message_number is 'x-goog-message-number for deduplication';
