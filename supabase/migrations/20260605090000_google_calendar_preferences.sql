-- Store the user's visible Google calendars for timeline display.
create table if not exists google_calendar_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  google_account_id uuid not null references google_calendar_accounts(id) on delete cascade,
  selected_calendar_ids text[] not null default array['primary']::text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, google_account_id)
);

alter table google_calendar_preferences enable row level security;

create policy "Users can read own google calendar preferences"
  on google_calendar_preferences for select
  using (auth.uid() = user_id);

create policy "Users can insert own google calendar preferences"
  on google_calendar_preferences for insert
  with check (auth.uid() = user_id);

create policy "Users can update own google calendar preferences"
  on google_calendar_preferences for update
  using (auth.uid() = user_id);

create policy "Users can delete own google calendar preferences"
  on google_calendar_preferences for delete
  using (auth.uid() = user_id);

create or replace function set_google_calendar_preferences_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists google_calendar_preferences_set_updated_at on google_calendar_preferences;
create trigger google_calendar_preferences_set_updated_at
  before update on google_calendar_preferences
  for each row
  execute function set_google_calendar_preferences_updated_at();

comment on table google_calendar_preferences is 'Visible Google Calendar IDs selected by each user for timeline display';
comment on column google_calendar_preferences.selected_calendar_ids is 'Calendar IDs selected in Taesk; validated against Google CalendarList';
