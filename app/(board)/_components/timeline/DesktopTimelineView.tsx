"use client";

import clsx from "clsx";
import { DndContext, MeasuringStrategy, DragOverlay } from "@dnd-kit/core";
import { useMemo } from "react";
import TimelineBuckets from "@/app/(board)/_components/timeline/TimelineBuckets";
import TimelineGrid from "@/app/(board)/_components/timeline/TimelineGrid";
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
  type ExternalCalendarEntry,
  timeLabel,
} from "@/app/(board)/_utils/timeline-helpers";
import { bucketKeyToDueBucket } from "@/lib/bucket-normalization";
import { countNonEmptyLines, normalizeChecklist, EMPTY_CHECKLIST } from "@/lib/checklist";
import type { Checklist } from "@/lib/checklist";
import type { ChecklistSaveTrigger } from "@/app/(board)/_components/checklist/ChecklistEditor";

type DragAndDropBindings = ReturnType<typeof useTimelineDragAndDrop>;

type DesktopTimelineViewProps = {
  timelineHeaderRef: React.RefObject<HTMLDivElement>;
  timelineScrollRef: React.RefObject<HTMLDivElement>;
  days: TimelineDay[];
  activeDayIndex: number;
  dayRange: number;
  status: string;
  handlePrevDay: () => void;
  handleNextDay: () => void;
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
  handleResizeStart: (e: React.PointerEvent, cardId: string, startMinutes: number, duration: number, edge: "top" | "bottom") => void;
  handleResizeMove: (e: React.PointerEvent) => void;
  handleResizeEnd: (e: React.PointerEvent) => void;
  onToggleCheck: (cardId: string, checked: boolean) => void;
  onChecklistCommit: (cardId: string, checklist: Checklist, trigger: ChecklistSaveTrigger) => void;
  onChecklistEditingChange: (cardId: string, editing: boolean) => void;
  editingCardId: string | null;
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
};

