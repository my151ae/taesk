"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { Board, Card } from "@/lib/supabase";
import type { ClientTrace } from "@/lib/metrics/client";
import { createClientTrace } from "@/lib/metrics/client";
import { useSyncQueue } from "@/app/(board)/_hooks/useSyncQueue";
import { useRealtimeBoard } from "@/app/(board)/_hooks/useRealtimeBoard";
import { useCommentsStore } from "@/app/(board)/_stores/comments-store";
import { applyCardUpdate } from "@/app/(board)/_utils/card-updates";
import {
  getCurrentTimelineIsoDateJst,
  getMsUntilNextTimelineBoundary,
  getTimelineIsoDateJst,
  type TimelineResponse,
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

export const useTimelineData = ({
  initialBoard,
  dayRange,
  timelineStartHour,
  dayWindowStartRef,
  setDayWindowStart,
  buildMockTimelineResponse,
  onRealtimeCardChange,
}: UseTimelineDataArgs) => {
  const [data, setData] = useState<TimelineResponse | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dataMode, setDataMode] = useState<DataMode>("api");
  const traceRef = useRef<ClientTrace | null>(null);
  const latestRequestIdRef = useRef(0);

  useEffect(() => {
    traceRef.current = createClientTrace("timeline");
  }, []);

  const fetchTimeline = useCallback(
    async (start?: number, options?: { silent?: boolean; range?: number }) => {
      if (!initialBoard?.id) return null;
      const effectiveStart = typeof start === "number" ? start : dayWindowStartRef.current;
      const effectiveRange = options?.range ?? dayRange;
      const requestId = latestRequestIdRef.current + 1;
      latestRequestIdRef.current = requestId;

      if (!options?.silent) {
        setStatus("loading");
      }
      setErrorMessage(null);
      try {
        traceRef.current?.mark("fetch:start");
        const params = new URLSearchParams({
          start: String(effectiveStart),
          range: String(effectiveRange),
        });
        const response = await fetch(`/api/boards/${initialBoard.id}/timeline?${params.toString()}`, {
          cache: "no-store",
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body?.error?.message || "Failed to load timeline");
        }
        const payload = (await response.json()) as TimelineResponse;
        if (latestRequestIdRef.current !== requestId) {
          return payload;
        }
        const startOffset = payload.startOffset ?? effectiveStart;
        setData(payload);
        setDataMode("api");
        setDayWindowStart(startOffset);
        dayWindowStartRef.current = startOffset;

        if (!options?.silent) {
          setStatus("idle");
        }
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
        return payload;
      } catch (error) {
        if (latestRequestIdRef.current !== requestId) {
          return null;
        }
        console.warn("[timeline] fetch failed, rendering mock data", error);
        setErrorMessage("Showing sample schedule until sync succeeds");
        const fallback = buildMockTimelineResponse();
        setData(fallback);
        setDataMode("mock");
        setStatus("idle");
        return fallback;
      } finally {
        if (!options?.silent && latestRequestIdRef.current === requestId) {
          setStatus("idle");
        }
      }
    },
    [dayRange, initialBoard.id, setDayWindowStart, buildMockTimelineResponse, dayWindowStartRef],
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
  }, [onRealtimeCardChange]);

  const { realtimeStatus } = useRealtimeBoard(initialBoard.id, {
    onCardChange: handleCardChange,
    upsertComment,
    removeComment,
  });

  useEffect(() => {
    fetchTimeline();
  }, [fetchTimeline]);

  useEffect(() => {
    if (!initialBoard.id) return;

    let cancelled = false;
    let timeoutId: number | null = null;

    const scheduleBoundaryRefresh = () => {
      const delay = getMsUntilNextTimelineBoundary(new Date().toISOString(), timelineStartHour) + 1000;
      timeoutId = window.setTimeout(async () => {
        if (cancelled) return;
        await fetchTimeline(undefined, { silent: true });
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
  }, [fetchTimeline, initialBoard.id, timelineStartHour]);

  useEffect(() => {
    if (!initialBoard.id) return;

    const handleVisibilityChange = () => {
      if (document.hidden) return;

      const currentTimelineIsoDate = getCurrentTimelineIsoDateJst(timelineStartHour);
      const dataTimelineIsoDate = data?.serverNow
        ? getTimelineIsoDateJst(data.serverNow, timelineStartHour)
        : null;

      if (dataTimelineIsoDate !== currentTimelineIsoDate) {
        void fetchTimeline(undefined, { silent: true });
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [data?.serverNow, fetchTimeline, initialBoard.id, timelineStartHour]);

  useEffect(() => {
    if (!initialBoard.id) return;
    if (!isOnline) return;
    if (realtimeStatus === "connected") return;
    if (process.env.NEXT_PUBLIC_ENABLE_TIMELINE_POLLING !== "true") return;

    if (typeof document !== "undefined" && document.hidden) return;

    const intervalId = window.setInterval(() => {
      fetchTimeline(undefined, { silent: true });
    }, 10000);

    return () => clearInterval(intervalId);
  }, [fetchTimeline, initialBoard.id, isOnline, realtimeStatus]);

  return {
    data,
    setData,
    status,
    errorMessage,
    setErrorMessage,
    dataMode,
    fetchTimeline,
    realtimeStatus,
    isOnline,
    syncQueueStats,
  };
};
