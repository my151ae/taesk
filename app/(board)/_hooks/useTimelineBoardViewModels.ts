"use client";

import { useMemo } from "react";
import type {
  KeyboardEvent,
  MouseEvent,
  PointerEvent,
  RefObject,
} from "react";

import type {
  ExternalCalendarEntry,
  TimelineBucketItem,
  TimelineDay,
  TimelineEvent,
  TimelineOverdueItem,
} from "@/app/(board)/_utils/timeline-helpers";
import type { TimelineSearchResultItem, TimelineTagSummary } from "@/app/(board)/_hooks/useTimelineFiltering";
import type {
  ActiveDragState,
  ActiveResizeState,
  BucketIndicator,
  PointerPreviewState,
} from "@/app/(board)/_hooks/useTimelineDragAndDrop";
import type { useTimelineDragAndDrop } from "@/app/(board)/_hooks/useTimelineDragAndDrop";
import type { ListWindowPresetKey } from "@/app/(board)/_hooks/useTimelineUrlState";
import type { LeftPanelMode } from "@/app/(board)/_hooks/useTimelineUrlState";
import type {
  DesktopSidebarMenuActions,
  DesktopSidebarMenuState,
  DesktopSidebarSection,
  SidebarSectionKey,
} from "@/app/(board)/_components/timeline/DesktopSidebarMenu";
import type {
  DesktopTimelineToolbarProps,
  DesktopTimelineViewProps,
} from "@/app/(board)/_components/timeline/DesktopTimelineView";
import type {
  DesktopListToolbarProps,
  DesktopListViewProps,
} from "@/app/(board)/_components/timeline/DesktopListView";
import type { BucketCreateRequest } from "@/app/(board)/_components/timeline/bucket-create-request";
import { useDesktopListState } from "@/app/(board)/_hooks/useDesktopListState";

type DragAndDropBindings = ReturnType<typeof useTimelineDragAndDrop>;
export type DesktopMainPanelViewMode = "timeline" | "list";

