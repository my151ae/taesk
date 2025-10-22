-- Notification preferences table for per-user settings
create table if not exists notification_preferences (
  profile_id uuid primary key references profiles(id) on delete cascade,
  in_app_enabled boolean default true,
  web_push_enabled boolean default false,
  quiet_hours jsonb default null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table notification_preferences enable row level security;

create policy "Users can view own notification preferences"
  on notification_preferences for select
  using (auth.uid() = profile_id);

create policy "Users can insert own notification preferences"
  on notification_preferences for insert
  with check (auth.uid() = profile_id);

create policy "Users can update own notification preferences"
  on notification_preferences for update
  using (auth.uid() = profile_id);

create or replace function set_notification_preferences_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists notification_preferences_set_updated_at on notification_preferences;
create trigger notification_preferences_set_updated_at
  before update on notification_preferences
  for each row
  execute function set_notification_preferences_updated_at();

comment on table notification_preferences is 'Per-user notification settings (in-app, push, quiet hours).';
comment on column notification_preferences.quiet_hours is 'JSON object with start, end, timezone. Example: { "start": "22:00", "end": "07:00", "timezone": "Asia/Tokyo" }';
