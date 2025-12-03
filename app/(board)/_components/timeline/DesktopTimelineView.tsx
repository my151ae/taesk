"use client";

import clsx from "clsx";
import { DndContext, MeasuringStrategy } from "@dnd-kit/core";
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
} from "@/app/(board)/_utils/timeline-helpers";
import type { Checklist } from "@/lib/checklist";
import type { ChecklistSaveTrigger } from "@/app/(board)/_components/checklist/ChecklistEditor";

type DragAndDropBindings = ReturnType<typeof useTimelineDragAndDrop>;

type DesktopTimelineViewProps = {
  timelineHeaderRef: React.RefObject<HTMLDivElement>;
  timelineScrollRef: React.RefObject<HTMLDivElement>;
  days: TimelineDay[];
  activeDayIndex: number;
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
  onTodayClick: () => void;
};

export function DesktopTimelineView({
  timelineHeaderRef,
  timelineScrollRef,
  days,
  activeDayIndex,
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
  onTodayClick,
}: DesktopTimelineViewProps) {
  // Calculate how many days to show (typically 1-3 based on board settings)
  const dayCount = Math.min(days.length - activeDayIndex, days.length);
  const visibleDays = days.slice(activeDayIndex, activeDayIndex + dayCount);

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
        <div
          ref={timelineHeaderRef}
          className="z-30 grid border-b border-slate-100 bg-white text-xs font-semibold uppercase tracking-wide text-slate-500 pr-[14px]"
          style={{
            gridTemplateColumns: `80px repeat(${visibleDays.length}, minmax(0, 1fr))`,
          }}
        >
          <div className="flex flex-col items-center justify-center border-r border-slate-100 px-1 py-2 gap-1">
            <button
              onClick={onTodayClick}
              className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50"
            >
              Today
            </button>
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
            />
          </div>
        </div>
      </div>
    </DndContext>
  );
}
