"use client";

import type {
  TimelineBucketItem,
  TimelineDay,
  TimelineEvent,
  TimelineResponse,
} from "@/app/(board)/_utils/timeline-helpers";

type MonthSectionKey = "a" | "timed" | "b";

export type MonthCardEntry =
  | { kind: "event"; item: TimelineEvent }
  | { kind: "bucket"; item: TimelineBucketItem; bucket: "a" | "b" };

export type MonthSection = {
  key: MonthSectionKey;
  label: string;
  items: MonthCardEntry[];
  visibleItems: MonthCardEntry[];
  hiddenCount: number;
};

export type MonthDayCell = {
  day: TimelineDay;
  inCurrentMonth: boolean;
  sections: MonthSection[];
  visibleEntries: MonthCardEntry[];
  hiddenTotalCount: number;
  completedCount: number;
  activeCount: number;
  totalCount: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export const addDaysToIsoDate = (isoDate: string, delta: number) => {
  const base = new Date(`${isoDate}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + delta);
  return base.toISOString().slice(0, 10);
};

export const getMonthGridSpec = (anchorIsoDate: string) => {
  const anchor = new Date(`${anchorIsoDate}T00:00:00Z`);
  const startOfMonth = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
  const endOfMonth = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0));
  const startWeekday = (startOfMonth.getUTCDay() + 6) % 7;
  const endWeekday = (endOfMonth.getUTCDay() + 6) % 7;
  const gridStart = new Date(startOfMonth.getTime() - startWeekday * DAY_MS);
  const trailingDays = 6 - endWeekday;
  const gridEnd = new Date(endOfMonth.getTime() + trailingDays * DAY_MS);
  const totalDays = Math.round((gridEnd.getTime() - gridStart.getTime()) / DAY_MS) + 1;
  const weeks = totalDays <= 35 ? 5 : 6;
  const range = weeks * 7;

  return {
    anchorIsoDate: startOfMonth.toISOString().slice(0, 10),
    monthStartIso: startOfMonth.toISOString().slice(0, 10),
    monthEndIso: endOfMonth.toISOString().slice(0, 10),
    gridStartIso: gridStart.toISOString().slice(0, 10),
    range,
    weeks,
  };
};

export const normalizeMonthAnchorDate = (anchorIsoDate: string) => getMonthGridSpec(anchorIsoDate).monthStartIso;

export const formatMonthTitle = (anchorIsoDate: string) => {
  const date = new Date(`${anchorIsoDate}T00:00:00Z`);
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
  }).format(date);
};

export const formatMonthDayNumber = (isoDate: string) => {
  const [, month, day] = isoDate.split("-");
  const dayNumber = Number(day);
  if (dayNumber === 1) {
    return `${Number(month)}/${dayNumber}`;
  }
  return String(dayNumber);
};

export const buildMonthCells = ({
  days,
  eventsByDay,
  abBuckets,
  anchorIsoDate,
  maxVisiblePerSection = 2,
  maxVisibleTotal = 2,
}: {
  days: TimelineResponse["days"];
  eventsByDay: Record<string, TimelineEvent[]>;
  abBuckets: TimelineResponse["abBuckets"];
  anchorIsoDate: string;
  maxVisiblePerSection?: number;
  maxVisibleTotal?: number;
}): MonthDayCell[] => {
  const monthGrid = getMonthGridSpec(anchorIsoDate);
  const anchorMonth = monthGrid.monthStartIso.slice(0, 7);
  const daysByIso = new Map(days.map((day) => [day.isoDate, day]));
  const monthDays = Array.from({ length: monthGrid.range }, (_, index) => {
    const isoDate = addDaysToIsoDate(monthGrid.gridStartIso, index);
    return daysByIso.get(isoDate);
  }).filter((day): day is TimelineDay => Boolean(day));

  return monthDays.map((day) => {
    const timedEvents = [...(eventsByDay[day.isoDate] ?? [])]
      .sort((left, right) => (left.due_start ?? "").localeCompare(right.due_start ?? ""))
    const bucketA = [...(abBuckets[`${day.key}_a`] ?? [])]
      .sort((left, right) => (left.bucketPosition ?? 0) - (right.bucketPosition ?? 0))
      .map((item) => ({ kind: "bucket" as const, item, bucket: "a" as const }));
    const bucketB = [...(abBuckets[`${day.key}_b`] ?? [])]
      .sort((left, right) => (left.bucketPosition ?? 0) - (right.bucketPosition ?? 0))
      .map((item) => ({ kind: "bucket" as const, item, bucket: "b" as const }));

    const completedCount =
      timedEvents.filter((item) => item.checked).length +
      bucketA.filter((entry) => entry.item.checked).length +
      bucketB.filter((entry) => entry.item.checked).length;

    const timedItems = timedEvents.filter((item) => !item.checked).map((item) => ({ kind: "event" as const, item }));
    const bucketAItems = bucketA.filter((entry) => !entry.item.checked);
    const bucketBItems = bucketB.filter((entry) => !entry.item.checked);

    const sections: MonthSection[] = [
      { key: "a", label: "A", items: bucketAItems, visibleItems: bucketAItems.slice(0, maxVisiblePerSection), hiddenCount: Math.max(0, bucketAItems.length - maxVisiblePerSection) },
      { key: "timed", label: "時間", items: timedItems, visibleItems: timedItems.slice(0, maxVisiblePerSection), hiddenCount: Math.max(0, timedItems.length - maxVisiblePerSection) },
      { key: "b", label: "B", items: bucketBItems, visibleItems: bucketBItems.slice(0, maxVisiblePerSection), hiddenCount: Math.max(0, bucketBItems.length - maxVisiblePerSection) },
    ];
  const visibleEntries = [...bucketAItems, ...timedItems, ...bucketBItems].slice(0, maxVisibleTotal);
    const hiddenTotalCount = Math.max(
      0,
      bucketAItems.length + timedItems.length + bucketBItems.length - visibleEntries.length,
    );

    return {
      day,
      inCurrentMonth: day.isoDate.slice(0, 7) === anchorMonth,
      sections,
      visibleEntries,
      hiddenTotalCount,
      completedCount,
      activeCount: visibleEntries.length + hiddenTotalCount,
      totalCount: sections.reduce((sum, section) => sum + section.items.length, 0),
    };
  });
};
