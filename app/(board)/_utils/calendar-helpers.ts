"use client";

import type { GoogleCalendarEvent } from "@/lib/api-types/google-calendar";
import {
  getIsoDateJst,
  getMinutesJstFromIso,
  type ExternalCalendarEntry,
  type TimelineDay,
} from "@/app/(board)/_utils/timeline-helpers";

export const buildCalendarEntriesByDay = (
  googleCalendarEvents: GoogleCalendarEvent[],
  days: TimelineDay[],
) => {
  if (!googleCalendarEvents.length || !days.length) {
    return {
      calendarEventsByDay: {} as Record<string, ExternalCalendarEntry[]>,
      calendarAllDayEventsByDay: {} as Record<string, ExternalCalendarEntry[]>,
    };
  }

  const daySet = new Set(days.map((day) => day.isoDate));
  const timedResult: Record<string, ExternalCalendarEntry[]> = {};
  const allDayResult: Record<string, ExternalCalendarEntry[]> = {};
  const parseDateOnly = (value?: string | null) => {
    if (!value) return null;
    const [year, month, day] = value.split("-").map((part) => Number(part));
    if (!year || !month || !day) return null;
    return Date.UTC(year, (month ?? 1) - 1, day ?? 1);
  };
  const utcDateToIso = (ms: number) => new Date(ms).toISOString().split("T")[0];

  googleCalendarEvents.forEach((event) => {
    const baseId = event.eventKey || event.id || `gcal-${event.start}`;

    if (event.isAllDay && event.startDate && event.endDate) {
      const startMs = parseDateOnly(event.startDate);
      const endMs = parseDateOnly(event.endDate);
      if (startMs != null && endMs != null && startMs < endMs) {
        let cursorMs = startMs;
        while (cursorMs < endMs) {
          const dayIso = utcDateToIso(cursorMs);
          if (daySet.has(dayIso)) {
            const entry: ExternalCalendarEntry = {
              id: `${baseId}-${dayIso}`,
              eventId: event.id || baseId,
              dayIso,
              title: event.title,
              startMinutes: 0,
              durationMinutes: 24 * 60,
              isAllDay: true,
              source: event.source,
              startDate: event.startDate ?? null,
              endDate: event.endDate ?? null,
              displayTz: event.displayTz ?? null,
              calendarId: event.calendarId ?? null,
              calendarSummary: event.calendarSummary ?? null,
              calendarBackgroundColor: event.calendarBackgroundColor ?? null,
              calendarForegroundColor: event.calendarForegroundColor ?? null,
            };

            if (!allDayResult[dayIso]) allDayResult[dayIso] = [];
            allDayResult[dayIso].push(entry);
          }
          cursorMs += 24 * 60 * 60 * 1000;
        }
        return;
      }
    }

    const start = new Date(event.start);
    const end = new Date(event.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;

    const startMs = start.getTime();
    const endMs = end.getTime();
    let cursorMs = startMs;
    const baseIdFallback = event.eventKey || event.id || `gcal-${startMs}`;

    while (cursorMs < endMs) {
      const cursor = new Date(cursorMs);
      const dayIso = getIsoDateJst(cursor.toISOString());
      const nextDay = new Date(cursor);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      const nextDayMs = nextDay.getTime();

      const isFirstDay = cursorMs === startMs;
      const isLastDay = nextDayMs >= endMs;

      const startMinutes = isFirstDay ? getMinutesJstFromIso(event.start) : 0;
      let endMinutes = isLastDay ? getMinutesJstFromIso(event.end) : 24 * 60;
      if (isLastDay && endMinutes === 0) endMinutes = 24 * 60;

      const duration = Math.max(0, endMinutes - startMinutes);

      if (daySet.has(dayIso)) {
        const entry: ExternalCalendarEntry = {
          id: `${baseIdFallback}-${dayIso}`,
          eventId: event.id || baseIdFallback,
          dayIso,
          title: event.title,
          startMinutes,
          durationMinutes: duration,
          isAllDay: event.isAllDay,
          source: event.source,
          startDate: event.startDate ?? null,
          endDate: event.endDate ?? null,
          displayTz: event.displayTz ?? null,
          calendarId: event.calendarId ?? null,
          calendarSummary: event.calendarSummary ?? null,
          calendarBackgroundColor: event.calendarBackgroundColor ?? null,
          calendarForegroundColor: event.calendarForegroundColor ?? null,
        };

        const target = event.isAllDay ? allDayResult : timedResult;
        if (!target[dayIso]) target[dayIso] = [];
        target[dayIso].push(entry);
      }

      cursorMs = nextDayMs;
    }
  });

  Object.values(timedResult).forEach((entries) => {
    entries.sort((a, b) => a.startMinutes - b.startMinutes);
  });

  Object.values(allDayResult).forEach((entries) => {
    entries.sort((a, b) => {
      if (a.startDate && b.startDate && a.startDate !== b.startDate) {
        return a.startDate.localeCompare(b.startDate);
      }
      return (a.title || "").localeCompare(b.title || "");
    });
  });

  return {
    calendarEventsByDay: timedResult,
    calendarAllDayEventsByDay: allDayResult,
  };
};
