import type React from 'react';

import {
  TimelineEvent,
  TimelineBucketItem,
  TimelineResponse,
  getMinutesFromTime,
  toLocalDay,
} from '@/app/(board)/_utils/timeline-helpers';
import type { DueBucket } from '@/lib/supabase';

export type PlacementMeta = {
  target: 'timeline' | 'bucket';
  bucketKey?: string;
  sourceEvent?: TimelineEvent;
  sourceBucketItem?: TimelineBucketItem;
  defaultDuration?: number;
  localDueDate?: string | null;
};

type CreatePersistPlacementArgs = {
  setData: React.Dispatch<React.SetStateAction<TimelineResponse | null>>;
  dataMode: 'api' | 'mock';
  applyPatch: (cardId: string, payload: Record<string, unknown>) => Promise<void>;
};

export function createPersistPlacement({
  setData,
  dataMode,
  applyPatch,
}: CreatePersistPlacementArgs) {
  return (cardId: string, payload: Record<string, unknown>, meta: PlacementMeta) => {
    setData((current) => {
      if (!current) return current;

      const nextEvents = [...current.events];
      const nextBuckets = Object.entries(current.abBuckets || {}).reduce(
        (acc, [key, items]) => {
          acc[key] = [...(items ?? [])];
          return acc;
        },
        {} as Record<string, TimelineBucketItem[]>
      );

      let removedBucketItem: TimelineBucketItem | null = null;
      Object.values(nextBuckets).forEach((items) => {
        const index = items.findIndex((item) => item.card_id === cardId);
        if (index >= 0) {
          removedBucketItem = items[index];
          items.splice(index, 1);
        }
      });

      let removedEvent: TimelineEvent | null = null;
      const eventIndex = nextEvents.findIndex((event) => event.card_id === cardId);
      if (eventIndex >= 0) {
        removedEvent = nextEvents.splice(eventIndex, 1)[0];
      }

      const baseEvent = removedEvent ?? meta.sourceEvent ?? null;
      const baseBucketItem = removedBucketItem ?? meta.sourceBucketItem ?? null;

      const payloadDueDate = (payload.due_date as string | null) ?? null;

      if (meta.target === 'timeline') {
        const nextStart =
          (payload.due_start as string | null) ??
          baseEvent?.due_start ??
          baseBucketItem?.due_start ??
          null;
        const nextEnd =
          (payload.due_end as string | null) ??
          baseEvent?.due_end ??
          baseBucketItem?.due_end ??
          null;
        const nextDate =
          meta.localDueDate ??
          toLocalDay(payloadDueDate) ??
          baseEvent?.due_date ??
          baseBucketItem?.due_date ??
          null;
        const startMinutes = getMinutesFromTime(nextStart);
        const endMinutes = getMinutesFromTime(nextEnd);
        const durationMinutes =
          startMinutes != null && endMinutes != null
            ? Math.max(endMinutes - startMinutes, 0)
            : baseEvent?.durationMinutes ??
              baseEvent?.duration ??
              baseBucketItem?.duration ??
              meta.defaultDuration ??
              60;

        const replacement: TimelineEvent = {
          card_id: cardId,
          due_date: nextDate ?? '',
          due_start: nextStart,
          due_end: nextEnd,
          due_bucket: (payload.due_bucket as DueBucket | null) ?? baseEvent?.due_bucket ?? null,
          durationMinutes,
          title: baseEvent?.title ?? baseBucketItem?.title ?? 'Untitled card',
          content: baseEvent?.content ?? baseBucketItem?.content ?? null,
          excerpt: baseEvent?.excerpt ?? baseBucketItem?.excerpt ?? null,
          tags: baseEvent?.tags ?? baseBucketItem?.tags ?? [],
          checklist: baseEvent?.checklist ?? baseBucketItem?.checklist ?? null,
          checked: baseEvent?.checked ?? baseBucketItem?.checked ?? false,
          assignee_id: baseEvent?.assignee_id ?? baseBucketItem?.assignee_id ?? null,
          assignee_ids: baseEvent?.assignee_ids ?? baseBucketItem?.assignee_ids ?? null,
          assigned_to: baseEvent?.assigned_to ?? baseBucketItem?.assigned_to ?? null,
          short_id: baseEvent?.short_id ?? baseBucketItem?.short_id ?? null,
          slug: baseEvent?.slug ?? baseBucketItem?.slug ?? null,
        };

        nextEvents.push(replacement);
        nextEvents.sort((a, b) => {
          if (a.due_date === b.due_date) {
            const aStart = getMinutesFromTime(a.due_start) ?? 0;
            const bStart = getMinutesFromTime(b.due_start) ?? 0;
            return aStart - bStart;
          }
          return (a.due_date ?? '').localeCompare(b.due_date ?? '');
        });

        return { ...current, events: nextEvents, abBuckets: nextBuckets };
      }

      if (meta.target === 'bucket' && meta.bucketKey) {
        if (!nextBuckets[meta.bucketKey]) {
          nextBuckets[meta.bucketKey] = [];
        }

        const bucketItems = nextBuckets[meta.bucketKey];
        const bucketPosition = (payload.due_bucket_position as number | null) ?? Date.now();
        const nextBucketItem: TimelineBucketItem = {
          card_id: cardId,
          title: baseBucketItem?.title ?? baseEvent?.title ?? 'Untitled card',
          content: baseBucketItem?.content ?? baseEvent?.content ?? null,
          excerpt: baseBucketItem?.excerpt ?? baseEvent?.excerpt ?? null,
          due_date: meta.localDueDate ?? toLocalDay(payloadDueDate) ?? baseBucketItem?.due_date ?? null,
          due_start: (payload.due_start as string | null) ?? null,
          due_end: (payload.due_end as string | null) ?? null,
          checked: baseBucketItem?.checked ?? baseEvent?.checked ?? false,
          checklist: baseBucketItem?.checklist ?? baseEvent?.checklist ?? null,
          tags: baseBucketItem?.tags ?? baseEvent?.tags ?? [],
          assignee_id: baseBucketItem?.assignee_id ?? baseEvent?.assignee_id ?? null,
          assignee_ids: baseBucketItem?.assignee_ids ?? baseEvent?.assignee_ids ?? null,
          assigned_to: baseBucketItem?.assigned_to ?? baseEvent?.assigned_to ?? null,
          short_id: baseBucketItem?.short_id ?? baseEvent?.short_id ?? null,
          slug: baseBucketItem?.slug ?? baseEvent?.slug ?? null,
          duration:
            baseBucketItem?.duration ??
            baseEvent?.durationMinutes ??
            baseEvent?.duration ??
            meta.defaultDuration ??
            60,
          bucketPosition,
        };

        bucketItems.unshift(nextBucketItem);
        bucketItems.sort((a, b) => (b.bucketPosition ?? 0) - (a.bucketPosition ?? 0));
        return { ...current, events: nextEvents, abBuckets: nextBuckets };
      }

      return current;
    });

    if (dataMode === 'api') {
      void applyPatch(cardId, payload);
    }
  };
}
