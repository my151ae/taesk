"use client";

import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DaySection } from "@/app/(board)/_components/timeline/DaySection";
import { handleTimelineCardArrowFocus } from "@/app/(board)/_components/timeline/timeline-focus-navigation";
import type {
  ActiveDragState,
  ActiveResizeState,
  PointerPreviewState,
  useTimelineDragAndDrop,
} from "@/app/(board)/_hooks/useTimelineDragAndDrop";
import {
  type TimelineBucketItem,
  type TimelineDay,
  type TimelineEvent,
  type ExternalCalendarEntry,
  type StackedTimelineItemKind,
  minuteToPixels,
  pixelsToMinutes,
  getTimelineHeight,
} from "@/app/(board)/_utils/timeline-helpers";
import {
  useTimelineZoomStore,
  MIN_HOUR_HEIGHT,
  MAX_HOUR_HEIGHT,
  ZOOM_STEP,
} from "@/app/(board)/_stores/timeline-zoom-store";
import {
  buildDesktopAllDayState,
  formatAllDayRange,
  formatAllDayInlineLabel,
} from "@/app/(board)/_components/timeline/timeline-render-model";
import {
  ANCHOR_SWITCH_THRESHOLD,
  type DesktopTimelineWindowState,
  resolveDesktopTimelineAnchorIso,
  resolveDesktopTimelineWindowMetrics,
  resolveDesktopTimelineWindowState,
} from "@/app/(board)/_components/timeline/desktopTimelineWindowing";
import { ToolbarMenuSelect } from "@/app/(board)/_components/timeline/ToolbarMenuSelect";
import type { BucketCreateRequest } from "@/app/(board)/_components/timeline/bucket-create-request";

const ALL_DAY_ROW_HEIGHT = 24;

// EMPTY配列の参照を安定化（memo効率化）
const EMPTY_EVENTS: readonly TimelineEvent[] = Object.freeze([]);
const EMPTY_BUCKET: readonly TimelineBucketItem[] = Object.freeze([]);

type DragAndDropBindings = ReturnType<typeof useTimelineDragAndDrop>;

export type DesktopTimelineViewProps = {
  timelineHeaderRef: React.RefObject<HTMLDivElement>;
  timelineScrollRef: React.RefObject<HTMLDivElement>;
  registerAbScrollContainer?: (dayIso: string, el: HTMLDivElement | null, bucket?: 'a' | 'b') => void;
  days: TimelineDay[];
  anchorDayIso: string;
  activeDayIndex: number;
  dayRange: number;
  status: string;
  eventsByDay: Record<string, TimelineEvent[]>;
  abBuckets: Record<string, TimelineBucketItem[]>;
  indicatorTop: number | null;
  indicatorDayIso: string | null;
  timelineViewportHeight: number;
  activeDrag: ActiveDragState | null;
  pointerPreview: PointerPreviewState;
  activeResize: ActiveResizeState | null;
  bucketIndicator: DragAndDropBindings["bucketIndicator"];
  openCardModal: (shortId: string | null, source: string) => void;
  handleEventKeyDown: (event: TimelineEvent, native: React.KeyboardEvent<HTMLElement>) => void;
  handleColumnClick: (day: TimelineDay, minutes: number) => void;
  onCreateBucketCard: (bucketKey: string, afterCardId?: string) => void;
  onRequestCreateBucketCard: (request: BucketCreateRequest) => void;
  handleResizeStart: (e: React.PointerEvent, cardId: string, startMinutes: number, duration: number, edge: "top" | "bottom") => void;
  handleResizeMove: (e: React.PointerEvent) => void;
  handleResizeEnd: (e: React.PointerEvent) => void;
  onToggleCheck: (cardId: string, checked: boolean) => void;
  onRenameCardTitle?: (cardId: string, nextTitle: string) => Promise<boolean>;
  sensors: DragAndDropBindings["sensors"];
  handleDragStart: DragAndDropBindings["handleDragStart"];
  handleDragMove: DragAndDropBindings["handleDragMove"];
  handleDragEnd: DragAndDropBindings["handleDragEnd"];
  handleDragCancel: DragAndDropBindings["handleDragCancel"];
  floatingLayerTop: number;
  calendarEventsByDay: Record<string, ExternalCalendarEntry[]>;
  calendarAllDayByDay: Record<string, ExternalCalendarEntry[]>;
  onExternalEventClick?: (entry: ExternalCalendarEntry) => void;
  onScroll?: (scrollTop: number) => void;
  onMount?: () => void;
  timelineStartHour?: number;
  onCardContextMenu: (e: React.MouseEvent, cardId: string) => void;
  onCardContextMenuByKeyboard: (cardId: string, rect: DOMRect) => void;
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
  currentIsoDate: string | null;
  currentMinutes: number | null;
  onAnchorDayChange?: (isoDate: string) => void;
  onWindowStateChange?: (state: DesktopTimelineWindowState) => void;
};

