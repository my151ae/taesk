import type React from 'react';

import {
  TimelineEvent,
  TimelineBucketItem,
  TimelineOverdueItem,
  TimelineResponse,
  getIsoDateJst,
  getMinutesFromTime,
  toLocalDay,
} from '@/app/(board)/_utils/timeline-helpers';
import { sortTimelineOverdueItems } from '@/lib/timeline-overdue-sort';
import type { DueBucket } from '@/lib/supabase';

export type PlacementMeta = {
  target: 'timeline' | 'bucket';
  bucketKey?: string;
  sourceEvent?: TimelineEvent;
  sourceBucketItem?: TimelineBucketItem;
  sourceOverdueItem?: TimelineOverdueItem;
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
      const nextOverdue = [...(current.overdue ?? [])];

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

      let removedOverdueItem: TimelineOverdueItem | null = null;
      const overdueIndex = nextOverdue.findIndex((item) => item.card_id === cardId);
      if (overdueIndex >= 0) {
        removedOverdueItem = nextOverdue.splice(overdueIndex, 1)[0];
      }

      const baseEvent = removedEvent ?? meta.sourceEvent ?? null;
      const baseBucketItem = removedBucketItem ?? meta.sourceBucketItem ?? null;
      const baseOverdueItem = removedOverdueItem ?? meta.sourceOverdueItem ?? null;

      const payloadDueDate = (payload.due_date as string | null) ?? null;
      const previousChecked = baseEvent?.checked ?? baseBucketItem?.checked ?? baseOverdueItem?.checked ?? false;
      const nextChecked =
        typeof payload.checked === 'boolean'
          ? payload.checked
          : previousChecked;
      const nextCheckedAt =
        previousChecked === nextChecked
          ? (baseEvent?.checked_at ?? baseBucketItem?.checked_at ?? baseOverdueItem?.checked_at ?? null)
          : nextChecked
            ? new Date().toISOString()
            : null;
      const upsertOverdueShortcut = (args: {
        dueDate: string | null;
        dueStart: string | null;
        dueEnd: string | null;
        dueBucket: DueBucket | null;
        dueBucketPosition: number | null;
      }) => {
        const todayIso = getIsoDateJst(new Date().toISOString());
        const isOverdue = Boolean(args.dueDate && args.dueDate < todayIso && !nextChecked);
        if (!isOverdue) return;

        nextOverdue.push({
          card_id: cardId,
          title: baseOverdueItem?.title ?? baseEvent?.title ?? baseBucketItem?.title ?? 'Untitled card',
          content: baseOverdueItem?.content ?? baseEvent?.content ?? baseBucketItem?.content ?? null,
          excerpt: baseOverdueItem?.excerpt ?? baseEvent?.excerpt ?? baseBucketItem?.excerpt ?? null,
          due_date: args.dueDate,
          due_start: args.dueStart,
          due_end: args.dueEnd,
          start_reminder_enabled:
            baseOverdueItem?.start_reminder_enabled ??
            baseEvent?.start_reminder_enabled ??
            baseBucketItem?.start_reminder_enabled ??
            false,
          start_reminder_minutes:
            baseOverdueItem?.start_reminder_minutes ??
            baseEvent?.start_reminder_minutes ??
            baseBucketItem?.start_reminder_minutes ??
            0,
          end_reminder_enabled:
            baseOverdueItem?.end_reminder_enabled ??
            baseEvent?.end_reminder_enabled ??
            baseBucketItem?.end_reminder_enabled ??
            false,
          end_reminder_minutes:
            baseOverdueItem?.end_reminder_minutes ??
            baseEvent?.end_reminder_minutes ??
            baseBucketItem?.end_reminder_minutes ??
            0,
          checked: nextChecked,
          checked_at: nextCheckedAt,
          checklist: baseOverdueItem?.checklist ?? baseEvent?.checklist ?? baseBucketItem?.checklist ?? null,
          tags: baseOverdueItem?.tags ?? baseEvent?.tags ?? baseBucketItem?.tags ?? [],
          assignee_id: baseOverdueItem?.assignee_id ?? baseEvent?.assignee_id ?? baseBucketItem?.assignee_id ?? null,
          assignee_ids:
            baseOverdueItem?.assignee_ids ?? baseEvent?.assignee_ids ?? baseBucketItem?.assignee_ids ?? null,
          assigned_to:
            baseOverdueItem?.assigned_to ?? baseEvent?.assigned_to ?? baseBucketItem?.assigned_to ?? null,
          duration:
            baseOverdueItem?.duration ??
            baseBucketItem?.duration ??
            baseEvent?.duration ??
            baseEvent?.durationMinutes ??
            meta.defaultDuration ??
            60,
          due_bucket: args.dueBucket,
          due_bucket_position: args.dueBucketPosition,
          short_id: baseOverdueItem?.short_id ?? baseEvent?.short_id ?? baseBucketItem?.short_id ?? null,
          slug: baseOverdueItem?.slug ?? baseEvent?.slug ?? baseBucketItem?.slug ?? null,
        });
        const sortedOverdue = sortTimelineOverdueItems(nextOverdue);
        nextOverdue.splice(0, nextOverdue.length, ...sortedOverdue);
      };

      if (meta.target === 'timeline') {
        const nextStart =
          (payload.due_start as string | null) ??
          baseEvent?.due_start ??
          baseBucketItem?.due_start ??
          null;
        const nextEnd =
          (payload.due_end as string | null) ??
          baseEvent?.due_end ??
          baseOverdueItem?.due_end ??
          baseBucketItem?.due_end ??
          null;
        const nextDate =
          meta.localDueDate ??
          toLocalDay(payloadDueDate) ??
          baseEvent?.due_date ??
          baseOverdueItem?.due_date ??
          baseBucketItem?.due_date ??
          null;
        const startMinutes = getMinutesFromTime(nextStart);
        const endMinutes = getMinutesFromTime(nextEnd);
        const durationMinutes =
          startMinutes != null && endMinutes != null
            ? Math.max(endMinutes - startMinutes, 0)
            : baseEvent?.durationMinutes ??
              baseEvent?.duration ??
              baseOverdueItem?.duration ??
              baseBucketItem?.duration ??
          meta.defaultDuration ??
          60;
        const nextDueBucket =
          (payload.due_bucket as DueBucket | null) ??
          baseEvent?.due_bucket ??
          baseOverdueItem?.due_bucket ??
          baseBucketItem?.due_bucket ??
          null;
        const nextDueBucketPosition =
          (payload.due_bucket_position as number | null) ??
          baseEvent?.due_bucket_position ??
          baseOverdueItem?.due_bucket_position ??
          baseBucketItem?.bucketPosition ??
          null;

        const replacement: TimelineEvent = {
          card_id: cardId,
          due_date: nextDate ?? '',
          due_start: nextStart,
          due_end: nextEnd,
          due_bucket: nextDueBucket,
          durationMinutes,
          title: baseEvent?.title ?? baseOverdueItem?.title ?? baseBucketItem?.title ?? 'Untitled card',
          content: baseEvent?.content ?? baseOverdueItem?.content ?? baseBucketItem?.content ?? null,
          excerpt: baseEvent?.excerpt ?? baseOverdueItem?.excerpt ?? baseBucketItem?.excerpt ?? null,
          tags: baseEvent?.tags ?? baseOverdueItem?.tags ?? baseBucketItem?.tags ?? [],
          checklist: baseEvent?.checklist ?? baseOverdueItem?.checklist ?? baseBucketItem?.checklist ?? null,
          checked: nextChecked,
          checked_at: nextCheckedAt,
          assignee_id: baseEvent?.assignee_id ?? baseOverdueItem?.assignee_id ?? baseBucketItem?.assignee_id ?? null,
          assignee_ids: baseEvent?.assignee_ids ?? baseOverdueItem?.assignee_ids ?? baseBucketItem?.assignee_ids ?? null,
          assigned_to: baseEvent?.assigned_to ?? baseOverdueItem?.assigned_to ?? baseBucketItem?.assigned_to ?? null,
          short_id: baseEvent?.short_id ?? baseOverdueItem?.short_id ?? baseBucketItem?.short_id ?? null,
          slug: baseEvent?.slug ?? baseOverdueItem?.slug ?? baseBucketItem?.slug ?? null,
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
        upsertOverdueShortcut({
          dueDate: nextDate,
          dueStart: nextStart,
          dueEnd: nextEnd,
          dueBucket: nextDueBucket,
          dueBucketPosition: nextDueBucketPosition,
        });

        return { ...current, events: nextEvents, abBuckets: nextBuckets, overdue: nextOverdue };
      }

      if (meta.target === 'bucket' && meta.bucketKey) {
        if (!nextBuckets[meta.bucketKey]) {
          nextBuckets[meta.bucketKey] = [];
        }

        const bucketItems = nextBuckets[meta.bucketKey];
        const bucketPosition = (payload.due_bucket_position as number | null) ?? Date.now();
        const nextDueDate =
          meta.localDueDate ?? toLocalDay(payloadDueDate) ?? baseBucketItem?.due_date ?? baseOverdueItem?.due_date ?? null;
        const nextDueBucket =
          (payload.due_bucket as DueBucket | null) ?? baseBucketItem?.due_bucket ?? baseOverdueItem?.due_bucket ?? null;
        const nextBucketItem: TimelineBucketItem = {
          card_id: cardId,
          title: baseBucketItem?.title ?? baseOverdueItem?.title ?? baseEvent?.title ?? 'Untitled card',
          content: baseBucketItem?.content ?? baseOverdueItem?.content ?? baseEvent?.content ?? null,
          excerpt: baseBucketItem?.excerpt ?? baseOverdueItem?.excerpt ?? baseEvent?.excerpt ?? null,
          due_date: nextDueDate,
          due_start: (payload.due_start as string | null) ?? null,
          due_end: (payload.due_end as string | null) ?? null,
          checked: nextChecked,
          checked_at: nextCheckedAt,
          checklist: baseBucketItem?.checklist ?? baseOverdueItem?.checklist ?? baseEvent?.checklist ?? null,
          tags: baseBucketItem?.tags ?? baseOverdueItem?.tags ?? baseEvent?.tags ?? [],
          assignee_id: baseBucketItem?.assignee_id ?? baseOverdueItem?.assignee_id ?? baseEvent?.assignee_id ?? null,
          assignee_ids: baseBucketItem?.assignee_ids ?? baseOverdueItem?.assignee_ids ?? baseEvent?.assignee_ids ?? null,
          assigned_to: baseBucketItem?.assigned_to ?? baseOverdueItem?.assigned_to ?? baseEvent?.assigned_to ?? null,
          due_bucket: nextDueBucket,
          short_id: baseBucketItem?.short_id ?? baseOverdueItem?.short_id ?? baseEvent?.short_id ?? null,
          slug: baseBucketItem?.slug ?? baseOverdueItem?.slug ?? baseEvent?.slug ?? null,
          duration:
            baseBucketItem?.duration ??
            baseOverdueItem?.duration ??
            baseEvent?.durationMinutes ??
            baseEvent?.duration ??
            meta.defaultDuration ??
            60,
          bucketPosition,
        };

        bucketItems.unshift(nextBucketItem);
        bucketItems.sort((a, b) => (b.bucketPosition ?? 0) - (a.bucketPosition ?? 0));
        upsertOverdueShortcut({
          dueDate: nextDueDate,
          dueStart: nextBucketItem.due_start,
          dueEnd: nextBucketItem.due_end,
          dueBucket: nextDueBucket,
          dueBucketPosition: bucketPosition,
        });
        return { ...current, events: nextEvents, abBuckets: nextBuckets, overdue: nextOverdue };
      }

      return current;
    });

    if (dataMode === 'api') {
      void applyPatch(cardId, payload);
    }
  };
}
