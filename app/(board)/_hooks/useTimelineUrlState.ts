"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams, type ReadonlyURLSearchParams } from "next/navigation";
import { getDayDiff } from "@/app/(board)/_utils/timeline-helpers";

type UseTimelineUrlStateArgs = {
  basePath?: string | null;
  defaultTimelineRange?: number | null;
  defaultListBefore?: number | null;
  defaultListAfter?: number | null;
};

export type TimelineViewMode = "timeline" | "list" | "month";
export type PrimaryPanelMode = "none" | "overdue" | "completed" | "notifications" | "tags" | "search" | "trash";
export type MainPanelMode = "timeline" | "list" | "month";
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

export type BoardUiState = {
  primaryPanel: {
    mode: PrimaryPanelMode;
    state: {
      tag?: string | null;
      q?: string | null;
    };
  };
  mainPanel: {
    mode: MainPanelMode;
    state: Record<string, never>;
  };
};

export type UrlParseErrorCode =
  | "LEGACY_QUERY"
  | "UNKNOWN_PARAM"
  | "MISSING_PP"
  | "MISSING_MP"
  | "INVALID_PP"
  | "INVALID_MP"
  | "INVALID_DATE"
  | "INVALID_TAG"
  | "INVALID_Q"
  | "INVALID_CHECKED"
  | "INVALID_UNCHECKED";

export type UrlParseResult =
  | { ok: true }
  | { ok: false; code: UrlParseErrorCode; detail?: string };

export type ResolvedTimelineUrlState = {
  hasQuery: boolean;
  hasExplicitBoardState: boolean;
  view: TimelineViewMode;
  primaryPanelMode: PrimaryPanelMode;
  mainPanelMode: MainPanelMode;
  boardUiState: BoardUiState;
  date: string | null;
  tag: string | null;
  searchQuery: string;
  showChecked: boolean;
  showUnchecked: boolean;
  card: string | null;
  timelineRange: number;
  listWindow: ListWindow;
  anchorOffset: number;
  startOffset: number;
};

type TimelineUrlUpdateArgs = {
  date?: string | null;
  method?: UrlUpdateMethod;
  card?: string | null;
};

type ListUrlUpdateArgs = {
  method?: UrlUpdateMethod;
  card?: string | null;
};

type MonthUrlUpdateArgs = {
  date?: string | null;
  method?: UrlUpdateMethod;
  card?: string | null;
};

type BoardUrlUpdateArgs = {
  primaryPanelMode?: PrimaryPanelMode;
  mainPanelMode?: MainPanelMode;
  date?: string | null;
  tag?: string | null;
  searchQuery?: string | null;
  showChecked?: boolean;
  showUnchecked?: boolean;
  card?: string | null;
  method?: UrlUpdateMethod;
};

type ParseDefaults = {
  timelineRange: number;
  listWindow: ListWindow;
};

const LEGACY_KEYS = new Set(["view", "range", "before", "after", "time"]);
const KNOWN_KEYS = new Set(["pp", "mp", "date", "tag", "q", "checked", "unchecked", "card"]);
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

const normalizeTagValue = (value: string | null) => {
  if (value == null) return { ok: true as const, value: null };
  const trimmed = value.trim();
  if (!trimmed) return { ok: false as const };
  return { ok: true as const, value: trimmed };
};

