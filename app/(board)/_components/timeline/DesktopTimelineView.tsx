"use client";

import clsx from "clsx";
import { DndContext, MeasuringStrategy, DragOverlay } from "@dnd-kit/core";
import { useEffect, useMemo, useState } from "react";
import { DaySection } from "@/app/(board)/_components/timeline/DaySection";
import { OverduePanel } from "@/app/(board)/_components/timeline/OverduePanel";
import type {
  ActiveDragState,
  ActiveResizeState,
  PointerPreviewState,
  useTimelineDragAndDrop,
} from "@/app/(board)/_hooks/useTimelineDragAndDrop";
import { bucketsFirstCollisionDetection } from "@/app/(board)/_hooks/useTimelineDragAndDrop";
import {
  type TimelineBucketItem,
  type TimelineDay,
  type TimelineEvent,
  type TimelineOverdueItem,
  type ExternalCalendarEntry,
  minuteToPixels,
  pixelsToMinutes,
  getTimelineHeight,
} from "@/app/(board)/_utils/timeline-helpers";
import {
  buildOverlayCardData,
  findOverlayBucketEntry,
  findOverlayOverdueEntry,
} from "@/app/(board)/_utils/timeline-overlay";
import { TimelineDragOverlayCard } from "@/app/(board)/_components/timeline/TimelineDragOverlayCard";
import {
  useTimelineZoomStore,
  MIN_HOUR_HEIGHT,
  MAX_HOUR_HEIGHT,
  ZOOM_STEP,
} from "@/app/(board)/_stores/timeline-zoom-store";

const ALL_DAY_ROW_HEIGHT = 36;
const DAY_SECTION_MIN_WIDTH_PX = 320;
const OVERDUE_MIN_WIDTH_PX = DAY_SECTION_MIN_WIDTH_PX / 2;

// EMPTY配列の参照を安定化（memo効率化）
const EMPTY_EVENTS: readonly TimelineEvent[] = Object.freeze([]);
const EMPTY_BUCKET: readonly TimelineBucketItem[] = Object.freeze([]);

type DragAndDropBindings = ReturnType<typeof useTimelineDragAndDrop>;

type DesktopTimelineViewProps = {
  timelineHeaderRef: React.RefObject<HTMLDivElement>;
  timelineScrollRef: React.RefObject<HTMLDivElement>;
  registerAbScrollContainer?: (dayIso: string, el: HTMLDivElement | null, bucket?: 'a' | 'b') => void;
  days: TimelineDay[];
  activeDayIndex: number;
  dayRange: number;
  status: string;
  handlePrevDay: () => void;
  handleNextDay: () => void;
  eventsByDay: Record<string, TimelineEvent[]>;
  abBuckets: Record<string, TimelineBucketItem[]>;
  overdue: TimelineOverdueItem[];
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
  handleResizeStart: (e: React.PointerEvent, cardId: string, startMinutes: number, duration: number, edge: "top" | "bottom") => void;
  handleResizeMove: (e: React.PointerEvent) => void;
  handleResizeEnd: (e: React.PointerEvent) => void;
  onToggleCheck: (cardId: string, checked: boolean) => void;
  sensors: DragAndDropBindings["sensors"];
  handleDragStart: DragAndDropBindings["handleDragStart"];
  handleDragMove: DragAndDropBindings["handleDragMove"];
  handleDragEnd: DragAndDropBindings["handleDragEnd"];
  handleDragCancel: DragAndDropBindings["handleDragCancel"];
  isOverABList: boolean;
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
};

