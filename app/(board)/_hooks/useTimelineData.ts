"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { Board, Card } from "@/lib/supabase";
import type { ClientTrace } from "@/lib/metrics/client";
import { createClientTrace } from "@/lib/metrics/client";
import { useSyncQueue } from "@/app/(board)/_hooks/useSyncQueue";
import { useRealtimeBoard } from "@/app/(board)/_hooks/useRealtimeBoard";
import { useCommentsStore } from "@/app/(board)/_stores/comments-store";
import { applyCardUpdate } from "@/app/(board)/_utils/card-updates";
import {
  getCurrentTimelineIsoDateJst,
  getDayDiff,
  getMsUntilNextTimelineBoundary,
  getTimelineIsoDateJst,
  type TimelineResponse,
  type TimelineBucketItem,
  type TimelineDay,
  type TimelineEvent,
  type TimelineOverdueItem,
} from "@/app/(board)/_utils/timeline-helpers";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

type DataMode = "api" | "mock";

type UseTimelineDataArgs = {
  initialBoard: Board;
  dayRange: number;
  timelineStartHour: number;
  dayWindowStartRef: MutableRefObject<number>;
  setDayWindowStart: (value: number) => void;
  buildMockTimelineResponse: () => TimelineResponse;
  onRealtimeCardChange?: (payload: RealtimePostgresChangesPayload<Card>) => void;
};

type LoadedSpan = {
  startIso: string;
  endIso: string;
};

type CardLocation =
  | { isoDate: string; containerType: "event" }
  | { isoDate: string; containerType: "bucket"; bucketKey: string }
  | { isoDate: string; containerType: "overdue" };

type TimelineCache = {
  daysByIso: Map<string, TimelineDay>;
  eventsByIso: Map<string, TimelineEvent[]>;
  abBucketsByKey: Map<string, TimelineBucketItem[]>;
  cardLocationById: Map<string, CardLocation>;
  loadedSpans: LoadedSpan[];
  overdue: TimelineOverdueItem[];
  availableTags: string[];
  serverNow: string | null;
  lastRequestedWindow: { startOffset: number; range: number } | null;
};

const compareIso = (left: string, right: string) => left.localeCompare(right);

const addDaysToIso = (isoDate: string, delta: number) => {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
};

const mergeSpans = (spans: LoadedSpan[], nextSpan: LoadedSpan): LoadedSpan[] => {
  const sorted = [...spans, nextSpan].sort((left, right) => compareIso(left.startIso, right.startIso));
  const merged: LoadedSpan[] = [];

  sorted.forEach((span) => {
    const current = merged[merged.length - 1];
    if (!current) {
      merged.push({ ...span });
      return;
    }

    const adjacentIso = addDaysToIso(current.endIso, 1);
    if (compareIso(span.startIso, adjacentIso) <= 0) {
      current.endIso = compareIso(span.endIso, current.endIso) > 0 ? span.endIso : current.endIso;
      return;
    }

    merged.push({ ...span });
  });

  return merged;
};

const isRangeLoaded = (spans: LoadedSpan[], startIso: string, endIso: string) =>
  spans.some(
    (span) => compareIso(span.startIso, startIso) <= 0 && compareIso(span.endIso, endIso) >= 0,
  );

const sortEvents = (events: TimelineEvent[]) =>
  [...events].sort((left, right) => {
    if (left.due_date !== right.due_date) {
      return (left.due_date ?? "").localeCompare(right.due_date ?? "");
    }
    return (left.due_start ?? "").localeCompare(right.due_start ?? "");
  });

const sortBucketItems = (items: TimelineBucketItem[]) =>
  [...items].sort((left, right) => {
    const leftPos = left.bucketPosition ?? 0;
    const rightPos = right.bucketPosition ?? 0;
    if (leftPos !== rightPos) return rightPos - leftPos;
    return (left.title ?? "").localeCompare(right.title ?? "");
  });

