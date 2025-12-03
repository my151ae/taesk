"use client";

import { useMemo } from "react";
import { DndContext, MeasuringStrategy } from "@dnd-kit/core";
import {
  TIMELINE_HEIGHT,
  TimelineEvent,
  TimelineBucketItem,
  TimelineDay,
  buildAbMeta,
} from "@/app/(board)/_utils/timeline-helpers";
import TimelineGrid from "@/app/(board)/_components/timeline/TimelineGrid";
import TimelineBuckets from "@/app/(board)/_components/timeline/TimelineBuckets";
import {
  type ActiveDragState,
  type ActiveResizeState,
  type PointerPreviewState,
  type useTimelineDragAndDrop,
} from "@/app/(board)/_hooks/useTimelineDragAndDrop";
import { bucketsFirstCollisionDetection } from "@/app/(board)/_hooks/useTimelineDragAndDrop";
import type { Checklist } from "@/lib/checklist";
import type { ChecklistSaveTrigger } from "@/app/(board)/_components/checklist/ChecklistEditor";

type DragAndDropBindings = ReturnType<typeof useTimelineDragAndDrop>;

type MobileTimelineViewProps = {
  timelineScrollRef: React.RefObject<HTMLDivElement>;
  days: TimelineDay[];
  activeDayIndex: number;
  onPrevDay: () => void;
  onNextDay: () => void;
  eventsByDay: Record<string, TimelineEvent[]>;
  abBuckets: Record<string, TimelineBucketItem[]>;
  indicatorTop: number | null;
  indicatorDayIso: string | null;
  timelineViewportHeight: number;
  openCardModal: (shortId: string | null, source: string) => void;
  onToggleCheck: (cardId: string, checked: boolean) => void;
  onChecklistCommit: (cardId: string, checklist: Checklist, trigger: ChecklistSaveTrigger) => void;
  onChecklistEditingChange: (cardId: string, editing: boolean) => void;
  editingCardId: string | null;
  status: string;
  sensors: DragAndDropBindings["sensors"];
  handleDragStart: DragAndDropBindings["handleDragStart"];
  handleDragMove: DragAndDropBindings["handleDragMove"];
  handleDragEnd: DragAndDropBindings["handleDragEnd"];
  handleDragCancel: DragAndDropBindings["handleDragCancel"];
  activeDrag: ActiveDragState | null;
  pointerPreview: PointerPreviewState;
  activeResize: ActiveResizeState | null;
  bucketIndicator: DragAndDropBindings["bucketIndicator"];
  isOverABList: boolean;
  handleEventKeyDown: (event: TimelineEvent, native: React.KeyboardEvent<HTMLElement>) => void;
  handleColumnClick: (day: TimelineDay, minutes: number) => void;
  handleResizeStart: (e: React.PointerEvent, cardId: string, startMinutes: number, duration: number, edge: "top" | "bottom") => void;
  handleResizeMove: (e: React.PointerEvent) => void;
  handleResizeEnd: (e: React.PointerEvent) => void;
};

