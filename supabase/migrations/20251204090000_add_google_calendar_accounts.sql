-- Google Calendar OAuth credentials per Supabase user (read-only v1)
create table if not exists google_calendar_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  google_sub text not null,
  email text not null,
  access_token text not null,
  refresh_token text not null,
  scope text not null,
  token_expires_at timestamptz not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, google_sub)
);

alter table google_calendar_accounts enable row level security;

create policy "Users can read own google calendar account"
  on google_calendar_accounts for select
  using (auth.uid() = user_id);

create policy "Users can upsert own google calendar account"
  on google_calendar_accounts for insert
  with check (auth.uid() = user_id);

create policy "Users can update own google calendar account"
  on google_calendar_accounts for update
  using (auth.uid() = user_id);

create policy "Users can delete own google calendar account"
  on google_calendar_accounts for delete
  using (auth.uid() = user_id);

create or replace function set_google_calendar_accounts_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists google_calendar_accounts_set_updated_at on google_calendar_accounts;
create trigger google_calendar_accounts_set_updated_at
  before update on google_calendar_accounts
  for each row
  execute function set_google_calendar_accounts_updated_at();

comment on table google_calendar_accounts is 'Google Calendar OAuth credentials per Supabase user (read-only v1)';
comment on column google_calendar_accounts.google_sub is 'Google account subject (sub) used as stable identifier';
comment on column google_calendar_accounts.token_expires_at is 'Access token expiry timestamp (UTC)';