const createEmptyCache = (): TimelineCache => ({
  daysByIso: new Map(),
  eventsByIso: new Map(),
  abBucketsByKey: new Map(),
  cardLocationById: new Map(),
  loadedSpans: [],
  overdue: [],
  availableTags: [],
  serverNow: null,
  lastRequestedWindow: null,
});

const pruneCache = (cache: TimelineCache, centerIso: string, keepBeforeDays = 21, keepAfterDays = 28) => {
  const minIso = addDaysToIso(centerIso, -keepBeforeDays);
  const maxIso = addDaysToIso(centerIso, keepAfterDays);

  cache.daysByIso.forEach((_, isoDate) => {
    if (compareIso(isoDate, minIso) < 0 || compareIso(isoDate, maxIso) > 0) {
      cache.daysByIso.delete(isoDate);
      cache.eventsByIso.delete(isoDate);
      cache.abBucketsByKey.delete(`${isoDate}_a`);
      cache.abBucketsByKey.delete(`${isoDate}_b`);
    }
  });

  cache.loadedSpans = cache.loadedSpans
    .map((span) => ({
      startIso: compareIso(span.startIso, minIso) < 0 ? minIso : span.startIso,
      endIso: compareIso(span.endIso, maxIso) > 0 ? maxIso : span.endIso,
    }))
    .filter((span) => compareIso(span.startIso, span.endIso) <= 0);

  rebuildCardLocationIndex(cache);
};

const rebuildCardLocationIndex = (cache: TimelineCache) => {
  const nextIndex = new Map<string, CardLocation>();

  cache.eventsByIso.forEach((events, isoDate) => {
    events.forEach((event) => {
      nextIndex.set(event.card_id, { isoDate, containerType: "event" });
    });
  });

  cache.abBucketsByKey.forEach((items, bucketKey) => {
    const isoDate = bucketKey.slice(0, 10);
    items.forEach((item) => {
      nextIndex.set(item.card_id, { isoDate, containerType: "bucket", bucketKey });
    });
  });

  cache.overdue.forEach((item) => {
    if (!item.due_date) return;
    nextIndex.set(item.card_id, { isoDate: item.due_date, containerType: "overdue" });
  });

  cache.cardLocationById = nextIndex;
};

const syncCacheFromResponse = (cache: TimelineCache, payload: TimelineResponse, currentTimelineIso: string) => {
  cache.daysByIso = new Map(payload.days.map((day) => [day.isoDate, day]));

  const nextEventsByIso = new Map<string, TimelineEvent[]>();
  payload.events.forEach((event) => {
    const entries = nextEventsByIso.get(event.due_date) ?? [];
    entries.push(event);
    nextEventsByIso.set(event.due_date, entries);
  });
  nextEventsByIso.forEach((events, isoDate) => {
    nextEventsByIso.set(isoDate, sortEvents(events));
  });
  cache.eventsByIso = nextEventsByIso;

  const nextBuckets = new Map<string, TimelineBucketItem[]>();
  Object.entries(payload.abBuckets ?? {}).forEach(([bucketKey, items]) => {
    nextBuckets.set(bucketKey, sortBucketItems(items));
  });
  cache.abBucketsByKey = nextBuckets;

  cache.loadedSpans =
    payload.days.length > 0
      ? [{ startIso: payload.days[0]!.isoDate, endIso: payload.days[payload.days.length - 1]!.isoDate }]
      : [];
  cache.overdue = payload.overdue ?? [];
  cache.availableTags = payload.availableTags ?? [];
  cache.serverNow = payload.serverNow ?? null;

  const startOffset =
    payload.days.length > 0
      ? getDayDiff(payload.days[0]!.isoDate, currentTimelineIso)
      : payload.startOffset ?? 0;

  cache.lastRequestedWindow = {
    startOffset,
    range: payload.days.length || payload.range || 0,
  };

  rebuildCardLocationIndex(cache);
};