export type DesktopTimelineToolbarProps = {
  status: string;
  dayRange: number;
  onDayRangeChange: (days: number) => void;
  onPrevDay: () => void;
  onNextDay: () => void;
  onPrevDayRange: () => void;
  onNextDayRange: () => void;
  onToday: () => void;
};

export function DesktopTimelineToolbar({
  status,
  dayRange,
  onDayRangeChange,
  onPrevDay,
  onNextDay,
  onPrevDayRange,
  onNextDayRange,
  onToday,
}: DesktopTimelineToolbarProps) {
  const dayRangeOptions = useMemo(
    () =>
      [1, 2, 3, 4, 5, 6, 7].map((days) => ({
        value: String(days),
        label: `${days} day${days > 1 ? "s" : ""}`,
      })),
    []
  );
  const buttonClassName =
    "inline-flex h-6 shrink-0 items-center rounded-full border border-slate-200 bg-white px-2.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40";
  const todayButtonClassName =
    "inline-flex h-6 shrink-0 items-center rounded-full border border-sky-300 bg-sky-200 px-2.5 text-[11px] font-medium text-sky-800 hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="border-b border-slate-100 bg-white px-3">
      <div className="flex h-8 items-center gap-2 overflow-x-auto">
        <button type="button" onClick={onPrevDayRange} disabled={status === "loading"} data-testid="timeline-toolbar-prev-range" data-focus-group="toolbar" data-focus-part="control" className={buttonClassName}>
          {"<<"}
        </button>
        <button type="button" onClick={onPrevDay} disabled={status === "loading"} data-testid="timeline-toolbar-prev-day" data-focus-group="toolbar" data-focus-part="control" className={buttonClassName}>
          {"<1"}
        </button>
        <button type="button" onClick={onToday} disabled={status === "loading"} data-testid="timeline-toolbar-today" data-focus-group="toolbar" data-focus-part="control" className={todayButtonClassName}>
          Today
        </button>
        <button type="button" onClick={onNextDay} disabled={status === "loading"} data-testid="timeline-toolbar-next-day" data-focus-group="toolbar" data-focus-part="control" className={buttonClassName}>
          {"1>"}
        </button>
        <button type="button" onClick={onNextDayRange} disabled={status === "loading"} data-testid="timeline-toolbar-next-range" data-focus-group="toolbar" data-focus-part="control" className={buttonClassName}>
          {">>"}
        </button>
        <div className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-white px-2 text-[11px] text-slate-700">
          <button
            type="button"
            onClick={() => onDayRangeChange(Math.max(1, dayRange - 1))}
            disabled={status === "loading" || dayRange <= 1}
            data-testid="timeline-toolbar-range-minus"
            data-focus-group="toolbar"
            data-focus-part="control"
            className="flex h-4 w-4 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="表示日数を減らす"
          >
            -
          </button>
          <ToolbarMenuSelect
            value={String(dayRange)}
            options={dayRangeOptions}
            onChange={(nextValue) => onDayRangeChange(Number(nextValue))}
            disabled={status === "loading"}
            ariaLabel="表示日数"
            buttonTestId="timeline-toolbar-range-select"
            className="h-full border-0 bg-transparent px-1 text-center text-xs font-medium shadow-none hover:bg-transparent"
            menuClassName="min-w-[7rem]"
          />
          <button
            type="button"
            onClick={() => onDayRangeChange(Math.min(7, dayRange + 1))}
            disabled={status === "loading" || dayRange >= 7}
            data-testid="timeline-toolbar-range-plus"
            data-focus-group="toolbar"
            data-focus-part="control"
            className="flex h-4 w-4 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="表示日数を増やす"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}

export function DesktopTimelineView({
  onMount,
  timelineHeaderRef,
  timelineScrollRef,
  registerAbScrollContainer,
  days,
  anchorDayIso,
  activeDayIndex,
  dayRange,
  status,
  eventsByDay,
  abBuckets,
  indicatorTop,
  indicatorDayIso,
  timelineViewportHeight,
  activeDrag,
  pointerPreview,
  activeResize,
  bucketIndicator,
  openCardModal,
  handleEventKeyDown,
  handleColumnClick,
  onCreateBucketCard,
  onRequestCreateBucketCard,
  handleResizeStart,
  handleResizeMove,
  handleResizeEnd,
  onToggleCheck,
  onRenameCardTitle,
  sensors,
  handleDragStart,
  handleDragMove,
  handleDragEnd,
  handleDragCancel,
  floatingLayerTop,
  calendarEventsByDay,
  calendarAllDayByDay,
  onExternalEventClick,
  onScroll,
  timelineStartHour = 0,
  onCardContextMenu,
  onCardContextMenuByKeyboard,
  contextMenuCardId,
  selectedCardIds,
  selectionLeadCardId,
  onShiftSelect,
  onClearSelection,
  onActivateCard,
  activeCardId,
  activeLaneId,
  pendingTitleEditCardId,
  onPendingTitleEditConsumed,
  currentIsoDate,
  currentMinutes,
  onAnchorDayChange,
  onWindowStateChange,
}: DesktopTimelineViewProps) {
  const handleArrowKeyFocus = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    handleTimelineCardArrowFocus(event);
  }, []);
  const horizontalScrollRef = useRef<HTMLDivElement | null>(null);
  const scrollSyncSourceRef = useRef<"external" | "user" | null>(null);
  const programmaticHorizontalScrollRef = useRef(false);
  const lastEmittedAnchorRef = useRef<string | null>(null);
  const pendingAnchorSyncRafRef = useRef<number | null>(null);
  const pendingExternalSettleRafRef = useRef<number | null>(null);
  const isSettlingScrollRef = useRef(false);
  const lastProgrammaticTargetLeftRef = useRef<number | null>(null);
  const lastWindowStateSignatureRef = useRef<string | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [abViewportHeight, setAbViewportHeight] = useState(0);

  // Zoom State
  const hourHeight = useTimelineZoomStore((state) => state.hourHeight);
  const setHourHeight = useTimelineZoomStore((state) => state.setHourHeight);
  const safeViewportWidth = viewportWidth > 0 ? viewportWidth : 1200;
  const columnWidth = safeViewportWidth / Math.max(1, dayRange);
  const windowMetrics = useMemo(
    () =>
      resolveDesktopTimelineWindowMetrics({
        scrollLeft,
        viewportWidth,
        columnWidth,
        loadedDayCount: days.length,
        dayRange,
        isInteractionActive: Boolean(activeDrag || activeResize),
      }),
    [activeDrag, activeResize, columnWidth, dayRange, days.length, scrollLeft, viewportWidth],
  );
  const { renderStartIndex, renderEndIndex, leftSpacerWidth, rightSpacerWidth, totalStripWidth } = windowMetrics;
  const renderDays = useMemo(() => days.slice(renderStartIndex, renderEndIndex), [days, renderEndIndex, renderStartIndex]);
  const desktopGridTemplateColumns = useMemo(
    () => `repeat(${renderDays.length}, minmax(${columnWidth}px, ${columnWidth}px))`,
    [columnWidth, renderDays.length],
  );
  const visibleDayColumns = useMemo(
    () => renderDays.map((day) => ({ kind: "day" as const, key: day.key, day })),
    [renderDays],
  );

  // Zoom Interaction: Ctrl + Wheel
  useEffect(() => {
    const container = timelineScrollRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();

      const rect = container.getBoundingClientRect();
      const mouseY = e.clientY - rect.top;
      const scrollTop = container.scrollTop;

      // 1. Calculate time at mouse position (Anchor)
      const anchorMinutes = pixelsToMinutes(scrollTop + mouseY, timelineStartHour, hourHeight);

      // 2. Determine new height
      // e.deltaY < 0 means scrolling UP (zoom in)
      const direction = e.deltaY < 0 ? 1 : -1;
      const nextRaw = hourHeight + direction * ZOOM_STEP;
      const nextHeight = Math.max(MIN_HOUR_HEIGHT, Math.min(MAX_HOUR_HEIGHT, nextRaw));

      if (nextHeight === hourHeight) return;

      // 3. Apply new height
      setHourHeight(nextHeight);

      // 4. Adjust scroll to keep anchor time at same visual position
      // newPixelPos = newScrollTop + mouseY
      // newScrollTop = newPixelPos - mouseY
      // newPixelPos = minuteToPixels(anchorMinutes, ...)
      const newTotalPos = minuteToPixels(anchorMinutes, timelineStartHour, nextHeight);
      const newScrollTop = newTotalPos - mouseY;

      container.scrollTop = newScrollTop;
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, [timelineScrollRef, hourHeight, setHourHeight, timelineStartHour]);

  // Ghost card state for Timeline
  const [selectedSlot, setSelectedSlot] = useState<{ day: string; minutes: number } | null>(null);
  const [activeStackItem, setActiveStackItem] = useState<{ kind: StackedTimelineItemKind; id: string } | null>(null);

  useEffect(() => {
    const handleGlobalClick = () => setSelectedSlot(null);
    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, []);

  useEffect(() => {
    if (selectedSlot) {
      setActiveStackItem(null);
    }
  }, [selectedSlot]);

  useEffect(() => {
    setActiveStackItem(null);
  }, [anchorDayIso, dayRange, days.length]);

  useEffect(() => {
    if (contextMenuCardId) {
      setActiveStackItem({ kind: "card", id: contextMenuCardId });
    }
  }, [contextMenuCardId]);

  useEffect(() => {
    if (!selectionLeadCardId) return;
    setActiveStackItem((current) => {
      if (current?.kind === "card" && current.id === selectionLeadCardId) {
        return current;
      }
      return { kind: "card", id: selectionLeadCardId };
    });
  }, [selectionLeadCardId]);

  useEffect(() => {
    if (!activeCardId) return;
    setActiveStackItem((current) => {
      if (current?.kind === "card" && current.id === activeCardId) {
        return current;
      }
      return { kind: "card", id: activeCardId };
    });
  }, [activeCardId]);

  useEffect(() => {
    const el = timelineScrollRef.current;
    if (!el) return;

    const update = () => setAbViewportHeight(el.clientHeight);
    update();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [timelineScrollRef]);

  const activeDragCardId = activeDrag?.cardId ?? null;

  const { hasAllDayEvents, allDayLayout, allDayMinHeight } = useMemo(
    () =>
      buildDesktopAllDayState({
        renderColumns: visibleDayColumns,
        calendarAllDayByDay,
        rowHeight: ALL_DAY_ROW_HEIGHT,
        rowGap: 4,
        minHeight: 34,
      }),
    [calendarAllDayByDay, visibleDayColumns]
  );

  useEffect(() => {
    onMount?.();
  }, [onMount]);

  useEffect(() => {
    const container = horizontalScrollRef.current;
    if (!container) return;

    const update = () => {
      setViewportWidth(container.clientWidth);
      setScrollLeft(container.scrollLeft);
    };

    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => {
      if (pendingAnchorSyncRafRef.current != null) {
        window.cancelAnimationFrame(pendingAnchorSyncRafRef.current);
      }
      if (pendingExternalSettleRafRef.current != null) {
        window.cancelAnimationFrame(pendingExternalSettleRafRef.current);
      }
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const container = horizontalScrollRef.current;
    if (!container || columnWidth <= 0) return;
    const anchorIndex = days.findIndex((day) => day.isoDate === anchorDayIso);
    if (anchorIndex < 0) return;
    const targetLeft = anchorIndex * columnWidth;
    if (Math.abs(container.scrollLeft - targetLeft) < 1) return;
    if (lastProgrammaticTargetLeftRef.current === targetLeft) return;
    lastProgrammaticTargetLeftRef.current = targetLeft;
    lastEmittedAnchorRef.current = anchorDayIso;
    scrollSyncSourceRef.current = "external";
    isSettlingScrollRef.current = true;
    programmaticHorizontalScrollRef.current = true;
    container.scrollTo({ left: targetLeft, behavior: "auto" });
    if (pendingExternalSettleRafRef.current != null) {
      window.cancelAnimationFrame(pendingExternalSettleRafRef.current);
    }
    pendingExternalSettleRafRef.current = window.requestAnimationFrame(() => {
      pendingExternalSettleRafRef.current = window.requestAnimationFrame(() => {
        setScrollLeft(container.scrollLeft);
        scrollSyncSourceRef.current = null;
        isSettlingScrollRef.current = false;
        programmaticHorizontalScrollRef.current = false;
        pendingExternalSettleRafRef.current = null;
      });
    });
    return () => {
      if (pendingExternalSettleRafRef.current != null) {
        window.cancelAnimationFrame(pendingExternalSettleRafRef.current);
      }
      programmaticHorizontalScrollRef.current = false;
      isSettlingScrollRef.current = false;
      scrollSyncSourceRef.current = null;
    };
  }, [anchorDayIso, columnWidth, days]);

  useEffect(() => {
    const nextWindowState = resolveDesktopTimelineWindowState({
      anchorDayIso,
      loadedDays: days,
    });
    const signature = JSON.stringify(nextWindowState);
    if (signature === lastWindowStateSignatureRef.current) return;
    lastWindowStateSignatureRef.current = signature;
    onWindowStateChange?.(nextWindowState);
  }, [anchorDayIso, days, onWindowStateChange]);

  useEffect(() => {
    return () => {
      if (pendingAnchorSyncRafRef.current != null) {
        window.cancelAnimationFrame(pendingAnchorSyncRafRef.current);
      }
      if (pendingExternalSettleRafRef.current != null) {
        window.cancelAnimationFrame(pendingExternalSettleRafRef.current);
      }
    };
  }, []);

  const scheduleAnchorEmit = useCallback(
    (nextScrollLeft: number) => {
      if (pendingAnchorSyncRafRef.current != null) {
        window.cancelAnimationFrame(pendingAnchorSyncRafRef.current);
      }
      pendingAnchorSyncRafRef.current = window.requestAnimationFrame(() => {
        pendingAnchorSyncRafRef.current = null;
        if (scrollSyncSourceRef.current !== "user") return;
        if (isSettlingScrollRef.current) return;
        const nextAnchor = resolveDesktopTimelineAnchorIso({
          scrollLeft: nextScrollLeft,
          columnWidth,
          loadedDays: days,
          threshold: ANCHOR_SWITCH_THRESHOLD,
        });
        if (!nextAnchor) return;
        if (nextAnchor === anchorDayIso) return;
        if (lastEmittedAnchorRef.current === nextAnchor) return;
        lastEmittedAnchorRef.current = nextAnchor;
        onAnchorDayChange?.(nextAnchor);
      });
    },
    [anchorDayIso, columnWidth, days, onAnchorDayChange],
  );

  useEffect(() => {
    if (!days.length) return;
    if (lastEmittedAnchorRef.current !== anchorDayIso) {
      lastEmittedAnchorRef.current = anchorDayIso;
    }
  }, [anchorDayIso, days.length]);

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-white"
      onKeyDownCapture={handleArrowKeyFocus}
    >
      <div
        ref={horizontalScrollRef}
        className="flex min-h-0 flex-1 flex-col overflow-x-auto overflow-y-hidden scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-200"
        onScroll={(event) => {
          const nextScrollLeft = event.currentTarget.scrollLeft;
          if (!programmaticHorizontalScrollRef.current) {
            scrollSyncSourceRef.current = "user";
            lastProgrammaticTargetLeftRef.current = null;
          }
          setScrollLeft(nextScrollLeft);
          if (scrollSyncSourceRef.current === "user") {
            scheduleAnchorEmit(nextScrollLeft);
          }
        }}
      >
          <div ref={timelineHeaderRef} className="z-30" style={{ width: totalStripWidth }}>
              <div
                className="flex h-8 border-b border-slate-100 bg-white text-xs font-semibold tracking-wide text-slate-500 pr-[14px]"
                style={{ width: totalStripWidth }}
              >
                <div style={{ width: leftSpacerWidth, flexShrink: 0 }} />
                <div
                  className="grid"
                  style={{
                    gridTemplateColumns: desktopGridTemplateColumns,
                  }}
                >
                {renderDays.map((day, index) => {
                  const isToday = day.label.startsWith("Today ");
                  const headerLabel = day.label;

                  return (
                    <div
                      key={day.key}
                      className={clsx(
                        "relative flex h-full min-w-0 items-center justify-center px-3 text-center",
                        index > 0 ? "border-l border-slate-100" : ""
                      )}
                      style={{ width: columnWidth }}
                    >
                      <div className="flex min-w-0 items-center justify-center gap-1.5 leading-tight">
                        <span
                          className={clsx(
                            "inline-flex max-w-full items-center justify-center truncate rounded-full px-2 py-0.5 text-xs font-semibold",
                            isToday
                              ? "bg-sky-200 text-sky-800 shadow-[inset_0_0_0_1px_rgba(125,211,252,0.7)]"
                              : "text-slate-800"
                          )}
                        >
                          {headerLabel}
                        </span>
                      </div>
                    </div>
                  );
                })}
                </div>
                <div style={{ width: rightSpacerWidth, flexShrink: 0 }} />
              </div>

              {hasAllDayEvents && (
                <div
                  className="flex border-b border-emerald-100/70 bg-emerald-50/60 text-[11px] font-semibold text-emerald-800 pr-[14px]"
                  style={{
                    width: totalStripWidth,
                  }}
                >
                  <div style={{ width: leftSpacerWidth, flexShrink: 0 }} />
                  <div
                    className="grid px-2 py-1.5"
                    style={{
                      gridTemplateColumns: desktopGridTemplateColumns,
                      gridTemplateRows: `repeat(${Math.max(allDayLayout.rows, 1)}, ${ALL_DAY_ROW_HEIGHT}px)`,
                      rowGap: "4px",
                      minHeight: allDayMinHeight,
                    }}
                  >
                    {allDayLayout.segments.map((item) => {
                      const rangeLabel = formatAllDayRange({ segment: item, visibleDays: renderDays });
                      const inlineLabel = formatAllDayInlineLabel({
                        title: item.title,
                        rangeLabel,
                      });
                      return (
                        <button
                          key={`${item.id}-${item.start}-${item.end}`}
                          type="button"
                          data-focus-group="timeline"
                          data-focus-part="card"
                          disabled={!onExternalEventClick}
                          onClick={() => onExternalEventClick?.(item.entry)}
                          className="flex h-6 min-w-0 items-center gap-2 overflow-hidden rounded-md border border-emerald-200 bg-white/90 px-2.5 text-left text-[11px] font-semibold text-emerald-800 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-400 hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 disabled:cursor-default disabled:opacity-80"
                          style={{
                            gridColumn: `${item.startColumn + 1} / span ${item.endColumn - item.startColumn + 1}`,
                            gridRow: `${item.row + 1}`,
                          }}
                          title={inlineLabel}
                        >
                          <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase leading-tight tracking-wide text-emerald-700">
                            G
                          </span>
                          <span className="min-w-0 truncate">{inlineLabel}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ width: rightSpacerWidth, flexShrink: 0 }} />
                </div>
              )}
          </div>

          <div
            ref={timelineScrollRef}
            onScroll={(e) => onScroll?.(e.currentTarget.scrollTop)}
            className="relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-200 [scrollbar-gutter:stable]"
            style={{ width: totalStripWidth }}
          >
            <div className="relative" style={{ minHeight: timelineViewportHeight, width: totalStripWidth }}>
              {!days.length && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/50 backdrop-blur-sm">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-sky-500" />
                </div>
              )}

              <div className="flex timeline-container" data-testid="timeline-grid" style={{ width: totalStripWidth }}>
                <div style={{ width: leftSpacerWidth, flexShrink: 0 }} />
                <div
                  className="grid"
                  style={{
                    gridTemplateColumns: desktopGridTemplateColumns,
                  }}
                >
                {renderDays.map((day, dayIndex) => {
                  return (
                    <DaySection
                      key={day.isoDate}
                      day={day}
                      index={renderStartIndex + dayIndex}
                      events={eventsByDay[day.isoDate] ?? EMPTY_EVENTS}
                      indicatorTop={indicatorTop}
                      indicatorDayIso={indicatorDayIso}
                      timelineViewportHeight={timelineViewportHeight}
                      activeDragCardId={activeDrag?.cardId ?? null}
                      pointerPreview={pointerPreview}
                      activeResize={activeResize}
                      selectedSlot={selectedSlot}
                      handleEventKeyDown={handleEventKeyDown}
                      handleColumnClick={handleColumnClick}
                      handleResizeStart={handleResizeStart}
                      handleResizeMove={handleResizeMove}
                      handleResizeEnd={handleResizeEnd}
                      setSelectedSlot={setSelectedSlot}
                      calendarEvents={calendarEventsByDay?.[day.isoDate] ?? []}
                      onExternalEventClick={onExternalEventClick}
                      timelineStartHour={timelineStartHour}
                      bucketsA={abBuckets[`${day.key}_a`] ?? EMPTY_BUCKET}
                      bucketsB={abBuckets[`${day.key}_b`] ?? EMPTY_BUCKET}
                      bucketIndicator={bucketIndicator}
                      onCreateBucketCard={onCreateBucketCard}
                      onRequestCreateBucketCard={onRequestCreateBucketCard}
                      viewportHeight={abViewportHeight}
                      registerAbScrollContainer={registerAbScrollContainer}
                      floatingLayerTop={floatingLayerTop}
                      status={status}
                      openCardModal={openCardModal}
                      onToggleCheck={onToggleCheck}
                      onRenameCardTitle={onRenameCardTitle}
                      onCardContextMenu={onCardContextMenu}
                      onCardContextMenuByKeyboard={onCardContextMenuByKeyboard}
                      contextMenuCardId={contextMenuCardId}
                      hourHeight={hourHeight}
                      activeStackItem={activeStackItem}
                      setActiveStackItem={setActiveStackItem}
                      selectedCardIds={selectedCardIds}
                      selectionLeadCardId={selectionLeadCardId}
                      onShiftSelect={onShiftSelect}
                      onClearSelection={onClearSelection}
                      onActivateCard={onActivateCard}
                      activeCardId={activeCardId}
                      activeLaneId={activeLaneId}
                      pendingTitleEditCardId={pendingTitleEditCardId}
                      onPendingTitleEditConsumed={onPendingTitleEditConsumed}
                      currentIsoDate={currentIsoDate}
                      currentMinutes={currentMinutes}
                    />
                  );
                })}
                </div>
                <div style={{ width: rightSpacerWidth, flexShrink: 0 }} />
              </div>
            </div>
          </div>
      </div>
    </div>
  );
}
