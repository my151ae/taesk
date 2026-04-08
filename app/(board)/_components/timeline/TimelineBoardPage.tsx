"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";

import type { Board, Card, Notification } from "@/lib/supabase";
import { buildBoardUrl } from "@/lib/board-url";
import { featureFlags } from "@/lib/featureFlags";
import { sortTimelineOverdueItems, type OverdueSortOrder } from "@/lib/timeline-overdue-sort";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import type { TrashCardItem } from "@/lib/api-types/timeline";
import { EMPTY_CHECKLIST } from "@/lib/checklist";
import { normalizeContent } from "@/lib/tiptap";

import { useAuth } from "@/app/contexts/AuthContext";
import TimelineBoardScreen from "@/app/(board)/_components/timeline/TimelineBoardScreen";
import { type SidebarVisibleCountState } from "@/app/(board)/_components/timeline/DesktopSidebarMenu";
import type { BucketCreateRequest } from "@/app/(board)/_components/timeline/bucket-create-request";
import { SIDEBAR_INCREMENT_PAGE_SIZE } from "@/app/(board)/_components/timeline/TimelineLeftPanelShared";
import { buildDesktopTimelineColumns } from "@/app/(board)/_components/timeline/timeline-render-model";
import type { IncrementalPanelSectionKey, SidebarSectionKey } from "@/app/(board)/_components/timeline/sidebar-section-types";
import {
  DEFAULT_TIMELINE_DAY_RANGE,
  getCurrentTimelineIsoDateJst,
  type TimelineEvent,
  getNowMinutesJst,
  getTimelineIsoDateJst,
  minuteToPixels,
} from "@/app/(board)/_utils/timeline-helpers";
import { buildMockTimeline } from "@/app/(board)/_utils/timeline-board-helpers";
import { applyCardUpdate } from "@/app/(board)/_utils/card-updates";
import { useTimelineCalendar } from "@/app/(board)/_hooks/useTimelineCalendar";
import { useCardModal } from "@/app/(board)/_hooks/useCardModal";
import { useTimelineUrlState, type ListWindow, type ListWindowPresetKey } from "@/app/(board)/_hooks/useTimelineUrlState";
import {
  serializeBoardUiStateToSearchParams,
  type LeftPanelMode,
} from "@/app/(board)/_hooks/useTimelineUrlState";
import { useTimelineScrollSync } from "@/app/(board)/_hooks/useTimelineScrollSync";
import { useTimelineData } from "@/app/(board)/_hooks/useTimelineData";
import { useTimelineDragAndDrop } from "@/app/(board)/_hooks/useTimelineDragAndDrop";
import { useTimelineZoomStore } from "@/app/(board)/_stores/timeline-zoom-store";
import { useTimelineViewport } from "@/app/(board)/_hooks/useTimelineViewport";
import { useTimelineFiltering } from "@/app/(board)/_hooks/useTimelineFiltering";
import type { TimelineSearchResultItem } from "@/app/(board)/_hooks/useTimelineFiltering";
import { useTimelineNavigation } from "@/app/(board)/_hooks/useTimelineNavigation";
import { useTimelineCardActions } from "@/app/(board)/_hooks/useTimelineCardActions";
import { useTimelineContextMenu } from "@/app/(board)/_hooks/useTimelineContextMenu";
import { useTimelineBoardInitialization } from "@/app/(board)/_hooks/useTimelineBoardInitialization";
import { useTimelineBoardController } from "@/app/(board)/_hooks/useTimelineBoardController";
import { useTimelineBoardModeSync } from "@/app/(board)/_hooks/useTimelineBoardModeSync";
import { useTimelineBoardScreen } from "@/app/(board)/_hooks/useTimelineBoardScreen";
import { useTimelineCardSelection } from "@/app/(board)/_hooks/useTimelineCardSelection";
import { useNotificationsStore } from "@/app/(board)/_stores/notifications-store";

type TimelineBoardPageProps = {
  initialBoard: Board;
};

type TimelineBoardPageContentProps = {
  initialBoard: Board;
  user: User | null;
  signOut: () => Promise<void>;
  basePath: string;
  resolvedState: ReturnType<typeof useTimelineUrlState>["resolvedState"];
  dayWindowStartRef: ReturnType<typeof useTimelineUrlState>["dayWindowStartRef"];
  setDayWindowStart: ReturnType<typeof useTimelineUrlState>["setDayWindowStart"];
  updateUrlForTimeline: ReturnType<typeof useTimelineUrlState>["updateUrlForTimeline"];
  updateUrlForList: ReturnType<typeof useTimelineUrlState>["updateUrlForList"];
  updateBoardUiState: ReturnType<typeof useTimelineUrlState>["updateBoardUiState"];
  setCard: ReturnType<typeof useTimelineUrlState>["setCard"];
};

const DAY_WINDOW_RANGE = DEFAULT_TIMELINE_DAY_RANGE;
const buildMockTimelineResponse = () => buildMockTimeline(DAY_WINDOW_RANGE);
const createInitialSidebarVisibleCounts = (): SidebarVisibleCountState => ({
  completed: SIDEBAR_INCREMENT_PAGE_SIZE,
  search: SIDEBAR_INCREMENT_PAGE_SIZE,
  tags: SIDEBAR_INCREMENT_PAGE_SIZE,
  trash: SIDEBAR_INCREMENT_PAGE_SIZE,
});

const deriveListWindowFromRange = (range?: number | null): ListWindow => {
  const normalized = typeof range === "number" ? Math.max(1, Math.round(range)) : 30;
  if (normalized === 31) return { before: 15, after: 15 };
  if (normalized >= 90) return { before: 0, after: 89 };
  if (normalized >= 60) return { before: 0, after: 59 };
  return { before: 0, after: 29 };
};

const canPersistBoardPreferences = (board: Board) => {
  if (!board.membership_role) return true;
  return board.membership_role === "owner" || board.membership_role === "editor";
};

const timelineLaneId = (isoDate: string) => `timeline:${isoDate}`;
const bucketLaneId = (bucketKey: string) => `bucket:${bucketKey}`;
const OVERDUE_LANE_ID = "overdue";
const MOBILE_BREAKPOINT_QUERY = "(min-width: 768px)";

const leftPanelModeToSidebarSection = (mode: LeftPanelMode): SidebarSectionKey | null => {
  if (mode === "overdue" || mode === "completed" || mode === "notifications" || mode === "search" || mode === "tags" || mode === "trash") return mode;
  return null;
};

const normalizeMobileLeftPanelMode = (mode: LeftPanelMode): LeftPanelMode => {
  if (mode === "none") return "overdue";
  return mode;
};

