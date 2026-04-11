"use client";

import { useCallback, useMemo } from "react";
import type {
  DesktopTimelineToolbarProps,
  DesktopTimelineViewProps,
} from "@/app/(board)/_components/timeline/DesktopTimelineView";
import type {
  DesktopListToolbarProps,
  DesktopListViewProps,
} from "@/app/(board)/_components/timeline/DesktopListView";
import type {
  DesktopMonthToolbarProps,
  DesktopMonthViewProps,
} from "@/app/(board)/_components/timeline/DesktopMonthView";
import { useDesktopListState } from "@/app/(board)/_hooks/useDesktopListState";
import type { UseTimelineBoardViewModelsArgs } from "@/app/(board)/_hooks/useTimelineBoardViewModels";

type DesktopMainArgs = Pick<
  UseTimelineBoardViewModelsArgs,
  | "viewMode"
  | "days"
  | "anchorDayIso"
  | "activeDayIndex"
  | "intendedDayRange"
  | "effectiveDayRange"
  | "timelineScrollRefDesktop"
  | "debouncedHandleScroll"
  | "handleTimelineViewMount"
  | "openCardModal"
  | "handleToggleCardChecked"
  | "handleRenameCardTitle"
  | "activeResize"
  | "handleResizeStart"
  | "handleResizeMove"
  | "handleResizeEnd"
  | "calendarEventsByDay"
  | "calendarAllDayEventsByDay"
  | "handleExternalEventClick"
  | "timelineStartHour"
  | "timelineHeaderRef"
  | "registerAbScrollContainer"
  | "status"
  | "eventsByDay"
  | "abBuckets"
  | "indicatorTop"
  | "liveNowIsoDate"
  | "timelineViewportHeight"
  | "activeDrag"
  | "pointerPreview"
  | "bucketIndicator"
  | "handleEventKeyDown"
  | "handleColumnClick"
  | "handleBucketClick"
  | "handleBucketCreateRequest"
  | "sensors"
  | "handleDragStart"
  | "handleDragMove"
  | "handleDragEnd"
  | "handleDragCancel"
  | "timelineHeaderHeight"
  | "handleCardContextMenu"
  | "handleCardContextMenuByKeyboard"
  | "contextMenuCardId"
  | "selectedCardIds"
  | "selectionLeadCardId"
  | "onShiftSelect"
  | "onClearSelection"
  | "onActivateCard"
  | "activeCardId"
  | "activeLaneId"
  | "pendingTitleEditCardId"
  | "onPendingTitleEditConsumed"
  | "liveNowMinutes"
  | "onTimelineAnchorChange"
  | "onTimelineWindowStateChange"
  | "handleDayRangeChange"
  | "handlePrevDay"
  | "handleNextDay"
  | "handlePrevDayRange"
  | "handleNextDayRange"
  | "handleTodayClick"
  | "overdue"
  | "listBaseDate"
  | "listWindowPresetKey"
  | "handleListWindowPresetChange"
  | "listReverse"
  | "handleListBaseDateChange"
  | "handleListPrevDay"
  | "handleListNextDay"
  | "handleListPrevWeek"
  | "handleListNextWeek"
  | "handleListToday"
  | "monthAnchorDate"
  | "handleMonthPrev"
  | "handleMonthNext"
  | "handleMonthToday"
  | "handleViewModeChange"
  | "openTimelineDay"
>;

