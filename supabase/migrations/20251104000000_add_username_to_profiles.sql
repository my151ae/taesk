create extension if not exists pg_trgm;

alter table profiles
  add column if not exists username text;

alter table profiles
  add constraint if not exists profiles_username_format_check
    check (
      username is null
      or username ~ '^[a-zA-Z0-9_]{3,20}$'
    );

create unique index if not exists profiles_username_unique_ci
  on profiles ((lower(username)))
  where username is not null;

create index if not exists profiles_username_search_idx
  on profiles using gin (username gin_trgm_ops);

comment on column profiles.username is 'Unique username for @mentions and display (3-20 chars, alphanumeric + underscore)';
