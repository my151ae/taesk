"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DndContext, MeasuringStrategy, useDroppable, DragOverlay } from "@dnd-kit/core";
import {
  getDisplayHours,
  getTimelineHeight,
  minuteToPixels,
  timeLabel,
  detailedTimeLabel,
  minutesToTime,
  TimelineBucketItem,
  TimelineDay,
  TimelineEvent,
  TimelineOverdueItem,
  getMinutesFromTime,
  ExternalCalendarEntry,
  formatDuration,
  type StackedTimelineItemKind,
} from "@/app/(board)/_utils/timeline-helpers";
import { bucketKeyToDueBucket } from "@/lib/bucket-normalization";
import type { OverdueSortOrder } from "@/lib/timeline-overdue-sort";
import { DraggableCard } from "@/app/(board)/_components/timeline/TimelineDraggableCard";
import {
  TimelineCard,
  TIMELINE_LIST_CARD_NOTE_CLAMP_CLASS,
} from "@/app/(board)/_components/timeline/TimelineCard";
import { buildTimelineCardTimeText } from "@/app/(board)/_components/timeline/timeline-card-meta";
import { TimelineDragOverlayCard } from "@/app/(board)/_components/timeline/TimelineDragOverlayCard";
import { OverduePanel } from "@/app/(board)/_components/timeline/OverduePanel";
import { handleTimelineCardArrowFocus } from "@/app/(board)/_components/timeline/timeline-focus-navigation";
import type { BucketCreateRequest } from "@/app/(board)/_components/timeline/bucket-create-request";
import { bucketsFirstCollisionDetection, type useTimelineDragAndDrop } from "@/app/(board)/_hooks/useTimelineDragAndDrop";
import {
  useTimelineZoomStore,
  MIN_HOUR_HEIGHT,
  MAX_HOUR_HEIGHT,
  ZOOM_STEP
} from "@/app/(board)/_stores/timeline-zoom-store";
import {
  buildMobileTimelineViewState,
  formatAllDayMeta,
  buildStackedTimelineColumnLayout,
  buildTimelineInteractionLock,
} from "@/app/(board)/_components/timeline/timeline-render-model";

type DragAndDropBindings = ReturnType<typeof useTimelineDragAndDrop>;



