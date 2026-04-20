import type { TrashCardItem } from "@/lib/api-types/timeline";
import type { Card, DueBucket } from "@/lib/supabase";

type TrashCardRow = Pick<
  Card,
  | "id"
  | "title"
  | "parent_card_id"
  | "is_parent"
  | "content"
  | "excerpt"
  | "due_date"
  | "due_start"
  | "due_end"
  | "checked"
  | "tags"
  | "assignee_id"
  | "assignee_ids"
  | "assigned_to"
  | "due_bucket"
  | "due_bucket_position"
  | "duration"
  | "short_id"
  | "slug"
  | "deleted_at"
  | "purge_after_at"
>;

export function sortTrashItems<T extends { purge_after_at: string; deleted_at: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => {
    const purgeDiff = new Date(left.purge_after_at).getTime() - new Date(right.purge_after_at).getTime();
    if (purgeDiff !== 0) return purgeDiff;
    return new Date(left.deleted_at).getTime() - new Date(right.deleted_at).getTime();
  });
}

export function mapCardRowToTrashItem(card: TrashCardRow): TrashCardItem | null {
  if (!card.deleted_at || !card.purge_after_at) return null;

  return {
    card_id: card.id,
    parent_card_id: card.parent_card_id ?? null,
    is_parent: Boolean(card.is_parent),
    child_count: 0,
    title: card.title,
    content: card.content ?? null,
    excerpt: card.excerpt ?? null,
    due_date: card.due_date ?? null,
    due_start: card.due_start ?? null,
    due_end: card.due_end ?? null,
    checked: card.checked,
    tags: card.tags ?? [],
    assignee_id: card.assignee_id ?? null,
    assignee_ids: card.assignee_ids ?? null,
    assigned_to: card.assigned_to ?? null,
    due_bucket: (card.due_bucket ?? null) as DueBucket | null,
    due_bucket_position: card.due_bucket_position ?? null,
    duration: card.duration ?? null,
    short_id: card.short_id ?? null,
    slug: card.slug ?? null,
    deleted_at: card.deleted_at,
    purge_after_at: card.purge_after_at,
  };
}