const mergeResponseIntoCache = (
  cache: TimelineCache,
  payload: TimelineResponse,
  request: { startOffset: number; range: number },
) => {
  payload.days.forEach((day) => {
    cache.daysByIso.set(day.isoDate, day);
    cache.eventsByIso.set(day.isoDate, []);
    cache.abBucketsByKey.set(`${day.key}_a`, []);
    cache.abBucketsByKey.set(`${day.key}_b`, []);
  });

  payload.events.forEach((event) => {
    const current = cache.eventsByIso.get(event.due_date) ?? [];
    current.push(event);
    cache.eventsByIso.set(event.due_date, current);
  });

  payload.days.forEach((day) => {
    const events = cache.eventsByIso.get(day.isoDate) ?? [];
    cache.eventsByIso.set(day.isoDate, sortEvents(events));
  });

  Object.entries(payload.abBuckets ?? {}).forEach(([bucketKey, items]) => {
    cache.abBucketsByKey.set(bucketKey, sortBucketItems(items));
  });

  if (payload.days.length > 0) {
    cache.loadedSpans = mergeSpans(cache.loadedSpans, {
      startIso: payload.days[0]!.isoDate,
      endIso: payload.days[payload.days.length - 1]!.isoDate,
    });
  }

  cache.overdue = payload.overdue ?? cache.overdue;
  cache.availableTags = payload.availableTags ?? cache.availableTags;
  cache.serverNow = payload.serverNow ?? cache.serverNow;
  cache.lastRequestedWindow = request;
  rebuildCardLocationIndex(cache);
};

const buildPayloadFromCache = (cache: TimelineCache): TimelineResponse | null => {
  const days = [...cache.daysByIso.values()].sort((left, right) => compareIso(left.isoDate, right.isoDate));
  if (days.length === 0) return null;

  const events = sortEvents(
    days.flatMap((day) => cache.eventsByIso.get(day.isoDate) ?? []),
  );
  const abBuckets = days.reduce<Record<string, TimelineBucketItem[]>>((acc, day) => {
    acc[`${day.key}_a`] = cache.abBucketsByKey.get(`${day.key}_a`) ?? [];
    acc[`${day.key}_b`] = cache.abBucketsByKey.get(`${day.key}_b`) ?? [];
    return acc;
  }, {});

  return {
    days,
    events,
    abBuckets,
    overdue: cache.overdue,
    serverNow: cache.serverNow ?? new Date().toISOString(),
    startOffset: cache.lastRequestedWindow?.startOffset,
    range: cache.lastRequestedWindow?.range,
    availableTags: cache.availableTags,
  };
};