const COMPLETED_TIME_FORMATTER = new Intl.DateTimeFormat("ja-JP", {
  month: "numeric",
  day: "numeric",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const buildCompletedTimeText = (checkedAt: string | null) => {
  if (!checkedAt) return "完了日時なし";
  return `完了 ${COMPLETED_TIME_FORMATTER.format(new Date(checkedAt))}`;
};

const sortTrashItems = (items: TrashCardItem[]) =>
  [...items].sort((left, right) => {
    const purgeDiff = new Date(left.purge_after_at).getTime() - new Date(right.purge_after_at).getTime();
    if (purgeDiff !== 0) return purgeDiff;
    return new Date(left.deleted_at).getTime() - new Date(right.deleted_at).getTime();
  });

const mapCardToTrashItem = (card: Partial<Card> & { id: string }): TrashCardItem | null => {
  if (!card.deleted_at || !card.purge_after_at) return null;
  return {
    card_id: card.id,
    title: card.title ?? "",
    content: card.content ?? null,
    excerpt: card.excerpt ?? null,
    due_date: card.due_date ?? null,
    due_start: card.due_start ?? null,
    due_end: card.due_end ?? null,
    checked: card.checked ?? false,
    tags: card.tags ?? [],
    assignee_id: card.assignee_id ?? null,
    assignee_ids: card.assignee_ids ?? null,
    assigned_to: card.assigned_to ?? null,
    due_bucket: card.due_bucket ?? null,
    due_bucket_position: card.due_bucket_position ?? null,
    duration: card.duration ?? null,
    short_id: card.short_id ?? null,
    slug: card.slug ?? null,
    deleted_at: card.deleted_at,
    purge_after_at: card.purge_after_at,
  };
};

const buildNotificationFallbackCard = ({
  boardId,
  shortId,
  title,
}: {
  boardId: string;
  shortId: string;
  title: string;
}) =>
  ({
    id: `notification:${shortId}`,
    title,
    content: normalizeContent(null),
    excerpt: null,
    checklist: EMPTY_CHECKLIST,
    tags: [],
    checked: false,
    checked_at: null,
    short_id: shortId,
    slug: null,
    deleted_at: null,
    purge_after_at: null,
    due_date: null,
    due_start: null,
    due_end: null,
    start_reminder_enabled: false,
    start_reminder_minutes: 0,
    end_reminder_enabled: false,
    end_reminder_minutes: 0,
    due_bucket: null,
    due_bucket_position: null,
    board_id: boardId,
    created_at: "",
    updated_at: "",
    duration: 60,
    assignee_id: null,
    assignee_ids: null,
    assigned_to: null,
    list_id: "",
    position: 0,
    user_id: null,
    id_short: null,
  }) as Card;

function InvalidTimelineUrlState({
  code,
  onResetInvalidUrl,
  onMoveToCanonicalUrl,
}: {
  code: string;
  onResetInvalidUrl: () => void;
  onMoveToCanonicalUrl: () => void;
}) {
  return (
    <div className="min-h-screen bg-[#f4f5f7] p-6">
      <div className="mx-auto max-w-xl rounded-xl border border-rose-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">Invalid/legacy URL</h1>
        <p className="mt-2 text-sm text-slate-600">
          このURLは現在の契約に一致しません。reason:{" "}
          <span className="font-mono text-rose-600">{code}</span>
        </p>
        <div className="mt-4 flex gap-2">
          <button
            onClick={onResetInvalidUrl}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            URLをリセット
          </button>
          <button
            onClick={onMoveToCanonicalUrl}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-800"
          >
            正規URLへ移動
          </button>
        </div>
      </div>
    </div>
  );
}

function TimelineBoardPageContent({
  initialBoard,
  user,
  signOut,
  basePath,
  resolvedState,
  dayWindowStartRef,
  setDayWindowStart,
  updateUrlForTimeline,
  updateUrlForList,
  updateBoardUiState,
  setCard,
}: TimelineBoardPageContentProps) {
  const router = useRouter();
  const boardMenuRef = useRef<HTMLDivElement | null>(null);
  const pendingToolbarFocusSelectorRef = useRef<string | null>(null);
  const hourHeight = useTimelineZoomStore((state) => state.hourHeight);
  const [isDesktopViewport, setIsDesktopViewport] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia(MOBILE_BREAKPOINT_QUERY).matches;
  });
  const isMobileViewport = !isDesktopViewport;
  const activeLeftSectionKey = leftPanelModeToSidebarSection(resolvedState.leftPanelMode);
  const mobileLeftPanelMode = normalizeMobileLeftPanelMode(resolvedState.leftPanelMode);
  const [expandedSectionKey, setExpandedSectionKey] = useState<SidebarSectionKey | null>(activeLeftSectionKey);
  const [overdueSortOrder, setOverdueSortOrder] = useState<OverdueSortOrder>("newest");
  const [trashItems, setTrashItems] = useState<TrashCardItem[]>([]);
  const [sidebarVisibleCounts, setSidebarVisibleCounts] = useState<SidebarVisibleCountState>(() => createInitialSidebarVisibleCounts());
  const [notificationFeedback, setNotificationFeedback] = useState<string | null>(null);
  const {
    notifications,
    loading: notificationsLoading,
    error: notificationsError,
    unreadCount: notificationUnreadCount,
    fetchNotifications,
    markAsRead,
    markAllAsRead,
  } = useNotificationsStore();

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia(MOBILE_BREAKPOINT_QUERY);
    const syncViewport = () => setIsDesktopViewport(mediaQuery.matches);

    syncViewport();
    mediaQuery.addEventListener("change", syncViewport);
    return () => mediaQuery.removeEventListener("change", syncViewport);
  }, []);

  useEffect(() => {
    if (!isMobileViewport) return;
    if (resolvedState.leftPanelMode === mobileLeftPanelMode) return;

    updateBoardUiState({
      leftPanelMode: mobileLeftPanelMode,
      method: "replace",
    });
  }, [isMobileViewport, mobileLeftPanelMode, resolvedState.leftPanelMode, updateBoardUiState]);

  const handleRealtimeTrashChange = useCallback((payload: RealtimePostgresChangesPayload<Card>) => {
    setTrashItems((prev) => {
      if (payload.eventType === "DELETE") {
        return prev.filter((item) => item.card_id !== payload.old.id);
      }

      const nextTrashItem = mapCardToTrashItem(payload.new as Card);
      const existing = prev.filter((item) => item.card_id !== payload.new.id);
      if (!nextTrashItem) {
        return existing;
      }
      return sortTrashItems([...existing, nextTrashItem]);
    });
  }, []);

  useEffect(() => {
    if (isMobileViewport) return;
    setExpandedSectionKey(activeLeftSectionKey);
  }, [activeLeftSectionKey, isMobileViewport]);

  const focusCardById = useCallback((cardId: string | null) => {
    if (!cardId) return;
    const target = document.querySelector(`[data-card-id="${cardId}"]`) as HTMLElement | null;
    target?.focus();
  }, []);

  const scheduleToolbarFocusRestore = useCallback(() => {
    if (typeof document === "undefined") return;
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const testId = activeElement?.dataset.testid;
    pendingToolbarFocusSelectorRef.current = testId ? `[data-testid="${testId.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"]` : null;
  }, []);

  const {
    selectedCardIds,
    selectedCardIdSet,
    selectionLane,
    selectionLeadCardId,
    activeCardId,
    activeLaneId,
    clearSelection,
    setActiveCard,
    handleShiftSelect,
  } = useTimelineCardSelection();
  const [pendingTitleEditCardId, setPendingTitleEditCardId] = useState<string | null>(null);
  const [hiddenDesktopDayIsos, setHiddenDesktopDayIsos] = useState<string[]>([]);

  const {
    contextMenu,
    openContextMenuAt,
    closeContextMenu,
  } = useTimelineContextMenu({ focusCardById });

  const {
    showBoardMenu,
    setShowBoardMenu,
    showShareDialog,
    setShowShareDialog,
    showNotificationSettings,
    setShowNotificationSettings,
    showProfileSettings,
    setShowProfileSettings,
    showBoardSettings,
    setShowBoardSettings,
    boardSettingsBoardId,
    setBoardSettingsBoardId,
    showTeamSettings,
    setShowTeamSettings,
    teamSettingsTeamId,
    setTeamSettingsTeamId,
    showShortcutsModal,
    setShowShortcutsModal,
    activeDayIndex,
    setActiveDayIndex,
    anchorDayIso,
    setAnchorDayIso,
    calendarPreset,
    setCalendarPreset,
    timelineStartHour,
    setTimelineStartHour,
    viewMode,
    timelineRange,
    setTimelineRange,
    listWindow,
    setListWindow,
    listWindowPresetKey,
    setListWindowPresetKey,
    listAnchorDate,
    setListAnchorDate,
    listAnchorOffset,
    setListAnchorOffset,
    intendedDayRange,
    effectiveDayRange,
    handleSetViewMode,
  } = useTimelineBoardController({
    initialTimelineRange: initialBoard.day_range,
    resolvedState,
    updateUrlForTimeline,
    updateUrlForList,
  });

  const desktopTimelineFetchRange = useMemo(() => {
    if (viewMode !== "timeline" || isMobileViewport) {
      return intendedDayRange;
    }
    return timelineRange + hiddenDesktopDayIsos.length + 1;
  }, [hiddenDesktopDayIsos.length, intendedDayRange, isMobileViewport, timelineRange, viewMode]);

  const {
    profile,
    availableBoards,
    availableTeams,
    setAvailableBoards,
    fetchProfile,
    refreshBoardMembers,
    handleBoardNavigate: navigateBoard,
    handleUpdateBoard,
    currentBoard,
  } = useTimelineBoardInitialization({
    initialBoard,
    currentBoardId: initialBoard.id,
    userId: user?.id,
    router,
    onTimelineStartHour: setTimelineStartHour,
  });

  useEffect(() => {
    if (hiddenDesktopDayIsos.length === 0) return;
    setHiddenDesktopDayIsos([]);
  }, [currentBoard.id, isDesktopViewport, viewMode]);

  const {
    data,
    setData,
    status,
    setErrorMessage,
    dataMode,
    fetchTimeline,
    realtimeStatus,
  } = useTimelineData({
    initialBoard,
    dayRange: isMobileViewport && viewMode === "timeline" ? Math.max(3, intendedDayRange) : desktopTimelineFetchRange,
    timelineStartHour,
    dayWindowStartRef,
    setDayWindowStart,
    buildMockTimelineResponse,
    onRealtimeCardChange: handleRealtimeTrashChange,
  });

  const fetchTrash = useCallback(async () => {
    const response = await fetch(`/api/boards/${currentBoard.id}/trash`, { cache: "no-store" });
    if (!response.ok) {
      return;
    }
    const body = await response.json().catch(() => null);
    setTrashItems(sortTrashItems(body?.items ?? []));
  }, [currentBoard.id]);

  useEffect(() => {
    void fetchTrash();
  }, [fetchTrash]);

  const handleResolveTrashedCard = useCallback(() => {
    updateBoardUiState({
      leftPanelMode: "trash",
      method: "replace",
    });
    setExpandedSectionKey("trash");
  }, [updateBoardUiState]);

  const {
    modalCard,
    cardModalStatus,
    cardModalError,
    setCardModalError,
    setModalCardOverride,
    openCardModal,
    closeCardModal,
    modalProfiles,
  } = useCardModal({
    initialBoard,
    dataMode,
    data,
    setCardInUrl: setCard,
    onResolveTrashedCard: handleResolveTrashedCard,
  });

  const timelineHeaderRef = useRef<HTMLDivElement | null>(null);
  const { timelineHeaderHeight, timelineViewportHeight, liveNowMinutes, liveNowIsoDate } =
    useTimelineViewport({
      timelineHeaderRef,
      serverNow: data?.serverNow,
      timelineStartHour,
      hourHeight,
    });
  const currentTimelineMinutes = liveNowMinutes ?? (data ? getNowMinutesJst(data.serverNow) : null);
  const currentTimelineIsoDate =
    liveNowIsoDate ?? (data ? getTimelineIsoDateJst(data.serverNow, timelineStartHour) : null);
  const indicatorMinutes = currentTimelineMinutes;
  const indicatorTop =
    indicatorMinutes != null
      ? minuteToPixels(indicatorMinutes, timelineStartHour, hourHeight)
      : null;
  const {
    timelineScrollRef,
    desktopTimelineScrollRef,
    mobileTimelineScrollRef,
    setMobileAnchorTimelineScrollNode,
    debouncedHandleScroll,
    debouncedHandleAnchorScroll,
    handleTimelineViewMount,
  } = useTimelineScrollSync({
    viewMode,
    urlDate: resolvedState.view === "timeline" ? resolvedState.date : null,
    urlRange: resolvedState.view === "timeline" ? resolvedState.timelineRange : null,
    urlTime: resolvedState.view === "timeline" ? resolvedState.time : null,
    data,
    anchorDayIso,
    dayRange: timelineRange,
    indicatorMinutes,
    updateUrlForTimeline,
    timelineStartHour,
    hourHeight,
  });

  const {
    searchQuery,
    setSearchQuery,
    filteredData,
    searchResults,
    tagResults,
    availableTags,
    selectedTags,
    setSelectedTags,
    tagSummaries,
  } = useTimelineFiltering(data, {
    initialSearchQuery: resolvedState.leftPanelMode === "search" ? resolvedState.searchQuery : "",
    initialSelectedTags:
      resolvedState.leftPanelMode === "tags" && resolvedState.tag ? [resolvedState.tag] : [],
  });
  const sortedFilteredData = useMemo(() => {
    if (!filteredData) return null;
    return {
      ...filteredData,
      overdue: sortTimelineOverdueItems(filteredData.overdue, overdueSortOrder),
    };
  }, [filteredData, overdueSortOrder]);
  const visibleOverdueItems = useMemo(
    () => (sortedFilteredData?.overdue ?? []).filter((item) => !item.checked),
    [sortedFilteredData?.overdue],
  );
  const completedResults = useMemo<TimelineSearchResultItem[]>(() => {
    if (!data) return [];

    const byCardId = new Map<string, TimelineSearchResultItem>();
    const addResult = (entry: TimelineSearchResultItem) => {
      if (!entry.item.checked) return;
      const current = byCardId.get(entry.item.card_id);
      if (!current) {
        byCardId.set(entry.item.card_id, entry);
        return;
      }
      const currentTime = current.item.checked_at ? new Date(current.item.checked_at).getTime() : 0;
      const nextTime = entry.item.checked_at ? new Date(entry.item.checked_at).getTime() : 0;
      if (nextTime >= currentTime) {
        byCardId.set(entry.item.card_id, entry);
      }
    };

    data.overdue.forEach((item) => {
      addResult({
        kind: "overdue",
        item,
        badgeLabel: item.due_bucket?.toUpperCase() ?? "O",
        timeText: buildCompletedTimeText(item.checked_at),
      });
    });

    data.events.forEach((item) => {
      addResult({
        kind: "event",
        item,
        badgeLabel: item.due_bucket?.toUpperCase() ?? "T",
        timeText: buildCompletedTimeText(item.checked_at),
      });
    });

    Object.entries(data.abBuckets).forEach(([bucketKey, items]) => {
      const badgeLabel = bucketKey.endsWith("_a") ? "A" : bucketKey.endsWith("_b") ? "B" : "L";
      items.forEach((item) => {
        addResult({
          kind: "bucket",
          item,
          badgeLabel,
          timeText: buildCompletedTimeText(item.checked_at),
        });
      });
    });

    return Array.from(byCardId.values()).sort((left, right) => {
      const leftTime = left.item.checked_at ? new Date(left.item.checked_at).getTime() : 0;
      const rightTime = right.item.checked_at ? new Date(right.item.checked_at).getTime() : 0;
      if (leftTime !== rightTime) return rightTime - leftTime;
      return left.item.card_id.localeCompare(right.item.card_id);
    });
  }, [data]);

  const sidebarVisibleResetKeys = useMemo<Record<IncrementalPanelSectionKey, string>>(
    () => ({
      completed: completedResults.map((result) => result.item.card_id).join(","),
      search: searchQuery.trim() ? `${searchQuery.trim()}::${searchResults.map((result) => result.item.card_id).join(",")}` : "",
      tags: `${selectedTags.join(",")}::${tagResults.map((result) => result.item.card_id).join(",")}`,
      trash: trashItems.map((item) => item.card_id).join(","),
    }),
    [completedResults, searchQuery, searchResults, selectedTags, tagResults, trashItems],
  );
  const previousSidebarVisibleResetKeysRef = useRef<Record<IncrementalPanelSectionKey, string> | null>(null);

  useEffect(() => {
    if (!previousSidebarVisibleResetKeysRef.current) {
      previousSidebarVisibleResetKeysRef.current = sidebarVisibleResetKeys;
      return;
    }

    const previousKeys = previousSidebarVisibleResetKeysRef.current;
    previousSidebarVisibleResetKeysRef.current = sidebarVisibleResetKeys;

    setSidebarVisibleCounts((prev) => {
      let changed = false;
      const next = { ...prev };

      (Object.keys(sidebarVisibleResetKeys) as IncrementalPanelSectionKey[]).forEach((section) => {
        if (previousKeys[section] === sidebarVisibleResetKeys[section]) return;
        if (next[section] === SIDEBAR_INCREMENT_PAGE_SIZE) return;
        next[section] = SIDEBAR_INCREMENT_PAGE_SIZE;
        changed = true;
      });

      return changed ? next : prev;
    });
  }, [sidebarVisibleResetKeys]);

  const laneCardOrderMap = useMemo(() => {
    if (!sortedFilteredData) return new Map<string, string[]>();

    const next = new Map<string, string[]>();

    sortedFilteredData.days.forEach((day) => {
      next.set(
        timelineLaneId(day.isoDate),
        sortedFilteredData.events
          .filter((event) => event.due_date === day.isoDate)
          .map((event) => event.card_id),
      );
    });

    Object.entries(sortedFilteredData.abBuckets).forEach(([bucketKey, items]) => {
      next.set(bucketLaneId(bucketKey), items.map((item) => item.card_id));
    });

    next.set(
      OVERDUE_LANE_ID,
      (sortedFilteredData.overdue ?? []).map((item) => item.card_id),
    );

    return next;
  }, [sortedFilteredData]);

  const sortCardIdsForLane = useCallback((laneId: string | null, cardIds: string[]) => {
    if (!laneId) return [...cardIds].sort();

    const laneOrder = laneCardOrderMap.get(laneId);
    if (!laneOrder?.length) return [...cardIds].sort();

    const laneIndex = new Map(laneOrder.map((cardId, index) => [cardId, index]));
    return [...cardIds].sort((left, right) => {
      const leftIndex = laneIndex.get(left);
      const rightIndex = laneIndex.get(right);
      if (typeof leftIndex === "number" && typeof rightIndex === "number") {
        return leftIndex - rightIndex;
      }
      if (typeof leftIndex === "number") return -1;
      if (typeof rightIndex === "number") return 1;
      return left.localeCompare(right);
    });
  }, [laneCardOrderMap]);

  const resolveContextMenuTargetIds = useCallback((cardId: string) => {
    if (selectedCardIdSet.has(cardId) && selectedCardIds.length > 1) {
      return sortCardIdsForLane(selectionLane, selectedCardIds);
    }

    if (selectedCardIds.length) {
      clearSelection();
    }

    return [cardId];
  }, [clearSelection, selectedCardIdSet, selectedCardIds, selectionLane, sortCardIdsForLane]);

  const openCardContextMenu = useCallback((cardId: string, x: number, y: number) => {
    const targetCardIds = resolveContextMenuTargetIds(cardId);
    openContextMenuAt(cardId, targetCardIds, x, y);
  }, [openContextMenuAt, resolveContextMenuTargetIds]);

  const handleCardContextMenu = useCallback((e: React.MouseEvent, cardId: string) => {
    e.preventDefault();
    e.stopPropagation();
    openCardContextMenu(cardId, e.clientX, e.clientY);
  }, [openCardContextMenu]);

  const handleCardContextMenuByKeyboard = useCallback((cardId: string, rect: DOMRect) => {
    openCardContextMenu(cardId, rect.right + 8, rect.top);
  }, [openCardContextMenu]);

  const closeBucketCreateMenu = useCallback((reason: "action" | "dismiss" = "dismiss") => {
    setBucketCreateMenu((prev) => (prev.open
      ? { open: false, bucketKey: null, x: 0, y: 0 }
      : prev));
    if (reason === "dismiss") {
      const focusElement = bucketCreateFocusRef.current;
      if (focusElement) {
        requestAnimationFrame(() => {
          focusElement.focus();
        });
      }
      return;
    }
    bucketCreateFocusRef.current = null;
  }, []);

  const handleBucketCreateRequest = useCallback((request: BucketCreateRequest) => {
    closeContextMenu("dismiss");
    const x = request.clientX ?? request.anchorRect?.left ?? 0;
    const y = request.clientY ?? request.anchorRect?.bottom ?? request.anchorRect?.top ?? 0;
    bucketCreateFocusRef.current = request.focusElement ?? null;
    setBucketCreateMenu({
      open: true,
      bucketKey: request.bucketKey,
      afterCardId: request.afterCardId,
      x,
      y,
    });
  }, [closeContextMenu]);

  const abScrollContainersRef = useRef<Record<string, HTMLDivElement | null>>({});

  const {
    goToDay,
    handlePrevDay,
    handleNextDay,
    handlePrevDayRange,
    handleNextDayRange,
    handleTodayClick,
    handleDayRangeChange,
  } = useTimelineNavigation({
    data,
    status,
    dayRange: timelineRange,
    activeDayIndex,
    setActiveDayIndex,
    anchorDayIso,
    setAnchorDayIso,
    fetchTimeline,
    updateUrlForTimeline,
    timelineScrollRef,
    dayWindowStartRef,
    timelineStartHour,
    hourHeight,
    requestedFetchRange: desktopTimelineFetchRange,
  });

  const visibleDays = useMemo(() => {
    const days = data?.days ?? [];
    if (!days.length) return [];
    if (viewMode === "timeline" && isDesktopViewport) {
      return buildDesktopTimelineColumns({
        candidateDays: days,
        hiddenDayIsos: hiddenDesktopDayIsos,
        targetVisibleCount: effectiveDayRange,
      }).visibleDays;
    }
    const anchorIndex = Math.max(0, days.findIndex((day) => day.isoDate === anchorDayIso));
    const startIndex = viewMode === "timeline" ? anchorIndex : activeDayIndex;
    return days.slice(startIndex, startIndex + effectiveDayRange);
  }, [activeDayIndex, anchorDayIso, data?.days, effectiveDayRange, hiddenDesktopDayIsos, isDesktopViewport, viewMode]);

  useEffect(() => {
    if (viewMode !== "timeline") return;
    const days = data?.days ?? [];
    if (!days.length) return;
    const nextIndex = days.findIndex((day) => day.isoDate === anchorDayIso);
    if (nextIndex >= 0 && nextIndex !== activeDayIndex) {
      setActiveDayIndex(nextIndex);
    }
  }, [activeDayIndex, anchorDayIso, data?.days, setActiveDayIndex, viewMode]);

  const {
    calendarEventsByDay,
    calendarAllDayEventsByDay,
    googleCalendarEvents,
    googleCalendarStatus,
    googleCalendarError,
    refreshGoogleCalendar,
  } = useTimelineCalendar({
    calendarPreset,
    calendarRangeStart: visibleDays[0] ? new Date(visibleDays[0].isoDate) : null,
    calendarRangeEnd: visibleDays[visibleDays.length - 1]
      ? new Date(visibleDays[visibleDays.length - 1].isoDate)
      : null,
    days: data?.days ?? [],
  });

  const googleCalendarLabel = useMemo(() => {
    if (!googleCalendarEvents?.length) return "primary";
    const ids = new Set<string>();
    googleCalendarEvents.forEach((event) => {
      if (event?.calendarId) ids.add(event.calendarId);
    });
    return ids.size ? Array.from(ids).sort().join(", ") : "primary";
  }, [googleCalendarEvents]);

  const googleStatusText = useMemo(() => {
    if (googleCalendarStatus === "loading") return "Google予定同期中...";
    if (googleCalendarStatus === "success") return `Google予定表示中 (${googleCalendarLabel})`;
    if (googleCalendarStatus === "disconnected") return "Google未接続";
    if (googleCalendarStatus === "error") return "Google予定の取得エラー";
    return "Google予定の状態確認中...";
  }, [googleCalendarLabel, googleCalendarStatus]);

  const bucketDayMap = useMemo(() => {
    const result: Record<string, string | null> = {};
    data?.days?.forEach((day) => {
      result[`${day.key}_a`] = day.isoDate;
      result[`${day.key}_b`] = day.isoDate;
    });
    return result;
  }, [data?.days]);

  const {
    applyPatch,
    handleCardModalSave,
    handleCardModalDelete: handleTrashCardMove,
    handleToggleCardChecked,
    handleRenameCardTitle,
    handleColumnClick,
    handleBucketClick,
    handleExternalEventClick,
    moveCardByDayOffset,
    googleToast,
    historySaveWarning,
    retryHistorySave,
    closeModalWithoutHistory,
  } = useTimelineCardActions({
    initialBoardId: currentBoard.id,
    dataMode,
    setData,
    fetchTimeline,
    openCardModal,
    closeCardModal,
    modalCard,
    setModalCardOverride,
    setCardModalError,
    setErrorMessage,
    bucketDayMap,
    refreshGoogleCalendar,
    data,
    onCardCreated: (cardId, laneId) => {
      clearSelection();
      setActiveCard(cardId, laneId);
      setPendingTitleEditCardId(cardId);
    },
  });

  const handleRestoreCard = useCallback(async (cardId: string) => {
    try {
      const response = await fetch(`/api/boards/${currentBoard.id}/cards/${cardId}/restore`, {
        method: "POST",
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.card) {
        throw new Error(body?.error?.message || "Failed to restore card");
      }

      setTrashItems((prev) => prev.filter((item) => item.card_id !== cardId));
      setData((prev) => (prev ? applyCardUpdate(prev, body.card as Card, "UPDATE") : prev));
      setModalCardOverride(body.card as Card);
      return true;
    } catch (error) {
      setCardModalError(error instanceof Error ? error.message : "Failed to restore card");
      return false;
    }
  }, [currentBoard.id, setCardModalError, setData, setModalCardOverride]);

  const handleCardModalDelete = useCallback(async (cardId: string) => {
    const success = await handleTrashCardMove(cardId);
    if (success) {
      void fetchTrash();
    }
    return success;
  }, [fetchTrash, handleTrashCardMove]);

  const [bucketCreateMenu, setBucketCreateMenu] = useState<{
    open: boolean;
    bucketKey: string | null;
    afterCardId?: string;
    x: number;
    y: number;
  }>({
    open: false,
    bucketKey: null,
    x: 0,
    y: 0,
  });
  const bucketCreateFocusRef = useRef<HTMLElement | null>(null);

  const confirmBucketCardCreation = useCallback(() => {
    if (!(bucketCreateMenu.open && bucketCreateMenu.bucketKey)) {
      return;
    }

    handleBucketClick(bucketCreateMenu.bucketKey, bucketCreateMenu.afterCardId);
    setBucketCreateMenu({ open: false, bucketKey: null, x: 0, y: 0 });
  }, [bucketCreateMenu, handleBucketClick]);

  const handleGoogleConnect = useCallback(() => {
    if (typeof window === "undefined") return;
    window.location.href = "/api/integrations/google-calendar/connect";
  }, []);

  const {
    sensors,
    activeDrag,
    pointerPreview,
    activeResize,
    bucketIndicator,
    isOverABList,
    handleDragStart,
    handleDragMove,
    handleDragEnd,
    handleDragCancel,
    handleEventKeyDown,
    handleResizeStart,
    handleResizeMove,
    handleResizeEnd,
  } = useTimelineDragAndDrop({
    data: sortedFilteredData,
    setData,
    applyPatch,
    timelineScrollRef,
    abScrollContainersRef,
    bucketDayMap,
    dataMode,
    timelineStartHour,
    hourHeight,
  });

  useEffect(() => {
    if (!selectedCardIds.length) return;

    const handleWindowClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest("[data-card-id]") || target?.closest("[role='menu']")) {
        return;
      }
      clearSelection();
    };

    window.addEventListener("click", handleWindowClick);
    return () => window.removeEventListener("click", handleWindowClick);
  }, [clearSelection, selectedCardIds.length]);

  const handleBoardNavigate = useCallback(
    (board: Board) => {
      navigateBoard(board);
      setShowBoardMenu(false);
    },
    [navigateBoard, setShowBoardMenu],
  );

  const handleOpenTeamSettings = useCallback(
    (teamId: string | null | undefined) => {
      if (!teamId) return;
      setTeamSettingsTeamId(teamId);
      setShowTeamSettings(true);
    },
    [setShowTeamSettings, setTeamSettingsTeamId],
  );

  const handleOpenBoardSettings = useCallback(
    (boardId: string | null | undefined) => {
      setShowBoardMenu(false);
      setBoardSettingsBoardId(boardId ?? currentBoard.id);
      setShowBoardSettings(true);
    },
    [currentBoard.id, setBoardSettingsBoardId, setShowBoardMenu, setShowBoardSettings],
  );

  const canPersistPreferences = canPersistBoardPreferences(currentBoard);
  const handleDayRangeUpdate = useCallback(
    (newRange: number) => {
      if (viewMode !== "timeline") return;
      if (hiddenDesktopDayIsos.length > 0) {
        setHiddenDesktopDayIsos([]);
      }
      scheduleToolbarFocusRestore();
      handleDayRangeChange(newRange);
      setTimelineRange(newRange);
      if (canPersistPreferences) {
        void handleUpdateBoard({ day_range: newRange });
      }
    },
    [canPersistPreferences, handleDayRangeChange, handleUpdateBoard, hiddenDesktopDayIsos.length, scheduleToolbarFocusRestore, setTimelineRange, viewMode],
  );

  const handlePrevDayWithFocusRestore = useCallback(() => {
    if (hiddenDesktopDayIsos.length > 0) {
      setHiddenDesktopDayIsos([]);
    }
    scheduleToolbarFocusRestore();
    handlePrevDay();
  }, [handlePrevDay, hiddenDesktopDayIsos.length, scheduleToolbarFocusRestore]);

  const handleNextDayWithFocusRestore = useCallback(() => {
    if (hiddenDesktopDayIsos.length > 0) {
      setHiddenDesktopDayIsos([]);
    }
    scheduleToolbarFocusRestore();
    handleNextDay();
  }, [handleNextDay, hiddenDesktopDayIsos.length, scheduleToolbarFocusRestore]);

  const handlePrevDayRangeWithFocusRestore = useCallback(() => {
    if (hiddenDesktopDayIsos.length > 0) {
      setHiddenDesktopDayIsos([]);
    }
    scheduleToolbarFocusRestore();
    handlePrevDayRange();
  }, [handlePrevDayRange, hiddenDesktopDayIsos.length, scheduleToolbarFocusRestore]);

  const handleNextDayRangeWithFocusRestore = useCallback(() => {
    if (hiddenDesktopDayIsos.length > 0) {
      setHiddenDesktopDayIsos([]);
    }
    scheduleToolbarFocusRestore();
    handleNextDayRange();
  }, [handleNextDayRange, hiddenDesktopDayIsos.length, scheduleToolbarFocusRestore]);

  const handleTodayClickWithFocusRestore = useCallback(() => {
    if (hiddenDesktopDayIsos.length > 0) {
      setHiddenDesktopDayIsos([]);
    }
    scheduleToolbarFocusRestore();
    handleTodayClick();
  }, [handleTodayClick, hiddenDesktopDayIsos.length, scheduleToolbarFocusRestore]);

  useEffect(() => {
    const selector = pendingToolbarFocusSelectorRef.current;
    if (!selector || status === "loading") return;

    const restoreFocus = () => {
      const target = document.querySelector<HTMLElement>(selector);
      if (!target) return;
      if (target.matches("[disabled]")) return;
      if (target.getClientRects().length === 0) return;
      target.focus();
      pendingToolbarFocusSelectorRef.current = null;
    };

    const firstFrame = window.requestAnimationFrame(() => {
      const secondFrame = window.requestAnimationFrame(restoreFocus);
      return () => window.cancelAnimationFrame(secondFrame);
    });

    return () => window.cancelAnimationFrame(firstFrame);
  }, [activeDayIndex, intendedDayRange, listAnchorDate, listWindowPresetKey, status, viewMode]);

  const modeSync = useTimelineBoardModeSync({
    viewMode,
    handleSetViewMode,
    dataDays: data?.days,
    dataStartOffset: data?.startOffset,
    dataRange: data?.range,
    activeDayIndex,
    setActiveDayIndex,
    anchorDayIso,
    setAnchorDayIso,
    resolvedDate: resolvedState.date,
    dayWindowStartRef,
    setDayWindowStart,
    status,
    fetchTimeline,
    handleUpdateBoard,
    canPersistBoardPreferences: canPersistPreferences,
    timelineStartHour,
    listAnchorDate,
    setListAnchorDate,
    listAnchorOffset,
    setListAnchorOffset,
    listWindow,
    setListWindow,
    setListWindowPresetKey,
    updateUrlForTimeline,
    updateUrlForList,
  });

  const handleListTodayWithFocusRestore = useCallback(() => {
    if (hiddenDesktopDayIsos.length > 0) {
      setHiddenDesktopDayIsos([]);
    }
    scheduleToolbarFocusRestore();
    modeSync.handleListToday();
  }, [hiddenDesktopDayIsos.length, modeSync, scheduleToolbarFocusRestore]);

  const handleListWindowPresetChangeWithFocusRestore = useCallback((nextPreset: ListWindowPresetKey) => {
    if (hiddenDesktopDayIsos.length > 0) {
      setHiddenDesktopDayIsos([]);
    }
    scheduleToolbarFocusRestore();
    modeSync.handleListWindowPresetChange(nextPreset);
  }, [hiddenDesktopDayIsos.length, modeSync, scheduleToolbarFocusRestore]);

  const handleListPrevDayWithFocusRestore = useCallback(() => {
    if (hiddenDesktopDayIsos.length > 0) {
      setHiddenDesktopDayIsos([]);
    }
    scheduleToolbarFocusRestore();
    modeSync.handleListPrevDay();
  }, [hiddenDesktopDayIsos.length, modeSync, scheduleToolbarFocusRestore]);

  const handleListNextDayWithFocusRestore = useCallback(() => {
    if (hiddenDesktopDayIsos.length > 0) {
      setHiddenDesktopDayIsos([]);
    }
    scheduleToolbarFocusRestore();
    modeSync.handleListNextDay();
  }, [hiddenDesktopDayIsos.length, modeSync, scheduleToolbarFocusRestore]);

  const handleListPrevWeekWithFocusRestore = useCallback(() => {
    if (hiddenDesktopDayIsos.length > 0) {
      setHiddenDesktopDayIsos([]);
    }
    scheduleToolbarFocusRestore();
    modeSync.handleListPrevWeek();
  }, [hiddenDesktopDayIsos.length, modeSync, scheduleToolbarFocusRestore]);

  const handleListNextWeekWithFocusRestore = useCallback(() => {
    if (hiddenDesktopDayIsos.length > 0) {
      setHiddenDesktopDayIsos([]);
    }
    scheduleToolbarFocusRestore();
    modeSync.handleListNextWeek();
  }, [hiddenDesktopDayIsos.length, modeSync, scheduleToolbarFocusRestore]);

  const handleSearchQueryChange = useCallback(
    (value: string) => {
      setSearchQuery(value);
      updateBoardUiState({
        leftPanelMode: "search",
        searchQuery: value,
        method: "replace",
      });
    },
    [setSearchQuery, updateBoardUiState],
  );

  const handleSelectedTagsChange = useCallback(
    (updater: React.SetStateAction<string[]>) => {
      const next = typeof updater === "function" ? updater(selectedTags) : updater;
      setSelectedTags(next);
      updateBoardUiState({
        leftPanelMode: "tags",
        tag: next[0] ?? null,
        method: "replace",
      });
    },
    [selectedTags, setSelectedTags, updateBoardUiState],
  );

  const handleExpandedSectionChange = useCallback(
    (key: SidebarSectionKey | null) => {
      if (key === null) {
        setExpandedSectionKey(null);
        return;
      }

      const isSameContext = activeLeftSectionKey === key;
      const isExpanded = expandedSectionKey === key;
      if (isSameContext && isExpanded) {
        setExpandedSectionKey(null);
        return;
      }

      setExpandedSectionKey(key);

      if (key === "overdue") {
        updateBoardUiState({
          leftPanelMode: "overdue",
          method: "replace",
        });
        return;
      }

      if (key === "completed") {
        updateBoardUiState({
          leftPanelMode: "completed",
          method: "replace",
        });
        return;
      }

      if (key === "search") {
        updateBoardUiState({
          leftPanelMode: "search",
          searchQuery,
          method: "replace",
        });
        return;
      }

      if (key === "notifications") {
        updateBoardUiState({
          leftPanelMode: "notifications",
          method: "replace",
        });
        return;
      }

      if (key === "trash") {
        updateBoardUiState({
          leftPanelMode: "trash",
          method: "replace",
        });
        return;
      }

      updateBoardUiState({
        leftPanelMode: "tags",
        tag: selectedTags[0] ?? resolvedState.tag ?? null,
        method: "replace",
      });
    },
    [activeLeftSectionKey, expandedSectionKey, resolvedState.tag, searchQuery, selectedTags, updateBoardUiState],
  );

  const handleOpenNotificationsPanel = useCallback(() => {
    updateBoardUiState({
      leftPanelMode: "notifications",
      method: "replace",
    });
    if (typeof window !== "undefined" && window.matchMedia(MOBILE_BREAKPOINT_QUERY).matches) {
      setExpandedSectionKey("notifications");
    }
  }, [updateBoardUiState]);

  const handleMobileLeftPanelSelect = useCallback((key: SidebarSectionKey) => {
    if (key === "overdue") {
      updateBoardUiState({
        leftPanelMode: "overdue",
        method: "replace",
      });
      return;
    }

    if (key === "completed") {
      updateBoardUiState({
        leftPanelMode: "completed",
        method: "replace",
      });
      return;
    }

    if (key === "notifications") {
      updateBoardUiState({
        leftPanelMode: "notifications",
        method: "replace",
      });
      return;
    }

    if (key === "search") {
      updateBoardUiState({
        leftPanelMode: "search",
        searchQuery,
        method: "replace",
      });
      return;
    }

    if (key === "trash") {
      updateBoardUiState({
        leftPanelMode: "trash",
        method: "replace",
      });
      return;
    }

    updateBoardUiState({
      leftPanelMode: "tags",
      tag: selectedTags[0] ?? resolvedState.tag ?? null,
      method: "replace",
    });
  }, [resolvedState.tag, searchQuery, selectedTags, updateBoardUiState]);

  const handleOpenNotification = useCallback(async (notification: Notification) => {
    setNotificationFeedback(null);
    const cardShortId =
      typeof notification.payload?.card_short_id === "string" ? notification.payload.card_short_id.trim() : "";
    if (!cardShortId) {
      await markAsRead(notification.id);
      setNotificationFeedback("この通知は既読にしました。関連カードは開けません。");
      return;
    }

    const cardTitle =
      typeof notification.payload?.card_title === "string" && notification.payload.card_title.trim().length > 0
        ? notification.payload.card_title.trim()
        : "Untitled card";

    setModalCardOverride(buildNotificationFallbackCard({
      boardId: currentBoard.id,
      shortId: cardShortId,
      title: cardTitle,
    }));
    openCardModal(cardShortId, "notifications");
    void markAsRead(notification.id);
  }, [currentBoard.id, markAsRead, openCardModal, setModalCardOverride]);

  const handleSidebarVisibleCountChange = useCallback((section: IncrementalPanelSectionKey, nextCount: number) => {
    setSidebarVisibleCounts((prev) => {
      if (prev[section] === nextCount) return prev;
      return {
        ...prev,
        [section]: nextCount,
      };
    });
  }, []);

  const eventsByDay = useMemo(() => {
    const result: Record<string, TimelineEvent[]> = {};
    sortedFilteredData?.events?.forEach((event) => {
      if (!result[event.due_date]) result[event.due_date] = [];
      result[event.due_date].push(event);
    });
    return result;
  }, [sortedFilteredData?.events]);

  const registerAbScrollContainer = useCallback(
    (iso: string, el: HTMLDivElement | null, bucket?: "a" | "b") => {
      const key = bucket ? `${iso}:${bucket}` : iso;
      abScrollContainersRef.current[key] = el;
    },
    [],
  );

  const screen = useTimelineBoardScreen({
    currentBoard,
    availableBoards,
    availableTeams,
    handleBoardNavigate,
    showBoardMenu,
    setShowBoardMenu,
    boardMenuRef,
    setShowNotificationSettings,
    setShowProfileSettings,
    onOpenBoardSettings: handleOpenBoardSettings,
    onOpenTeamSettings: handleOpenTeamSettings,
    profile,
    user,
    signOut,
    intendedDayRange,
    onDayRangeChange: handleDayRangeUpdate,
    onTodayClick: viewMode === "list" ? handleListTodayWithFocusRestore : handleTodayClickWithFocusRestore,
    realtimeStatus,
    googleToast,
    googleStatusText,
    googleCalendarStatus,
    googleCalendarError,
    calendarPreset,
    setCalendarPreset,
    refreshGoogleCalendar,
    handleGoogleConnect,
    viewMode,
    onShortcutsClick: () => setShowShortcutsModal(true),
    expandedSectionKey,
    activeLeftPanelMode: resolvedState.leftPanelMode,
    mobileLeftPanelMode,
    activeLeftSectionKey,
    onExpandedSectionChange: handleExpandedSectionChange,
    onMobileLeftPanelSelect: handleMobileLeftPanelSelect,
    sidebarVisibleCounts,
    onSidebarVisibleCountChange: handleSidebarVisibleCountChange,
    onOpenNotificationsPanel: handleOpenNotificationsPanel,
    days: data?.days ?? [],
    activeDayIndex,
    anchorDayIso,
    effectiveDayRange,
    hiddenDesktopDayIsos,
    onHiddenDesktopDayIsosChange: setHiddenDesktopDayIsos,
    timelineScrollRefDesktop: desktopTimelineScrollRef,
    timelineScrollRefMobile: mobileTimelineScrollRef,
    setMobileAnchorTimelineScrollNode,
    timelineHeaderRef,
    debouncedHandleScroll,
    debouncedHandleAnchorScroll,
    handleTimelineViewMount,
    openCardModal,
    handleToggleCardChecked,
    handleRenameCardTitle,
    activeResize,
    handleResizeStart,
    handleResizeMove,
    handleResizeEnd,
    calendarEventsByDay,
    calendarAllDayEventsByDay,
    handleExternalEventClick,
    timelineStartHour,
    registerAbScrollContainer,
    status,
    handlePrevDay: handlePrevDayWithFocusRestore,
    handleNextDay: handleNextDayWithFocusRestore,
    goToDay,
    handlePrevDayRange: handlePrevDayRangeWithFocusRestore,
    handleNextDayRange: handleNextDayRangeWithFocusRestore,
    eventsByDay,
    abBuckets: sortedFilteredData?.abBuckets ?? {},
    overdue: visibleOverdueItems,
    completedResults,
    searchQuery,
    setSearchQuery: handleSearchQueryChange,
    searchResults,
    tagResults,
    availableTags,
    selectedTags,
    setSelectedTags: handleSelectedTagsChange,
    tagSummaries,
    trashItems,
    notifications,
    notificationsLoading,
    notificationsError,
    notificationUnreadCount,
    notificationFeedback,
    onRetryNotifications: () => {
      void fetchNotifications();
    },
    onMarkAllNotificationsRead: () => {
      void markAllAsRead();
    },
    onOpenNotification: (notification) => {
      void handleOpenNotification(notification);
    },
    indicatorTop,
    liveNowIsoDate: currentTimelineIsoDate,
    liveNowMinutes: currentTimelineMinutes,
    timelineViewportHeight,
    activeDrag,
    pointerPreview,
    bucketIndicator,
    handleEventKeyDown,
    handleColumnClick,
    handleBucketClick,
    handleBucketCreateRequest,
    sensors,
    handleDragStart,
    handleDragMove,
    handleDragEnd,
    handleDragCancel,
    isOverABList,
    timelineHeaderHeight,
    handleCardContextMenu,
    handleCardContextMenuByKeyboard,
    contextMenu,
    selectedCardIds: selectedCardIdSet,
    selectionLeadCardId,
    onShiftSelect: handleShiftSelect,
    clearSelection,
    onActivateCard: setActiveCard,
    activeCardId,
    activeLaneId,
    pendingTitleEditCardId,
    onPendingTitleEditConsumed: () => setPendingTitleEditCardId(null),
    listAnchorDate,
    listWindowPresetKey,
    handleListWindowPresetChange: handleListWindowPresetChangeWithFocusRestore,
    listReverse: listWindow.before > 0,
    handleListBaseDateChange: modeSync.handleListBaseDateChange,
    handleListPrevDay: handleListPrevDayWithFocusRestore,
    handleListNextDay: handleListNextDayWithFocusRestore,
    handleListPrevWeek: handleListPrevWeekWithFocusRestore,
    handleListNextWeek: handleListNextWeekWithFocusRestore,
    handleListToday: handleListTodayWithFocusRestore,
    handleViewModeChange: modeSync.handleViewModeChange,
    showShareDialog,
    setShowShareDialog,
    showNotificationSettings,
    setShowNotificationSettingsOpen: setShowNotificationSettings,
    showProfileSettings,
    setShowProfileSettingsOpen: setShowProfileSettings,
    showBoardSettings,
    setShowBoardSettings,
    boardSettingsBoardId,
    showTeamSettings,
    setShowTeamSettings,
    teamSettingsTeamId,
    fetchProfile,
    setAvailableBoards,
    setActiveDayIndexForDialogs: setActiveDayIndex,
    fetchTimelineForDialogs: fetchTimeline,
    refreshBoardMembers,
    showShortcutsModal,
    setShowShortcutsModal,
    modalCard,
    cardModalStatus,
    modalProfiles,
    handleCardModalSave,
    handleCardModalDelete,
    handleRestoreCard,
    closeCardModal,
    historySaveWarning,
    retryHistorySave,
    closeModalWithoutHistory,
    cardModalError,
    data,
    moveCardByDayOffset,
    overdueSortOrder,
    onOverdueSortOrderChange: setOverdueSortOrder,
    filteredData: sortedFilteredData,
  });

  return (
    <TimelineBoardScreen
      parseResult={{ ok: true }}
      onResetInvalidUrl={() => {
        const params = serializeBoardUiStateToSearchParams({
          state: {
            leftPanelMode: "overdue",
            rightPanelMode: "timeline",
            date: null,
            tag: null,
            searchQuery: "",
            showChecked: true,
            showUnchecked: true,
          },
        });
        router.replace(`${basePath}?${params.toString()}`, { scroll: false });
      }}
      onMoveToCanonicalUrl={() => {
        const params = serializeBoardUiStateToSearchParams({
          state: {
            leftPanelMode: "overdue",
            rightPanelMode: "timeline",
            date: null,
            tag: null,
            searchQuery: "",
            showChecked: true,
            showUnchecked: true,
          },
        });
        router.replace(`${basePath}?${params.toString()}`, { scroll: false });
      }}
      {...screen}
      contextMenu={
        screen.contextMenu.open && screen.contextMenu.cardId
          ? {
              ...screen.contextMenu,
              onClose: closeContextMenu,
            }
          : screen.contextMenu
      }
      bucketCreateMenu={
        bucketCreateMenu.open
          ? {
              open: true,
              x: bucketCreateMenu.x,
              y: bucketCreateMenu.y,
              items: [
                { label: "追加", onClick: confirmBucketCardCreation },
                { label: "キャンセル", onClick: () => closeBucketCreateMenu("dismiss") },
              ],
              onClose: (reason) => closeBucketCreateMenu(reason),
            }
          : { open: false }
      }
    />
  );
}

