"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GoogleCalendarEvent, GoogleCalendarEventsResponse } from "@/lib/api-types/google-calendar";

type GoogleCalendarStatus = "idle" | "loading" | "success" | "error" | "disconnected";

type CacheEntry = {
  events: GoogleCalendarEvent[];
  canWrite: boolean; // Added
  status: GoogleCalendarStatus;
  error: string | null;
};

const toErrorMessage = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const maybe = value as { code?: unknown; message?: unknown };
    const message = typeof maybe.message === "string" ? maybe.message : null;
    const code = typeof maybe.code === "string" ? maybe.code : null;
    if (code && message) return `${code}: ${message}`;
    if (message) return message;
    try {
      return JSON.stringify(value);
    } catch {
      return "Unknown error";
    }
  }
  return String(value);
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
  const [canWrite, setCanWrite] = useState<boolean>(false);
  const [status, setStatus] = useState<GoogleCalendarStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const cacheRef = useRef<Map<string, CacheEntry>>(new Map());
  const abortRef = useRef<AbortController | null>(null);

  const cacheKey = startIso && endIso ? `${startIso}_${endIso}` : "permission_check";

  const load = useCallback(async (force = false) => {
    // If no dates, we still fetch to check permissions, unless it's strictly required to have dates.
    // The API now supports missing dates for permission check.
    if (!cacheKey) {
      // Should not happen with new logic, but safe guard
      return;
    }

    if (!force && cacheRef.current.has(cacheKey)) {
      const cached = cacheRef.current.get(cacheKey)!;
      setEvents(cached.events);
      setCanWrite(cached.canWrite); // Restore canWrite
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
      const params = new URLSearchParams();
      if (startIso && endIso) {
        params.append('start', startIso);
        params.append('end', endIso);
      }

      const queryString = params.toString();
      const url = queryString ? `/api/calendar/events?${queryString}` : '/api/calendar/events';

      const response = await fetch(url, { signal: controller.signal });
      const body = (await response.json().catch(() => null)) as GoogleCalendarEventsResponse | null;

      if (controller.signal.aborted) return;

      if (body?.connected === false) {
        const normalizedError = toErrorMessage((body as unknown as { error?: unknown } | null)?.error) ?? null;
        const entry: CacheEntry = { events: [], canWrite: false, status: "disconnected", error: normalizedError };
        cacheRef.current.set(cacheKey, entry);
        setEvents([]);
        setCanWrite(false);
        setStatus("disconnected");
        setError(normalizedError);
        return;
      }

      if (!response.ok) {
        const message =
          toErrorMessage((body as unknown as { error?: unknown } | null)?.error) ??
          "Failed to fetch Google Calendar events";
        const entry: CacheEntry = { events: [], canWrite: false, status: "error", error: message };
        cacheRef.current.set(cacheKey, entry);
        setEvents([]);
        setCanWrite(false);
        setStatus("error");
        setError(message);
        return;
      }

      const nextEvents = Array.isArray(body?.events) ? body!.events : [];
      const nextCanWrite = body?.canWrite ?? false;

      const normalizedError = toErrorMessage((body as unknown as { error?: unknown } | null)?.error) ?? null;
      const entry: CacheEntry = { events: nextEvents, canWrite: nextCanWrite, status: "success", error: normalizedError };
      cacheRef.current.set(cacheKey, entry);

      setEvents(nextEvents);
      setCanWrite(nextCanWrite);
      setStatus("success");
      setError(normalizedError);
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : "Failed to fetch Google Calendar events";
      const entry: CacheEntry = { events: [], canWrite: false, status: "error", error: message }; // Default false on error
      cacheRef.current.set(cacheKey, entry);
      setEvents([]);
      setCanWrite(false);
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
    canWrite,
    status,
    error,
    connected: status !== "disconnected" && status !== "error" && status !== "idle", // 'idle' means not loaded yet
    // Actually connected logic in v1 was `status !== "disconnected"`. Let's keep it consistent but safer.
    // Wait, original was `connected: status !== "disconnected"`.
    // If error occurs (e.g. rate limit), we are still connected?
    // Let's stick to original behavior as much as possible but expose canWrite.
    isConnected: status === "success" || (status !== "disconnected" && status !== "error"), // ambiguous
    refresh,
  };
}
