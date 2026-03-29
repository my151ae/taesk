"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { minuteToPixels, pixelsToMinutes, type TimelineResponse } from "@/app/(board)/_utils/timeline-helpers";
import type { UrlUpdateMethod } from "@/app/(board)/_hooks/useTimelineUrlState";

type TimelineUrlUpdateArgs = {
  date?: string | null;
  range: number;
  time?: number | null;
  method?: UrlUpdateMethod;
};

type UseTimelineScrollSyncArgs = {
  viewMode: "timeline" | "list";
  urlDate: string | null;
  urlRange: number | null;
  urlTime: number | null;
  data: TimelineResponse | null;
  activeDayIndex: number;
  dayRange: number;
  indicatorMinutes: number | null;
  updateUrlForTimeline: (args: TimelineUrlUpdateArgs) => void;
  timelineStartHour?: number;
  hourHeight?: number;
};

export const useTimelineScrollSync = ({
  viewMode,
  urlDate,
  urlRange,
  urlTime,
  data,
  activeDayIndex,
  dayRange,
  indicatorMinutes,
  updateUrlForTimeline,
  timelineStartHour = 0,
  hourHeight = 40,
}: UseTimelineScrollSyncArgs) => {
  const [hasAutoScrolled, setHasAutoScrolled] = useState(false);
  const [isTimelineViewMounted, setIsTimelineViewMounted] = useState(false);
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  const desktopTimelineScrollRef = useRef<HTMLDivElement | null>(null);
  const mobileTimelineScrollRef = useRef<HTMLDivElement | null>(null);
  const lastScrollRestoreKeyRef = useRef<string | null>(null);
  const scrollRestoreAttemptRef = useRef(0);
  const autoScrollAttemptRef = useRef(0);
  const initialOpenScrollDoneRef = useRef(false);
  const programmaticScrollRef = useRef(false);

  const useDebounce = <TArgs extends unknown[]>(callback: (...args: TArgs) => void, delay: number) => {
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);

    return useCallback(
      (...args: TArgs) => {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
        timeoutRef.current = setTimeout(() => {
          callback(...args);
        }, delay);
      },
      [callback, delay],
    );
  };

  const syncActiveTimelineScrollRef = useCallback(() => {
    if (typeof window === "undefined") return;
    const isDesktop = window.matchMedia("(min-width: 768px)").matches;
    timelineScrollRef.current = isDesktop ? desktopTimelineScrollRef.current : mobileTimelineScrollRef.current;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(min-width: 768px)");
    const sync = () => syncActiveTimelineScrollRef();
    sync();
    mql.addEventListener("change", sync);
    return () => mql.removeEventListener("change", sync);
  }, [syncActiveTimelineScrollRef]);

  const urlTimeMinutes = useMemo(() => {
    if (typeof urlTime !== "number") return null;
    const timeMinutes = Math.round(urlTime);
    if (isNaN(timeMinutes) || timeMinutes < 0 || timeMinutes >= 24 * 60) return null;
    return timeMinutes;
  }, [urlTime]);

  const shouldPreferNowIndicatorOnOpen =
    !initialOpenScrollDoneRef.current &&
    isTimelineViewMounted &&
    indicatorMinutes != null;

  useEffect(() => {
    if (shouldPreferNowIndicatorOnOpen) return;
    if (urlTimeMinutes == null || !timelineScrollRef.current || !isTimelineViewMounted) return;

    const restoreKey = `${urlDate ?? ""}|${urlRange ?? ""}|${urlTimeMinutes}`;
    if (lastScrollRestoreKeyRef.current === restoreKey) return;

    scrollRestoreAttemptRef.current = 0;
    let cancelled = false;
    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();

    const tryRestore = () => {
      if (cancelled) return;
      const container = timelineScrollRef.current;
      if (!container) return;

      const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
      const desiredTop = minuteToPixels(urlTimeMinutes, timelineStartHour, hourHeight);
      const clampedTop = Math.max(0, Math.min(desiredTop, maxTop));

      if (Math.abs(container.scrollTop - clampedTop) >= 2) {
        container.scrollTo({ top: clampedTop, behavior: "auto" });
      }

      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      const canReachDesired = maxTop + 1 >= desiredTop;
      const isCloseEnough = Math.abs(container.scrollTop - desiredTop) < 2;

      if (canReachDesired && isCloseEnough) {
        lastScrollRestoreKeyRef.current = restoreKey;
        programmaticScrollRef.current = false;
        return;
      }

      scrollRestoreAttemptRef.current += 1;
      const timedOut = now - startedAt > 3000;
      if (!timedOut && scrollRestoreAttemptRef.current <= 180) {
        requestAnimationFrame(tryRestore);
        return;
      }

      lastScrollRestoreKeyRef.current = restoreKey;
      programmaticScrollRef.current = false;
    };

    programmaticScrollRef.current = true;
    requestAnimationFrame(tryRestore);
    return () => {
      cancelled = true;
      programmaticScrollRef.current = false;
    };
  }, [urlDate, urlRange, urlTimeMinutes, isTimelineViewMounted, shouldPreferNowIndicatorOnOpen, timelineStartHour, hourHeight]);

  useEffect(() => {
    if (!shouldPreferNowIndicatorOnOpen && urlTime != null) {
      if (!hasAutoScrolled) setHasAutoScrolled(true);
      return;
    }

    if (!isTimelineViewMounted || !timelineScrollRef.current || indicatorMinutes == null || hasAutoScrolled) return;

    autoScrollAttemptRef.current = 0;
    let cancelled = false;
    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();

    const tryCenterNowIndicator = () => {
      if (cancelled) return;
      const container = timelineScrollRef.current;
      if (!container) return;

      const desiredTop = minuteToPixels(indicatorMinutes, timelineStartHour, hourHeight) - container.clientHeight / 2;
      const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
      const clampedTop = Math.max(0, Math.min(desiredTop, maxTop));

      if (Math.abs(container.scrollTop - clampedTop) >= 2) {
        container.scrollTo({ top: clampedTop, behavior: "auto" });
      }

      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      const isCloseEnough = Math.abs(container.scrollTop - clampedTop) < 2;
      if (isCloseEnough) {
        initialOpenScrollDoneRef.current = true;
        programmaticScrollRef.current = false;
        setHasAutoScrolled(true);
        return;
      }

      autoScrollAttemptRef.current += 1;
      const timedOut = now - startedAt > 3000;
      if (!timedOut && autoScrollAttemptRef.current <= 180) {
        requestAnimationFrame(tryCenterNowIndicator);
        return;
      }

      initialOpenScrollDoneRef.current = true;
      programmaticScrollRef.current = false;
      setHasAutoScrolled(true);
    };

    programmaticScrollRef.current = true;
    requestAnimationFrame(tryCenterNowIndicator);
    return () => {
      cancelled = true;
      programmaticScrollRef.current = false;
    };
  }, [timelineScrollRef, indicatorMinutes, hasAutoScrolled, urlTime, isTimelineViewMounted, shouldPreferNowIndicatorOnOpen, timelineStartHour, hourHeight]);

  const stateRef = useRef({ data, activeDayIndex, dayRange, updateUrlForTimeline, timelineStartHour, hourHeight, viewMode });
  stateRef.current = { data, activeDayIndex, dayRange, updateUrlForTimeline, timelineStartHour, hourHeight, viewMode };

  const handleTimelineScroll = useCallback((arg?: number | React.UIEvent<HTMLDivElement>) => {
    let scrollTop: number | undefined;

    if (typeof arg === "number") {
      scrollTop = arg;
    } else if (arg && "currentTarget" in arg) {
      scrollTop = arg.currentTarget.scrollTop;
    } else {
      scrollTop = timelineScrollRef.current?.scrollTop;
    }

    if (scrollTop == null) return;
    if (programmaticScrollRef.current) return;

    const { data, activeDayIndex, dayRange, updateUrlForTimeline, timelineStartHour, hourHeight, viewMode } = stateRef.current;
    if (viewMode !== "timeline") return;

    const minutes = pixelsToMinutes(scrollTop, timelineStartHour, hourHeight);
    const currentDay = data?.days?.[activeDayIndex];

    if (currentDay) {
      updateUrlForTimeline({ date: currentDay.isoDate, range: dayRange, time: minutes });
    }
  }, []);

  const debouncedHandleScroll = useDebounce(handleTimelineScroll, 500);

  const handleTimelineViewMount = useCallback(() => {
    setIsTimelineViewMounted(true);
    syncActiveTimelineScrollRef();
  }, [syncActiveTimelineScrollRef]);

  return {
    timelineScrollRef,
    desktopTimelineScrollRef,
    mobileTimelineScrollRef,
    debouncedHandleScroll,
    handleTimelineViewMount,
  };
};
