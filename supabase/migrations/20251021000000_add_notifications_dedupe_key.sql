-- Add dedupe_key column to notifications table for deduplication
alter table notifications add column if not exists dedupe_key text;

-- Create unique index on dedupe_key
create unique index if not exists idx_notifications_dedupe_key
on notifications(dedupe_key)
where dedupe_key is not null;

-- Add comment for documentation
comment on column notifications.dedupe_key is 'Deduplication key to prevent duplicate notifications. Format: type:recipient_id:comment_id:card_id';
