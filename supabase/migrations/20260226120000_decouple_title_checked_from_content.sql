-- Decouple cards.title/cards.checked from cards.content body structure.
-- Safely remove legacy first taskItem only when it matches the current card title/checked.

create table if not exists public.cards_content_backup_20260226 as
select id, content, excerpt
from public.cards;

create table if not exists public.card_content_history_backup_20260226 as
select id, card_id, content, excerpt
from public.card_content_history;

create or replace function public.build_default_body_content_sql()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'type', 'doc',
    'content', jsonb_build_array(
      jsonb_build_object(
        'type', 'taskList',
        'content', jsonb_build_array(
          jsonb_build_object(
            'type', 'taskItem',
            'attrs', jsonb_build_object('checked', false),
            'content', jsonb_build_array(
              jsonb_build_object('type', 'paragraph', 'content', '[]'::jsonb)
            )
          )
        )
      )
    )
  );
$$;

create or replace function public.concat_jsonb_text(content jsonb)
returns text
language sql
immutable
as $$
  select coalesce(string_agg(value #>> '{}', ''), '')
  from jsonb_path_query(content, '$.**.text') as value;
$$;

create or replace function public.strip_legacy_title_task_if_matches(
  content jsonb,
  expected_title text,
  expected_checked boolean
)
returns jsonb
language plpgsql
immutable
as $$
declare
  doc_content jsonb;
  first_node jsonb;
  first_task jsonb;
  first_task_text text;
  first_task_checked boolean;
  normalized_first_task_text text;
  normalized_expected_title text;
  first_task_items_trimmed jsonb;
  tail_nodes jsonb;
  rebuilt_nodes jsonb;
begin
  if content is null then
    return public.build_default_body_content_sql();
  end if;

  if jsonb_typeof(content) <> 'object' or content->>'type' <> 'doc' then
    return public.build_default_body_content_sql();
  end if;

  doc_content := content->'content';
  if jsonb_typeof(doc_content) <> 'array' then
    return public.build_default_body_content_sql();
  end if;

  if jsonb_array_length(doc_content) = 0 then
    return public.build_default_body_content_sql();
  end if;

  first_node := doc_content->0;
  if first_node->>'type' <> 'taskList' then
    return content;
  end if;

  if jsonb_typeof(first_node->'content') <> 'array' or jsonb_array_length(first_node->'content') = 0 then
    return content;
  end if;

  first_task := first_node->'content'->0;
  if first_task->>'type' <> 'taskItem' then
    return content;
  end if;

  first_task_text := public.concat_jsonb_text(first_task);
  normalized_first_task_text := lower(trim(regexp_replace(first_task_text, '^\s*\[(x| )\]\s*', '', 'i')));
  normalized_expected_title := lower(trim(coalesce(expected_title, '')));
  first_task_checked := coalesce((first_task->'attrs'->>'checked')::boolean, false);

  if normalized_first_task_text <> normalized_expected_title then
    return content;
  end if;

  if expected_checked is not null and first_task_checked is distinct from expected_checked then
    return content;
  end if;

  select coalesce(jsonb_agg(item), '[]'::jsonb)
  into first_task_items_trimmed
  from jsonb_array_elements(first_node->'content') with ordinality as t(item, idx)
  where idx > 1;

  select coalesce(jsonb_agg(item), '[]'::jsonb)
  into tail_nodes
  from jsonb_array_elements(doc_content) with ordinality as t(item, idx)
  where idx > 1;

  if jsonb_array_length(first_task_items_trimmed) > 0 then
    first_node := jsonb_set(first_node, '{content}', first_task_items_trimmed, false);
    rebuilt_nodes := jsonb_build_array(first_node) || tail_nodes;
  else
    rebuilt_nodes := tail_nodes;
  end if;

  if jsonb_typeof(rebuilt_nodes) <> 'array' or jsonb_array_length(rebuilt_nodes) = 0 then
    return public.build_default_body_content_sql();
  end if;

  return jsonb_set(content, '{content}', rebuilt_nodes, false);
end;
$$;

create or replace function public.tiptap_excerpt(content jsonb, max_len int default 160)
returns text
language sql
immutable
as $$
  with raw as (
    select coalesce(string_agg(value #>> '{}', ' '), '') as text
    from jsonb_path_query(content, '$.**.text') as value
  ),
  normalized as (
    select trim(regexp_replace(text, '\s+', ' ', 'g')) as text
    from raw
  )
  select left(coalesce(normalized.text, ''), greatest(coalesce(max_len, 160), 0))
  from normalized;
$$;

with transformed as (
  select
    c.id,
    public.strip_legacy_title_task_if_matches(c.content, c.title, c.checked) as next_content
  from public.cards c
)
update public.cards c
set
  content = t.next_content,
  excerpt = public.tiptap_excerpt(t.next_content, 160)
from transformed t
where c.id = t.id;

with transformed as (
  select
    h.id,
    public.strip_legacy_title_task_if_matches(h.content, c.title, c.checked) as next_content
  from public.card_content_history h
  inner join public.cards c on c.id = h.card_id
)
update public.card_content_history h
set
  content = t.next_content,
  excerpt = public.tiptap_excerpt(t.next_content, 160)
from transformed t
where h.id = t.id;

drop function if exists public.tiptap_excerpt(jsonb, int);
drop function if exists public.strip_legacy_title_task_if_matches(jsonb, text, boolean);
drop function if exists public.concat_jsonb_text(jsonb);
drop function if exists public.build_default_body_content_sql();
