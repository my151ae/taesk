"use client";

import { useMemo } from "react";

import TimelineBoardScreen, {
  type TimelineBoardScreenProps,
} from "@/app/(board)/_components/timeline/TimelineBoardScreen";
import type { ShortcutBarConfig } from "@/app/(board)/_components/timeline/shortcut-bar-registry";
import type { Board, ProfileSummary, TeamView } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";
import type { SidebarSectionKey } from "@/app/(board)/_components/timeline/DesktopSidebarMenu";
import type { OverdueSortOrder } from "@/lib/timeline-overdue-sort";
import type {
  ExternalCalendarEntry,
  TimelineResponse,
  UserProfile,
} from "@/app/(board)/_utils/timeline-helpers";
import type { TimelineSearchResultItem, TimelineTagSummary } from "@/app/(board)/_hooks/useTimelineFiltering";
import type { useTimelineDragAndDrop } from "@/app/(board)/_hooks/useTimelineDragAndDrop";
import { useTimelineBoardViewModels } from "@/app/(board)/_hooks/useTimelineBoardViewModels";
import { useTimelineCardContextMenuItems } from "@/app/(board)/_hooks/useTimelineCardContextMenuItems";
import { buildTimelineOverlayState } from "@/app/(board)/_components/timeline/timeline-render-model";
import type { ListWindowPresetKey } from "@/app/(board)/_hooks/useTimelineUrlState";
import type { LeftPanelMode } from "@/app/(board)/_hooks/useTimelineUrlState";
import type { BucketCreateRequest } from "@/app/(board)/_components/timeline/bucket-create-request";

type ViewModels = ReturnType<typeof useTimelineBoardViewModels>;
type DragAndDropBindings = ReturnType<typeof useTimelineDragAndDrop>;

export type TimelineBoardScreenContentProps = Omit<
  TimelineBoardScreenProps,
  "parseResult" | "onResetInvalidUrl" | "onMoveToCanonicalUrl" | "bucketCreateMenu"
>;