function MobileTimelineColumn({
  day,
  events,
  indicatorVisible,
  indicatorPosition,
  openCardModal,
  onToggleCheck,
  pointerPreview,
  activeDragCardId,
  calendarEvents,
  onExternalEventClick,
  timelineStartHour = 0,
  onCardContextMenu,
  onCardContextMenuByKeyboard,
  contextMenuCardId,
  hourHeight,
  activeStackItem,
  setActiveStackItem,
}: {
  day: TimelineDay;
  events: TimelineEvent[];
  indicatorVisible: boolean;
  indicatorPosition: number;
  openCardModal: (shortId: string | null, source: string) => void;
  onToggleCheck: (cardId: string, checked: boolean) => void;
  pointerPreview: DragAndDropBindings["pointerPreview"];
  activeDragCardId: string | null;
  calendarEvents: ExternalCalendarEntry[];
  onExternalEventClick?: (entry: ExternalCalendarEntry) => void;
  timelineStartHour?: number;
  onCardContextMenu: (e: React.MouseEvent, cardId: string) => void;
  onCardContextMenuByKeyboard: (cardId: string, rect: DOMRect) => void;
  contextMenuCardId: string | null;
  hourHeight: number;
  activeStackItem: { kind: StackedTimelineItemKind; id: string } | null;
  setActiveStackItem: React.Dispatch<React.SetStateAction<{ kind: StackedTimelineItemKind; id: string } | null>>;
}) {
  const { setNodeRef } = useDroppable({ id: `day:${day.isoDate}`, data: { type: "timeline-column", day } });
  const { combinedItems, stackedLayout } = buildStackedTimelineColumnLayout({
    events,
    calendarEvents,
    device: "mobile",
    hourHeight,
  });
  const interactionLocked = buildTimelineInteractionLock({
    activeDragCardId,
    contextMenuCardId,
    pointerPreviewVisible: pointerPreview.visible,
  });

  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-0" style={{ height: getTimelineHeight(hourHeight) }}>
        {getDisplayHours(timelineStartHour).map((hour, idx) => (
          <div
            key={hour}
            className="absolute left-0 right-0 border-b border-slate-200"
            style={{ top: idx * hourHeight }}
          >
            <span className="absolute -top-4 right-2 text-[11px] font-medium text-slate-400/70">
              {hour}
            </span>
          </div>
        ))}
      </div>

      {indicatorVisible && (
        <div
          className="pointer-events-none absolute z-10"
          style={{ top: indicatorPosition, left: 0, right: 0 }}
        >
          <div className="relative h-px bg-red-400/80">
            <div className="absolute top-1/2 left-0 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500" />
          </div>
        </div>
      )}

      <div
        ref={setNodeRef}
        className="relative"
        data-dnd="timeline-column"
        data-day-iso={day.isoDate}
        style={{ height: getTimelineHeight(hourHeight) }}
      >
        {pointerPreview.visible && pointerPreview.dayIso === day.isoDate && (
          <div
            className="pointer-events-none absolute z-10 border border-dashed border-sky-400 bg-sky-50/60"
            style={{
              top: minuteToPixels(pointerPreview.startMinutes, timelineStartHour, hourHeight),
              height: minuteToPixels(pointerPreview.startMinutes + pointerPreview.durationMinutes, timelineStartHour, hourHeight) - minuteToPixels(pointerPreview.startMinutes, timelineStartHour, hourHeight),
              left: "6px",
              right: "6px",
            }}
          >
            <div className="absolute -top-4 left-0 text-[10px] font-semibold text-sky-600 px-1">
              {timeLabel(
                minutesToTime(pointerPreview.startMinutes),
                minutesToTime(pointerPreview.startMinutes + pointerPreview.durationMinutes)
              )}
            </div>
          </div>
        )}

        {combinedItems.map((item) => {
          if (item.kind === "calendar") {
            const calendarEvent = item.entry as ExternalCalendarEntry;
            const layout = stackedLayout[item.key];
            const isActive = activeStackItem?.kind === "calendar" && activeStackItem.id === calendarEvent.id;
            return (
              <button
                key={`calendar-${calendarEvent.id}`}
                type="button"
                data-testid="timeline-calendar-event"
                data-focus-group="timeline"
                data-focus-part="card"
                data-stack-mode={layout?.presentationMode ?? "full-width"}
                data-column-span={layout?.columnSpan ?? 1}
                data-cluster-columns={layout?.clusterColumns ?? 1}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!interactionLocked) {
                    setActiveStackItem({ kind: "calendar", id: calendarEvent.id });
                  }
                  onExternalEventClick?.(calendarEvent);
                }}
                onFocus={() => {
                  if (interactionLocked) return;
                  setActiveStackItem({ kind: "calendar", id: calendarEvent.id });
                }}
                onBlur={() => {
                  setActiveStackItem((current) => {
                    if (current?.kind === "calendar" && current.id === calendarEvent.id) {
                      return null;
                    }
                    return current;
                  });
                }}
                className="absolute z-0 rounded-md border border-emerald-200 bg-emerald-50/80 px-2 py-1 text-[10px] text-emerald-700 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.15)] text-left hover:bg-emerald-100"
                style={{
                  top: minuteToPixels(calendarEvent.startMinutes, timelineStartHour, hourHeight),
                  height: Math.max(
                    minuteToPixels(calendarEvent.startMinutes + calendarEvent.durationMinutes, timelineStartHour, hourHeight) -
                    minuteToPixels(calendarEvent.startMinutes, timelineStartHour, hourHeight),
                    18
                  ),
                  left: layout?.left ?? "0px",
                  width: layout?.width ?? "100%",
                  zIndex: isActive ? 30 : (layout?.baseZIndex ?? 10),
                }}
              >
                <div className="flex items-center gap-1">
                  <span className="truncate font-semibold">{calendarEvent.title || "Google予定"}</span>
                  <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase leading-tight tracking-wide text-emerald-700">
                    G
                  </span>
                </div>
                <p className="text-[9px] text-emerald-600">
                  {layout?.isTimeOverlapped && !isActive
                    ? null
                    : calendarEvent.isAllDay
                      ? "終日"
                      : timeLabel(
                        minutesToTime(calendarEvent.startMinutes),
                        minutesToTime(calendarEvent.startMinutes + calendarEvent.durationMinutes)
                      )}
                </p>
              </button>
            );
          }

          const event = item.entry as TimelineEvent;
          const start = getMinutesFromTime(event.due_start ?? null) ?? 0;
          const duration = event.durationMinutes ?? 60;
          const top = minuteToPixels(start, timelineStartHour, hourHeight);
          const height = Math.max(minuteToPixels(start + duration, timelineStartHour, hourHeight) - minuteToPixels(start, timelineStartHour, hourHeight), 10);
          const layout = stackedLayout[item.key];

          return (
            <DraggableCard
              key={`card-${event.card_id}`}
              id={`event:${event.card_id}`}
              data={{ kind: "event", event, cardId: event.card_id }}
              attachListenersToChild
              disabled={contextMenuCardId === event.card_id}
            >
              <div
                className="absolute"
                data-stack-mode={layout?.presentationMode ?? "full-width"}
                data-column-span={layout?.columnSpan ?? 1}
                data-cluster-columns={layout?.clusterColumns ?? 1}
                style={{
                  top,
                  height,
                  left: layout?.left ?? "0px",
                  width: layout?.width ?? "100%",
                  zIndex:
                    activeStackItem?.kind === "card" && activeStackItem.id === event.card_id
                      ? 30
                      : (layout?.baseZIndex ?? 20),
                }}
                onContextMenu={(e) => onCardContextMenu(e, event.card_id)}
              >
                <TimelineCard
                  title={event.title || ""}
                  checked={event.checked}
                  checklist={event.checklist}
                  content={event.content ?? null}
                  onToggleCheck={(next) => onToggleCheck(event.card_id, next)}
                  cardId={event.card_id}
                  badgeLabel={(event.due_bucket ?? "a").toUpperCase()}
                  timeText={
                    layout?.isTimeOverlapped && !(activeStackItem?.kind === "card" && activeStackItem.id === event.card_id)
                      ? null
                      : detailedTimeLabel(event.due_start, event.due_end, event.durationMinutes ?? 60)
                  }
                  rightMeta={undefined}
                  timePlacement="out-top"
                  onOpen={() => openCardModal(event.short_id, "mobile-timeline")}
                  dataTestId="timeline-event"
                  className={`w-full h-full pt-0 ${activeStackItem?.kind === "card" && activeStackItem.id === event.card_id ? "ring-2 ring-sky-400 shadow-md" : ""}`}
                  tabIndex={0}
                  focusGroup="timeline"
                  onOpenContextMenu={(rect) => onCardContextMenuByKeyboard(event.card_id, rect)}
                  onFocus={() => {
                    if (interactionLocked) return;
                    setActiveStackItem({ kind: "card", id: event.card_id });
                  }}
                  onBlur={() => {
                    if (contextMenuCardId === event.card_id) return;
                    setActiveStackItem((current) => {
                      if (current?.kind === "card" && current.id === event.card_id) {
                        return null;
                      }
                      return current;
                    });
                  }}
                />
              </div>
            </DraggableCard>
          );
        })}
      </div>
    </div>
  );
}

