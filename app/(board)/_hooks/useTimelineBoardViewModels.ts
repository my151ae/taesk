"use client";

import { useMemo } from "react";
import type {
  KeyboardEvent,
  MouseEvent,
  PointerEvent,
  RefObject,
} from "react";

import type { ExternalCalendarEntry, TimelineBucketItem, TimelineDay, TimelineEvent, TimelineOverdueItem } from "@/app/(board)/_utils/timeline-helpers";
import type { TimelineSearchResultItem } from "@/app/(board)/_hooks/useTimelineFiltering";
import type { ActiveDragState, ActiveResizeState, BucketIndicator, PointerPreviewState } from "@/app/(board)/_hooks/useTimelineDragAndDrop";
import type { useTimelineDragAndDrop } from "@/app/(board)/_hooks/useTimelineDragAndDrop";
import type { ListWindowPresetKey } from "@/app/(board)/_hooks/useTimelineUrlState";

type DragAndDropBindings = ReturnType<typeof useTimelineDragAndDrop>;

type UseTimelineBoardViewModelsArgs = {
  days: TimelineDay[];
  activeDayIndex: number;
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
  eventsByDay: Record<string, TimelineEvent[]>;
  abBuckets: Record<string, TimelineBucketItem[]>;
  overdue: TimelineOverdueItem[];
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  searchResults: TimelineSearchResultItem[];
  indicatorTop: number | null;
  liveNowIsoDate: string | null;
  timelineViewportHeight: number;
  activeDrag: ActiveDragState | null;
  pointerPreview: PointerPreviewState;
  bucketIndicator: BucketIndicator | null;
  handleEventKeyDown: (event: TimelineEvent, native: KeyboardEvent<HTMLElement>) => void;
  handleColumnClick: (day: TimelineDay, minutes: number) => void;
  handleBucketClick: (bucketKey: string, afterCardId?: string) => void;
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
};

export function useTimelineBoardViewModels(args: UseTimelineBoardViewModelsArgs) {
  const timelineViewModel = useMemo(
    () => ({
      desktop: {
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
        handlePrevDay: args.handlePrevDay,
        handleNextDay: args.handleNextDay,
        handlePrevDayRange: args.handlePrevDayRange,
        handleNextDayRange: args.handleNextDayRange,
        eventsByDay: args.eventsByDay,
        abBuckets: args.abBuckets,
        overdue: args.overdue,
        searchQuery: args.searchQuery,
        onSearchQueryChange: args.setSearchQuery,
        searchResults: args.searchResults,
        indicatorTop: args.indicatorTop,
        indicatorDayIso: args.liveNowIsoDate,
        timelineViewportHeight: args.timelineViewportHeight,
        activeDrag: args.activeDrag,
        pointerPreview: args.pointerPreview,
        bucketIndicator: args.bucketIndicator,
        handleEventKeyDown: args.handleEventKeyDown,
        handleColumnClick: args.handleColumnClick,
        onCreateBucketCard: args.handleBucketClick,
        sensors: args.sensors,
        handleDragStart: args.handleDragStart,
        handleDragMove: args.handleDragMove,
        handleDragEnd: args.handleDragEnd,
        handleDragCancel: args.handleDragCancel,
        isOverABList: args.isOverABList,
        floatingLayerTop: args.timelineHeaderHeight,
        calendarAllDayByDay: args.calendarAllDayEventsByDay,
        onCardContextMenu: args.handleCardContextMenu,
        onCardContextMenuByKeyboard: args.handleCardContextMenuByKeyboard,
        contextMenuCardId: args.contextMenuCardId,
      },
      mobile: {
        timelineScrollRef: args.timelineScrollRefMobile,
        days: args.days,
        activeDayIndex: args.activeDayIndex,
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
    }),
    [args]
  );

  const listViewModel = useMemo(
    () => ({
      desktop: {
        days: args.days,
        eventsByDay: args.eventsByDay,
        abBuckets: args.abBuckets,
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
        onToday: args.handleListToday,
        listBaseDate: args.listBaseDate,
        listWindowPresetKey: args.listWindowPresetKey,
        onListWindowPresetChange: args.handleListWindowPresetChange,
        listReverse: args.listReverse,
        onListBaseDateChange: args.handleListBaseDateChange,
      },
      mobile: {
        days: args.days,
        eventsByDay: args.eventsByDay,
        abBuckets: args.abBuckets,
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
      },
    }),
    [args]
  );

  return {
    timelineViewModel,
    listViewModel,
  };
}
