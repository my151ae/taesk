"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getDayDiff } from "@/app/(board)/_utils/timeline-helpers";

type UseTimelineUrlStateArgs = {
  basePath?: string | null;
  defaultTimelineRange?: number | null;
  defaultListBefore?: number | null;
  defaultListAfter?: number | null;
  defaultView?: TimelineViewMode;
};

export type TimelineViewMode = "timeline" | "list";
export type UrlUpdateMethod = "replace" | "push";
export type ListWindow = { before: number; after: number };
export type ListWindowPresetKey =
  | "plus3"
  | "plus2"
  | "plus1"
  | "zero"
  | "minus1"
  | "minus2"
  | "minus3";

export type UrlParseErrorCode =
  | "MISSING_VIEW"
  | "INVALID_VIEW"
  | "UNKNOWN_PARAM"
  | "MISSING_RANGE"
  | "INVALID_RANGE"
  | "MISSING_BEFORE"
  | "INVALID_BEFORE"
  | "MISSING_AFTER"
  | "INVALID_AFTER"
  | "INVALID_WINDOW"
  | "INVALID_DATE"
  | "INVALID_TIME";

export type UrlParseResult =
  | { ok: true }
  | { ok: false; code: UrlParseErrorCode; detail?: string };

export type ResolvedTimelineUrlState = {
  hasQuery: boolean;
  hasExplicitView: boolean;
  view: TimelineViewMode;
  date: string | null;
  time: number | null;
  card: string | null;
  timelineRange: number;
  listWindow: ListWindow;
  anchorOffset: number;
  startOffset: number;
};

type TimelineUrlUpdateArgs = {
  date?: string | null;
  range: number;
  time?: number | null;
  method?: UrlUpdateMethod;
  card?: string | null;
};

type ListUrlUpdateArgs = {
  date?: string | null;
  before: number;
  after: number;
  time?: number | null;
  method?: UrlUpdateMethod;
  card?: string | null;
};

const KNOWN_KEYS = new Set(["view", "card", "date", "time", "range", "before", "after"]);
const TIMELINE_KEYS = new Set(["view", "range", "date", "time", "card"]);
const LIST_KEYS = new Set(["view", "before", "after", "date", "time", "card"]);
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ZERO_LIST_WINDOW: ListWindow = { before: 15, after: 15 };

const todayJstIso = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const normalizeCardValue = (value: string | null | undefined) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseIntegerStrict = (value: string | null) => {
  if (value == null) return null;
  if (!/^-?\d+$/.test(value)) return null;
  return Number.parseInt(value, 10);
};

const isValidIsoDate = (value: string) => {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const [yearRaw, monthRaw, dayRaw] = value.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day
  );
};

const clampTimelineRange = (range: number) => Math.min(7, Math.max(1, Math.round(range)));

const normalizeListWindow = (before: number, after: number): ListWindow => {
  const normalizedBefore = Number.isFinite(before) ? Math.max(0, Math.round(before)) : ZERO_LIST_WINDOW.before;
  const normalizedAfter = Number.isFinite(after) ? Math.max(0, Math.round(after)) : ZERO_LIST_WINDOW.after;
  if (normalizedBefore + normalizedAfter + 1 > 120) {
    return ZERO_LIST_WINDOW;
  }
  return { before: normalizedBefore, after: normalizedAfter };
};