function MobileOverdueSection({
  items,
  expanded,
  onToggle,
  overdueSortOrder,
  onOverdueSortOrderChange,
  openCardModal,
  onToggleCheck,
  onCardContextMenu,
  onCardContextMenuByKeyboard,
  contextMenuCardId,
}: {
  items: TimelineOverdueItem[];
  expanded: boolean;
  onToggle: () => void;
  overdueSortOrder: OverdueSortOrder;
  onOverdueSortOrderChange: (order: OverdueSortOrder) => void;
  openCardModal: (shortId: string | null, source: string) => void;
  onToggleCheck: (cardId: string, checked: boolean) => void;
  onCardContextMenu: (e: React.MouseEvent, cardId: string) => void;
  onCardContextMenuByKeyboard: (cardId: string, rect: DOMRect) => void;
  contextMenuCardId: string | null;
}) {
  const nextOrder = overdueSortOrder === "oldest" ? "newest" : "oldest";
  const currentLabel = overdueSortOrder === "oldest" ? "古い順" : "新しい順";
  const nextLabel = nextOrder === "oldest" ? "古い順" : "新しい順";

  return (
    <div className="border-b border-rose-100 bg-rose-50/40 px-3 py-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls="mobile-overdue-sheet"
          data-testid="mobile-overdue-toggle"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center justify-between rounded-md border border-rose-200 bg-rose-50/80 px-3 py-2 text-left shadow-sm transition-colors hover:bg-rose-100/70"
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-rose-900">
              Overdue
            </span>
            <span
              className="rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-rose-800 shadow-sm ring-1 ring-rose-200"
              data-testid="mobile-overdue-count"
            >
              {items.length}
            </span>
          </div>
          <span
            className={`inline-flex h-6 w-6 items-center justify-center rounded-full border border-rose-200 bg-white/90 text-rose-700 transition-transform duration-150 ease-out ${expanded ? "rotate-180" : ""}`}
            aria-hidden="true"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 9l6 6 6-6" />
            </svg>
          </span>
        </button>

        <button
          type="button"
          data-testid="mobile-overdue-sort-toggle"
          data-order={overdueSortOrder}
          onClick={() => onOverdueSortOrderChange(nextOrder)}
          aria-label={`Overdue の並び順を${nextLabel}に切り替え`}
          title={`現在: ${currentLabel}`}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-rose-200 bg-white/90 px-2.5 py-2 text-[10px] font-semibold text-rose-800 shadow-sm transition-colors hover:bg-white"
        >
          <svg className="h-3 w-3" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d={overdueSortOrder === "oldest" ? "M6 14l4-4 4 4M10 6v8" : "M6 6l4 4 4-4M10 14V6"} />
          </svg>
          <span>{currentLabel}</span>
        </button>
      </div>

      <div
        id="mobile-overdue-sheet"
        data-testid="mobile-overdue-sheet"
        aria-hidden={!expanded}
        className="overflow-hidden transition-[max-height,opacity] duration-150 ease-out"
        style={{
          maxHeight: expanded ? "240px" : "0px",
          opacity: expanded ? 1 : 0,
        }}
      >
        <div
          className="pt-2"
          style={{
            height: "clamp(168px, 28svh, 240px)",
          }}
        >
          <OverduePanel
            items={items}
            variant="mobile"
            openCardModal={openCardModal}
            onToggleCheck={onToggleCheck}
            onCardContextMenu={onCardContextMenu}
            onCardContextMenuByKeyboard={onCardContextMenuByKeyboard}
            contextMenuCardId={contextMenuCardId}
            hideHeader
            compactEmptyState
            emptyStateMessage="未完了の期限超過カードはありません"
            className="h-full border-amber-200 bg-amber-50/50"
            contentClassName="space-y-3 px-2 pb-2 pt-2"
          />
        </div>
      </div>
    </div>
  );
}

