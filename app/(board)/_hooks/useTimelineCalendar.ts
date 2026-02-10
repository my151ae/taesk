"use client";

import { useCallback, useMemo } from "react";
import { useGoogleCalendar } from "@/app/(board)/_hooks/useGoogleCalendar";
import { buildCalendarEntriesByDay } from "@/app/(board)/_utils/calendar-helpers";
import type { TimelineDay } from "@/app/(board)/_utils/timeline-helpers";

type CalendarPreset = "visible" | "this-week" | "next-week";
const CALENDAR_BUFFER_DAYS = 14;
const MAX_CALENDAR_RANGE_DAYS = 130;

type UseTimelineCalendarArgs = {
  calendarPreset: CalendarPreset;
  calendarRangeStart: Date | null;
  calendarRangeEnd: Date | null;
  days: TimelineDay[];
};

export const useTimelineCalendar = ({
  calendarPreset,
  calendarRangeStart,
  calendarRangeEnd,
  days,
}: UseTimelineCalendarArgs) => {
  const expandRangeWithBuffer = useCallback((start: Date | null, end: Date | null) => {
    if (!start || !end) return { start, end };

    const expandedStart = new Date(start);
    expandedStart.setUTCDate(expandedStart.getUTCDate() - CALENDAR_BUFFER_DAYS);

    const expandedEnd = new Date(end);
    expandedEnd.setUTCDate(expandedEnd.getUTCDate() + CALENDAR_BUFFER_DAYS);

    const maxEnd = new Date(expandedStart);
    maxEnd.setUTCDate(maxEnd.getUTCDate() + MAX_CALENDAR_RANGE_DAYS);

    return {
      start: expandedStart,
      end: expandedEnd.getTime() > maxEnd.getTime() ? maxEnd : expandedEnd,
    };
  }, []);

  const startOfWeekJst = useCallback((base: Date) => {
    const jstMs = base.getTime() + 9 * 60 * 60 * 1000;
    const jst = new Date(jstMs);
    const day = jst.getUTCDay();
    const diff = (day + 6) % 7; // Monday start
    const mondayUtc = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() - diff, 0, 0, 0);
    return new Date(mondayUtc - 9 * 60 * 60 * 1000);
  }, []);

  const presetRange = useMemo(() => {
    const now = new Date();
    if (calendarPreset === "this-week") {
      const start = startOfWeekJst(now);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 7);
      return { start, end };
    }
    if (calendarPreset === "next-week") {
      const start = startOfWeekJst(now);
      start.setUTCDate(start.getUTCDate() + 7);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 7);
      return { start, end };
    }
    return expandRangeWithBuffer(calendarRangeStart, calendarRangeEnd);
  }, [calendarPreset, calendarRangeEnd, calendarRangeStart, expandRangeWithBuffer, startOfWeekJst]);

  const {
    events: googleCalendarEvents,
    status: googleCalendarStatus,
    error: googleCalendarError,
    refresh: refreshGoogleCalendar,
  } = useGoogleCalendar(presetRange.start, presetRange.end);

  const { calendarEventsByDay, calendarAllDayEventsByDay } = useMemo(
    () => buildCalendarEntriesByDay(googleCalendarEvents, days),
    [googleCalendarEvents, days],
  );

  return {
    calendarEventsByDay,
    calendarAllDayEventsByDay,
    googleCalendarEvents,
    googleCalendarStatus,
    googleCalendarError,
    refreshGoogleCalendar,
  };
};
