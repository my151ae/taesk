"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GoogleCalendarEvent, GoogleCalendarEventsResponse } from "@/lib/api-types/google-calendar";

type GoogleCalendarStatus = "idle" | "loading" | "success" | "error" | "disconnected";

type WeekBlock = {
  events: Map<string, GoogleCalendarEvent>;
};

type FetchMode = "cache-only" | "refresh";

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

const startOfWeekJst = (base: Date) => {
  const jstMs = base.getTime() + 9 * 60 * 60 * 1000;
  const jst = new Date(jstMs);
  const day = jst.getUTCDay();
  const diff = (day + 6) % 7;
  const mondayUtc = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() - diff, 0, 0, 0);
  return new Date(mondayUtc - 9 * 60 * 60 * 1000);
};

const endOfWeekExclusiveJst = (weekStart: Date) => {
  const next = new Date(weekStart);
  next.setUTCDate(next.getUTCDate() + 7);
  return next;
};

const formatWeekKey = (weekStart: Date) => weekStart.toISOString().slice(0, 10);

const buildRequiredWeekKeys = (startDate?: Date | null, endDate?: Date | null) => {
  if (!startDate || !endDate) return [];

  const start = startOfWeekJst(startDate);
  const keys: string[] = [];
  let cursor = new Date(start);
  while (cursor.getTime() < endDate.getTime()) {
    keys.push(formatWeekKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return keys;
};

const dedupeEventKey = (event: GoogleCalendarEvent) => {
  if (event.isAllDay) {
    return `${event.id}:${event.startDate ?? event.start}:${event.endDate ?? event.end}`;
  }
  return `${event.id}:${event.start}:${event.end}`;
};

const parseIsoDateKey = (value: string | null) => (value ? new Date(`${value}T00:00:00.000Z`) : null);

export function useGoogleCalendar(startDate?: Date | null, endDate?: Date | null) {
  const startDateKey = startDate ? startDate.toISOString().slice(0, 10) : null;
  const endDateKey = endDate ? endDate.toISOString().slice(0, 10) : null;
  const hasExplicitRange = startDateKey != null && endDateKey != null;
  const requiredWeekKeys = useMemo(
    () => buildRequiredWeekKeys(parseIsoDateKey(startDateKey), parseIsoDateKey(endDateKey)),
    [endDateKey, startDateKey],
  );
  const requiredWeekKeysSignature = useMemo(() => requiredWeekKeys.join("|"), [requiredWeekKeys]);

  const [events, setEvents] = useState<GoogleCalendarEvent[]>([]);
  const [canWrite, setCanWrite] = useState<boolean>(false);
  const [status, setStatus] = useState<GoogleCalendarStatus>("idle");
  const [backgroundStatus, setBackgroundStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);

  const blocksRef = useRef<Map<string, WeekBlock>>(new Map());
  const inflightRequestsRef = useRef<Set<string>>(new Set());
  const permissionCheckedRef = useRef(false);
  const refreshRecommendedWeekKeysRef = useRef<Set<string>>(new Set());
  const refreshAttemptedWeekKeysRef = useRef<Set<string>>(new Set());
  const manualRefreshRequestedRef = useRef(false);
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const lastVisibleEventsSignatureRef = useRef<string>("");

  const rebuildVisibleEvents = useCallback(() => {
    const merged = new Map<string, GoogleCalendarEvent>();
    requiredWeekKeys.forEach((weekKey) => {
      const block = blocksRef.current.get(weekKey);
      if (!block) return;
      block.events.forEach((event, key) => merged.set(key, event));
    });

    const nextEvents = [...merged.values()].sort((left, right) => {
        const leftValue = left.startDate ?? left.start;
        const rightValue = right.startDate ?? right.start;
        return leftValue.localeCompare(rightValue);
      });
    const nextSignature = nextEvents
      .map((event) => dedupeEventKey(event))
      .join("|");
    if (nextSignature === lastVisibleEventsSignatureRef.current) {
      return;
    }
    lastVisibleEventsSignatureRef.current = nextSignature;
    setEvents(nextEvents);
  }, [requiredWeekKeys]);

  const fetchWeek = useCallback(async (weekKey: string, mode: FetchMode) => {
    const requestKey = `${mode}:${weekKey}`;
    if (inflightRequestsRef.current.has(requestKey)) return;

    inflightRequestsRef.current.add(requestKey);
    const controller = new AbortController();
    abortControllersRef.current.set(requestKey, controller);

    try {
      const start = new Date(`${weekKey}T00:00:00.000Z`);
      const end = endOfWeekExclusiveJst(start);
      const params = new URLSearchParams({
        start: start.toISOString(),
        end: end.toISOString(),
        mode,
      });
      if (mode === "refresh") {
        params.set("syncCardsOnFetch", "false");
      }

      const response = await fetch(`/api/calendar/events?${params.toString()}`, {
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => null)) as GoogleCalendarEventsResponse | null;

      if (controller.signal.aborted) return;

      if (body?.connected === false) {
        const normalizedError = toErrorMessage((body as { error?: unknown } | null)?.error) ?? null;
        setCanWrite(false);
        setStatus("disconnected");
        setError(normalizedError);
        setBackgroundStatus("idle");
        return;
      }

      if (!response.ok) {
        const message =
          toErrorMessage((body as { error?: unknown } | null)?.error) ??
          "Failed to fetch Google Calendar events";
        if (mode === "cache-only" && events.length === 0 && blocksRef.current.size === 0) {
          setStatus("error");
        }
        setError(message);
        setBackgroundStatus("error");
        return;
      }

      const nextEvents = Array.isArray(body?.events) ? body.events : [];
      const blockEvents = new Map<string, GoogleCalendarEvent>();
      nextEvents.forEach((event) => {
        blockEvents.set(dedupeEventKey(event), event);
      });

      blocksRef.current.set(weekKey, { events: blockEvents });
      permissionCheckedRef.current = true;
      setCanWrite(body?.canWrite ?? false);
      setStatus("success");
      setError(toErrorMessage((body as { error?: unknown } | null)?.error) ?? null);
      rebuildVisibleEvents();

      if (mode === "cache-only") {
        if (body?.backgroundRefreshRecommended) {
          refreshRecommendedWeekKeysRef.current.add(weekKey);
          refreshAttemptedWeekKeysRef.current.add(weekKey);
          setBackgroundStatus("loading");
          void fetchWeek(weekKey, "refresh");
        } else {
          refreshRecommendedWeekKeysRef.current.delete(weekKey);
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : "Failed to fetch Google Calendar events";
      if (!permissionCheckedRef.current && mode === "cache-only") {
        setStatus("error");
      }
      setError(message);
      setBackgroundStatus("error");
    } finally {
      inflightRequestsRef.current.delete(requestKey);
      abortControllersRef.current.delete(requestKey);
      if (mode === "refresh") {
        setBackgroundStatus("idle");
      }
    }
  }, [events.length, rebuildVisibleEvents]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!hasExplicitRange) {
        if (permissionCheckedRef.current) {
          rebuildVisibleEvents();
          return;
        }

        setStatus("loading");
        try {
          const response = await fetch("/api/calendar/events?mode=cache-only");
          const body = (await response.json().catch(() => null)) as GoogleCalendarEventsResponse | null;
          if (cancelled) return;

          if (body?.connected === false) {
            setCanWrite(false);
            setStatus("disconnected");
            setError(toErrorMessage((body as { error?: unknown } | null)?.error) ?? null);
            return;
          }

          if (!response.ok) {
            const message =
              toErrorMessage((body as { error?: unknown } | null)?.error) ??
              "Failed to fetch Google Calendar events";
            setStatus("error");
            setError(message);
            return;
          }

          permissionCheckedRef.current = true;
          setCanWrite(body?.canWrite ?? false);
          setStatus("success");
          setError(null);

          if (body?.backgroundRefreshRecommended) {
            setBackgroundStatus("loading");
            void fetch("/api/calendar/events?mode=refresh&syncCardsOnFetch=false")
              .then(async (refreshResponse) => {
                const refreshBody = (await refreshResponse.json().catch(() => null)) as GoogleCalendarEventsResponse | null;
                if (cancelled) return;
                if (refreshBody?.connected === false) {
                  setCanWrite(false);
                  setStatus("disconnected");
                  setError(toErrorMessage((refreshBody as { error?: unknown } | null)?.error) ?? null);
                  return;
                }
                if (!refreshResponse.ok) {
                  setError(
                    toErrorMessage((refreshBody as { error?: unknown } | null)?.error) ??
                    "Failed to refresh Google Calendar events"
                  );
                  setBackgroundStatus("error");
                  return;
                }
                setCanWrite(refreshBody?.canWrite ?? false);
                setStatus("success");
                setError(null);
              })
              .catch((err) => {
                if (cancelled) return;
                setError(err instanceof Error ? err.message : "Failed to refresh Google Calendar events");
                setBackgroundStatus("error");
              })
              .finally(() => {
                if (!cancelled) setBackgroundStatus("idle");
              });
          }
        } catch (err) {
          if (cancelled) return;
          setStatus("error");
          setError(err instanceof Error ? err.message : "Failed to fetch Google Calendar events");
        }
        return;
      }

      rebuildVisibleEvents();
      const missingWeekKeys = requiredWeekKeys.filter((weekKey) => !blocksRef.current.has(weekKey));
      if (missingWeekKeys.length === 0) {
        if (permissionCheckedRef.current) {
          setStatus("success");
        }
        setBackgroundStatus("idle");
        const refreshWeekKeys = requiredWeekKeys.filter((weekKey) => {
          if (refreshAttemptedWeekKeysRef.current.has(weekKey)) return false;
          if (manualRefreshRequestedRef.current) return true;
          return refreshRecommendedWeekKeysRef.current.has(weekKey);
        });
        if (refreshWeekKeys.length > 0) {
          refreshWeekKeys.forEach((weekKey) => refreshAttemptedWeekKeysRef.current.add(weekKey));
          setBackgroundStatus("loading");
          await Promise.all(refreshWeekKeys.map((weekKey) => fetchWeek(weekKey, "refresh")));
          if (cancelled) return;
          rebuildVisibleEvents();
          setBackgroundStatus("idle");
        }
        manualRefreshRequestedRef.current = false;
        return;
      }

      if (events.length === 0 && blocksRef.current.size === 0 && !permissionCheckedRef.current) {
        setStatus("loading");
      } else {
        setBackgroundStatus("loading");
      }

      await Promise.all(missingWeekKeys.map((weekKey) => fetchWeek(weekKey, "cache-only")));
      if (cancelled) return;

      rebuildVisibleEvents();
      if (permissionCheckedRef.current) {
        setStatus("success");
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [endDateKey, events.length, fetchWeek, hasExplicitRange, rebuildVisibleEvents, refreshVersion, requiredWeekKeys, startDateKey]);

  useEffect(() => {
    const controllers = abortControllersRef.current;
    return () => {
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
    };
  }, []);

  const refresh = useCallback(() => {
    requiredWeekKeys.forEach((weekKey) => {
      blocksRef.current.delete(weekKey);
      refreshRecommendedWeekKeysRef.current.delete(weekKey);
      refreshAttemptedWeekKeysRef.current.delete(weekKey);
    });
    manualRefreshRequestedRef.current = true;
    if (requiredWeekKeys.length === 0) {
      permissionCheckedRef.current = false;
    }
    if (events.length > 0 || permissionCheckedRef.current) {
      setBackgroundStatus("loading");
    } else if (requiredWeekKeys.length > 0) {
      setStatus("loading");
    }
    setRefreshVersion((current) => current + 1);
  }, [events.length, requiredWeekKeys]);

  return {
    events,
    canWrite,
    status,
    backgroundStatus,
    error,
    connected: status !== "disconnected" && status !== "error" && status !== "idle",
    isConnected: status === "success" || (status !== "disconnected" && status !== "error"),
    refresh,
  };
}