function MobileAbBucket({
  sectionLabel,
  bucketKey,
  items,
  openCardModal,
  onRequestCreateBucketCard,
  onCreateBucketCard,
  onToggleCheck,
  bucketIndicator,
  onCardContextMenu,
  onCardContextMenuByKeyboard,
  contextMenuCardId,
}: {
  sectionLabel: string;
  bucketKey: string;
  items: TimelineBucketItem[];
  openCardModal: (shortId: string | null, source: string) => void;
  onRequestCreateBucketCard: (request: BucketCreateRequest) => void;
  onCreateBucketCard: (bucketKey: string, afterCardId?: string) => void;
  onToggleCheck: (cardId: string, checked: boolean) => void;
  bucketIndicator: DragAndDropBindings["bucketIndicator"];
  onCardContextMenu: (e: React.MouseEvent, cardId: string) => void;
  onCardContextMenuByKeyboard: (cardId: string, rect: DOMRect) => void;
  contextMenuCardId: string | null;
}) {
  const { setNodeRef: setBucketRef, isOver } = useDroppable({
    id: `bucket-drop:${bucketKey}`,
    data: { type: "ab-bucket", bucketKey },
  });
  const renderAddButton = (position: "top" | "bottom", onClick: (e: React.MouseEvent<HTMLButtonElement>) => void) => (
    <div
      className={`pointer-events-none relative mx-0.5 h-0 shrink-0 ${
        position === "top"
          ? "sticky top-0 z-10"
          : "z-10"
      }`}
    >
      <button
        type="button"
        tabIndex={-1}
        data-arrow-skip="true"
        onClick={onClick}
        className={`pointer-events-auto absolute left-1/2 top-0 flex h-4 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border text-[9px] leading-none shadow-[0_1px_2px_rgba(15,23,42,0.08)] transition-all duration-150 scale-90 opacity-75 hover:scale-100 hover:opacity-100 focus-visible:scale-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${
          isOver
            ? "border-sky-400 bg-sky-50 text-sky-700"
            : "border-slate-300/90 bg-white text-slate-400 hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700"
        }`}
        aria-label="Add card"
        data-testid={`ab-add-${position}-${bucketKey}`}
      >
        <span aria-hidden="true">＋</span>
      </button>
    </div>
  );

  return (
    <div
      ref={setBucketRef}
      className={`border border-slate-200 bg-slate-50/70 shadow-inner ${isOver ? "ring-1 ring-sky-200 bg-slate-50" : ""}`}
      data-dnd="ab-bucket"
      data-bucket-key={bucketKey}
    >
      <div className="border-b border-slate-200 px-3 py-1.5">
        <p className="text-[10px] font-semibold text-slate-700">{sectionLabel}</p>
      </div>
      <div className="space-y-1 px-2 pb-2">
        {items.length === 0 ? (
          renderAddButton("bottom", (e) => {
            e.stopPropagation();
            onRequestCreateBucketCard({
              bucketKey,
              clientX: e.clientX,
              clientY: e.clientY,
              anchorRect: e.currentTarget.getBoundingClientRect(),
            });
          })
        ) : (
          <>
            {renderAddButton("top", (e) => {
              e.stopPropagation();
              onRequestCreateBucketCard({
                bucketKey,
                clientX: e.clientX,
                clientY: e.clientY,
                anchorRect: e.currentTarget.getBoundingClientRect(),
              });
            })}
            {items.map((item) => (
              <Fragment key={item.card_id}>
                <MobileBucketCard
                  item={item}
                  bucketKey={bucketKey}
                  openCardModal={openCardModal}
                  onToggleCheck={onToggleCheck}
                  bucketIndicator={bucketIndicator}
                  onCardContextMenu={onCardContextMenu}
                  onCardContextMenuByKeyboard={onCardContextMenuByKeyboard}
                  isContextMenuOpen={contextMenuCardId === item.card_id}
                />
                {renderAddButton("bottom", (e) => {
                  e.stopPropagation();
                  onRequestCreateBucketCard({
                    bucketKey,
                    afterCardId: item.card_id,
                    clientX: e.clientX,
                    clientY: e.clientY,
                    anchorRect: e.currentTarget.getBoundingClientRect(),
                  });
                })}
              </Fragment>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

type MobileTimelineViewProps = {
  timelineScrollRef: React.RefObject<HTMLDivElement>;
  days: TimelineDay[];
  activeDayIndex: number;
  onPrevDay: () => void;
  onNextDay: () => void;
  onMount?: () => void;
  onScroll?: (scrollTop: number) => void;
  registerAbScrollContainer?: (dayIso: string, el: HTMLDivElement | null, bucket?: 'a' | 'b') => void;
  eventsByDay: Record<string, TimelineEvent[]>;
  abBuckets: Record<string, TimelineBucketItem[]>;
  overdue: TimelineOverdueItem[];
  calendarEventsByDay: Record<string, ExternalCalendarEntry[]>;
  calendarAllDayByDay: Record<string, ExternalCalendarEntry[]>;
  indicatorTop: number | null;
  indicatorDayIso: string | null;
  timelineViewportHeight: number;
  openCardModal: (shortId: string | null, source: string) => void;
  onCreateBucketCard: (bucketKey: string, afterCardId?: string) => void;
  onRequestCreateBucketCard: (request: BucketCreateRequest) => void;
  onToggleCheck: (cardId: string, checked: boolean) => void;
  status: string;
  activeDrag: DragAndDropBindings["activeDrag"];
  sensors: DragAndDropBindings["sensors"];
  handleDragStart: DragAndDropBindings["handleDragStart"];
  handleDragMove: DragAndDropBindings["handleDragMove"];
  handleDragEnd: DragAndDropBindings["handleDragEnd"];
  handleDragCancel: DragAndDropBindings["handleDragCancel"];
  bucketIndicator: DragAndDropBindings["bucketIndicator"];
  isOverABList: boolean;
  pointerPreview: DragAndDropBindings["pointerPreview"];
  onExternalEventClick?: (entry: ExternalCalendarEntry) => void;
  timelineStartHour?: number;
  onCardContextMenu: (e: React.MouseEvent, cardId: string) => void;
  onCardContextMenuByKeyboard: (cardId: string, rect: DOMRect) => void;
  contextMenuCardId: string | null;
  overdueSortOrder: OverdueSortOrder;
  onOverdueSortOrderChange: (order: OverdueSortOrder) => void;
};

export default function MobileTimelineView({
  timelineScrollRef,
  days,
  activeDayIndex,
  onPrevDay,
  onNextDay,
  onMount,
  onScroll,
  registerAbScrollContainer,
  eventsByDay,
  abBuckets,
  overdue,
  calendarEventsByDay,
  calendarAllDayByDay,
  indicatorTop,
  indicatorDayIso,
  timelineViewportHeight,
  openCardModal,
  onCreateBucketCard,
  onRequestCreateBucketCard,
  onToggleCheck,
  status,
  sensors,
  handleDragStart,
  handleDragMove,
  handleDragEnd,
  handleDragCancel,
  bucketIndicator,
  isOverABList,
  pointerPreview,
  activeDrag,
  onExternalEventClick,
  timelineStartHour = 0,
  onCardContextMenu,
  onCardContextMenuByKeyboard,
  contextMenuCardId,
  overdueSortOrder,
  onOverdueSortOrderChange,
}: MobileTimelineViewProps) {
  const handleArrowKeyFocus = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    handleTimelineCardArrowFocus(event);
  }, []);

  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const swipeLockedRef = useRef(false);
  const [isOverdueExpanded, setIsOverdueExpanded] = useState(false);
  const [activeStackItem, setActiveStackItem] = useState<{ kind: StackedTimelineItemKind; id: string } | null>(null);

  useEffect(() => {
    onMount?.();
  }, [onMount]);

  const hourHeight = useTimelineZoomStore((state) => state.hourHeight);

  const activeDragCardId = activeDrag?.cardId ?? null;
  const {
    activeDay,
    eventsForDay,
    calendarTimedEventsForDay,
    calendarAllDayForDay,
    abMeta,
    activeBuckets,
    indicatorVisible,
    indicatorPosition,
    overlayBucketEntry,
    overlayOverdueCard,
    overlayCardData,
  } = useMemo(
    () =>
      buildMobileTimelineViewState({
        days,
        activeDayIndex,
        eventsByDay,
        calendarEventsByDay,
        calendarAllDayByDay,
        abBuckets,
        overdue,
        indicatorTop,
        indicatorDayIso,
        activeDragCardId,
      }),
    [
      abBuckets,
      activeDayIndex,
      activeDragCardId,
      calendarAllDayByDay,
      calendarEventsByDay,
      days,
      eventsByDay,
      indicatorDayIso,
      indicatorTop,
      overdue,
    ]
  );

  useEffect(() => {
    setActiveStackItem(null);
  }, [activeDay?.isoDate]);

  useEffect(() => {
    if (contextMenuCardId) {
      setActiveStackItem({ kind: "card", id: contextMenuCardId });
    }
  }, [contextMenuCardId]);

  if (!activeDay) return null;

  const handleSwipeStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (activeDrag || event.touches.length !== 1) return;
    const touch = event.touches[0];
    if (!touch) return;
    touchStartXRef.current = touch.clientX;
    touchStartYRef.current = touch.clientY;
    swipeLockedRef.current = false;
  };

  const handleSwipeMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (activeDrag || swipeLockedRef.current || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const startX = touchStartXRef.current;
    const startY = touchStartYRef.current;
    if (!touch || startX == null || startY == null) return;
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    if (Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      swipeLockedRef.current = true;
      if (dx > 0) {
        onPrevDay();
      } else {
        onNextDay();
      }
    }
  };

  const handleSwipeEnd = () => {
    touchStartXRef.current = null;
    touchStartYRef.current = null;
    swipeLockedRef.current = false;
  };

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
        className="relative flex h-full w-full flex-col bg-white overflow-x-hidden overscroll-x-none touch-pan-y"
        onKeyDownCapture={handleArrowKeyFocus}
        onTouchStart={handleSwipeStart}
        onTouchMove={handleSwipeMove}
        onTouchEnd={handleSwipeEnd}
        onTouchCancel={handleSwipeEnd}
      >
        {(status === "loading" || !days.length) && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-white/60 backdrop-blur-sm">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-sky-500" />
          </div>
        )}

        <div className="flex h-full flex-col">
          <div className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-100 bg-white px-3 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <button
              type="button"
              aria-label="前へ 1日"
              disabled={status === "loading"}
              onClick={(e) => {
                e.preventDefault();
                onPrevDay();
              }}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-[10px] text-slate-700 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-30"
            >
              {"<1"}
            </button>
            <div className="flex items-center gap-2 text-slate-800">
              {/* Zoom Controls (Left of date) */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    useTimelineZoomStore.getState().setHourHeight(hourHeight - ZOOM_STEP);
                  }}
                  disabled={hourHeight <= MIN_HOUR_HEIGHT}
                  className="flex h-6 w-6 items-center justify-center rounded bg-slate-100 text-slate-600 active:bg-slate-200 disabled:opacity-30"
                >
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M20 12H4" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    useTimelineZoomStore.getState().setHourHeight(hourHeight + ZOOM_STEP);
                  }}
                  disabled={hourHeight >= MAX_HOUR_HEIGHT}
                  className="flex h-6 w-6 items-center justify-center rounded bg-slate-100 text-slate-600 active:bg-slate-200 disabled:opacity-30"
                >
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                </button>
              </div>

              {/* Date Info */}
              <div className="flex flex-col items-center gap-0">
                <span>{activeDay.label}</span>
                <span className="text-[10px] text-slate-400 normal-case tracking-normal">
                  {activeDay.isoDate}
                </span>
              </div>
            </div>
            <button
              type="button"
              aria-label="次へ 1日"
              disabled={status === "loading"}
              onClick={(e) => {
                e.preventDefault();
                onNextDay();
              }}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-[10px] text-slate-700 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-30"
            >
              {'1>'}
            </button>
          </div>

          {calendarAllDayForDay.length > 0 && (
            <div className="border-b border-emerald-100 bg-emerald-50/80 px-3 py-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                終日（Google）
              </div>
              <div className="flex flex-wrap gap-2">
                {calendarAllDayForDay.map((item) => {
                  const meta = formatAllDayMeta({ entry: item, fallbackIsoDate: activeDay?.isoDate ?? null });
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-focus-group="timeline"
                      data-focus-part="card"
                      disabled={!onExternalEventClick}
                      onClick={() => onExternalEventClick?.(item)}
                      className="flex min-w-0 items-start gap-2 rounded-md border border-emerald-200 bg-white px-2.5 py-1.5 text-left text-[11px] font-semibold text-emerald-800 shadow-sm transition hover:border-emerald-400 hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 disabled:cursor-default disabled:opacity-80"
                      title={item.title || "Google予定"}
                    >
                      <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase leading-tight tracking-wide text-emerald-700">
                        G
                      </span>
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate max-w-[180px]">{item.title || "Google予定"}</span>
                        {meta ? (
                          <span className="truncate text-[10px] font-normal text-emerald-700">
                            {meta}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <MobileOverdueSection
            items={overdue}
            expanded={isOverdueExpanded}
            onToggle={() => setIsOverdueExpanded((current) => !current)}
            overdueSortOrder={overdueSortOrder}
            onOverdueSortOrderChange={onOverdueSortOrderChange}
            openCardModal={openCardModal}
            onToggleCheck={onToggleCheck}
            onCardContextMenu={onCardContextMenu}
            onCardContextMenuByKeyboard={onCardContextMenuByKeyboard}
            contextMenuCardId={contextMenuCardId}
          />

          <div
            className="grid flex-1 overflow-hidden"
            style={{ gridTemplateColumns: "1fr 1fr" }}
          >
            <div
              ref={timelineScrollRef}
              onScroll={(e) => onScroll?.(e.currentTarget.scrollTop)}
              className="min-w-0 border-r border-slate-100 bg-white overflow-y-auto"
            >
              <div
                className="relative grid h-full grid-cols-1"
                data-testid="timeline-grid"
                style={{ minHeight: Math.max(timelineViewportHeight, getTimelineHeight(hourHeight)) }}
              >
                <MobileTimelineColumn
                  day={activeDay}
                  events={eventsForDay}
                  indicatorVisible={indicatorVisible}
                  indicatorPosition={indicatorPosition}
                  openCardModal={openCardModal}
                  onToggleCheck={onToggleCheck}
                  pointerPreview={pointerPreview}
                  activeDragCardId={activeDragCardId}
                  calendarEvents={calendarTimedEventsForDay}
                  onExternalEventClick={onExternalEventClick}
                  timelineStartHour={timelineStartHour}
                  onCardContextMenu={onCardContextMenu}
                  onCardContextMenuByKeyboard={onCardContextMenuByKeyboard}
                  contextMenuCardId={contextMenuCardId}
                  hourHeight={hourHeight}
                  activeStackItem={activeStackItem}
                  setActiveStackItem={setActiveStackItem}
                />
              </div>
            </div>

            <div
              ref={(el) => registerAbScrollContainer?.(activeDay.isoDate, el)}
              data-ab-scroll-container="true"
              data-ab-day={activeDay.isoDate}
              className="min-w-0 overflow-y-auto overflow-x-hidden border-l border-slate-100 scrollbar-ab-thin [scrollbar-gutter:stable]"
            >
              <div className="space-y-3 px-3 pb-4">
                {abMeta?.sections.map((section) => {
                  const items = activeBuckets[section.bucket] ?? [];
                  return (
                    <MobileAbBucket
                      key={section.bucket}
                      sectionLabel={section.label}
                      bucketKey={section.bucket}
                      items={items}
                      openCardModal={openCardModal}
                      onRequestCreateBucketCard={onRequestCreateBucketCard}
                      onCreateBucketCard={onCreateBucketCard}
                      onToggleCheck={onToggleCheck}
                      bucketIndicator={bucketIndicator}
                      onCardContextMenu={onCardContextMenu}
                      onCardContextMenuByKeyboard={onCardContextMenuByKeyboard}
                      contextMenuCardId={contextMenuCardId}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Zoom Controls (Bottom Left) */}

      </div>

      <DragOverlay dropAnimation={null}>
        <TimelineDragOverlayCard
          variant="mobile"
          overlayCardData={overlayCardData}
          overlayBucketCard={overlayBucketEntry?.item ?? null}
          overlayOverdueCard={overlayOverdueCard}
        />
      </DragOverlay>
    </DndContext>
  );
}
function MobileBucketCard({
  item,
  bucketKey,
  openCardModal,
  onToggleCheck,
  bucketIndicator,
  onCardContextMenu,
  onCardContextMenuByKeyboard,
  isContextMenuOpen,
}: {
  item: TimelineBucketItem;
  bucketKey: string;
  openCardModal: (shortId: string | null, source: string) => void;
  onToggleCheck: (cardId: string, checked: boolean) => void;
  bucketIndicator: DragAndDropBindings["bucketIndicator"];
  onCardContextMenu: (e: React.MouseEvent, cardId: string) => void;
  onCardContextMenuByKeyboard: (cardId: string, rect: DOMRect) => void;
  isContextMenuOpen: boolean;
}) {
  const { setNodeRef: setTopRef, isOver: isOverTop } = useDroppable({
    id: `bucket-item-top:${bucketKey}:${item.card_id}`,
    data: { type: "bucket-item-top", bucketKey, cardId: item.card_id },
  });
  const { setNodeRef: setBottomRef, isOver: isOverBottom } = useDroppable({
    id: `bucket-item-bottom:${bucketKey}:${item.card_id}`,
    data: { type: "bucket-item-bottom", bucketKey, cardId: item.card_id },
  });
  const showFallbackBottomLine =
    bucketIndicator?.bucketKey === bucketKey && bucketIndicator.cardId === item.card_id;

  return (
    <DraggableCard
      key={item.card_id}
      id={`bucket:${item.card_id}`}
      data={{ kind: "bucket", cardId: item.card_id, bucketKey, item }}
      attachListenersToChild
      disabled={isContextMenuOpen}
    >
      <div
        className="relative flex w-full flex-col select-none pt-4"
        onContextMenu={(e) => onCardContextMenu(e, item.card_id)}
      >
        <TimelineCard
          title={item.title || ""}
          checked={item.checked}
          checklist={item.checklist}
          content={item.content ?? null}
          onToggleCheck={(checked) => onToggleCheck(item.card_id, checked)}
          cardId={item.card_id}
          badgeLabel={bucketKeyToDueBucket(bucketKey).toUpperCase()}
          timeText={buildTimelineCardTimeText(item, {
            includeDate: true,
            includeTime: false,
            includeDuration: true,
          })}
          rightMeta={null}
          note={item.excerpt ?? undefined}
          noteClampClass={TIMELINE_LIST_CARD_NOTE_CLAMP_CLASS}
          notePreviewLines={3}
          onOpen={() => openCardModal(item.short_id, "mobile-ab")}
          timePlacement="out-top"
          paddingClass="py-1"
          className="w-full min-h-0"
          onOpenContextMenu={(rect) => onCardContextMenuByKeyboard(item.card_id, rect)}
          focusGroup="bucket"
        />

        <div
          ref={setTopRef}
          className="pointer-events-none absolute left-0 right-0 z-20"
          style={{ top: -12, height: "calc(50% + 12px)" }}
        />
        <div
          ref={setBottomRef}
          className="pointer-events-none absolute left-0 right-0 z-20"
          style={{ bottom: -12, height: "calc(50% + 12px)" }}
        />

        {isOverTop && <div className="absolute left-0 right-0 top-0 h-0.5 bg-sky-500 z-30" />}
        {(isOverBottom || showFallbackBottomLine) && (
          <div className="absolute left-0 right-0 bottom-0 h-0.5 bg-sky-50/10 z-0" />
        )}
      </div>
    </DraggableCard>
  );
}
