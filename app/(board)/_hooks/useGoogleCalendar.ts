"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GoogleCalendarEvent, GoogleCalendarEventsResponse } from "@/lib/api-types/google-calendar";

type GoogleCalendarStatus = "idle" | "loading" | "success" | "error" | "disconnected";

type CacheEntry = {
  events: GoogleCalendarEvent[];
  status: GoogleCalendarStatus;
  error: string | null;
};

export function useGoogleCalendar(startDate?: Date | null, endDate?: Date | null) {
  const startIso = useMemo(() => {
    if (!startDate) return null;
    return startDate.toISOString();
  }, [startDate]);

  const endIso = useMemo(() => {
    if (!endDate) return null;
    return endDate.toISOString();
  }, [endDate]);

  const [events, setEvents] = useState<GoogleCalendarEvent[]>([]);
  const [status, setStatus] = useState<GoogleCalendarStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const cacheRef = useRef<Map<string, CacheEntry>>(new Map());
  const abortRef = useRef<AbortController | null>(null);

  const cacheKey = startIso && endIso ? `${startIso}_${endIso}` : null;

  const load = useCallback(async (force = false) => {
    if (!startIso || !endIso || !cacheKey) {
      setEvents([]);
      setStatus("idle");
      setError(null);
      return;
    }

    if (!force && cacheRef.current.has(cacheKey)) {
      const cached = cacheRef.current.get(cacheKey)!;
      setEvents(cached.events);
      setStatus(cached.status);
      setError(cached.error);
      return;
    }

    setStatus("loading");
    setError(null);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const params = new URLSearchParams({ start: startIso, end: endIso });
      const response = await fetch(`/api/calendar/events?${params.toString()}`, { signal: controller.signal });
      const body = (await response.json().catch(() => null)) as GoogleCalendarEventsResponse | null;

      if (controller.signal.aborted) return;

      if (body?.connected === false) {
        const entry: CacheEntry = { events: [], status: "disconnected", error: body?.error ?? null };
        cacheRef.current.set(cacheKey, entry);
        setEvents([]);
        setStatus("disconnected");
        setError(body?.error ?? null);
        return;
      }

      if (!response.ok) {
        const message = body?.error || "Failed to fetch Google Calendar events";
        const entry: CacheEntry = { events: [], status: "error", error: message };
        cacheRef.current.set(cacheKey, entry);
        setEvents([]);
        setStatus("error");
        setError(message);
        return;
      }

      const nextEvents = Array.isArray(body?.events) ? body!.events : [];
      const entry: CacheEntry = { events: nextEvents, status: "success", error: body?.error ?? null };
      cacheRef.current.set(cacheKey, entry);
      setEvents(nextEvents);
      setStatus("success");
      setError(body?.error ?? null);
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : "Failed to fetch Google Calendar events";
      const entry: CacheEntry = { events: [], status: "error", error: message };
      cacheRef.current.set(cacheKey, entry);
      setEvents([]);
      setStatus("error");
      setError(message);
    }
  }, [cacheKey, endIso, startIso]);

  useEffect(() => {
    load();
    return () => {
      abortRef.current?.abort();
    };
  }, [load]);

  const refresh = useCallback(() => {
    if (cacheKey) {
      cacheRef.current.delete(cacheKey);
    }
    void load(true);
  }, [cacheKey, load]);

  return {
    events,
    status,
    error,
    connected: status !== "disconnected",
    refresh,
  };
}
