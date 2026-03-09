import type { Card } from '@/lib/supabase';
import { buildDefaultBodyContent, deriveExcerptFromContent } from '@/lib/tiptap';
import type { TimelineBucketItem } from '@/app/(board)/_utils/timeline-helpers';

export function buildOptimisticCard(payload: Partial<Card>, boardId: string, optimisticId: string): Card {
  const nowIso = new Date().toISOString();
  const optimisticContent = payload.content ?? buildDefaultBodyContent();
  const optimisticExcerpt = payload.excerpt ?? deriveExcerptFromContent(optimisticContent);

  return {
    id: optimisticId,
    title: payload.title ?? '',
    checklist: payload.checklist ?? null,
    content: optimisticContent,
    excerpt: optimisticExcerpt,
    list_id: payload.list_id ?? 'optimistic',
    board_id: boardId,
    position: payload.position ?? 0,
    user_id: payload.user_id ?? null,
    tags: payload.tags ?? [],
    due_date: payload.due_date ?? null,
    due_start: payload.due_start ?? null,
    due_end: payload.due_end ?? null,
    start_reminder_enabled: payload.start_reminder_enabled ?? false,
    start_reminder_minutes: payload.start_reminder_minutes ?? 0,
    end_reminder_enabled: payload.end_reminder_enabled ?? false,
    end_reminder_minutes: payload.end_reminder_minutes ?? 0,
    due_bucket: payload.due_bucket ?? null,
    due_bucket_position: payload.due_bucket_position ?? null,
    started_at: payload.started_at ?? null,
    duration: payload.duration ?? 60,
    checked: payload.checked ?? false,
    assigned_to: payload.assigned_to ?? null,
    assignee_id: payload.assignee_id ?? null,
    assignee_ids: payload.assignee_ids ?? null,
    short_id: payload.short_id ?? null,
    id_short: payload.id_short ?? null,
    slug: payload.slug ?? null,
    created_at: payload.created_at ?? nowIso,
    updated_at: payload.updated_at ?? nowIso,
  };
}

export function calculateBucketInsertPosition(
  items: TimelineBucketItem[],
  afterCardId?: string,
  now: number = Date.now()
): number {
  if (!afterCardId) return now;

  const sortedItems = [...items].sort((a, b) => (b.bucketPosition ?? 0) - (a.bucketPosition ?? 0));
  const targetIndex = sortedItems.findIndex((item) => item.card_id === afterCardId);

  if (targetIndex !== -1) {
    const targetItem = sortedItems[targetIndex];
    const nextItem = sortedItems[targetIndex + 1];

    if (nextItem) {
      const p1 = targetItem.bucketPosition ?? 0;
      const p2 = nextItem.bucketPosition ?? 0;
      return (p1 + p2) / 2;
    }

    return (targetItem.bucketPosition ?? 0) - 1000;
  }

  const minPos = items.length > 0
    ? Math.min(...items.map((item) => item.bucketPosition ?? 0))
    : now;
  return minPos - 1000;
}