type UseTimelineBoardViewModelsArgs = {
  viewMode: DesktopMainPanelViewMode;
  activeLeftPanelMode: LeftPanelMode;
  activeLeftSectionKey: SidebarSectionKey | null;
  expandedSectionKey: SidebarSectionKey | null;
  onExpandedSectionChange: (key: SidebarSectionKey | null) => void;
  days: TimelineDay[];
  activeDayIndex: number;
  intendedDayRange: number;
  effectiveDayRange: number;
  timelineScrollRefDesktop: RefObject<HTMLDivElement>;
  timelineScrollRefMobile: RefObject<HTMLDivElement>;
  timelineHeaderRef: RefObject<HTMLDivElement>;
  debouncedHandleScroll: (scrollTop: number) => void;
  handleTimelineViewMount: () => void;
  openCardModal: (shortId: string | null, source: string) => void;
  handleToggleCardChecked: (cardId: string, checked: boolean) => void;
  activeResize: ActiveResizeState | null;
  handleResizeStart: (e: PointerEvent, cardId: string, startMinutes: number, duration: number, edge: "top" | "bottom") => void;
  handleResizeMove: (e: PointerEvent) => void;
  handleResizeEnd: (e: PointerEvent) => void;
  calendarEventsByDay: Record<string, ExternalCalendarEntry[]>;
  calendarAllDayEventsByDay: Record<string, ExternalCalendarEntry[]>;
  handleExternalEventClick: (entry: ExternalCalendarEntry) => void;
  timelineStartHour: number;
  registerAbScrollContainer: (iso: string, el: HTMLDivElement | null, bucket?: "a" | "b") => void;
  status: string;
  handlePrevDay: () => void;
  handleNextDay: () => void;
  handlePrevDayRange: () => void;
  handleNextDayRange: () => void;
  handleDayRangeChange: (days: number) => void;
  handleTodayClick: () => void;
  eventsByDay: Record<string, TimelineEvent[]>;
  abBuckets: Record<string, TimelineBucketItem[]>;
  overdue: TimelineOverdueItem[];
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  searchResults: TimelineSearchResultItem[];
  tagResults: TimelineSearchResultItem[];
  selectedTags: string[];
  setSelectedTags: React.Dispatch<React.SetStateAction<string[]>>;
  tagSummaries: TimelineTagSummary[];
  indicatorTop: number | null;
  liveNowIsoDate: string | null;
  timelineViewportHeight: number;
  activeDrag: ActiveDragState | null;
  pointerPreview: PointerPreviewState;
  bucketIndicator: BucketIndicator | null;
  handleEventKeyDown: (event: TimelineEvent, native: KeyboardEvent<HTMLElement>) => void;
  handleColumnClick: (day: TimelineDay, minutes: number) => void;
  handleBucketClick: (bucketKey: string, afterCardId?: string) => void;
  handleBucketCreateRequest: (request: BucketCreateRequest) => void;
  sensors: DragAndDropBindings["sensors"];
  handleDragStart: DragAndDropBindings["handleDragStart"];
  handleDragMove: DragAndDropBindings["handleDragMove"];
  handleDragEnd: DragAndDropBindings["handleDragEnd"];
  handleDragCancel: DragAndDropBindings["handleDragCancel"];
  isOverABList: boolean;
  timelineHeaderHeight: number;
  handleCardContextMenu: (e: MouseEvent, cardId: string) => void;
  handleCardContextMenuByKeyboard: (cardId: string, rect: DOMRect) => void;
  contextMenuCardId: string | null;
  selectedCardIds: ReadonlySet<string>;
  selectionLeadCardId: string | null;
  onShiftSelect: (args: {
    cardId: string;
    laneId: string;
    activeCardId: string | null;
    activeLaneId: string | null;
  }) => void;
  onClearSelection: () => void;
  onActivateCard: (cardId: string, laneId: string) => void;
  activeCardId: string | null;
  activeLaneId: string | null;
  pendingTitleEditCardId: string | null;
  onPendingTitleEditConsumed: () => void;
  listBaseDate: string;
  listWindowPresetKey: ListWindowPresetKey;
  handleListWindowPresetChange: (nextPreset: ListWindowPresetKey) => void;
  listReverse: boolean;
  handleListBaseDateChange: (nextIsoDate: string) => void;
  handleListPrevDay: () => void;
  handleListNextDay: () => void;
  handleListPrevWeek: () => void;
  handleListNextWeek: () => void;
  handleListToday: () => void;
  handleViewModeChange: (mode: DesktopMainPanelViewMode) => void;
};