export function DesktopTimelineView({
  onMount,
  timelineHeaderRef,
  timelineScrollRef,
  registerAbScrollContainer,
  days,
  activeDayIndex,
  dayRange,
  status,
  handlePrevDay,
  handleNextDay,
  eventsByDay,
  abBuckets,
  overdue,
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
  handleResizeStart,
  handleResizeMove,
  handleResizeEnd,
  onToggleCheck,
  sensors,
  handleDragStart,
  handleDragMove,
  handleDragEnd,
  handleDragCancel,
  isOverABList,
  floatingLayerTop,
  calendarEventsByDay,
  calendarAllDayByDay,
  onExternalEventClick,
  onScroll,
  timelineStartHour = 0,
  onCardContextMenu,
  onCardContextMenuByKeyboard,
  contextMenuCardId,
}: DesktopTimelineViewProps) {
  // Calculate how many days to show based on dayRange setting
  const dayCount = Math.min(dayRange, days.length - activeDayIndex);
  const visibleDays = days.slice(activeDayIndex, activeDayIndex + dayCount);
  const desktopGridTemplateColumns = `minmax(${OVERDUE_MIN_WIDTH_PX}px, 0.5fr) repeat(${visibleDays.length}, minmax(${DAY_SECTION_MIN_WIDTH_PX}px, 1fr))`;
  const desktopGridMinWidth = `${OVERDUE_MIN_WIDTH_PX + visibleDays.length * DAY_SECTION_MIN_WIDTH_PX}px`;
  const hasAllDayEvents = visibleDays.some((day) => (calendarAllDayByDay[day.isoDate]?.length ?? 0) > 0);
  const [abViewportHeight, setAbViewportHeight] = useState(0);

  // Zoom State
  const hourHeight = useTimelineZoomStore((state) => state.hourHeight);
  const setHourHeight = useTimelineZoomStore((state) => state.setHourHeight);

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

  useEffect(() => {
    const handleGlobalClick = () => setSelectedSlot(null);
    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, []);

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

  // Build overlay card data for DragOverlay
  const activeDragCardId = activeDrag?.cardId ?? null;
  const overlayBucketEntry = useMemo(
    () => findOverlayBucketEntry(abBuckets, activeDragCardId),
    [abBuckets, activeDragCardId]
  );
  const overlayBucketCard = overlayBucketEntry?.item ?? null;
  const overlayOverdueEntry = useMemo(
    () => findOverlayOverdueEntry(overdue, activeDragCardId),
    [overdue, activeDragCardId]
  );
  const overlayOverdueCard = overlayOverdueEntry?.item ?? null;

  const allEvents = useMemo(() => Object.values(eventsByDay).flat(), [eventsByDay]);
  const overlayTimelineEvent = allEvents.find((event) => event.card_id === activeDragCardId);

  const overlayCardData = useMemo(
    () =>
      buildOverlayCardData({
        timelineEvent: overlayTimelineEvent,
        bucketEntry: overlayBucketEntry,
        overdueEntry: overlayOverdueEntry,
        defaultTimelineDuration: 60,
      }),
    [overlayBucketEntry, overlayOverdueEntry, overlayTimelineEvent]
  );

  const allDayLayout = useMemo(() => {
    if (!hasAllDayEvents || !visibleDays.length) return { segments: [] as { id: string; title: string; start: number; end: number; row: number; entry: ExternalCalendarEntry; startDate?: string | null; endDate?: string | null; displayTz?: string | null; calendarId?: string | null }[], rows: 0 };

    type SegmentSeed = {
      id: string;
      title: string;
      start: number;
      end: number;
      entry: ExternalCalendarEntry;
      startDate?: string | null;
      endDate?: string | null;
      displayTz?: string | null;
      calendarId?: string | null;
    };
    type Segment = SegmentSeed & { row: number };
    const segments: SegmentSeed[] = [];
    const ongoing = new Map<string, SegmentSeed>();

    visibleDays.forEach((day, idx) => {
      const items = calendarAllDayByDay[day.isoDate] ?? [];
      const present = new Set<string>();

      items.forEach((item) => {
        const key = item.eventId ?? item.id;
        present.add(key);
        const existing = ongoing.get(key);
        if (existing) {
          if (idx === existing.end + 1) {
            existing.end = idx;
          } else {
            segments.push(existing);
            ongoing.set(key, {
              id: key,
              title: item.title || "Google予定",
              start: idx,
              end: idx,
              entry: item,
              startDate: item.startDate ?? item.dayIso ?? null,
              endDate: item.endDate ?? null,
              displayTz: item.displayTz ?? null,
              calendarId: item.calendarId ?? null,
            });
          }
        } else {
          ongoing.set(key, {
            id: key,
            title: item.title || "Google予定",
            start: idx,
            end: idx,
            entry: item,
            startDate: item.startDate ?? item.dayIso ?? null,
            endDate: item.endDate ?? null,
            displayTz: item.displayTz ?? null,
            calendarId: item.calendarId ?? null,
          });
        }
      });

      // close segments that ended before this day
      const toClose: string[] = [];
      ongoing.forEach((seg, key) => {
        if (!present.has(key)) {
          segments.push(seg);
          toClose.push(key);
        }
      });
      toClose.forEach((key) => ongoing.delete(key));
    });

    ongoing.forEach((seg) => segments.push(seg));

    // pack rows so spans don't overlap on the same row
    segments.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
    const rowEnds: number[] = [];
    const placed: Segment[] = segments.map((seg) => {
      let row = rowEnds.findIndex((end) => seg.start > end);
      if (row === -1) {
        row = rowEnds.length;
        rowEnds.push(seg.end);
      } else {
        rowEnds[row] = seg.end;
      }
      return { ...seg, row };
    });

    return { segments: placed, rows: rowEnds.length };
  }, [calendarAllDayByDay, hasAllDayEvents, visibleDays]);

  const shiftIsoDate = (iso?: string | null, deltaDays = 0) => {
    if (!iso) return null;
    const [year, month, day] = iso.split("-").map((part) => Number(part));
    if (!year || !month || !day) return iso;
    const shifted = new Date(Date.UTC(year, (month ?? 1) - 1, (day ?? 1) + deltaDays));
    return shifted.toISOString().split("T")[0];
  };

  const formatShortDate = (iso?: string | null) => {
    if (!iso) return null;
    const [, month, day] = iso.split("-");
    if (!month || !day) return null;
    return `${Number(month)}/${Number(day)}`;
  };

  const formatAllDayRange = (segment: { startDate?: string | null; endDate?: string | null; start: number; end: number }) => {
    const visibleStartIso = visibleDays[segment.start]?.isoDate ?? null;
    const visibleEndIso = visibleDays[segment.end]?.isoDate ?? null;
    const startIso = segment.startDate ?? visibleStartIso;
    const endExclusive = segment.endDate ?? null;
    const endIso = endExclusive ? shiftIsoDate(endExclusive, -1) : visibleEndIso ?? startIso;
    const startLabel = formatShortDate(startIso);
    const endLabel = formatShortDate(endIso);
    if (startLabel && endLabel && startLabel !== endLabel) return `${startLabel}–${endLabel}`;
    return startLabel ?? endLabel;
  };

  const allDayMinHeight = Math.max(48, allDayLayout.rows * (ALL_DAY_ROW_HEIGHT + 6) + 10);

  useEffect(() => {
    onMount?.();
  }, [onMount]);

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
      collisionDetection={bucketsFirstCollisionDetection}
      measuring={{
        droppable: { strategy: MeasuringStrategy.Always },
      }}
      autoScroll={{
        enabled: false,
        threshold: { x: 0, y: 0.2 },
        acceleration: 1,
      }}
    >
      <div
        className="relative flex min-h-0 flex-col max-h-[80vh] overflow-x-auto overflow-y-hidden bg-white shadow-sm ring-1 ring-black/5"
      >
        <div ref={timelineHeaderRef} className="z-30">
          <div
            className="grid border-b border-slate-100 bg-white text-xs font-semibold uppercase tracking-wide text-slate-500 pr-[14px]"
            style={{
              gridTemplateColumns: desktopGridTemplateColumns,
              minWidth: desktopGridMinWidth,
            }}
          >
            <div className="flex items-center justify-center px-4 py-3 text-center text-slate-800">
              <div>
                <p>Overdue</p>
                <p className="text-[10px] text-slate-400 normal-case tracking-normal">{overdue.length} cards</p>
              </div>
            </div>
            {visibleDays.map((day, index) => (
              <div
                key={day.key}
                className={clsx(
                  "px-4 py-3 text-center flex items-center justify-between relative",
                  "border-l border-slate-100"
                )}
              >
                {index === 0 && (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handlePrevDay();
                    }}
                    disabled={status === "loading"}
                    className="p-1.5 hover:bg-slate-200 rounded disabled:opacity-20 disabled:cursor-not-allowed transition-colors bg-white border border-slate-300 relative z-10"
                    aria-label="Previous day"
                    type="button"
                    style={{ pointerEvents: "auto" }}
                  >
                    <svg className="w-4 h-4 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                )}
                {index !== 0 && index !== (visibleDays.length - 1) && <div className="w-7" />}

                <div className="flex-1">
                  <p className="text-slate-800">{day.label}</p>
                  <p className="text-[10px] text-slate-400">{day.isoDate}</p>
                </div>

                {index === (visibleDays.length - 1) && (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleNextDay();
                    }}
                    disabled={status === "loading"}
                    className="p-1.5 hover:bg-slate-200 rounded disabled:opacity-20 disabled:cursor-not-allowed transition-colors bg-white border border-slate-300 relative z-10"
                    aria-label="Next day"
                    type="button"
                    style={{ pointerEvents: "auto" }}
                  >
                    <svg className="w-4 h-4 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                )}
                {index === 0 && <div className="w-7" />}
              </div>
            ))}
          </div>

          {hasAllDayEvents && (
            <div
              className="grid border-b border-emerald-100/70 bg-emerald-50/60 text-[11px] font-semibold text-emerald-800 pr-[14px]"
              style={{
                gridTemplateColumns: desktopGridTemplateColumns,
                minWidth: desktopGridMinWidth,
              }}
            >
              <div
                className="bg-amber-50/40"
                style={{ minHeight: allDayMinHeight }}
              />
              <div
                className="relative px-2 py-2"
                style={{
                  gridColumn: `2 / span ${visibleDays.length}`,
                  minHeight: allDayMinHeight,
                }}
              >
                {allDayLayout.segments.map((item) => {
                  const span = item.end - item.start + 1;
                  const dayWidth = 100 / visibleDays.length;
                  const left = dayWidth * item.start;
                  const width = dayWidth * span;
                  const rangeLabel = formatAllDayRange(item);
                  const tzLabel = item.displayTz && item.displayTz !== "Asia/Tokyo" ? item.displayTz : null;
                  const meta = [rangeLabel, tzLabel].filter(Boolean).join(" · ");
                  return (
                    <button
                      key={`${item.id}-${item.start}-${item.end}`}
                      type="button"
                      disabled={!onExternalEventClick}
                      onClick={() => onExternalEventClick?.(item.entry)}
                      className="absolute flex items-start gap-2 rounded-md border border-emerald-200 bg-white/90 px-2.5 py-1.5 text-left text-[11px] font-semibold text-emerald-800 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-400 hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 disabled:cursor-default disabled:opacity-80"
                      style={{
                        top: 6 + item.row * (ALL_DAY_ROW_HEIGHT + 6),
                        left: `calc(${left}% + 2px)`,
                        width: `calc(${width}% - 4px)`,
                      }}
                      title={item.title || "Google予定"}
                    >
                      <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase leading-tight tracking-wide text-emerald-700">
                        G
                      </span>
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate">{item.title || "Google予定"}</span>
                        {meta ? <span className="truncate text-[10px] font-normal text-emerald-700">{meta}</span> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div
          ref={timelineScrollRef}
          onScroll={(e) => onScroll?.(e.currentTarget.scrollTop)}
          className="relative flex-1 min-h-0 overflow-y-auto overflow-x-visible scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-200 [scrollbar-gutter:stable]"
        >
          <div className="relative" style={{ minHeight: timelineViewportHeight }}>
            {(status === "loading" || !days.length) && (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/50 backdrop-blur-sm">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-sky-500" />
              </div>
            )}

            {/* 日単位でDOMを組み替え */}
            <div
              className="grid timeline-container"
              data-testid="timeline-grid"
              style={{
                gridTemplateColumns: desktopGridTemplateColumns,
                minWidth: desktopGridMinWidth,
              }}
            >
              <aside className="border-r border-slate-100 bg-amber-50/40">
                <div
                  className="sticky top-0 min-h-0"
                  style={abViewportHeight > 0 ? { height: `${abViewportHeight}px` } : undefined}
                >
                  <OverduePanel
                    items={overdue}
                    variant="desktop"
                    openCardModal={openCardModal}
                    onToggleCheck={onToggleCheck}
                    onCardContextMenu={onCardContextMenu}
                    onCardContextMenuByKeyboard={onCardContextMenuByKeyboard}
                    contextMenuCardId={contextMenuCardId}
                    className="h-full border-0"
                    contentClassName="space-y-1.5"
                  />
                </div>
              </aside>

              {/* 日ごとにループ：Timeline → A/Bリスト の順 */}
              {visibleDays.map((day, index) => (
                <DaySection
                  key={day.isoDate}
                  day={day}
                  index={index}
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
                  viewportHeight={abViewportHeight}
                  registerAbScrollContainer={registerAbScrollContainer}
                  floatingLayerTop={floatingLayerTop}
                  status={status}
                  openCardModal={openCardModal}
                  onToggleCheck={onToggleCheck}
                  onCardContextMenu={onCardContextMenu}
                  onCardContextMenuByKeyboard={onCardContextMenuByKeyboard}
                  contextMenuCardId={contextMenuCardId}
                  hourHeight={hourHeight}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <DragOverlay dropAnimation={null} zIndex={50}>
        <TimelineDragOverlayCard
          variant="desktop"
          overlayCardData={overlayCardData}
          overlayTimelineEvent={overlayTimelineEvent}
          overlayBucketCard={overlayBucketCard}
          overlayOverdueCard={overlayOverdueCard}
        />
      </DragOverlay>
    </DndContext>
  );
}
