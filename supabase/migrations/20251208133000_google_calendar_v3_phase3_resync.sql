-- Phase3: track last linked google_event_id for resync suggestion

alter table calendar_sync
  add column if not exists last_google_event_id text;

comment on column calendar_sync.last_google_event_id is 'Previously linked Google event id for resync candidate search';
