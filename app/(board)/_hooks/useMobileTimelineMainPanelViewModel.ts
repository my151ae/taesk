"use client";

import type { UseTimelineBoardViewModelsArgs } from "@/app/(board)/_hooks/useTimelineBoardViewModels";
import { useDesktopListState } from "@/app/(board)/_hooks/useDesktopListState";

type MobileMainArgs = Pick<
  UseTimelineBoardViewModelsArgs,
  | "timelineScrollRefMobile"
  | "days"
  | "activeDayIndex"
  | "anchorDayIso"
  | "setMobileAnchorTimelineScrollNode"
  | "debouncedHandleAnchorScroll"
  | "goToDay"
  | "handlePrevDay"
  | "handleNextDay"
  | "handleTimelineViewMount"
  | "debouncedHandleScroll"
  | "registerAbScrollContainer"
  | "eventsByDay"
  | "abBuckets"
  | "overdue"
  | "calendarEventsByDay"
  | "calendarAllDayEventsByDay"
  | "indicatorTop"
  | "liveNowIsoDate"
  | "timelineViewportHeight"
  | "openCardModal"
  | "handleBucketClick"
  | "handleBucketCreateRequest"
  | "handleToggleCardChecked"
  | "status"
  | "activeDrag"
  | "sensors"
  | "handleDragStart"
  | "handleDragMove"
  | "handleDragEnd"
  | "handleDragCancel"
  | "bucketIndicator"
  | "isOverABList"
  | "pointerPreview"
  | "handleExternalEventClick"
  | "timelineStartHour"
  | "handleCardContextMenu"
  | "handleCardContextMenuByKeyboard"
  | "contextMenuCardId"
  | "liveNowMinutes"
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
  | "openTimelineDay"
>;

export function useMobileTimelineMainPanelViewModel(args: MobileMainArgs) {
  const listState = useDesktopListState({
    listBaseDate: args.listBaseDate,
    fallbackBaseDate: args.days[0]?.isoDate ?? "",
  });

  return {
    timeline: {
      timelineScrollRef: args.timelineScrollRefMobile,
      days: args.days,
      activeDayIndex: args.activeDayIndex,
      anchorDayIso: args.anchorDayIso,
      setAnchorTimelineScrollNode: args.setMobileAnchorTimelineScrollNode,
      onAnchorTimelineScroll: args.debouncedHandleAnchorScroll,
      onAnchorDayChange: args.goToDay,
      onPrevDay: args.handlePrevDay,
      onNextDay: args.handleNextDay,
      onMount: args.handleTimelineViewMount,
      onScroll: args.debouncedHandleScroll,
      registerAbScrollContainer: args.registerAbScrollContainer,
      eventsByDay: args.eventsByDay,
      abBuckets: args.abBuckets,
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
      currentIsoDate: args.liveNowIsoDate,
      currentMinutes: args.liveNowMinutes,
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
    month: {
      days: args.days,
      eventsByDay: args.eventsByDay,
      abBuckets: args.abBuckets,
      monthAnchorDate: args.monthAnchorDate,
      openCardModal: args.openCardModal,
      onToggleCheck: args.handleToggleCardChecked,
      onCardContextMenu: args.handleCardContextMenu,
      onOpenDayTimeline: args.openTimelineDay,
      onPrevMonth: args.handleMonthPrev,
      onNextMonth: args.handleMonthNext,
      onToday: args.handleMonthToday,
      status: args.status,
    },
  };
}