type UseTimelineBoardScreenArgs = {
  currentBoard: Board;
  availableBoards: Board[];
  availableTeams: TeamView[];
  handleBoardNavigate: (board: Board) => void;
  showBoardMenu: boolean;
  setShowBoardMenu: (show: boolean | ((prev: boolean) => boolean)) => void;
  boardMenuRef: React.RefObject<HTMLDivElement | null>;
  setShowNotificationSettings: (show: boolean) => void;
  setShowProfileSettings: (show: boolean) => void;
  onOpenBoardSettings: (boardId: string | null | undefined) => void;
  onOpenTeamSettings: (teamId: string | null | undefined) => void;
  profile: UserProfile | null;
  user: User | null;
  signOut: () => Promise<void>;
  intendedDayRange: number;
  onDayRangeChange: (days: number) => void;
  onTodayClick: () => void;
  realtimeStatus: "connected" | "connecting" | "disconnected";
  googleToast: string | null;
  googleStatusText: string;
  googleCalendarStatus: string;
  googleCalendarError: string | null;
  calendarPreset: "visible" | "this-week" | "next-week";
  setCalendarPreset: (preset: "visible" | "this-week" | "next-week") => void;
  refreshGoogleCalendar: () => void;
  handleGoogleConnect: () => void;
  viewMode: "timeline" | "list";
  onShortcutsClick: () => void;
  activeLeftPanelMode: LeftPanelMode;
  activeLeftSectionKey: SidebarSectionKey | null;
  expandedSectionKey: SidebarSectionKey | null;
  onExpandedSectionChange: (key: SidebarSectionKey | null) => void;
  onResetToDefaultList: () => void;
  days: TimelineResponse["days"];
  activeDayIndex: number;
  effectiveDayRange: number;
  timelineScrollRefDesktop: React.RefObject<HTMLDivElement | null>;
  timelineScrollRefMobile: React.RefObject<HTMLDivElement | null>;
  timelineHeaderRef: React.RefObject<HTMLDivElement | null>;
  debouncedHandleScroll: (scrollTop: number) => void;
  handleTimelineViewMount: () => void;
  openCardModal: (shortId: string | null, source: string) => void;
  handleToggleCardChecked: (cardId: string, checked: boolean) => Promise<boolean>;
  handleRenameCardTitle: (cardId: string, nextTitle: string) => Promise<boolean>;
  activeResize: DragAndDropBindings["activeResize"];
  handleResizeStart: DragAndDropBindings["handleResizeStart"];
  handleResizeMove: DragAndDropBindings["handleResizeMove"];
  handleResizeEnd: DragAndDropBindings["handleResizeEnd"];
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
  eventsByDay: Record<string, TimelineResponse["events"]>;
  abBuckets: TimelineResponse["abBuckets"];
  overdue: TimelineResponse["overdue"];
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  searchResults: TimelineSearchResultItem[];
  tagResults: TimelineSearchResultItem[];
  availableTags: string[];
  selectedTags: string[];
  setSelectedTags: React.Dispatch<React.SetStateAction<string[]>>;
  tagSummaries: TimelineTagSummary[];
  indicatorTop: number | null;
  liveNowIsoDate: string | null;
  timelineViewportHeight: number;
  activeDrag: DragAndDropBindings["activeDrag"];
  pointerPreview: DragAndDropBindings["pointerPreview"];
  bucketIndicator: DragAndDropBindings["bucketIndicator"];
  handleEventKeyDown: DragAndDropBindings["handleEventKeyDown"];
  handleColumnClick: (day: TimelineResponse["days"][number], minutes: number) => void;
  handleBucketClick: (bucketKey: string, afterCardId?: string) => void;
  handleBucketCreateRequest: (request: BucketCreateRequest) => void;
  sensors: DragAndDropBindings["sensors"];
  handleDragStart: DragAndDropBindings["handleDragStart"];
  handleDragMove: DragAndDropBindings["handleDragMove"];
  handleDragEnd: DragAndDropBindings["handleDragEnd"];
  handleDragCancel: DragAndDropBindings["handleDragCancel"];
  isOverABList: boolean;
  timelineHeaderHeight: number;
  handleCardContextMenu: (e: React.MouseEvent, cardId: string) => void;
  handleCardContextMenuByKeyboard: (cardId: string, rect: DOMRect) => void;
  contextMenu: {
    open: boolean;
    cardId: string | null;
    targetCardIds: string[];
    x: number;
    y: number;
  };
  selectedCardIds: ReadonlySet<string>;
  selectionLeadCardId: string | null;
  onShiftSelect: (args: {
    cardId: string;
    laneId: string;
    activeCardId: string | null;
    activeLaneId: string | null;
  }) => void;
  clearSelection: () => void;
  onActivateCard: (cardId: string, laneId: string) => void;
  activeCardId: string | null;
  activeLaneId: string | null;
  pendingTitleEditCardId: string | null;
  onPendingTitleEditConsumed: () => void;
  listAnchorDate: string;
  listWindowPresetKey: ListWindowPresetKey;
  handleListWindowPresetChange: (nextPreset: ListWindowPresetKey) => void;
  listReverse: boolean;
  handleListBaseDateChange: (nextIsoDate: string) => void;
  handleListPrevDay: () => void;
  handleListNextDay: () => void;
  handleListPrevWeek: () => void;
  handleListNextWeek: () => void;
  handleListToday: () => void;
  handleViewModeChange: (mode: "timeline" | "list") => void;
  showShareDialog: boolean;
  setShowShareDialog: (show: boolean) => void;
  showNotificationSettings: boolean;
  setShowNotificationSettingsOpen: (show: boolean) => void;
  showProfileSettings: boolean;
  setShowProfileSettingsOpen: (show: boolean) => void;
  showBoardSettings: boolean;
  setShowBoardSettings: (show: boolean) => void;
  boardSettingsBoardId: string | null;
  showTeamSettings: boolean;
  setShowTeamSettings: (show: boolean) => void;
  teamSettingsTeamId: string | null;
  fetchProfile: () => Promise<void>;
  setAvailableBoards: React.Dispatch<React.SetStateAction<Board[]>>;
  setActiveDayIndexForDialogs: (value: number) => void;
  fetchTimelineForDialogs: (start?: number) => Promise<unknown>;
  refreshBoardMembers: () => Promise<void>;
  showShortcutsModal: boolean;
  setShowShortcutsModal: (show: boolean) => void;
  modalCard: NonNullable<TimelineBoardScreenProps["modalProps"]>["card"] | null;
  cardModalStatus: "idle" | "loading" | "ready" | "error";
  modalProfiles: ProfileSummary[];
  handleCardModalSave: NonNullable<TimelineBoardScreenProps["modalProps"]>["onSave"];
  handleCardModalDelete: (cardId: string) => Promise<boolean>;
  closeCardModal: () => void;
  historySaveWarning: string | null;
  retryHistorySave: () => void;
  closeModalWithoutHistory: () => void;
  cardModalError: string | null;
  data: TimelineResponse | null;
  moveCardByDayOffset: (cardId: string, offset: number) => Promise<boolean>;
  overdueSortOrder: OverdueSortOrder;
  onOverdueSortOrderChange: (order: OverdueSortOrder) => void;
  filteredData: TimelineResponse | null;
};