export function DesktopTimelineView({
  timelineHeaderRef,
  timelineScrollRef,
  days,
  activeDayIndex,
  dayRange,
  status,
  handlePrevDay,
  handleNextDay,
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
  handleResizeStart,
  handleResizeMove,
  handleResizeEnd,
  onToggleCheck,
  onChecklistCommit,
  onChecklistEditingChange,
  editingCardId,
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
}: DesktopTimelineViewProps) {
  // Calculate how many days to show based on dayRange setting
  const dayCount = Math.min(dayRange, days.length - activeDayIndex);
  const visibleDays = days.slice(activeDayIndex, activeDayIndex + dayCount);
  const hasAllDayEvents = visibleDays.some((day) => (calendarAllDayByDay[day.isoDate]?.length ?? 0) > 0);

  // Build overlay card data for DragOverlay
  const activeDragCardId = activeDrag?.cardId ?? null;
  const overlayBucketEntry = useMemo(() => {
    const entries = Object.entries(abBuckets);
    for (const [key, items] of entries) {
      const found = items.find((item) => item.card_id === activeDragCardId);
      if (found) return { key, item: found };
    }
    return null;
  }, [abBuckets, activeDragCardId]);
  const overlayBucketCard = overlayBucketEntry?.item ?? null;
  const overlayBucketKey = overlayBucketEntry?.key ?? null;

  const allEvents = useMemo(() => Object.values(eventsByDay).flat(), [eventsByDay]);
  const overlayTimelineEvent = allEvents.find((event) => event.card_id === activeDragCardId);

  const overlayCardData = useMemo(() => {
    if (overlayTimelineEvent) {
      return {
        title: overlayTimelineEvent.title || "Untitled card",
        badge: overlayTimelineEvent.due_bucket ?? "a",
        timeText: timeLabel(overlayTimelineEvent.due_start, overlayTimelineEvent.due_end),
        checklistCount: countNonEmptyLines(normalizeChecklist(overlayTimelineEvent.checklist ?? EMPTY_CHECKLIST)),
      };
    }
    if (overlayBucketCard) {
      return {
        title: overlayBucketCard.title || "Untitled card",
        badge: overlayBucketKey ? bucketKeyToDueBucket(overlayBucketKey) : "a",
        timeText: overlayBucketCard.due_start ? timeLabel(overlayBucketCard.due_start, overlayBucketCard.due_end) : null,
        checklistCount: countNonEmptyLines(normalizeChecklist(overlayBucketCard.checklist ?? EMPTY_CHECKLIST)),
      };
    }
    return null;
  }, [overlayBucketCard, overlayBucketKey, overlayTimelineEvent]);

  const allDayLayout = useMemo(() => {
    if (!hasAllDayEvents || !visibleDays.length) return { segments: [] as { id: string; title: string; start: number; end: number; row: number }[], rows: 0 };

    type Segment = { id: string; title: string; start: number; end: number };
    const segments: Segment[] = [];
    const ongoing = new Map<string, Segment>();

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
            ongoing.set(key, { id: key, title: item.title || "Google予定", start: idx, end: idx });
          }
        } else {
          ongoing.set(key, { id: key, title: item.title || "Google予定", start: idx, end: idx });
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
    const placed = segments.map((seg) => {
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
        enabled: !isOverABList,
        threshold: { x: 0, y: 0.2 },
        acceleration: 1,
      }}
    >
      <div className="relative flex flex-col max-h-[80vh] overflow-hidden bg-white shadow-sm ring-1 ring-black/5">
        <div ref={timelineHeaderRef} className="z-30">
          <div
            className="grid border-b border-slate-100 bg-white text-xs font-semibold uppercase tracking-wide text-slate-500 pr-[14px]"
            style={{
              gridTemplateColumns: `80px repeat(${visibleDays.length}, minmax(0, 1fr))`,
            }}
          >
            <div className="flex items-center justify-center border-r border-slate-100 px-3 py-3 text-left">
              <span className="leading-none text-[10px] text-slate-400">GMT+09</span>
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
                gridTemplateColumns: `80px repeat(${visibleDays.length}, minmax(0, 1fr))`,
              }}
            >
              <div
                className="flex items-start justify-end border-r border-emerald-100/70 px-3 py-2 text-[10px] uppercase tracking-wide text-emerald-700"
                style={{
                  minHeight: Math.max(36, allDayLayout.rows * 28 + 8),
                }}
              >
                終日
              </div>
              <div
                className="relative px-2 py-2"
                style={{
                  gridColumn: `2 / span ${visibleDays.length}`,
                  minHeight: Math.max(36, allDayLayout.rows * 28 + 8),
                }}
              >
                {allDayLayout.segments.map((item) => {
                  const span = item.end - item.start + 1;
                  const dayWidth = 100 / visibleDays.length;
                  const left = dayWidth * item.start;
                  const width = dayWidth * span;
                  return (
                    <div
                      key={`${item.id}-${item.start}-${item.end}`}
                      className="absolute flex items-center gap-1 rounded-md border border-emerald-200 bg-white/90 px-2 py-1 text-[11px] font-semibold text-emerald-800 shadow-sm"
                      style={{
                        top: 4 + item.row * 28,
                        left: `calc(${left}% + 2px)`,
                        width: `calc(${width}% - 4px)`,
                      }}
                      title={item.title || "Google予定"}
                    >
                      <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase leading-tight tracking-wide text-emerald-700">
                        G
                      </span>
                      <span className="truncate">{item.title || "Google予定"}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div
          ref={timelineScrollRef}
          className="relative flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-200 [scrollbar-gutter:stable]"
        >
          <div className="relative" style={{ minHeight: timelineViewportHeight }}>
            {(status === "loading" || !days.length) && (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/50 backdrop-blur-sm">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-sky-500" />
              </div>
            )}

            <TimelineBuckets
              days={visibleDays}
              abBuckets={abBuckets}
              floatingLayerTop={floatingLayerTop}
              status={status}
              openCardModal={openCardModal}
              onToggleCheck={onToggleCheck}
              onChecklistCommit={onChecklistCommit}
              onChecklistEditingChange={onChecklistEditingChange}
              editingCardId={editingCardId}
              bucketIndicator={bucketIndicator}
            />

            <TimelineGrid
              days={visibleDays}
              eventsByDay={eventsByDay}
              indicatorTop={indicatorTop}
              indicatorDayIso={indicatorDayIso}
              timelineViewportHeight={timelineViewportHeight}
              activeDrag={activeDrag}
              pointerPreview={pointerPreview}
              activeResize={activeResize}
              openCardModal={openCardModal}
              handleEventKeyDown={handleEventKeyDown}
              handleColumnClick={handleColumnClick}
              handleResizeStart={handleResizeStart}
              handleResizeMove={handleResizeMove}
              handleResizeEnd={handleResizeEnd}
              onToggleCheck={onToggleCheck}
              onChecklistCommit={onChecklistCommit}
              onChecklistEditingChange={onChecklistEditingChange}
              editingCardId={editingCardId}
              shrinkDaysToHalf
              calendarEventsByDay={calendarEventsByDay}
              onExternalEventClick={onExternalEventClick}
            />
          </div>
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {overlayCardData ? (
          <DesktopDragOverlayCard
            title={overlayCardData.title}
            badge={overlayCardData.badge}
            timeText={overlayCardData.timeText}
            checklistCount={overlayCardData.checklistCount}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function DesktopDragOverlayCard({
  title,
  badge,
  timeText,
  checklistCount,
}: {
  title: string;
  badge: string;
  timeText: string | null;
  checklistCount: number;
}) {
  return (
    <div className="w-[220px] max-w-[260px] rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
      <div className="flex items-start gap-2">
        <span className="rounded-full border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-600 shadow-sm">
          {badge.toUpperCase()}
        </span>
        <div className="min-w-0 flex-1 text-[12px] font-semibold text-slate-800 leading-tight line-clamp-2 break-words">
          {title || "Untitled card"}
        </div>
      </div>
      {timeText ? <div className="mt-1 text-[11px] text-slate-600">{timeText}</div> : null}
      {checklistCount > 0 ? <div className="mt-1 text-[11px] text-slate-400">☑︎ {checklistCount}</div> : null}
    </div>
  );
}
