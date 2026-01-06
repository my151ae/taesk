
import type { TimelineResponse, TimelineEvent, TimelineBucketItem, TimelineDay } from "./timeline-helpers";
import type { Card } from "@/lib/supabase";
import { normalizeChecklist, EMPTY_CHECKLIST } from "@/lib/checklist";
import { getMinutesFromTime, toLocalDay } from "./timeline-helpers";
import { normalizeDueBucket } from "@/lib/bucket-normalization";

const DEFAULT_AB_BUCKET = "b";

function resolveBucketKey(
    days: TimelineDay[],
    localDay: string,
    bucket: string
) {
    const matchedDay = days?.find((day) => toLocalDay(day.isoDate) === localDay);
    const dayKey = matchedDay?.key ?? days?.[0]?.key ?? null;
    if (!dayKey) return null;
    return `${dayKey}_${bucket}`;
}

export function applyCardUpdate(
    prev: TimelineResponse,
    card: Card,
    eventType: 'INSERT' | 'UPDATE' | 'DELETE'
): TimelineResponse {
    const nextEvents = [...prev.events];
    const nextBuckets = { ...prev.abBuckets };

    // 1. Remove existing instance to avoid duplicates
    const removeCard = (cardId: string) => {
        // Remove from events
        const eventIdx = nextEvents.findIndex(e => e.card_id === cardId);
        if (eventIdx >= 0) nextEvents.splice(eventIdx, 1);

        // Remove from buckets
        Object.keys(nextBuckets).forEach(key => {
            nextBuckets[key] = nextBuckets[key].filter(item => item.card_id !== cardId);
        });
    };

    const cardId = card.id;
    if (!cardId) return prev; // Should not happen

    removeCard(cardId);

    if (eventType === 'DELETE') {
        return { ...prev, events: nextEvents, abBuckets: nextBuckets };
    }

    const checklist = normalizeChecklist((card as any).checklist ?? EMPTY_CHECKLIST);
    const localDay = toLocalDay(card.due_date ?? null);
    const hasTime = Boolean(card.due_start && card.due_end);

    // 2. Add new instance for INSERT/UPDATE
    // Keep the same logic as `app/api/boards/[boardId]/timeline/route.ts`:
    // - due_date + (due_start && due_end) => timeline event
    // - due_date + no time => A/B list (default bucket "b" if missing)
    if (localDay && hasTime) {
        // Timeline event
        const startMinutes = getMinutesFromTime(card.due_start);
        const endMinutes = getMinutesFromTime(card.due_end);
        const durationMinutes = startMinutes != null && endMinutes != null
            ? Math.max(endMinutes - startMinutes, 15)
            : 60;

        const newEvent: TimelineEvent = {
            card_id: card.id,
            due_date: localDay,
            due_start: card.due_start,
            due_end: card.due_end,
            durationMinutes,
            title: card.title,
            content: (card as any).content ?? null,
            excerpt: card.excerpt ?? null,
            tags: card.tags ?? [],
            priority: card.priority,
            checked: card.checked,
            checklist,
            due_bucket: card.due_bucket ?? null,
            due_bucket_position: card.due_bucket_position ?? null,
            assignee_id: card.assignee_id,
            assignee_ids: card.assignee_ids ?? null,
            assigned_to: card.assigned_to,
            duration: card.duration ?? null,
            short_id: card.short_id,
            slug: card.slug,
        };

        nextEvents.push(newEvent);

        // Sort events
        nextEvents.sort((a, b) => {
            if (a.due_date === b.due_date) {
                const aStart = getMinutesFromTime(a.due_start) ?? 0;
                const bStart = getMinutesFromTime(b.due_start) ?? 0;
                return aStart - bStart;
            }
            return (a.due_date ?? '').localeCompare(b.due_date ?? '');
        });

    } else if (localDay) {
        // A/B list
        let bucket = DEFAULT_AB_BUCKET;
        try {
            bucket = normalizeDueBucket(card.due_bucket) ?? DEFAULT_AB_BUCKET;
        } catch (error) {
            console.error('[card-updates] invalid due_bucket; falling back to "b"', error);
            bucket = DEFAULT_AB_BUCKET;
        }

        const bucketKey = resolveBucketKey(prev.days, localDay, bucket);
        if (!bucketKey) {
            return { ...prev, events: nextEvents, abBuckets: nextBuckets };
        }

        if (!nextBuckets[bucketKey]) nextBuckets[bucketKey] = [];

        const newItem: TimelineBucketItem = {
            card_id: card.id,
            title: card.title,
            content: (card as any).content ?? null,
            excerpt: card.excerpt ?? null,
            due_date: localDay,
            due_start: card.due_start,
            due_end: card.due_end,
            checked: card.checked,
            checklist,
            tags: card.tags ?? [],
            assignee_id: card.assignee_id,
            assignee_ids: card.assignee_ids ?? null,
            assigned_to: card.assigned_to,
            duration: card.duration ?? null,
            short_id: card.short_id,
            slug: card.slug,
            bucketPosition: card.due_bucket_position,
        };

        nextBuckets[bucketKey].push(newItem);

        // Sort bucket items (position desc, then title for stability)
        nextBuckets[bucketKey].sort((a, b) => {
            const aPos = a.bucketPosition ?? 0;
            const bPos = b.bucketPosition ?? 0;
            if (aPos !== bPos) return bPos - aPos;
            return (a.title ?? "").localeCompare(b.title ?? "");
        });
    }

    return { ...prev, events: nextEvents, abBuckets: nextBuckets };
}