export function useTimelineBoardScreen({
  currentBoard,
  availableBoards,
  availableTeams,
  handleBoardNavigate,
  showBoardMenu,
  setShowBoardMenu,
  boardMenuRef,
  setShowNotificationSettings,
  setShowProfileSettings,
  onOpenBoardSettings,
  onOpenTeamSettings,
  profile,
  user,
  signOut,
  intendedDayRange,
  onDayRangeChange,
  onTodayClick,
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
  onShortcutsClick,
  activeLeftPanelMode,
  activeLeftSectionKey,
  expandedSectionKey,
  onExpandedSectionChange,
  onResetToDefaultList,
  days,
  activeDayIndex,
  effectiveDayRange,
  timelineScrollRefDesktop,
  timelineScrollRefMobile,
  timelineHeaderRef,
  debouncedHandleScroll,
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
  handlePrevDay,
  handleNextDay,
  handlePrevDayRange,
  handleNextDayRange,
  eventsByDay,
  abBuckets,
  overdue,
  searchQuery,
  setSearchQuery,
  searchResults,
  tagResults,
  availableTags,
  selectedTags,
  setSelectedTags,
  tagSummaries,
  indicatorTop,
  liveNowIsoDate,
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
  selectedCardIds,
  selectionLeadCardId,
  onShiftSelect,
  clearSelection,
  onActivateCard,
  activeCardId,
  activeLaneId,
  pendingTitleEditCardId,
  onPendingTitleEditConsumed,
  listAnchorDate,
  listWindowPresetKey,
  handleListWindowPresetChange,
  listReverse,
  handleListBaseDateChange,
  handleListPrevDay,
  handleListNextDay,
  handleListPrevWeek,
  handleListNextWeek,
  handleListToday,
  handleViewModeChange,
  showShareDialog,
  setShowShareDialog,
  showNotificationSettings,
  setShowNotificationSettingsOpen,
  showProfileSettings,
  setShowProfileSettingsOpen,
  showBoardSettings,
  setShowBoardSettings,
  boardSettingsBoardId,
  showTeamSettings,
  setShowTeamSettings,
  teamSettingsTeamId,
  fetchProfile,
  setAvailableBoards,
  setActiveDayIndexForDialogs,
  fetchTimelineForDialogs,
  refreshBoardMembers,
  showShortcutsModal,
  setShowShortcutsModal,
  modalCard,
  cardModalStatus,
  modalProfiles,
  handleCardModalSave,
  handleCardModalDelete,
  closeCardModal,
  historySaveWarning,
  retryHistorySave,
  closeModalWithoutHistory,
  cardModalError,
  data,
  moveCardByDayOffset,
  overdueSortOrder,
  onOverdueSortOrderChange,
  filteredData,
}: UseTimelineBoardScreenArgs): TimelineBoardScreenContentProps {
  const { items: contextMenuItems } = useTimelineCardContextMenuItems({
    contextMenuCardId: contextMenu.cardId,
    contextMenuTargetCardIds: contextMenu.targetCardIds,
    data,
    openCardModal,
    handleToggleCardChecked,
    moveCardByDayOffset,
    handleCardModalDelete,
    onBulkActionSuccess: clearSelection,
  });

  const activeDragCardId = activeDrag?.cardId ?? null;
  const { overlayBucketEntry, overlayOverdueEntry, overlayTimelineEvent, overlayCardData } = useMemo(
    () =>
      buildTimelineOverlayState({
        abBuckets: filteredData?.abBuckets ?? {},
        overdue: filteredData?.overdue ?? [],
        events: filteredData?.events ?? [],
        activeDragCardId,
        defaultTimelineDuration: 60,
      }),
    [activeDragCardId, filteredData?.abBuckets, filteredData?.events, filteredData?.overdue],
  );

  const viewModels: ViewModels = useTimelineBoardViewModels({
    viewMode,
    activeLeftPanelMode,
    activeLeftSectionKey,
    expandedSectionKey,
    onExpandedSectionChange,
    days,
    activeDayIndex,
    intendedDayRange,
    effectiveDayRange,
    timelineScrollRefDesktop: timelineScrollRefDesktop as React.RefObject<HTMLDivElement>,
    timelineScrollRefMobile: timelineScrollRefMobile as React.RefObject<HTMLDivElement>,
    timelineHeaderRef: timelineHeaderRef as React.RefObject<HTMLDivElement>,
    debouncedHandleScroll,
    handleTimelineViewMount,
    openCardModal,
    handleToggleCardChecked,
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
    handlePrevDay,
    handleNextDay,
    handlePrevDayRange,
    handleNextDayRange,
    handleDayRangeChange: onDayRangeChange,
    handleTodayClick: onTodayClick,
    eventsByDay,
    abBuckets,
    overdue,
    searchQuery,
    setSearchQuery,
    searchResults,
    tagResults,
    selectedTags,
    setSelectedTags,
    tagSummaries,
    indicatorTop,
    liveNowIsoDate,
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
    contextMenuCardId: contextMenu.cardId,
    selectedCardIds,
    selectionLeadCardId,
    onShiftSelect,
    onClearSelection: clearSelection,
    onActivateCard,
    activeCardId,
    activeLaneId,
    pendingTitleEditCardId,
    onPendingTitleEditConsumed,
    listBaseDate: listAnchorDate,
    listWindowPresetKey,
    handleListWindowPresetChange,
    listReverse,
    handleListBaseDateChange,
    handleListPrevDay,
    handleListNextDay,
    handleListPrevWeek,
    handleListNextWeek,
    handleListToday,
    handleViewModeChange,
  });

  const desktopActiveView = viewModels.desktop.mainPanel.tabs.activeKey;
  const desktopTabItems = viewModels.desktop.mainPanel.tabs.items.filter((item) =>
    viewModels.desktop.mainPanel.tabs.availableKeys.includes(item.key),
  );

  const headerProps: TimelineBoardScreenContentProps["headerProps"] = {
    board: currentBoard,
    modalBoards: availableBoards,
    modalTeams: availableTeams,
    handleBoardNavigate,
    showBoardMenu,
    setShowBoardMenu,
    boardMenuRef: boardMenuRef as React.RefObject<HTMLDivElement>,
    setShowNotificationSettings,
    setShowProfileSettings,
    onOpenBoardSettings,
    onOpenTeamSettings,
    profile,
    user,
    signOut,
    dayRange: intendedDayRange,
    onDayRangeChange,
    onTodayClick,
    realtimeStatus,
    googleToast,
    googleStatusText,
    googleCalendarStatus,
    googleCalendarError,
    calendarPreset,
    setCalendarPreset,
    refreshGoogleCalendar,
    handleGoogleConnect,
    isGoogleLoading: googleCalendarStatus === "loading",
    viewMode,
    onShortcutsClick,
  };

  const leftPanelProps: TimelineBoardScreenContentProps["desktop"]["leftPanelProps"] = {
    state: viewModels.desktop.leftPanel.state,
    actions: viewModels.desktop.leftPanel.actions,
    sections: viewModels.desktop.leftPanel.sections,
    allowOverdueDrag: viewModels.desktop.leftPanel.allowOverdueDrag,
    openCardModal,
    onToggleCheck: handleToggleCardChecked,
    onCardContextMenu: handleCardContextMenu,
    onCardContextMenuByKeyboard: handleCardContextMenuByKeyboard,
    contextMenuCardId: contextMenu.cardId,
    onRenameCardTitle: handleRenameCardTitle,
    selectedCardIds,
    selectionLeadCardId,
    onShiftSelect,
    onClearSelection: clearSelection,
    onActivateCard,
    activeCardId,
    activeLaneId,
  };

  return {
    headerProps,
    desktop: {
      activeView: desktopActiveView,
      tabItems: desktopTabItems,
      onTabChange: viewModels.desktop.mainPanel.tabs.onChange,
      leftPanelProps,
      overdueSortOrder,
      onOverdueSortOrderChange,
      timelineToolbarProps: viewModels.desktop.mainPanel.views.timeline.toolbar,
      timelineViewProps: {
        ...viewModels.desktop.mainPanel.views.timeline.body,
        onRenameCardTitle: handleRenameCardTitle,
      },
      listToolbarProps: viewModels.desktop.mainPanel.views.list.toolbar,
      listViewProps: {
        ...viewModels.desktop.mainPanel.views.list.body,
        onRenameCardTitle: handleRenameCardTitle,
      },
      dndProps: {
        sensors,
        handleDragStart,
        handleDragMove,
        handleDragEnd,
        handleDragCancel,
      },
      overlayProps: {
        overlayCardData,
        overlayTimelineEvent,
        overlayBucketCard: overlayBucketEntry?.item ?? null,
        overlayOverdueCard: overlayOverdueEntry?.item ?? null,
      },
    },
    mobile: {
      viewMode,
      timelineProps: viewModels.mobile.timeline,
      listProps: viewModels.mobile.list,
      contextBar:
        activeLeftPanelMode !== "none"
          ? {
              label:
                activeLeftPanelMode === "tags"
                  ? selectedTags[0]
                    ? `#${selectedTags[0]}`
                    : "Tag"
                  : activeLeftPanelMode === "search"
                    ? searchQuery.trim()
                      ? `"${searchQuery.trim()}"`
                      : "Search"
                    : "Overdue",
              onReset: onResetToDefaultList,
            }
          : null,
      overdueSortOrder,
      onOverdueSortOrderChange,
    },
    dialogsProps: {
      showShareDialog,
      setShowShareDialog,
      showNotificationSettings,
      setShowNotificationSettings: setShowNotificationSettingsOpen,
      showProfileSettings,
      setShowProfileSettings: setShowProfileSettingsOpen,
      showBoardSettings,
      setShowBoardSettings,
      boardSettingsBoardId,
      showTeamSettings,
      setShowTeamSettings,
      teamSettingsTeamId,
      initialBoard: currentBoard,
      availableBoards,
      fetchProfile,
      setAvailableBoards,
      setActiveDayIndex: setActiveDayIndexForDialogs,
      fetchTimeline: fetchTimelineForDialogs,
      onMemberAdded: refreshBoardMembers,
    },
  shortcutsProps: {
      isOpen: showShortcutsModal,
      onClose: () => setShowShortcutsModal(false),
    },
    shortcutBarProps: {
      maxVisibleItems: 5,
    } satisfies ShortcutBarConfig,
    modalProps:
      modalCard && (cardModalStatus === "ready" || cardModalStatus === "loading")
        ? {
            card: modalCard,
            boards: availableBoards,
            profiles: modalProfiles,
            availableTags,
            onSave: handleCardModalSave,
            onDelete: handleCardModalDelete,
            onMoveToBoard: () => {},
            onClose: closeCardModal,
            isLoading: cardModalStatus === "loading",
            historySaveWarning,
            onRetryHistorySave: retryHistorySave,
            onCloseWithoutHistory: closeModalWithoutHistory,
            shortcutBar: {
              maxVisibleItems: 5,
            },
          }
        : null,
    cardModalError,
    contextMenu:
      contextMenu.open && contextMenu.cardId
        ? {
            open: true,
            cardId: contextMenu.cardId,
            x: contextMenu.x,
            y: contextMenu.y,
            items: contextMenuItems,
            onClose: () => {
              /* page injects actual close handler into contextMenu state */
            },
          }
        : {
            open: false,
            cardId: contextMenu.cardId,
          },
  };
}