const normalizeQueryValue = (value: string | null) => {
  if (value == null) return { ok: true as const, value: null };
  const trimmed = value.trim();
  return { ok: true as const, value: trimmed.length > 0 ? trimmed : null };
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

const isPrimaryPanelMode = (value: string | null): value is PrimaryPanelMode =>
  value === "none" || value === "overdue" || value === "completed" || value === "notifications" || value === "tags" || value === "search" || value === "trash";

const isMainPanelMode = (value: string | null): value is MainPanelMode =>
  value === "timeline" || value === "list" || value === "month";

const parseBooleanSearchParam = (
  value: string | null,
): { ok: true; value: boolean | null } | { ok: false } => {
  if (value == null) return { ok: true, value: null };
  if (value === "1") return { ok: true, value: true };
  if (value === "0") return { ok: true, value: false };
  return { ok: false };
};

const buildDefaultResolvedState = (
  defaults: ParseDefaults,
  hasQuery: boolean,
  card: string | null,
): ResolvedTimelineUrlState => ({
  hasQuery,
  hasExplicitBoardState: false,
  view: "timeline",
  primaryPanelMode: "overdue",
  mainPanelMode: "timeline",
  boardUiState: {
    primaryPanel: { mode: "overdue", state: { tag: null, q: null } },
    mainPanel: { mode: "timeline", state: {} },
  },
  date: null,
  tag: null,
  searchQuery: "",
  showChecked: true,
  showUnchecked: true,
  card,
  timelineRange: defaults.timelineRange,
  listWindow: defaults.listWindow,
  anchorOffset: 0,
  startOffset: 0,
});

export function normalizeBoardUiState(
  input: {
    primaryPanelMode: PrimaryPanelMode;
    mainPanelMode: MainPanelMode;
    date?: string | null;
    tag?: string | null;
    searchQuery?: string | null;
    showChecked?: boolean | null;
    showUnchecked?: boolean | null;
  },
  defaults?: ParseDefaults,
): ResolvedTimelineUrlState {
  const safeDefaults = defaults ?? {
    timelineRange: 2,
    listWindow: ZERO_LIST_WINDOW,
  };
  const card = null;
  const today = todayJstIso();
  let primaryPanelMode = input.primaryPanelMode;
  let mainPanelMode = input.mainPanelMode;
  let date = input.date && isValidIsoDate(input.date) ? input.date : null;
  let tag = input.tag?.trim() ? input.tag.trim() : null;
  let searchQuery = input.searchQuery?.trim() ? input.searchQuery.trim() : "";
  let showChecked = input.showChecked ?? true;
  let showUnchecked = input.showUnchecked ?? true;

  if (mainPanelMode === "list") {
    date = null;
  }
  if (primaryPanelMode !== "tags") {
    tag = null;
    showChecked = true;
    showUnchecked = true;
  }
  if (primaryPanelMode !== "search") {
    searchQuery = "";
  }

  const anchorOffset = date ? getDayDiff(date, today) : 0;
  const view = mainPanelMode;

  return {
    hasQuery: true,
    hasExplicitBoardState: true,
    view,
    primaryPanelMode,
    mainPanelMode,
    boardUiState: {
      primaryPanel: {
        mode: primaryPanelMode,
        state: {
          tag,
          q: searchQuery || null,
        },
      },
      mainPanel: { mode: mainPanelMode, state: {} },
    },
    date,
    tag,
    searchQuery,
    showChecked,
    showUnchecked,
    card,
    timelineRange: safeDefaults.timelineRange,
    listWindow: safeDefaults.listWindow,
    anchorOffset,
    startOffset: view === "list" ? anchorOffset - safeDefaults.listWindow.before : anchorOffset,
  };
}

export function serializeBoardUiStateToSearchParams(args: {
  state: Pick<
    ResolvedTimelineUrlState,
    "primaryPanelMode" | "mainPanelMode" | "date" | "tag" | "searchQuery" | "showChecked" | "showUnchecked"
  >;
  card?: string | null;
}) {
  const normalized = normalizeBoardUiState({
    primaryPanelMode: args.state.primaryPanelMode,
    mainPanelMode: args.state.mainPanelMode,
    date: args.state.date,
    tag: args.state.tag,
    searchQuery: args.state.searchQuery,
    showChecked: args.state.showChecked,
    showUnchecked: args.state.showUnchecked,
  });

  const params = new URLSearchParams();
  params.set("pp", normalized.primaryPanelMode);
  params.set("mp", normalized.mainPanelMode);

  if ((normalized.mainPanelMode === "timeline" || normalized.mainPanelMode === "month") && normalized.date) {
    params.set("date", normalized.date);
  }
  if (normalized.primaryPanelMode === "tags" && normalized.tag) {
    params.set("tag", normalized.tag);
  }
  if (normalized.primaryPanelMode === "search" && normalized.searchQuery) {
    params.set("q", normalized.searchQuery);
  }
  if (normalized.primaryPanelMode === "tags" && !normalized.showChecked) {
    params.set("checked", "0");
  }
  if (normalized.primaryPanelMode === "tags" && !normalized.showUnchecked) {
    params.set("unchecked", "0");
  }

  const card = normalizeCardValue(args.card);
  if (card) params.set("card", card);

  return params;
}

export function parseBoardUiStateFromSearchParams(
  searchParams: URLSearchParams | ReadonlyURLSearchParams,
  defaults?: ParseDefaults,
): { parseResult: UrlParseResult; resolvedState: ResolvedTimelineUrlState } {
  const keys = Array.from(new Set(Array.from(searchParams.keys())));
  const hasQuery = keys.length > 0;
  const card = normalizeCardValue(searchParams.get("card"));
  const nonCardKeys = keys.filter((key) => key !== "card");
  const safeDefaults = defaults ?? {
    timelineRange: 2,
    listWindow: ZERO_LIST_WINDOW,
  };
  const defaultResolved = buildDefaultResolvedState(safeDefaults, hasQuery, card);

  if (nonCardKeys.length === 0) {
    return { parseResult: { ok: true }, resolvedState: defaultResolved };
  }

  const legacyKeys = nonCardKeys.filter((key) => LEGACY_KEYS.has(key));
  if (legacyKeys.length > 0) {
    return {
      parseResult: { ok: false, code: "LEGACY_QUERY", detail: legacyKeys.join(",") },
      resolvedState: defaultResolved,
    };
  }

  const unknownKeys = nonCardKeys.filter((key) => !KNOWN_KEYS.has(key));
  if (unknownKeys.length > 0) {
    return {
      parseResult: { ok: false, code: "UNKNOWN_PARAM", detail: unknownKeys.join(",") },
      resolvedState: defaultResolved,
    };
  }

  const rawPrimaryPanelMode = searchParams.get("pp");
  if (!rawPrimaryPanelMode) {
    return { parseResult: { ok: false, code: "MISSING_PP" }, resolvedState: defaultResolved };
  }
  if (!isPrimaryPanelMode(rawPrimaryPanelMode)) {
    return { parseResult: { ok: false, code: "INVALID_PP" }, resolvedState: defaultResolved };
  }

  const rawMainPanelMode = searchParams.get("mp");
  if (!rawMainPanelMode) {
    return { parseResult: { ok: false, code: "MISSING_MP" }, resolvedState: defaultResolved };
  }
  if (rawMainPanelMode && !isMainPanelMode(rawMainPanelMode)) {
    return { parseResult: { ok: false, code: "INVALID_MP" }, resolvedState: defaultResolved };
  }

  const rawDate = searchParams.get("date");
  if (rawDate != null && !isValidIsoDate(rawDate)) {
    return { parseResult: { ok: false, code: "INVALID_DATE" }, resolvedState: defaultResolved };
  }

  const parsedTag = normalizeTagValue(searchParams.get("tag"));
  if (!parsedTag.ok) {
    return { parseResult: { ok: false, code: "INVALID_TAG" }, resolvedState: defaultResolved };
  }
  const parsedQuery = normalizeQueryValue(searchParams.get("q"));
  if (!parsedQuery.ok) {
    return { parseResult: { ok: false, code: "INVALID_Q" }, resolvedState: defaultResolved };
  }
  const parsedChecked = parseBooleanSearchParam(searchParams.get("checked"));
  if (!parsedChecked.ok) {
    return { parseResult: { ok: false, code: "INVALID_CHECKED" }, resolvedState: defaultResolved };
  }
  const parsedUnchecked = parseBooleanSearchParam(searchParams.get("unchecked"));
  if (!parsedUnchecked.ok) {
    return { parseResult: { ok: false, code: "INVALID_UNCHECKED" }, resolvedState: defaultResolved };
  }
  const normalized = normalizeBoardUiState(
    {
      primaryPanelMode: rawPrimaryPanelMode,
      mainPanelMode: rawMainPanelMode as MainPanelMode,
      date: rawDate,
      tag: parsedTag.value,
      searchQuery: parsedQuery.value,
      showChecked: parsedChecked.value ?? true,
      showUnchecked: parsedUnchecked.value ?? true,
    },
    safeDefaults,
  );

  return {
    parseResult: { ok: true },
    resolvedState: {
      ...normalized,
      hasQuery,
      hasExplicitBoardState: true,
      card,
    },
  };
}

export const useTimelineUrlState = ({
  basePath,
  defaultTimelineRange,
  defaultListBefore,
  defaultListAfter,
}: UseTimelineUrlStateArgs) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const path = basePath ?? null;

  const normalizedDefaults = useMemo(() => {
    const timelineRange = clampTimelineRange(defaultTimelineRange ?? 2);
    const listWindow = normalizeListWindow(
      defaultListBefore ?? ZERO_LIST_WINDOW.before,
      defaultListAfter ?? ZERO_LIST_WINDOW.after,
    );
    return {
      timelineRange,
      listWindow,
    };
  }, [defaultListAfter, defaultListBefore, defaultTimelineRange]);

  const { parseResult, resolvedState } = useMemo(
    () => parseBoardUiStateFromSearchParams(searchParams, normalizedDefaults),
    [normalizedDefaults, searchParams],
  );

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

  const navigateWithNativeHistory = useCallback(
    (params: URLSearchParams, method: UrlUpdateMethod = "replace") => {
      if (typeof window === "undefined") {
        navigateWithParams(params, method);
        return;
      }

      const currentPath = window.location.pathname;
      const currentSearch = window.location.search;
      const effectivePath = path ?? currentPath;
      const query = params.toString();
      const nextUrl = query ? `${effectivePath}?${query}` : effectivePath;
      const currentUrl = `${currentPath}${currentSearch}`;

      if (currentUrl === nextUrl) return;

      if (method === "push") {
        window.history.pushState(null, "", nextUrl);
        return;
      }

      window.history.replaceState(null, "", nextUrl);
    },
    [navigateWithParams, path],
  );

  const updateBoardUiState = useCallback(
    ({
      primaryPanelMode,
      mainPanelMode,
      date,
      tag,
      searchQuery,
      showChecked,
      showUnchecked,
      card,
      method,
    }: BoardUrlUpdateArgs) => {
      const params = serializeBoardUiStateToSearchParams({
        state: {
          primaryPanelMode: primaryPanelMode ?? resolvedState.primaryPanelMode,
          mainPanelMode: mainPanelMode ?? resolvedState.mainPanelMode,
          date: date === undefined ? resolvedState.date : date,
          tag: tag === undefined ? resolvedState.tag : tag,
          searchQuery: searchQuery === undefined ? resolvedState.searchQuery : (searchQuery ?? ""),
          showChecked: showChecked ?? resolvedState.showChecked,
          showUnchecked: showUnchecked ?? resolvedState.showUnchecked,
        },
        card: card === undefined ? resolvedState.card : card,
      });

      navigateWithParams(params, method ?? "replace");
    },
    [navigateWithParams, resolvedState],
  );

  const updateUrlForTimeline = useCallback(
    ({ date, method, card }: TimelineUrlUpdateArgs) => {
      updateBoardUiState({
        primaryPanelMode: resolvedState.primaryPanelMode,
        mainPanelMode: "timeline",
        date: date ?? resolvedState.date ?? todayJstIso(),
        card,
        method,
      });
    },
    [resolvedState.date, resolvedState.primaryPanelMode, updateBoardUiState],
  );

  const updateUrlForList = useCallback(
    ({ method, card }: ListUrlUpdateArgs) => {
      updateBoardUiState({
        primaryPanelMode: resolvedState.primaryPanelMode,
        mainPanelMode: "list",
        card,
        method,
      });
    },
    [resolvedState.primaryPanelMode, updateBoardUiState],
  );

  const updateUrlForMonth = useCallback(
    ({ date, method, card }: MonthUrlUpdateArgs) => {
      updateBoardUiState({
        primaryPanelMode: resolvedState.primaryPanelMode,
        mainPanelMode: "month",
        date: date ?? resolvedState.date ?? todayJstIso(),
        card,
        method,
      });
    },
    [resolvedState.date, resolvedState.primaryPanelMode, updateBoardUiState],
  );

  const setCard = useCallback(
    (card: string | null, options?: { method?: UrlUpdateMethod }) => {
      const method = options?.method ?? "replace";
      const normalizedCard = normalizeCardValue(card);
      if (!resolvedState.hasExplicitBoardState) {
        const params = new URLSearchParams();
        if (normalizedCard) params.set("card", normalizedCard);
        navigateWithNativeHistory(params, method);
        return;
      }
      const params = serializeBoardUiStateToSearchParams({
        state: {
          primaryPanelMode: resolvedState.primaryPanelMode,
          mainPanelMode: resolvedState.mainPanelMode,
          date: resolvedState.date,
          tag: resolvedState.tag,
          searchQuery: resolvedState.searchQuery,
          showChecked: resolvedState.showChecked,
          showUnchecked: resolvedState.showUnchecked,
        },
        card: normalizedCard,
      });

      navigateWithNativeHistory(params, method);
    },
    [
      navigateWithNativeHistory,
      resolvedState.date,
      resolvedState.hasExplicitBoardState,
      resolvedState.primaryPanelMode,
      resolvedState.mainPanelMode,
      resolvedState.searchQuery,
      resolvedState.showChecked,
      resolvedState.showUnchecked,
      resolvedState.tag,
    ],
  );

  return {
    parseResult,
    resolvedState,
    dayWindowStart,
    setDayWindowStart,
    dayWindowStartRef,
    updateBoardUiState,
    updateUrlForTimeline,
    updateUrlForList,
    updateUrlForMonth,
    setCard,
  };
};