export function useTimelineBoardViewModels(args: UseTimelineBoardViewModelsArgs) {
  const { onExpandedSectionChange, setSearchQuery, setSelectedTags } = args;
  const activeSidebarSectionKey = args.activeLeftSectionKey;

  const leftPanelState = useMemo<DesktopSidebarMenuState>(
    () => ({
      activeSectionKey: activeSidebarSectionKey,
      expandedSectionKey: args.expandedSectionKey,
      searchQuery: args.searchQuery,
      selectedTags: args.selectedTags,
    }),
    [activeSidebarSectionKey, args.expandedSectionKey, args.searchQuery, args.selectedTags]
  );

  const leftPanelActions = useMemo<DesktopSidebarMenuActions>(
    () => ({
      onExpandedSectionChange,
      onSearchQueryChange: setSearchQuery,
      onTagToggle: (value: string) =>
        setSelectedTags((prev) => (prev.length === 1 && prev[0] === value ? [] : [value])),
      onTagClear: () => setSelectedTags([]),
    }),
    [onExpandedSectionChange, setSearchQuery, setSelectedTags]
  );

  const leftPanelSections = useMemo<DesktopSidebarSection[]>(
    () => [
      {
        key: "overdue",
        tone: "danger",
        id: "desktop-sidebar-overdue-panel",
        label: "Overdue",
        count: args.overdue.length,
        items: args.overdue,
      },
      {
        key: "search",
        tone: "neutral",
        id: "desktop-sidebar-search-panel",
        label: "Search",
        count: args.searchQuery.trim() ? args.searchResults.length : 0,
        results: args.searchResults,
      },
      {
        key: "tags",
        tone: "neutral",
        id: "desktop-sidebar-tags-panel",
        label: "Tag",
        count: args.tagSummaries.length,
        tags: args.tagSummaries,
        results: args.tagResults,
      },
    ],
    [args.overdue, args.searchQuery, args.searchResults, args.tagResults, args.tagSummaries]
  );

  const availableKeys = useMemo<DesktopMainPanelViewMode[]>(
    () => ["timeline", "list"],
    []
  );
  const fallbackKey: DesktopMainPanelViewMode = args.viewMode;
  const activeKey = args.viewMode;

  const listState = useDesktopListState({
    listBaseDate: args.listBaseDate,
    fallbackBaseDate: args.days[0]?.isoDate ?? "",
  });

  const timelineEventsByDay = useMemo(() => args.eventsByDay, [args.eventsByDay]);
  const timelineBuckets = useMemo(() => args.abBuckets, [args.abBuckets]);

  const timelineToolbar = useMemo<DesktopTimelineToolbarProps>(
    () => ({
      status: args.status,
      dayRange: args.intendedDayRange,
      onDayRangeChange: args.handleDayRangeChange,
      onPrevDay: args.handlePrevDay,
      onNextDay: args.handleNextDay,
      onPrevDayRange: args.handlePrevDayRange,
      onNextDayRange: args.handleNextDayRange,
      onToday: args.handleTodayClick,
    }),
    [
      args.status,
      args.intendedDayRange,
      args.handleDayRangeChange,
      args.handlePrevDay,
      args.handleNextDay,
      args.handlePrevDayRange,
      args.handleNextDayRange,
      args.handleTodayClick,
    ]
  );

  const timelineBody = useMemo<DesktopTimelineViewProps>(
    () => ({
      days: args.days,
      activeDayIndex: args.activeDayIndex,
      dayRange: args.effectiveDayRange,
      timelineScrollRef: args.timelineScrollRefDesktop,
      onScroll: args.debouncedHandleScroll,
      onMount: args.handleTimelineViewMount,
      openCardModal: args.openCardModal,
      onToggleCheck: args.handleToggleCardChecked,
      activeResize: args.activeResize,
      handleResizeStart: args.handleResizeStart,
      handleResizeMove: args.handleResizeMove,
      handleResizeEnd: args.handleResizeEnd,
      calendarEventsByDay: args.calendarEventsByDay,
      onExternalEventClick: args.handleExternalEventClick,
      timelineStartHour: args.timelineStartHour,
      timelineHeaderRef: args.timelineHeaderRef,
      registerAbScrollContainer: args.registerAbScrollContainer,
      status: args.status,
      eventsByDay: timelineEventsByDay,
      abBuckets: timelineBuckets,
      indicatorTop: args.indicatorTop,
      indicatorDayIso: args.liveNowIsoDate,
      timelineViewportHeight: args.timelineViewportHeight,
      activeDrag: args.activeDrag,
      pointerPreview: args.pointerPreview,
      bucketIndicator: args.bucketIndicator,
      handleEventKeyDown: args.handleEventKeyDown,
      handleColumnClick: args.handleColumnClick,
      onCreateBucketCard: args.handleBucketClick,
      onRequestCreateBucketCard: args.handleBucketCreateRequest,
      sensors: args.sensors,
      handleDragStart: args.handleDragStart,
      handleDragMove: args.handleDragMove,
      handleDragEnd: args.handleDragEnd,
      handleDragCancel: args.handleDragCancel,
      floatingLayerTop: args.timelineHeaderHeight,
      calendarAllDayByDay: args.calendarAllDayEventsByDay,
      onCardContextMenu: args.handleCardContextMenu,
      onCardContextMenuByKeyboard: args.handleCardContextMenuByKeyboard,
      contextMenuCardId: args.contextMenuCardId,
      selectedCardIds: args.selectedCardIds,
      selectionLeadCardId: args.selectionLeadCardId,
      onShiftSelect: args.onShiftSelect,
      onClearSelection: args.onClearSelection,
      onActivateCard: args.onActivateCard,
      activeCardId: args.activeCardId,
      activeLaneId: args.activeLaneId,
      pendingTitleEditCardId: args.pendingTitleEditCardId,
      onPendingTitleEditConsumed: args.onPendingTitleEditConsumed,
    }),
    [
      args.days,
      args.activeDayIndex,
      args.effectiveDayRange,
      args.timelineScrollRefDesktop,
      args.debouncedHandleScroll,
      args.handleTimelineViewMount,
      args.openCardModal,
      args.handleToggleCardChecked,
      args.activeResize,
      args.handleResizeStart,
      args.handleResizeMove,
      args.handleResizeEnd,
      args.calendarEventsByDay,
      args.handleExternalEventClick,
      args.timelineStartHour,
      args.timelineHeaderRef,
      args.registerAbScrollContainer,
      args.status,
      timelineEventsByDay,
      timelineBuckets,
      args.indicatorTop,
      args.liveNowIsoDate,
      args.timelineViewportHeight,
      args.activeDrag,
      args.pointerPreview,
      args.bucketIndicator,
      args.handleEventKeyDown,
      args.handleColumnClick,
      args.handleBucketClick,
      args.handleBucketCreateRequest,
      args.sensors,
      args.handleDragStart,
      args.handleDragMove,
      args.handleDragEnd,
      args.handleDragCancel,
      args.timelineHeaderHeight,
      args.calendarAllDayEventsByDay,
      args.handleCardContextMenu,
      args.handleCardContextMenuByKeyboard,
      args.contextMenuCardId,
      args.selectedCardIds,
      args.selectionLeadCardId,
      args.onShiftSelect,
      args.onClearSelection,
      args.onActivateCard,
      args.activeCardId,
      args.activeLaneId,
      args.pendingTitleEditCardId,
      args.onPendingTitleEditConsumed,
    ]
  );

  const listToolbar: DesktopListToolbarProps = {
    onPrevDay: args.handleListPrevDay,
    onNextDay: args.handleListNextDay,
    onPrevWeek: args.handleListPrevWeek,
    onNextWeek: args.handleListNextWeek,
    onToday: args.handleListToday,
    draftBaseDate: listState.draftBaseDate,
    baseDateValue: listState.baseDateValue,
    onDraftBaseDateChange: listState.setDraftBaseDate,
    onCommitBaseDate: () => {
      if (listState.draftBaseDate && listState.draftBaseDate !== listState.baseDateValue) {
        args.handleListBaseDateChange(listState.draftBaseDate);
      }
    },
    listWindowPresetKey: args.listWindowPresetKey,
    onListWindowPresetChange: args.handleListWindowPresetChange,
    showUnchecked: listState.showUnchecked,
      onShowUncheckedChange: listState.setShowUnchecked,
      showChecked: listState.showChecked,
      onShowCheckedChange: listState.setShowChecked,
      showGoogle: listState.showGoogle,
      onShowGoogleChange: listState.setShowGoogle,
  };

  const listBody = useMemo<DesktopListViewProps>(
    () => ({
      days: args.days,
      eventsByDay: args.eventsByDay,
      abBuckets: args.abBuckets,
      overdue: args.overdue,
      calendarEventsByDay: args.calendarEventsByDay,
      calendarAllDayEventsByDay: args.calendarAllDayEventsByDay,
      openCardModal: args.openCardModal,
      onToggleCheck: args.handleToggleCardChecked,
      onExternalEventClick: args.handleExternalEventClick,
      onCardContextMenu: args.handleCardContextMenu,
      status: args.status,
      listReverse: args.listReverse,
      showUnchecked: listState.showUnchecked,
      showChecked: listState.showChecked,
      showGoogle: listState.showGoogle,
    }),
    [
      args.days,
      args.eventsByDay,
      args.abBuckets,
      args.overdue,
      args.calendarEventsByDay,
      args.calendarAllDayEventsByDay,
      args.openCardModal,
      args.handleToggleCardChecked,
      args.handleExternalEventClick,
      args.handleCardContextMenu,
      args.status,
      args.listReverse,
      listState.showUnchecked,
      listState.showChecked,
      listState.showGoogle,
    ]
  );

  const mainPanel = {
    tabs: {
      items: [
        { key: "timeline" as const, label: "Timeline" },
        { key: "list" as const, label: "List" },
      ],
      activeKey,
      availableKeys,
      fallbackKey,
      onChange: args.handleViewModeChange,
    },
    views: {
      timeline: {
        toolbar: timelineToolbar,
        body: timelineBody,
      },
      list: {
        toolbar: listToolbar,
        body: listBody,
      },
    },
  };

  const mobile = {
    timeline: {
      timelineScrollRef: args.timelineScrollRefMobile,
      days: args.days,
      activeDayIndex: args.activeDayIndex,
      onPrevDay: args.handlePrevDay,
      onNextDay: args.handleNextDay,
      onMount: args.handleTimelineViewMount,
      onScroll: args.debouncedHandleScroll,
      registerAbScrollContainer: args.registerAbScrollContainer,
      eventsByDay: timelineEventsByDay,
      abBuckets: timelineBuckets,
      overdue: args.overdue,
      calendarEventsByDay: args.calendarEventsByDay,
      calendarAllDayByDay: args.calendarAllDayEventsByDay,
      indicatorTop: args.indicatorTop,
      indicatorDayIso: args.liveNowIsoDate,
      timelineViewportHeight: args.timelineViewportHeight,
      openCardModal: args.openCardModal,
      onCreateBucketCard: args.handleBucketClick,
      onRequestCreateBucketCard: args.handleBucketCreateRequest,
      onToggleCheck: args.handleToggleCardChecked,
      status: args.status,
      activeDrag: args.activeDrag,
      sensors: args.sensors,
      handleDragStart: args.handleDragStart,
      handleDragMove: args.handleDragMove,
      handleDragEnd: args.handleDragEnd,
      handleDragCancel: args.handleDragCancel,
      bucketIndicator: args.bucketIndicator,
      isOverABList: args.isOverABList,
      pointerPreview: args.pointerPreview,
      onExternalEventClick: args.handleExternalEventClick,
      timelineStartHour: args.timelineStartHour,
      onCardContextMenu: args.handleCardContextMenu,
      onCardContextMenuByKeyboard: args.handleCardContextMenuByKeyboard,
      contextMenuCardId: args.contextMenuCardId,
    },
    list: {
      days: args.days,
      eventsByDay: args.eventsByDay,
      abBuckets: args.abBuckets,
      overdue: args.overdue,
      calendarEventsByDay: args.calendarEventsByDay,
      calendarAllDayEventsByDay: args.calendarAllDayEventsByDay,
      openCardModal: args.openCardModal,
      onToggleCheck: args.handleToggleCardChecked,
      onExternalEventClick: args.handleExternalEventClick,
      onCardContextMenu: args.handleCardContextMenu,
      status: args.status,
      onPrevDay: args.handleListPrevDay,
      onNextDay: args.handleListNextDay,
      onPrevWeek: args.handleListPrevWeek,
      onNextWeek: args.handleListNextWeek,
      listBaseDate: args.listBaseDate,
      listWindowPresetKey: args.listWindowPresetKey,
      onListWindowPresetChange: args.handleListWindowPresetChange,
      listReverse: args.listReverse,
      onListBaseDateChange: args.handleListBaseDateChange,
      showChecked: listState.showChecked,
      showUnchecked: listState.showUnchecked,
      showGoogle: listState.showGoogle,
    },
  };

  return {
    desktop: {
      leftPanel: {
        state: leftPanelState,
        sections: leftPanelSections,
        actions: leftPanelActions,
        allowOverdueDrag: activeKey === "timeline",
      },
      mainPanel,
    },
    mobile,
  };
}