export const useTimelineUrlState = ({
  basePath,
  defaultTimelineRange,
  defaultListBefore,
  defaultListAfter,
  defaultView = "timeline",
}: UseTimelineUrlStateArgs) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const path = basePath ?? null;

  const normalizedDefaults = useMemo(() => {
    const timelineRange = clampTimelineRange(defaultTimelineRange ?? 2);
    const listWindow = normalizeListWindow(defaultListBefore ?? ZERO_LIST_WINDOW.before, defaultListAfter ?? ZERO_LIST_WINDOW.after);
    const view: TimelineViewMode = defaultView === "list" ? "list" : "timeline";
    return {
      timelineRange,
      listWindow,
      view,
    };
  }, [defaultListAfter, defaultListBefore, defaultTimelineRange, defaultView]);

  const { parseResult, resolvedState } = useMemo((): {
    parseResult: UrlParseResult;
    resolvedState: ResolvedTimelineUrlState;
  } => {
    const keys = Array.from(new Set(Array.from(searchParams.keys())));
    const hasQuery = keys.length > 0;
    const card = normalizeCardValue(searchParams.get("card"));
    const nonCardKeys = keys.filter((key) => key !== "card");
    const today = todayJstIso();

    const buildDefaultResolved = (): ResolvedTimelineUrlState => ({
      hasQuery,
      hasExplicitView: false,
      view: normalizedDefaults.view,
      date: null,
      time: null,
      card,
      timelineRange: normalizedDefaults.timelineRange,
      listWindow: normalizedDefaults.listWindow,
      anchorOffset: 0,
      startOffset: normalizedDefaults.view === "list" ? -normalizedDefaults.listWindow.before : 0,
    });

    if (nonCardKeys.length === 0) {
      return { parseResult: { ok: true }, resolvedState: buildDefaultResolved() };
    }

    const view = searchParams.get("view");
    if (!view) {
      const unknown = nonCardKeys.filter((key) => !KNOWN_KEYS.has(key));
      if (unknown.length > 0) {
        return {
          parseResult: { ok: false, code: "UNKNOWN_PARAM", detail: unknown.join(",") },
          resolvedState: buildDefaultResolved(),
        };
      }
      return { parseResult: { ok: false, code: "MISSING_VIEW" }, resolvedState: buildDefaultResolved() };
    }

    if (view !== "timeline" && view !== "list") {
      return { parseResult: { ok: false, code: "INVALID_VIEW" }, resolvedState: buildDefaultResolved() };
    }

    const allowed = view === "timeline" ? TIMELINE_KEYS : LIST_KEYS;
    const unknownParams = keys.filter((key) => !allowed.has(key));
    if (unknownParams.length > 0) {
      return {
        parseResult: { ok: false, code: "UNKNOWN_PARAM", detail: unknownParams.join(",") },
        resolvedState: buildDefaultResolved(),
      };
    }

    const rawDate = searchParams.get("date");
    if (rawDate != null && !isValidIsoDate(rawDate)) {
      return { parseResult: { ok: false, code: "INVALID_DATE" }, resolvedState: buildDefaultResolved() };
    }
    const date = rawDate ?? null;

    const rawTime = searchParams.get("time");
    const parsedTime = parseIntegerStrict(rawTime);
    if (rawTime != null && (parsedTime == null || parsedTime < 0 || parsedTime > 1439)) {
      return { parseResult: { ok: false, code: "INVALID_TIME" }, resolvedState: buildDefaultResolved() };
    }
    const time = parsedTime ?? null;

    if (view === "timeline") {
      const rawRange = searchParams.get("range");
      if (rawRange == null) {
        return { parseResult: { ok: false, code: "MISSING_RANGE" }, resolvedState: buildDefaultResolved() };
      }
      const parsedRange = parseIntegerStrict(rawRange);
      if (parsedRange == null || parsedRange < 1 || parsedRange > 7) {
        return { parseResult: { ok: false, code: "INVALID_RANGE" }, resolvedState: buildDefaultResolved() };
      }
      const anchorOffset = date ? getDayDiff(date, today) : 0;
      return {
        parseResult: { ok: true },
        resolvedState: {
          hasQuery,
          hasExplicitView: true,
          view,
          date,
          time,
          card,
          timelineRange: parsedRange,
          listWindow: normalizedDefaults.listWindow,
          anchorOffset,
          startOffset: anchorOffset,
        },
      };
    }

    const rawBefore = searchParams.get("before");
    if (rawBefore == null) {
      return { parseResult: { ok: false, code: "MISSING_BEFORE" }, resolvedState: buildDefaultResolved() };
    }
    const parsedBefore = parseIntegerStrict(rawBefore);
    if (parsedBefore == null || parsedBefore < 0) {
      return { parseResult: { ok: false, code: "INVALID_BEFORE" }, resolvedState: buildDefaultResolved() };
    }

    const rawAfter = searchParams.get("after");
    if (rawAfter == null) {
      return { parseResult: { ok: false, code: "MISSING_AFTER" }, resolvedState: buildDefaultResolved() };
    }
    const parsedAfter = parseIntegerStrict(rawAfter);
    if (parsedAfter == null || parsedAfter < 0) {
      return { parseResult: { ok: false, code: "INVALID_AFTER" }, resolvedState: buildDefaultResolved() };
    }
    if (parsedBefore + parsedAfter + 1 > 120) {
      return { parseResult: { ok: false, code: "INVALID_WINDOW" }, resolvedState: buildDefaultResolved() };
    }

    const anchorOffset = date ? getDayDiff(date, today) : 0;
    return {
      parseResult: { ok: true },
      resolvedState: {
        hasQuery,
        hasExplicitView: true,
        view,
        date,
        time,
        card,
        timelineRange: normalizedDefaults.timelineRange,
        listWindow: { before: parsedBefore, after: parsedAfter },
        anchorOffset,
        startOffset: anchorOffset - parsedBefore,
      },
    };
  }, [searchParams, normalizedDefaults]);

  const [dayWindowStart, setDayWindowStart] = useState(resolvedState.startOffset);
  const dayWindowStartRef = useRef(resolvedState.startOffset);

  useEffect(() => {
    setDayWindowStart(resolvedState.startOffset);
    dayWindowStartRef.current = resolvedState.startOffset;
  }, [resolvedState.startOffset]);

  const navigateWithParams = useCallback(
    (params: URLSearchParams, method: UrlUpdateMethod = "replace") => {
      const currentPath = typeof window !== "undefined" ? window.location.pathname : "";
      const currentSearch = typeof window !== "undefined" ? window.location.search : "";
      const effectivePath = path ?? currentPath;
      const query = params.toString();
      const nextUrl = query ? `${effectivePath}?${query}` : effectivePath;
      const currentUrl = `${currentPath}${currentSearch}`;
      if (currentUrl === nextUrl) return;
      if (method === "push") {
        router.push(nextUrl, { scroll: false });
        return;
      }
      router.replace(nextUrl, { scroll: false });
    },
    [path, router],
  );

  const buildBaseParams = useCallback(
    (explicitCard?: string | null) => {
      const params = new URLSearchParams();
      const card = explicitCard === undefined ? resolvedState.card : normalizeCardValue(explicitCard);
      if (card) params.set("card", card);
      return params;
    },
    [resolvedState.card],
  );

  const updateUrlForTimeline = useCallback(
    ({ date, range, time, method, card }: TimelineUrlUpdateArgs) => {
      const params = buildBaseParams(card);
      params.set("view", "timeline");
      params.set("range", String(clampTimelineRange(range)));
      if (date && isValidIsoDate(date)) {
        params.set("date", date);
      }
      if (typeof time === "number" && Number.isFinite(time) && time >= 0 && time <= 1439) {
        params.set("time", String(Math.round(time)));
      }
      navigateWithParams(params, method ?? "replace");
    },
    [buildBaseParams, navigateWithParams],
  );

  const updateUrlForList = useCallback(
    ({ date, before, after, time, method, card }: ListUrlUpdateArgs) => {
      const params = buildBaseParams(card);
      const window = normalizeListWindow(before, after);
      params.set("view", "list");
      params.set("before", String(window.before));
      params.set("after", String(window.after));
      if (date && isValidIsoDate(date)) {
        params.set("date", date);
      }
      if (typeof time === "number" && Number.isFinite(time) && time >= 0 && time <= 1439) {
        params.set("time", String(Math.round(time)));
      }
      navigateWithParams(params, method ?? "replace");
    },
    [buildBaseParams, navigateWithParams],
  );

  const setCard = useCallback(
    (card: string | null, options?: { method?: UrlUpdateMethod }) => {
      const method = options?.method ?? "replace";
      const normalizedCard = normalizeCardValue(card);
      if (!resolvedState.hasExplicitView) {
        const params = new URLSearchParams();
        if (normalizedCard) params.set("card", normalizedCard);
        navigateWithParams(params, method);
        return;
      }
      if (resolvedState.view === "timeline") {
        updateUrlForTimeline({
          date: resolvedState.date,
          range: resolvedState.timelineRange,
          time: resolvedState.time,
          card: normalizedCard,
          method,
        });
        return;
      }
      updateUrlForList({
        date: resolvedState.date,
        before: resolvedState.listWindow.before,
        after: resolvedState.listWindow.after,
        time: resolvedState.time,
        card: normalizedCard,
        method,
      });
    },
    [navigateWithParams, resolvedState, updateUrlForList, updateUrlForTimeline],
  );

  return {
    parseResult,
    resolvedState,
    dayWindowStart,
    setDayWindowStart,
    dayWindowStartRef,
    updateUrlForTimeline,
    updateUrlForList,
    setCard,
  };
};
