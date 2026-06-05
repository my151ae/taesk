-- Harden google_calendar_preferences after advisor checks.

create index if not exists idx_google_calendar_preferences_google_account_id
  on google_calendar_preferences (google_account_id);

create or replace function set_google_calendar_preferences_updated_at()
returns trigger
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop policy if exists "Users can read own google calendar preferences" on google_calendar_preferences;
create policy "Users can read own google calendar preferences"
  on google_calendar_preferences for select
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own google calendar preferences" on google_calendar_preferences;
create policy "Users can insert own google calendar preferences"
  on google_calendar_preferences for insert
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own google calendar preferences" on google_calendar_preferences;
create policy "Users can update own google calendar preferences"
  on google_calendar_preferences for update
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can delete own google calendar preferences" on google_calendar_preferences;
create policy "Users can delete own google calendar preferences"
  on google_calendar_preferences for delete
  using ((select auth.uid()) = user_id);