export default function MobileTimelineView({
  timelineScrollRef,
  days,
  activeDayIndex,
  onPrevDay,
  onNextDay,
  eventsByDay,
  abBuckets,
  indicatorTop,
  indicatorDayIso,
  timelineViewportHeight,
  openCardModal,
  onToggleCheck,
  onChecklistCommit,
  onChecklistEditingChange,
  editingCardId,
  status,
  sensors,
  handleDragStart,
  handleDragMove,
  handleDragEnd,
  handleDragCancel,
  activeDrag,
  pointerPreview,
  activeResize,
  bucketIndicator,
  isOverABList,
  handleEventKeyDown,
  handleColumnClick,
  handleResizeStart,
  handleResizeMove,
  handleResizeEnd,
}: MobileTimelineViewProps) {
  const activeDay = useMemo(() => days[activeDayIndex] ?? days[0] ?? null, [activeDayIndex, days]);

  const activeDayIso = activeDay?.isoDate ?? null;
  const activeBuckets = useMemo(() => {
    if (!activeDay) return {} as Record<string, TimelineBucketItem[]>;
    const entries = Object.entries(abBuckets || {}).filter(([key]) => key.startsWith(activeDay.key));
    return Object.fromEntries(entries);
  }, [abBuckets, activeDay]);
  const visibleDays = activeDay ? [activeDay] : [];
  const abMeta = useMemo(() => (activeDay ? buildAbMeta(activeDay) : null), [activeDay]);
  const minHeight = Math.max(timelineViewportHeight, TIMELINE_HEIGHT);

  if (!activeDay) return null;

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
      <div className="relative flex h-full flex-col bg-white overflow-x-hidden overscroll-x-none touch-pan-y">
        {(status === "loading" || !days.length) && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-white/60 backdrop-blur-sm">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-sky-500" />
          </div>
        )}

        <div className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-100 bg-white px-3 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <button
            type="button"
            aria-label="前の日"
            disabled={status === "loading"}
            onClick={(e) => {
              e.preventDefault();
              onPrevDay();
            }}
            className="rounded border border-slate-300 bg-white p-1.5 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <svg className="h-4 w-4 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex flex-col items-center gap-0.5 text-slate-800">
            <span>{activeDay.label}</span>
            <span className="text-[10px] text-slate-400 normal-case tracking-normal">{activeDay.isoDate} · GMT+09</span>
          </div>
          <button
            type="button"
            aria-label="次の日"
            disabled={status === "loading"}
            onClick={(e) => {
              e.preventDefault();
              onNextDay();
            }}
            className="rounded border border-slate-300 bg-white p-1.5 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <svg className="h-4 w-4 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        <div
          ref={timelineScrollRef}
          className="grid flex-1 overflow-y-auto"
          style={{ gridTemplateColumns: "1fr 1fr", minHeight: minHeight }}
        >
          <div className="min-w-0 border-r border-slate-100 bg-white">
            <div className="relative h-full">
              <TimelineGrid
                days={visibleDays}
                eventsByDay={eventsByDay}
                indicatorTop={indicatorTop}
                indicatorDayIso={indicatorDayIso}
                timelineViewportHeight={minHeight}
                activeDrag={activeDrag}
                pointerPreview={pointerPreview}
                activeResize={activeResize}
                openCardModal={(shortId, source) => openCardModal(shortId, source || "mobile-timeline")}
                handleEventKeyDown={handleEventKeyDown}
                handleColumnClick={handleColumnClick}
                handleResizeStart={handleResizeStart}
                handleResizeMove={handleResizeMove}
                handleResizeEnd={handleResizeEnd}
                onToggleCheck={onToggleCheck}
                onChecklistCommit={onChecklistCommit}
                onChecklistEditingChange={onChecklistEditingChange}
                editingCardId={editingCardId}
                axisWidth={60}
                shrinkDaysToHalf
              />
            </div>
          </div>

          <div className="min-w-0 overflow-hidden border-l border-slate-100">
            <div className="px-3 py-2">
              {abMeta?.sections?.length ? (
                <>
                  <p className="text-[11px] font-semibold text-slate-700">{abMeta.sections[0]?.label}</p>
                  <p className="text-[10px] text-slate-400">{abMeta.sections[0]?.helper}</p>
                </>
              ) : null}
            </div>

            <div className="px-2 pb-4">
              <TimelineBuckets
                days={visibleDays}
                abBuckets={activeBuckets}
                floatingLayerTop={0}
                status={status}
                openCardModal={(shortId) => openCardModal(shortId, "mobile-ab")}
                onToggleCheck={onToggleCheck}
                onChecklistCommit={onChecklistCommit}
                onChecklistEditingChange={onChecklistEditingChange}
                editingCardId={editingCardId}
                bucketIndicator={bucketIndicator}
                axisWidth={0}
              />
            </div>
          </div>
        </div>
      </div>
    </DndContext>
  );
}
