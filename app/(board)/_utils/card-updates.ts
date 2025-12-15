
import type { TimelineResponse, TimelineEvent, TimelineBucketItem, TimelineDay } from "./timeline-helpers";
import type { Card } from "@/lib/supabase";
import { normalizeChecklist, EMPTY_CHECKLIST } from "@/lib/checklist";
import { getMinutesFromTime, toLocalDay } from "./timeline-helpers";
import { normalizeDueBucket } from "@/lib/bucket-normalization";

// Helper to resolve bucket key (duplicated from TimelineBoardPage for purity)
const resolveBucketKey = (card: Card, days: TimelineDay[]) => {
    let normalizedBucket: string | null = null;
    try {
        normalizedBucket = normalizeDueBucket(card.due_bucket);
    } catch (error) {
        console.error('[card-updates] invalid due_bucket', error);
        return null;
    }

    if (!normalizedBucket) return null;

    const localDay = toLocalDay(card.due_date ?? null);
    const matchedDay = days?.find((day) => toLocalDay(day.isoDate) === localDay);

    if (matchedDay?.key) {
        return `${matchedDay.key}_${normalizedBucket}`;
    }

    if (days?.[0]?.key) {
        return `${days[0].key}_${normalizedBucket}`;
    }

    return null;
};

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

    // 2. Add new instance for INSERT/UPDATE
    if (card.due_date) {
        // It's a timeline event
        const startMinutes = getMinutesFromTime(card.due_start);
        const endMinutes = getMinutesFromTime(card.due_end);
        const durationMinutes = startMinutes != null && endMinutes != null
            ? Math.max(endMinutes - startMinutes, 15)
            : 60;

        const newEvent: TimelineEvent = {
            card_id: card.id,
            due_date: card.due_date,
            due_start: card.due_start,
            due_end: card.due_end,
            durationMinutes,
            title: card.title,
            tags: card.tags ?? [],
            priority: card.priority,
            checked: card.checked,
            due_bucket: card.due_bucket ?? null,
            due_bucket_position: card.due_bucket_position ?? null,
            assignee_id: card.assignee_id,
            assignee_ids: card.assignee_ids ?? null,
            assigned_to: card.assigned_to,
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

    } else if (card.due_bucket) {
        // It's a bucket item
        const bucketKey = resolveBucketKey(card, prev.days);

        if (bucketKey) {
            if (!nextBuckets[bucketKey]) nextBuckets[bucketKey] = [];

            const newItem: TimelineBucketItem = {
                card_id: card.id,
                title: card.title,
                due_date: toLocalDay(card.due_date ?? null),
                due_start: card.due_start,
                due_end: card.due_end,
                checked: card.checked,
                tags: card.tags ?? [],
                assignee_id: card.assignee_id,
                assignee_ids: card.assignee_ids ?? null,
                assigned_to: card.assigned_to,
                short_id: card.short_id,
                slug: card.slug,
                bucketPosition: card.due_bucket_position,
            };

            nextBuckets[bucketKey].push(newItem);

            // Sort bucket items
            nextBuckets[bucketKey].sort((a, b) => (b.bucketPosition ?? 0) - (a.bucketPosition ?? 0));
        }
    }

    return { ...prev, events: nextEvents, abBuckets: nextBuckets };
}
