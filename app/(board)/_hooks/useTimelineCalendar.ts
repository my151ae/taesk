"use client";

import { useCallback, useMemo } from "react";
import { useGoogleCalendar } from "@/app/(board)/_hooks/useGoogleCalendar";
import { buildCalendarEntriesByDay } from "@/app/(board)/_utils/calendar-helpers";
import type { TimelineDay } from "@/app/(board)/_utils/timeline-helpers";

type CalendarPreset = "visible" | "this-week" | "next-week";

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
    return { start: calendarRangeStart, end: calendarRangeEnd };
  }, [calendarPreset, calendarRangeEnd, calendarRangeStart, startOfWeekJst]);

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
