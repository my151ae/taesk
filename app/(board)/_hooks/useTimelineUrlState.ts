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

export type TimelineViewMode = "timeline" | "list";
export type LeftPanelMode = "none" | "timeline-nav" | "overdue" | "tags" | "search";
export type RightPanelMode = "timeline" | "list";
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
  leftPanel: {
    mode: LeftPanelMode;
    state: {
      date?: string | null;
      tag?: string | null;
      q?: string | null;
    };
  };
  rightPanel: {
    mode: RightPanelMode;
    state: {
      checked?: boolean;
      unchecked?: boolean;
    };
  };
};

export type UrlParseErrorCode =
  | "LEGACY_QUERY"
  | "UNKNOWN_PARAM"
  | "MISSING_LP"
  | "MISSING_RP"
  | "INVALID_LP"
  | "INVALID_RP"
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
  leftPanelMode: LeftPanelMode;
  rightPanelMode: RightPanelMode;
  boardUiState: BoardUiState;
  date: string | null;
  time: number | null;
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

type BoardUrlUpdateArgs = {
  leftPanelMode?: LeftPanelMode;
  rightPanelMode?: RightPanelMode;
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
const KNOWN_KEYS = new Set(["lp", "rp", "date", "tag", "q", "checked", "unchecked", "card"]);
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

const parseBooleanStrict = (value: string | null) => {
  if (value == null) return { ok: true as const, value: null };
  if (value === "1") return { ok: true as const, value: true };
  if (value === "0") return { ok: true as const, value: false };
  return { ok: false as const };
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

const isLeftPanelMode = (value: string | null): value is LeftPanelMode =>
  value === "none" || value === "timeline-nav" || value === "overdue" || value === "tags" || value === "search";

const isRightPanelMode = (value: string | null): value is RightPanelMode =>
  value === "timeline" || value === "list";

const buildDefaultResolvedState = (
  defaults: ParseDefaults,
  hasQuery: boolean,
  card: string | null,
): ResolvedTimelineUrlState => ({
  hasQuery,
  hasExplicitBoardState: false,
  view: "timeline",
  leftPanelMode: "overdue",
  rightPanelMode: "timeline",
  boardUiState: {
    leftPanel: { mode: "overdue", state: { date: null, tag: null, q: null } },
    rightPanel: { mode: "timeline", state: {} },
  },
  date: null,
  time: null,
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
    leftPanelMode: LeftPanelMode;
    rightPanelMode: RightPanelMode;
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
  let leftPanelMode = input.leftPanelMode;
  let rightPanelMode = input.rightPanelMode;
  let date = input.date && isValidIsoDate(input.date) ? input.date : null;
  let tag = input.tag?.trim() ? input.tag.trim() : null;
  let searchQuery = input.searchQuery?.trim() ? input.searchQuery.trim() : "";
  let showChecked = input.showChecked ?? true;
  let showUnchecked = input.showUnchecked ?? true;

  if (leftPanelMode === "none" && rightPanelMode === "timeline") {
    leftPanelMode = "timeline-nav";
  }
  if (leftPanelMode === "timeline-nav") {
    rightPanelMode = "timeline";
  }
  if (leftPanelMode === "tags") {
    rightPanelMode = "list";
  }
  if (leftPanelMode === "search") {
    rightPanelMode = "list";
  }
  if (leftPanelMode === "none") {
    rightPanelMode = "list";
  }
  if (leftPanelMode === "overdue" && rightPanelMode !== "timeline" && rightPanelMode !== "list") {
    rightPanelMode = "timeline";
  }

  if (leftPanelMode === "tags" && searchQuery) {
    searchQuery = "";
  } else if (leftPanelMode === "search" && tag) {
    tag = null;
  } else if (searchQuery && tag) {
    if (leftPanelMode === "search") {
      tag = null;
    } else if (leftPanelMode === "tags") {
      searchQuery = "";
    } else {
      leftPanelMode = "search";
      rightPanelMode = "list";
      tag = null;
    }
  } else if (searchQuery && leftPanelMode !== "search") {
    leftPanelMode = "search";
    rightPanelMode = "list";
  } else if (tag && leftPanelMode !== "tags") {
    leftPanelMode = "tags";
    rightPanelMode = "list";
  }

  if (!(leftPanelMode === "timeline-nav" && rightPanelMode === "timeline")) {
    date = null;
  }
  if (!(leftPanelMode === "tags" && rightPanelMode === "list")) {
    tag = null;
    showChecked = true;
    showUnchecked = true;
  }
  if (!(leftPanelMode === "search" && rightPanelMode === "list")) {
    searchQuery = "";
  }

  const anchorOffset = date ? getDayDiff(date, today) : 0;
  const view = rightPanelMode;

  return {
    hasQuery: true,
    hasExplicitBoardState: true,
    view,
    leftPanelMode,
    rightPanelMode,
    boardUiState: {
      leftPanel: {
        mode: leftPanelMode,
        state: {
          date,
          tag,
          q: searchQuery || null,
        },
      },
      rightPanel: {
        mode: rightPanelMode,
        state:
          leftPanelMode === "tags" && rightPanelMode === "list"
            ? {
                checked: showChecked,
                unchecked: showUnchecked,
              }
            : {},
      },
    },
    date,
    time: null,
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
    "leftPanelMode" | "rightPanelMode" | "date" | "tag" | "searchQuery" | "showChecked" | "showUnchecked"
  >;
  card?: string | null;
}) {
  const normalized = normalizeBoardUiState({
    leftPanelMode: args.state.leftPanelMode,
    rightPanelMode: args.state.rightPanelMode,
    date: args.state.date,
    tag: args.state.tag,
    searchQuery: args.state.searchQuery,
    showChecked: args.state.showChecked,
    showUnchecked: args.state.showUnchecked,
  });

  const params = new URLSearchParams();
  params.set("lp", normalized.leftPanelMode);
  params.set("rp", normalized.rightPanelMode);

  if (normalized.leftPanelMode === "timeline-nav" && normalized.rightPanelMode === "timeline" && normalized.date) {
    params.set("date", normalized.date);
  }
  if (normalized.leftPanelMode === "tags" && normalized.rightPanelMode === "list" && normalized.tag) {
    params.set("tag", normalized.tag);
    params.set("checked", normalized.showChecked ? "1" : "0");
    params.set("unchecked", normalized.showUnchecked ? "1" : "0");
  }
  if (normalized.leftPanelMode === "search" && normalized.rightPanelMode === "list" && normalized.searchQuery) {
    params.set("q", normalized.searchQuery);
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

  const rawLp = searchParams.get("lp");
  if (!rawLp) {
    return { parseResult: { ok: false, code: "MISSING_LP" }, resolvedState: defaultResolved };
  }
  if (!isLeftPanelMode(rawLp)) {
    return { parseResult: { ok: false, code: "INVALID_LP" }, resolvedState: defaultResolved };
  }

  const rawRp = searchParams.get("rp");
  if (!rawRp && rawLp !== "overdue") {
    return { parseResult: { ok: false, code: "MISSING_RP" }, resolvedState: defaultResolved };
  }
  if (rawRp && !isRightPanelMode(rawRp)) {
    return { parseResult: { ok: false, code: "INVALID_RP" }, resolvedState: defaultResolved };
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
  const parsedChecked = parseBooleanStrict(searchParams.get("checked"));
  if (!parsedChecked.ok) {
    return { parseResult: { ok: false, code: "INVALID_CHECKED" }, resolvedState: defaultResolved };
  }
  const parsedUnchecked = parseBooleanStrict(searchParams.get("unchecked"));
  if (!parsedUnchecked.ok) {
    return { parseResult: { ok: false, code: "INVALID_UNCHECKED" }, resolvedState: defaultResolved };
  }

  const normalized = normalizeBoardUiState(
    {
      leftPanelMode: rawLp,
      rightPanelMode: (rawRp ?? "timeline") as RightPanelMode,
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

  const updateBoardUiState = useCallback(
    ({
      leftPanelMode,
      rightPanelMode,
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
          leftPanelMode: leftPanelMode ?? resolvedState.leftPanelMode,
          rightPanelMode: rightPanelMode ?? resolvedState.rightPanelMode,
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
      const nextLeftPanelMode: LeftPanelMode =
        resolvedState.leftPanelMode === "overdue" ? "overdue" : "timeline-nav";
      updateBoardUiState({
        leftPanelMode: nextLeftPanelMode,
        rightPanelMode: "timeline",
        date: date ?? resolvedState.date ?? todayJstIso(),
        card,
        method,
      });
    },
    [resolvedState.date, resolvedState.leftPanelMode, updateBoardUiState],
  );

  const updateUrlForList = useCallback(
    ({ method, card }: ListUrlUpdateArgs) => {
      const nextLeftPanelMode: LeftPanelMode =
        resolvedState.leftPanelMode === "timeline-nav" ? "none" : resolvedState.leftPanelMode;
      updateBoardUiState({
        leftPanelMode: nextLeftPanelMode,
        rightPanelMode: "list",
        card,
        method,
      });
    },
    [resolvedState.leftPanelMode, updateBoardUiState],
  );

  const setCard = useCallback(
    (card: string | null, options?: { method?: UrlUpdateMethod }) => {
      const method = options?.method ?? "replace";
      const normalizedCard = normalizeCardValue(card);
      if (!resolvedState.hasExplicitBoardState) {
        const params = new URLSearchParams();
        if (normalizedCard) params.set("card", normalizedCard);
        navigateWithParams(params, method);
        return;
      }
      updateBoardUiState({
        card: normalizedCard,
        method,
      });
    },
    [navigateWithParams, resolvedState.hasExplicitBoardState, updateBoardUiState],
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
    setCard,
  };
};