export function useDesktopTimelineMainPanelViewModel(args: DesktopMainArgs) {
  const availableKeys = useMemo(() => ["timeline", "list", "month"] as const, []);
  const activeKey = args.viewMode;
  const fallbackKey = args.viewMode;
  const openTimelineDay = args.openTimelineDay;
  const listState = useDesktopListState({
    listBaseDate: args.listBaseDate,
    fallbackBaseDate: args.days[0]?.isoDate ?? "",
  });

  const openMonthDayTimeline = useCallback(
    (isoDate: string) => {
      openTimelineDay(isoDate);
    },
    [openTimelineDay],
  );

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
    ],
  );

  const timelineBody = useMemo<DesktopTimelineViewProps>(
    () => ({
      days: args.days,
      anchorDayIso: args.anchorDayIso,
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
      eventsByDay: args.eventsByDay,
      abBuckets: args.abBuckets,
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
      currentIsoDate: args.liveNowIsoDate,
      currentMinutes: args.liveNowMinutes,
      onAnchorDayChange: args.onTimelineAnchorChange,
      onWindowStateChange: args.onTimelineWindowStateChange,
    }),
    [
      args.abBuckets,
      args.activeCardId,
      args.activeDayIndex,
      args.activeDrag,
      args.activeLaneId,
      args.activeResize,
      args.anchorDayIso,
      args.bucketIndicator,
      args.calendarAllDayEventsByDay,
      args.calendarEventsByDay,
      args.contextMenuCardId,
      args.days,
      args.debouncedHandleScroll,
      args.effectiveDayRange,
      args.eventsByDay,
      args.handleBucketClick,
      args.handleBucketCreateRequest,
      args.handleCardContextMenu,
      args.handleCardContextMenuByKeyboard,
      args.handleColumnClick,
      args.handleDragCancel,
      args.handleDragEnd,
      args.handleDragMove,
      args.handleDragStart,
      args.handleEventKeyDown,
      args.handleExternalEventClick,
      args.handleResizeEnd,
      args.handleResizeMove,
      args.handleResizeStart,
      args.handleTimelineViewMount,
      args.handleToggleCardChecked,
      args.indicatorTop,
      args.liveNowIsoDate,
      args.liveNowMinutes,
      args.onActivateCard,
      args.onClearSelection,
      args.onPendingTitleEditConsumed,
      args.onShiftSelect,
      args.onTimelineAnchorChange,
      args.onTimelineWindowStateChange,
      args.openCardModal,
      args.pendingTitleEditCardId,
      args.pointerPreview,
      args.registerAbScrollContainer,
      args.selectedCardIds,
      args.selectionLeadCardId,
      args.sensors,
      args.status,
      args.timelineHeaderHeight,
      args.timelineHeaderRef,
      args.timelineScrollRefDesktop,
      args.timelineStartHour,
      args.timelineViewportHeight,
    ],
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
      args.abBuckets,
      args.calendarAllDayEventsByDay,
      args.calendarEventsByDay,
      args.days,
      args.eventsByDay,
      args.handleCardContextMenu,
      args.handleExternalEventClick,
      args.handleToggleCardChecked,
      args.listReverse,
      args.openCardModal,
      args.overdue,
      args.status,
      listState.showChecked,
      listState.showGoogle,
      listState.showUnchecked,
    ],
  );

  const monthToolbar: DesktopMonthToolbarProps = {
    monthAnchorDate: args.monthAnchorDate,
    onPrevMonth: args.handleMonthPrev,
    onNextMonth: args.handleMonthNext,
    onToday: args.handleMonthToday,
  };

  const monthBody = useMemo<DesktopMonthViewProps>(
    () => ({
      days: args.days,
      eventsByDay: args.eventsByDay,
      abBuckets: args.abBuckets,
      monthAnchorDate: args.monthAnchorDate,
      openCardModal: args.openCardModal,
      onToggleCheck: args.handleToggleCardChecked,
      onRenameCardTitle: args.handleRenameCardTitle,
      onCardContextMenu: args.handleCardContextMenu,
      onOpenDayTimeline: openMonthDayTimeline,
      status: args.status,
    }),
    [
      args.abBuckets,
      args.days,
      args.eventsByDay,
      args.handleCardContextMenu,
      args.handleRenameCardTitle,
      args.handleToggleCardChecked,
      args.monthAnchorDate,
      args.openCardModal,
      args.status,
      openMonthDayTimeline,
    ],
  );

  return {
    tabs: {
      items: [
        { key: "timeline" as const, label: "Timeline" },
        { key: "list" as const, label: "List" },
        { key: "month" as const, label: "Month" },
      ],
      activeKey,
      availableKeys,
      fallbackKey,
      onChange: args.handleViewModeChange,
    },
    views: {
      timeline: { toolbar: timelineToolbar, body: timelineBody },
      list: { toolbar: listToolbar, body: listBody },
      month: { toolbar: monthToolbar, body: monthBody },
    },
  };
}
