"use client";

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
import type { TrashCardItem } from "@/lib/api-types/timeline";
import type {
  ActiveDragState,
  ActiveResizeState,
  BucketIndicator,
  PointerPreviewState,
} from "@/app/(board)/_hooks/useTimelineDragAndDrop";
import type { useTimelineDragAndDrop } from "@/app/(board)/_hooks/useTimelineDragAndDrop";
import type { ListWindowPresetKey } from "@/app/(board)/_hooks/useTimelineUrlState";
import type { PrimaryPanelMode } from "@/app/(board)/_hooks/useTimelineUrlState";
import type { CompletedResultsGroup } from "@/app/(board)/_components/timeline/TimelineLeftPanelShared";
import type { SidebarSectionKey } from "@/app/(board)/_components/timeline/sidebar-section-types";
import type { TimelineViewportState } from "@/app/(board)/_components/timeline/timelineViewportState";
import type { BucketCreateRequest } from "@/app/(board)/_components/timeline/bucket-create-request";
import { useDesktopTimelineMainPanelViewModel } from "@/app/(board)/_hooks/useDesktopTimelineMainPanelViewModel";
import { useMobileTimelineMainPanelViewModel } from "@/app/(board)/_hooks/useMobileTimelineMainPanelViewModel";
import { useTimelineLeftPanelViewModel } from "@/app/(board)/_hooks/useTimelineLeftPanelViewModel";

type DragAndDropBindings = ReturnType<typeof useTimelineDragAndDrop>;
export type DesktopMainPanelViewMode = "timeline" | "list" | "month";

export type UseTimelineBoardViewModelsArgs = {
  viewMode: DesktopMainPanelViewMode;
  activeLeftPanelMode: PrimaryPanelMode;
  activeLeftSectionKey: SidebarSectionKey | null;
  expandedSectionKey: SidebarSectionKey | null;
  onExpandedSectionChange: (key: SidebarSectionKey | null) => void;
  onOpenNotificationSettings: () => void;
  days: TimelineDay[];
  activeDayIndex: number;
  anchorDayIso: string;
  intendedDayRange: number;
  effectiveDayRange: number;
  timelineScrollRefDesktop: RefObject<HTMLDivElement>;
  timelineScrollRefMobile: RefObject<HTMLDivElement>;
  setMobileAnchorTimelineScrollNode: (node: HTMLDivElement | null) => void;
  timelineHeaderRef: RefObject<HTMLDivElement>;
  debouncedHandleScroll: (scrollTop: number) => void;
  debouncedHandleAnchorScroll: (dayIso: string, scrollTop: number) => void;
  handleTimelineViewMount: () => void;
  openCardModal: (shortId: string | null, source: string) => void;
  handleToggleCardChecked: (cardId: string, checked: boolean) => void;
  handleRenameCardTitle: (cardId: string, nextTitle: string) => Promise<boolean>;
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
  goToDay: (isoDate: string) => Promise<void>;
  openTimelineDay: (isoDate: string) => void;
  handlePrevDayRange: () => void;
  handleNextDayRange: () => void;
  handleDayRangeChange: (days: number) => void;
  handleTodayClick: () => void;
  eventsByDay: Record<string, TimelineEvent[]>;
  abBuckets: Record<string, TimelineBucketItem[]>;
  overdue: TimelineOverdueItem[];
  completedResults: TimelineSearchResultItem[];
  completedCurrentMonthCount: number;
  completedCurrentMonthKey: string | null;
  completedGroupedResults: CompletedResultsGroup[];
  completedResetKey: string;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  searchResults: TimelineSearchResultItem[];
  tagResults: TimelineSearchResultItem[];
  selectedTags: string[];
  setSelectedTags: React.Dispatch<React.SetStateAction<string[]>>;
  tagSummaries: TimelineTagSummary[];
  trashItems: TrashCardItem[];
  notificationUnreadCount: number;
  indicatorTop: number | null;
  liveNowIsoDate: string | null;
  liveNowMinutes: number | null;
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
  onTimelineAnchorChange: (isoDate: string) => void;
  onTimelineWindowStateChange: (state: TimelineViewportState) => void;
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
  monthAnchorDate: string;
  handleMonthPrev: () => void;
  handleMonthNext: () => void;
  handleMonthToday: () => void;
  handleViewModeChange: (mode: DesktopMainPanelViewMode) => void;
};

export function useTimelineBoardViewModels(args: UseTimelineBoardViewModelsArgs) {
  const leftPanel = useTimelineLeftPanelViewModel(args);
  const desktopMainPanel = useDesktopTimelineMainPanelViewModel(args);
  const mobileMainPanel = useMobileTimelineMainPanelViewModel(args);

  return {
    desktop: {
      leftPanel,
      mainPanel: desktopMainPanel,
    },
    mobile: mobileMainPanel,
  };
}
