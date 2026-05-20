"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSONContent } from "@tiptap/react";

import type { DueBucket } from "@/lib/supabase";
import {
  countCheckedLines,
  countNonEmptyLines,
  normalizeChecklist,
  type Checklist,
} from "@/lib/checklist";

type ChildCardSummary = {
  id: string;
  short_id: string | null;
  title: string;
  checklist: Checklist | null;
  content: JSONContent | null;
  due_date: string | null;
  due_start: string | null;
  due_end: string | null;
  due_bucket: DueBucket | null;
  created_at: string;
};

export type ChildCardLinkSummary = {
  id: string;
  shortId: string | null;
  title: string;
  dateLabel: string;
  timeLabel: string;
  bucketLabel: string;
  checklistChecked: number;
  checklistTotal: number;
  linkMeta: string;
};

type UseChildCardSummariesArgs = {
  boardId: string;
  cardId: string;
  isParent: boolean;
  childCount?: number | null;
  refreshKey?: number;
};

const formatChildCardDate = (value: string | null) => {
  if (!value) return "日付なし";
  const date = new Date(value.includes("T") ? value : `${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(date);
};

const formatChildCardTimeRange = (start: string | null, end: string | null) => {
  if (!start && !end) return "時間なし";
  if (start && end) return `${start.slice(0, 5)}-${end.slice(0, 5)}`;
  return (start ?? end ?? "").slice(0, 5);
};

const formatChildCardBucket = (bucket: DueBucket | null) => (bucket ? bucket.toUpperCase() : "-");

const countTaskItemsInContent = (content: JSONContent | null | undefined) => {
  const progress = { checked: 0, total: 0 };

  const visit = (node: JSONContent | null | undefined) => {
    if (!node) return;
    if (node.type === "taskItem") {
      progress.total += 1;
      if (node.attrs?.checked === true) {
        progress.checked += 1;
      }
    }
    node.content?.forEach((child) => visit(child));
  };

  visit(content);
  return progress;
};

export function useChildCardSummaries({
  boardId,
  cardId,
  isParent,
  childCount,
  refreshKey = 0,
}: UseChildCardSummariesArgs) {
  const [childCards, setChildCards] = useState<ChildCardSummary[]>([]);
  const [childCardsLoading, setChildCardsLoading] = useState(false);
  const [childCardsError, setChildCardsError] = useState<string | null>(null);

  const refreshChildCards = useCallback(async (signal?: AbortSignal) => {
    if (!isParent) {
      setChildCards((prev) => (prev.length ? [] : prev));
      setChildCardsLoading(false);
      setChildCardsError(null);
      return;
    }

    setChildCardsLoading(true);
    setChildCardsError(null);
    try {
      const response = await fetch(`/api/boards/${boardId}/cards/${cardId}/children`, { signal });
      const body = await response.json().catch(() => null);
      if (signal?.aborted) return;
      if (!response.ok) {
        throw new Error(body?.error?.message || "子カードの読み込みに失敗しました");
      }
      const nextChildren = Array.isArray(body?.children) ? body.children : [];
      setChildCards(nextChildren as ChildCardSummary[]);
    } catch (error) {
      if (signal?.aborted) return;
      setChildCards([]);
      setChildCardsError(error instanceof Error ? error.message : "子カードの読み込みに失敗しました");
    } finally {
      if (!signal?.aborted) {
        setChildCardsLoading(false);
      }
    }
  }, [boardId, cardId, isParent]);

  useEffect(() => {
    const abortController = new AbortController();
    void refreshChildCards(abortController.signal);
    return () => abortController.abort();
  }, [childCount, refreshChildCards, refreshKey]);

  const childSummaryByCardId = useMemo(() => {
    return childCards.reduce<Record<string, ChildCardLinkSummary>>((acc, child) => {
      const checklist = normalizeChecklist(child.checklist ?? null);
      const checklistProgress = {
        checked: countCheckedLines(checklist),
        total: countNonEmptyLines(checklist),
      };
      const contentProgress = countTaskItemsInContent(child.content);
      const progress = checklistProgress.total > 0 ? checklistProgress : contentProgress;
      const dateLabel = formatChildCardDate(child.due_date);
      const timeLabel = formatChildCardTimeRange(child.due_start, child.due_end);
      const bucketLabel = formatChildCardBucket(child.due_bucket);

      acc[child.id] = {
        id: child.id,
        shortId: child.short_id,
        title: child.title,
        dateLabel,
        timeLabel,
        bucketLabel,
        checklistChecked: progress.checked,
        checklistTotal: progress.total,
        linkMeta: [child.title, dateLabel, timeLabel, bucketLabel, `${progress.checked}/${progress.total}`].join(" "),
      };
      return acc;
    }, {});
  }, [childCards]);

  const childCardLinkMetaByShortId = useMemo(() => {
    return Object.values(childSummaryByCardId).reduce<Record<string, string>>((acc, summary) => {
      if (summary.shortId) {
        acc[summary.shortId] = summary.linkMeta;
      }
      return acc;
    }, {});
  }, [childSummaryByCardId]);

  return {
    childCards,
    childCardsLoading,
    childCardsError,
    refreshChildCards: () => refreshChildCards(),
    childSummaryByCardId,
    childCardLinkMetaByShortId,
  };
}
