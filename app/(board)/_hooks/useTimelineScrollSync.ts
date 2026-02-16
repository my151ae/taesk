"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { minuteToPixels, pixelsToMinutes, type TimelineResponse } from "@/app/(board)/_utils/timeline-helpers";

type UseTimelineScrollSyncArgs = {
  urlDate: string | null;
  urlRange: string | null;
  urlTime: string | null;
  data: TimelineResponse | null;
  activeDayIndex: number;
  dayRange: number;
  indicatorMinutes: number | null;
  updateUrl: (date: string | null, range: number, time?: number | null) => void;
  timelineStartHour?: number;
  hourHeight?: number;
};

export const useTimelineScrollSync = ({
  urlDate,
  urlRange,
  urlTime,
  data,
  activeDayIndex,
  dayRange,
  indicatorMinutes,
  updateUrl,
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
    if (!urlTime) return null;
    const timeMinutes = parseInt(urlTime, 10);
    if (isNaN(timeMinutes) || timeMinutes < 0 || timeMinutes >= 24 * 60) return null;
    return timeMinutes;
  }, [urlTime]);

  useEffect(() => {
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
  }, [urlDate, urlRange, urlTimeMinutes, isTimelineViewMounted, timelineStartHour, hourHeight]);

  useEffect(() => {
    if (urlTime) {
      if (!hasAutoScrolled) setHasAutoScrolled(true);
      return;
    }

    if (!isTimelineViewMounted || !timelineScrollRef.current || indicatorMinutes == null || hasAutoScrolled) return;

    const container = timelineScrollRef.current;
    const target = minuteToPixels(indicatorMinutes, timelineStartHour, hourHeight) - container.clientHeight / 2;
    const clampedTop = Math.max(0, Math.min(target, container.scrollHeight - container.clientHeight));

    programmaticScrollRef.current = true;
    container.scrollTo({
      top: clampedTop,
      behavior: "auto",
    });

    requestAnimationFrame(() => {
      programmaticScrollRef.current = false;
    });
    setHasAutoScrolled(true);
  }, [timelineScrollRef, indicatorMinutes, hasAutoScrolled, urlTime, isTimelineViewMounted, timelineStartHour, hourHeight]);

  const stateRef = useRef({ data, activeDayIndex, dayRange, updateUrl, timelineStartHour, hourHeight });
  stateRef.current = { data, activeDayIndex, dayRange, updateUrl, timelineStartHour, hourHeight };

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

    const { data, activeDayIndex, dayRange, updateUrl, timelineStartHour, hourHeight } = stateRef.current;

    const minutes = pixelsToMinutes(scrollTop, timelineStartHour, hourHeight);
    const currentDay = data?.days?.[activeDayIndex];

    if (currentDay) {
      updateUrl(currentDay.isoDate, dayRange, minutes);
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
