"use client";

import type { Card, DueBucket } from "@/lib/supabase";
import {
  DEFAULT_TIMELINE_DAY_RANGE,
  formatDayLabel,
  toLocalDay,
  type TimelineBucketItem,
  type TimelineDay,
  type TimelineResponse,
} from "@/app/(board)/_utils/timeline-helpers";
import { normalizeDueBucket } from "@/lib/bucket-normalization";

export const buildMockTimeline = (range: number = DEFAULT_TIMELINE_DAY_RANGE): TimelineResponse => {
  const base = new Date();
  const format = (offsetDays: number) => {
    const next = new Date(base.getTime() + offsetDays * 24 * 60 * 60 * 1000);
    const year = next.getFullYear();
    const month = `${next.getMonth() + 1}`.padStart(2, "0");
    const day = `${next.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
  };
  const today = format(0);
  const days = Array.from({ length: range }, (_, offset) => {
    const isoDate = format(offset);
    return {
      key: isoDate,
      label: formatDayLabel(isoDate, today),
      isoDate,
    };
  });

  const events: TimelineResponse["events"] = [];

  if (days[0]) {
    events.push(
      {
        card_id: "mock-spec",
  parent_card_id: null,
  is_parent: false,
  child_count: 0,
        due_date: days[0].isoDate,
        due_start: "09:30:00",
        due_end: "10:30:00",
        durationMinutes: 60,
        title: "Spec writing",
        tags: [],
        checked: false,
        checked_at: null,
        short_id: null,
        slug: null,
      },
      {
        card_id: "mock-deepwork-a",
  parent_card_id: null,
  is_parent: false,
  child_count: 0,
        due_date: days[0].isoDate,
        due_start: "13:00:00",
        due_end: "14:00:00",
        durationMinutes: 60,
        title: "Deep work A",
        tags: [],
        checked: false,
        checked_at: null,
        short_id: null,
        slug: null,
      },
      {
        card_id: "mock-deepwork-b",
  parent_card_id: null,
  is_parent: false,
  child_count: 0,
        due_date: days[0].isoDate,
        due_start: "13:30:00",
        due_end: "14:30:00",
        durationMinutes: 60,
        title: "Deep work B",
        tags: [],
        checked: false,
        checked_at: null,
        short_id: null,
        slug: null,
      },
    );
  }

  if (days[1]) {
    events.push({
      card_id: "mock-design-review",
  parent_card_id: null,
  is_parent: false,
  child_count: 0,
      due_date: days[1].isoDate,
      due_start: "10:00:00",
      due_end: "11:00:00",
      durationMinutes: 60,
      title: "Design review",
      tags: [],
      checked: false,
      checked_at: null,
      short_id: null,
      slug: null,
    });
  }

  const abBuckets = days.reduce((acc, day, index) => {
    const aKey = `${day.key}_a`;
    const bKey = `${day.key}_b`;
    acc[aKey] = [];
    acc[bKey] = [];

    if (index === 0) {
      acc[aKey].push(
        {
          card_id: "mock-finish-spec",
  parent_card_id: null,
  is_parent: false,
  child_count: 0,
          title: "Finish spec",
          due_date: day.isoDate,
          due_start: null,
          due_end: null,
          checked: false,
          checked_at: null,
          tags: [],
          short_id: null,
          slug: null,
          bucketPosition: 4000,
        },
        {
          card_id: "mock-prepare-meeting",
  parent_card_id: null,
  is_parent: false,
  child_count: 0,
          title: "Prepare meeting",
          due_date: day.isoDate,
          due_start: null,
          due_end: null,
          checked: false,
          checked_at: null,
          tags: [],
          short_id: null,
          slug: null,
          bucketPosition: 3900,
        },
        {
          card_id: "mock-fix-bug",
  parent_card_id: null,
  is_parent: false,
  child_count: 0,
          title: "Fix bug #123",
          due_date: day.isoDate,
          due_start: null,
          due_end: null,
          checked: false,
          checked_at: null,
          tags: [],
          short_id: null,
          slug: null,
          bucketPosition: 3800,
        },
      );
      acc[bKey].push(
        {
          card_id: "mock-organize-docs",
  parent_card_id: null,
  is_parent: false,
  child_count: 0,
          title: "Organize docs",
          due_date: day.isoDate,
          due_start: null,
          due_end: null,
          checked: false,
          checked_at: null,
          tags: [],
          short_id: null,
          slug: null,
          bucketPosition: 3600,
        },
        {
          card_id: "mock-break-task",
  parent_card_id: null,
  is_parent: false,
  child_count: 0,
          title: "Break down big task",
          due_date: day.isoDate,
          due_start: null,
          due_end: null,
          checked: false,
          checked_at: null,
          tags: [],
          short_id: null,
          slug: null,
          bucketPosition: 3500,
        },
      );
    }

    if (index === 1) {
      acc[aKey].push(
        {
          card_id: "mock-finish-review",
  parent_card_id: null,
  is_parent: false,
  child_count: 0,
          title: "Finish review",
          due_date: day.isoDate,
          due_start: null,
          due_end: null,
          checked: false,
          checked_at: null,
          tags: [],
          short_id: null,
          slug: null,
          bucketPosition: 3400,
        },
        {
          card_id: "mock-prepare-slides",
  parent_card_id: null,
  is_parent: false,
  child_count: 0,
          title: "Prepare slides",
          due_date: day.isoDate,
          due_start: null,
          due_end: null,
          checked: false,
          checked_at: null,
          tags: [],
          short_id: null,
          slug: null,
          bucketPosition: 3300,
        },
      );
      acc[bKey].push(
        {
          card_id: "mock-refactor",
  parent_card_id: null,
  is_parent: false,
  child_count: 0,
          title: "Refactor old code",
          due_date: day.isoDate,
          due_start: null,
          due_end: null,
          checked: false,
          checked_at: null,
          tags: [],
          short_id: null,
          slug: null,
          bucketPosition: 3200,
        },
        {
          card_id: "mock-research",
  parent_card_id: null,
  is_parent: false,
  child_count: 0,
          title: "Research item",
          due_date: day.isoDate,
          due_start: null,
          due_end: null,
          checked: false,
          checked_at: null,
          tags: [],
          short_id: null,
          slug: null,
          bucketPosition: 3100,
        },
      );
    }

    return acc;
  }, {} as Record<string, TimelineBucketItem[]>);

  return {
    days,
    events,
    abBuckets,
    overdue: [],
    serverNow: new Date().toISOString(),
    startOffset: 0,
    range,
  };
};

export const resolveBucketKey = (card: Card, days: TimelineDay[]) => {
  let normalizedBucket: DueBucket | null = null;
  try {
    normalizedBucket = normalizeDueBucket(card.due_bucket);
  } catch (error) {
    console.error("[timeline] invalid due_bucket received", {
      cardId: card.id,
      due_bucket: card.due_bucket,
      error,
    });
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
