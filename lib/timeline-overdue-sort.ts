import type { TimelineOverdueItem } from "@/lib/api-types/timeline";

export type OverdueSortOrder = "oldest" | "newest";

const getOverdueTimeValue = (item: TimelineOverdueItem) => item.due_start ?? item.due_end ?? "";

export function compareTimelineOverdueItems(
  a: TimelineOverdueItem,
  b: TimelineOverdueItem,
  order: OverdueSortOrder = "newest"
) {
  const direction = order === "oldest" ? 1 : -1;

  const dateCompare = (a.due_date ?? "").localeCompare(b.due_date ?? "");
  if (dateCompare !== 0) return dateCompare * direction;

  const timeCompare = getOverdueTimeValue(a).localeCompare(getOverdueTimeValue(b));
  if (timeCompare !== 0) return timeCompare * direction;

  const aPos = a.due_bucket_position ?? 0;
  const bPos = b.due_bucket_position ?? 0;
  if (aPos !== bPos) return bPos - aPos;

  return (a.title ?? "").localeCompare(b.title ?? "");
}

export function sortTimelineOverdueItems(
  items: readonly TimelineOverdueItem[],
  order: OverdueSortOrder = "newest"
) {
  return [...items].sort((a, b) => compareTimelineOverdueItems(a, b, order));
}