export default function TimelineBoardPage({ initialBoard }: TimelineBoardPageProps) {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const basePath =
    buildBoardUrl(initialBoard) ||
    (typeof window !== "undefined" ? window.location.pathname : `/b/${initialBoard.short_id ?? ""}`);
  const defaultListWindow = {
    before:
      initialBoard.list_window_before_days ??
      deriveListWindowFromRange(initialBoard.list_range).before,
    after:
      initialBoard.list_window_after_days ??
      deriveListWindowFromRange(initialBoard.list_range).after,
  };

  const {
    parseResult,
    resolvedState,
    dayWindowStartRef,
    setDayWindowStart,
    updateBoardUiState,
    updateUrlForTimeline,
    updateUrlForList,
    setCard,
  } = useTimelineUrlState({
    basePath,
    defaultTimelineRange: initialBoard.day_range,
    defaultListBefore: defaultListWindow.before,
    defaultListAfter: defaultListWindow.after,
  });

  const effectiveParseResult =
    !featureFlags.notifications && resolvedState.leftPanelMode === "notifications"
      ? ({ ok: false, code: "INVALID_LP" } as const)
      : parseResult;

  const handleResetInvalidUrl = useCallback(() => {
    const params = serializeBoardUiStateToSearchParams({
      state: {
        leftPanelMode: "overdue",
        rightPanelMode: "timeline",
        date: null,
        tag: null,
        searchQuery: "",
        showChecked: true,
        showUnchecked: true,
      },
    });
    router.replace(`${basePath}?${params.toString()}`, { scroll: false });
  }, [basePath, router]);

  const handleMoveToCanonicalUrl = useCallback(() => {
    const params = serializeBoardUiStateToSearchParams({
      state: {
        leftPanelMode: "overdue",
        rightPanelMode: "timeline",
        date: null,
        tag: null,
        searchQuery: "",
        showChecked: true,
        showUnchecked: true,
      },
    });
    router.replace(`${basePath}?${params.toString()}`, { scroll: false });
  }, [basePath, router]);

  if (!effectiveParseResult.ok) {
    return (
      <InvalidTimelineUrlState
        code={effectiveParseResult.code}
        onResetInvalidUrl={handleResetInvalidUrl}
        onMoveToCanonicalUrl={handleMoveToCanonicalUrl}
      />
    );
  }

  return (
    <TimelineBoardPageContent
      initialBoard={initialBoard}
      user={user}
      signOut={signOut}
      basePath={basePath}
      resolvedState={resolvedState}
      dayWindowStartRef={dayWindowStartRef}
      setDayWindowStart={setDayWindowStart}
      updateBoardUiState={updateBoardUiState}
      updateUrlForTimeline={updateUrlForTimeline}
      updateUrlForList={updateUrlForList}
      setCard={setCard}
    />
  );
}