export const useTimelineData = ({
  initialBoard,
  dayRange,
  timelineStartHour,
  dayWindowStartRef,
  setDayWindowStart,
  buildMockTimelineResponse,
  onRealtimeCardChange,
}: UseTimelineDataArgs) => {
  const [dataState, setDataState] = useState<TimelineResponse | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [backgroundRangeStatus, setBackgroundRangeStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dataMode, setDataMode] = useState<DataMode>("api");
  const traceRef = useRef<ClientTrace | null>(null);
  const cacheRef = useRef<TimelineCache>(createEmptyCache());
  const inflightSpansRef = useRef<Map<string, Promise<TimelineResponse | null>>>(new Map());
  const dataStateRef = useRef<TimelineResponse | null>(null);

  useEffect(() => {
    dataStateRef.current = dataState;
  }, [dataState]);

  useEffect(() => {
    traceRef.current = createClientTrace("timeline");
  }, []);

  const setData = useCallback<Dispatch<SetStateAction<TimelineResponse | null>>>(
    (value) => {
      setDataState((current) => {
        const next = typeof value === "function" ? (value as (prev: TimelineResponse | null) => TimelineResponse | null)(current) : value;
        if (!next) {
          cacheRef.current = createEmptyCache();
          return next;
        }
        syncCacheFromResponse(
          cacheRef.current,
          next,
          getCurrentTimelineIsoDateJst(timelineStartHour),
        );
        return buildPayloadFromCache(cacheRef.current);
      });
    },
    [timelineStartHour],
  );

  const ensureTimelineRange = useCallback(
    async (startIso: string, endIso: string, options?: { silent?: boolean }) => {
      if (!initialBoard?.id) return null;
      if (compareIso(startIso, endIso) > 0) return buildPayloadFromCache(cacheRef.current);

      const currentTimelineIso = getCurrentTimelineIsoDateJst(timelineStartHour);
      const startOffset = getDayDiff(startIso, currentTimelineIso);
      const range = Math.max(1, getDayDiff(endIso, startIso) + 1);

      if (isRangeLoaded(cacheRef.current.loadedSpans, startIso, endIso)) {
        cacheRef.current.lastRequestedWindow = { startOffset, range };
        setDayWindowStart(startOffset);
        dayWindowStartRef.current = startOffset;
        const next = buildPayloadFromCache(cacheRef.current);
        setDataState(next);
        return next;
      }

      const requestKey = `${startIso}:${endIso}`;
      const inflight = inflightSpansRef.current.get(requestKey);
      if (inflight) {
        return inflight;
      }

      const isBlockingRequest = !options?.silent && !dataStateRef.current;
      if (isBlockingRequest) {
        setStatus("loading");
      } else {
        setBackgroundRangeStatus("loading");
      }
      setErrorMessage(null);

      const promise = (async () => {
        try {
          traceRef.current?.mark("fetch:start");
          const params = new URLSearchParams({
            start: String(startOffset),
            range: String(range),
          });
          const response = await fetch(`/api/boards/${initialBoard.id}/timeline?${params.toString()}`, {
            cache: "no-store",
          });
          if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body?.error?.message || "Failed to load timeline");
          }
          const payload = (await response.json()) as TimelineResponse;
          mergeResponseIntoCache(cacheRef.current, payload, { startOffset, range });
          pruneCache(cacheRef.current, addDaysToIso(currentTimelineIso, startOffset));
          const nextData = buildPayloadFromCache(cacheRef.current);
          setDataState(nextData);
          setDataMode("api");
          setDayWindowStart(startOffset);
          dayWindowStartRef.current = startOffset;

          const abItemCount = Object.values(payload.abBuckets || {}).reduce(
            (sum, items) => sum + (items?.length ?? 0),
            0,
          );
          traceRef.current?.mark("render:complete");
          traceRef.current?.finish("success", {
            eventsCount: payload.events.length,
            abItems: abItemCount,
          });
          traceRef.current = createClientTrace("timeline");
          return nextData;
        } catch (error) {
          if (!dataStateRef.current) {
            console.warn("[timeline] fetch failed, rendering mock data", error);
            setErrorMessage("Showing sample schedule until sync succeeds");
            const fallback = buildMockTimelineResponse();
            syncCacheFromResponse(cacheRef.current, fallback, currentTimelineIso);
            const nextData = buildPayloadFromCache(cacheRef.current);
            setDataState(nextData);
            setDataMode("mock");
            return nextData;
          }

          setErrorMessage(error instanceof Error ? error.message : "Failed to load timeline");
          return buildPayloadFromCache(cacheRef.current);
        } finally {
          inflightSpansRef.current.delete(requestKey);
          if (isBlockingRequest) {
            setStatus("idle");
          } else {
            setBackgroundRangeStatus("idle");
          }
        }
      })();

      inflightSpansRef.current.set(requestKey, promise);
      return promise;
    },
    [
      buildMockTimelineResponse,
      dayWindowStartRef,
      initialBoard?.id,
      setDayWindowStart,
      timelineStartHour,
    ],
  );

  const fetchTimeline = useCallback(
    async (start?: number, options?: { silent?: boolean; range?: number }) => {
      const currentTimelineIso = getCurrentTimelineIsoDateJst(timelineStartHour);
      const effectiveStart = typeof start === "number" ? start : dayWindowStartRef.current;
      const effectiveRange = options?.range ?? dayRange;
      const startIso = addDaysToIso(currentTimelineIso, effectiveStart);
      const endIso = addDaysToIso(startIso, effectiveRange - 1);
      return ensureTimelineRange(startIso, endIso, { silent: options?.silent });
    },
    [dayRange, dayWindowStartRef, ensureTimelineRange, timelineStartHour],
  );

  const { isOnline, syncQueueStats } = useSyncQueue();
  const upsertComment = useCommentsStore((state) => state.upsertComment);
  const removeComment = useCommentsStore((state) => state.removeComment);

  const handleCardChange = useCallback((payload: RealtimePostgresChangesPayload<Card>) => {
    setData((prev) => {
      if (!prev) return prev;

      const { eventType } = payload;
      const record = eventType === "DELETE" ? (payload.old as Card) : (payload.new as Card);
      if (eventType === "INSERT" || eventType === "UPDATE" || eventType === "DELETE") {
        return applyCardUpdate(prev, record, eventType);
      }
      return prev;
    });
    onRealtimeCardChange?.(payload);
  }, [onRealtimeCardChange, setData]);

  const { realtimeStatus } = useRealtimeBoard(initialBoard.id, {
    onCardChange: handleCardChange,
    upsertComment,
    removeComment,
  });

  useEffect(() => {
    void fetchTimeline();
  }, [fetchTimeline]);

  useEffect(() => {
    if (!initialBoard.id) return;

    let cancelled = false;
    let timeoutId: number | null = null;

    const scheduleBoundaryRefresh = () => {
      const delay = getMsUntilNextTimelineBoundary(new Date().toISOString(), timelineStartHour) + 1000;
      timeoutId = window.setTimeout(async () => {
        if (cancelled) return;
        const currentWindow = cacheRef.current.lastRequestedWindow;
        await fetchTimeline(currentWindow?.startOffset, { silent: true, range: currentWindow?.range ?? dayRange });
        if (cancelled) return;
        scheduleBoundaryRefresh();
      }, delay);
    };

    scheduleBoundaryRefresh();

    return () => {
      cancelled = true;
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [dayRange, fetchTimeline, initialBoard.id, timelineStartHour]);

  useEffect(() => {
    if (!initialBoard.id) return;

    const handleVisibilityChange = () => {
      if (document.hidden) return;

      const currentTimelineIsoDate = getCurrentTimelineIsoDateJst(timelineStartHour);
      const dataTimelineIsoDate = dataState?.serverNow
        ? getTimelineIsoDateJst(dataState.serverNow, timelineStartHour)
        : null;

      if (dataTimelineIsoDate !== currentTimelineIsoDate) {
        const currentWindow = cacheRef.current.lastRequestedWindow;
        void fetchTimeline(currentWindow?.startOffset, {
          silent: true,
          range: currentWindow?.range ?? dayRange,
        });
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [dataState?.serverNow, dayRange, fetchTimeline, initialBoard.id, timelineStartHour]);

  useEffect(() => {
    if (!initialBoard.id) return;
    if (!isOnline) return;
    if (realtimeStatus === "connected") return;
    if (process.env.NEXT_PUBLIC_ENABLE_TIMELINE_POLLING !== "true") return;

    if (typeof document !== "undefined" && document.hidden) return;

    const intervalId = window.setInterval(() => {
      const currentWindow = cacheRef.current.lastRequestedWindow;
      void fetchTimeline(currentWindow?.startOffset, {
        silent: true,
        range: currentWindow?.range ?? dayRange,
      });
    }, 10000);

    return () => clearInterval(intervalId);
  }, [dayRange, fetchTimeline, initialBoard.id, isOnline, realtimeStatus]);

  return {
    data: dataState,
    setData,
    status,
    backgroundRangeStatus,
    ensureTimelineRange,
    errorMessage,
    setErrorMessage,
    dataMode,
    fetchTimeline,
    realtimeStatus,
    isOnline,
    syncQueueStats,
  };
};
