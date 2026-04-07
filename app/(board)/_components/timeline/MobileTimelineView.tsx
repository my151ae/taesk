"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DndContext, MeasuringStrategy, useDroppable, DragOverlay, type CollisionDetection } from "@dnd-kit/core";
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
import { DraggableCard } from "@/app/(board)/_components/timeline/TimelineDraggableCard";
import {
  TimelineCard,
  TIMELINE_LIST_CARD_NOTE_CLAMP_CLASS,
} from "@/app/(board)/_components/timeline/TimelineCard";
import { resolveTimelineEventTone } from "@/app/(board)/_components/timeline/timeline-event-tone";
import { buildTimelineCardTimeText } from "@/app/(board)/_components/timeline/timeline-card-meta";
import { TimelineDragOverlayCard } from "@/app/(board)/_components/timeline/TimelineDragOverlayCard";
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
  currentIsoDate,
  currentMinutes,
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
  currentIsoDate: string | null;
  currentMinutes: number | null;
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
          const tone = resolveTimelineEventTone(event, currentIsoDate, currentMinutes);
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
                  openButtonTestId={`cardOpenButton-mobile-timeline-${event.card_id}`}
                  showOpenButton
                  dataTestId="timeline-event"
                  className={`w-full h-full pt-0 ${activeStackItem?.kind === "card" && activeStackItem.id === event.card_id ? "ring-2 ring-sky-400 shadow-md" : ""}`}
                  backgroundClass={tone.backgroundClass}
                  borderClassName={tone.borderClassName}
                  titleBackgroundClassName={tone.titleBackgroundClassName}
                  titleClassName={tone.titleClassName}
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
  anchorDayIso: string;
  setAnchorTimelineScrollNode?: (node: HTMLDivElement | null) => void;
  onAnchorTimelineScroll?: (dayIso: string, scrollTop: number) => void;
  onAnchorDayChange?: (isoDate: string) => Promise<void>;
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
  currentIsoDate: string | null;
  currentMinutes: number | null;
};

export default function MobileTimelineView({
  timelineScrollRef,
  days,
  anchorDayIso,
  setAnchorTimelineScrollNode,
  onAnchorTimelineScroll,
  onAnchorDayChange,
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
  pointerPreview,
  activeDrag,
  onExternalEventClick,
  timelineStartHour = 0,
  onCardContextMenu,
  onCardContextMenuByKeyboard,
  contextMenuCardId,
  currentIsoDate,
  currentMinutes,
}: MobileTimelineViewProps) {
  const SWIPE_COMMIT_DISTANCE_PX = 18;
  const SCROLL_SETTLE_DELAY_MS = 80;
  const handleArrowKeyFocus = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    handleTimelineCardArrowFocus(event);
  }, []);

  const railRef = useRef<HTMLDivElement | null>(null);
  const anchorTimelineNodeRef = useRef<HTMLDivElement | null>(null);
  const programmaticRailScrollRef = useRef(false);
  const scrollSettleTimerRef = useRef<number | null>(null);
  const touchGestureRef = useRef<{ startX: number; startY: number; startIndex: number } | null>(null);
  const pendingAnchorIsoRef = useRef<string | null>(null);
  const pendingScrollCommitIsoRef = useRef<string | null>(null);
  const [visiblePaneIds, setVisiblePaneIds] = useState<string[]>(anchorDayIso ? [anchorDayIso] : []);
  const [activeStackItem, setActiveStackItem] = useState<{ kind: StackedTimelineItemKind; id: string } | null>(null);
  const [touchSnapDisabled, setTouchSnapDisabled] = useState(false);

  useEffect(() => {
    onMount?.();
  }, [onMount]);

  const hourHeight = useTimelineZoomStore((state) => state.hourHeight);

  const activeDragCardId = activeDrag?.cardId ?? null;
  const {
    anchorWindowIndex,
    windowDayStates,
  } = useMemo(
    () =>
      buildMobileTimelineViewState({
        days,
        anchorDayIso,
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
      activeDragCardId,
      anchorDayIso,
      calendarAllDayByDay,
      calendarEventsByDay,
      days,
      eventsByDay,
      indicatorDayIso,
      indicatorTop,
      overdue,
    ]
  );
  const anchorDayState = windowDayStates[anchorWindowIndex] ?? windowDayStates[0] ?? null;
  const overlayBucketEntry = anchorDayState?.overlayBucketEntry ?? null;
  const overlayOverdueCard = anchorDayState?.overlayOverdueCard ?? null;
  const overlayCardData = anchorDayState?.overlayCardData ?? null;

  useEffect(() => {
    setActiveStackItem(null);
  }, [anchorDayState?.day.isoDate]);

  useEffect(() => {
    if (contextMenuCardId) {
      setActiveStackItem({ kind: "card", id: contextMenuCardId });
    }
  }, [contextMenuCardId]);

  useEffect(() => {
    if (pendingAnchorIsoRef.current === anchorDayIso) {
      pendingAnchorIsoRef.current = null;
    }
  }, [anchorDayIso]);

  useLayoutEffect(() => {
    if (scrollSettleTimerRef.current != null) {
      window.clearTimeout(scrollSettleTimerRef.current);
      scrollSettleTimerRef.current = null;
    }
    if (!railRef.current || !windowDayStates.length) return;
    programmaticRailScrollRef.current = true;
    railRef.current.scrollTo({ left: railRef.current.clientWidth * anchorWindowIndex, behavior: "auto" });
    window.requestAnimationFrame(() => {
      programmaticRailScrollRef.current = false;
    });
  }, [anchorWindowIndex, windowDayStates.length]);

  const updateVisiblePanes = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;
    const paneWidth = rail.clientWidth;
    if (!paneWidth) return;
    const viewportLeft = rail.scrollLeft;
    const viewportRight = viewportLeft + paneWidth;
    const nextVisible = windowDayStates
      .filter((state, index) => {
        if (state.day.isoDate === anchorDayIso) return true;
        const paneLeft = index * paneWidth;
        const paneRight = paneLeft + paneWidth;
        const overlap = Math.max(0, Math.min(paneRight, viewportRight) - Math.max(paneLeft, viewportLeft));
        return overlap / paneWidth >= 0.5;
      })
      .map((state) => state.day.isoDate);
    setVisiblePaneIds((current) => {
      if (
        current.length === nextVisible.length &&
        current.every((value, index) => value === nextVisible[index])
      ) {
        return current;
      }
      return nextVisible;
    });
  }, [anchorDayIso, windowDayStates]);

  useEffect(() => {
    updateVisiblePanes();
  }, [updateVisiblePanes]);

  useEffect(() => {
    return () => {
      if (scrollSettleTimerRef.current != null) {
        window.clearTimeout(scrollSettleTimerRef.current);
      }
    };
  }, []);

  const setAnchorTimelineNode = useCallback((node: HTMLDivElement | null) => {
    anchorTimelineNodeRef.current = node;
    setAnchorTimelineScrollNode?.(node);
  }, [setAnchorTimelineScrollNode]);

  const commitAnchorDay = useCallback((nextAnchorIso: string | null) => {
    if (!nextAnchorIso || nextAnchorIso === anchorDayIso || pendingAnchorIsoRef.current === nextAnchorIso) return;
    pendingAnchorIsoRef.current = nextAnchorIso;
    void onAnchorDayChange?.(nextAnchorIso);
  }, [anchorDayIso, onAnchorDayChange]);

  const snapToPaneIndex = useCallback((paneIndex: number, behavior: ScrollBehavior = "smooth", commitAnchor = false) => {
    const rail = railRef.current;
    if (!rail || !windowDayStates.length) return;
    const paneWidth = rail.clientWidth || 1;
    const nextIndex = Math.max(0, Math.min(windowDayStates.length - 1, paneIndex));
    const nextAnchorIso = windowDayStates[nextIndex]?.day.isoDate ?? null;
    if (commitAnchor) {
      if (behavior === "auto") {
        pendingScrollCommitIsoRef.current = null;
        commitAnchorDay(nextAnchorIso);
      } else {
        pendingScrollCommitIsoRef.current = nextAnchorIso;
      }
    }
    rail.scrollTo({ left: nextIndex * paneWidth, behavior });
  }, [commitAnchorDay, windowDayStates]);

  const handleRailScroll = useCallback(() => {
    updateVisiblePanes();
    if (activeDrag || programmaticRailScrollRef.current || !railRef.current) return;
    if (scrollSettleTimerRef.current != null) {
      window.clearTimeout(scrollSettleTimerRef.current);
    }
    scrollSettleTimerRef.current = window.setTimeout(() => {
      const rail = railRef.current;
      if (!rail || !windowDayStates.length) return;
      const paneWidth = rail.clientWidth || 1;
      const paneIndex = Math.max(0, Math.min(windowDayStates.length - 1, Math.round(rail.scrollLeft / paneWidth)));
      const targetLeft = paneIndex * paneWidth;
      const aligned = Math.abs(rail.scrollLeft - targetLeft) <= 1;
      if (!aligned) {
        snapToPaneIndex(paneIndex, touchSnapDisabled ? "auto" : "smooth", false);
        return;
      }
      if (touchSnapDisabled) {
        setTouchSnapDisabled(false);
      }
      const settledIso = pendingScrollCommitIsoRef.current ?? windowDayStates[paneIndex]?.day.isoDate ?? null;
      pendingScrollCommitIsoRef.current = null;
      commitAnchorDay(settledIso);
    }, SCROLL_SETTLE_DELAY_MS);
  }, [activeDrag, commitAnchorDay, snapToPaneIndex, touchSnapDisabled, updateVisiblePanes, windowDayStates]);

  const scrollToPane = useCallback((delta: number) => {
    const rail = railRef.current;
    if (!rail) return;
    const paneWidth = rail.clientWidth || 1;
    const currentIndex = Math.round(rail.scrollLeft / paneWidth);
    const nextIndex = Math.max(0, Math.min(windowDayStates.length - 1, currentIndex + delta));
    snapToPaneIndex(nextIndex, "smooth", true);
  }, [snapToPaneIndex, windowDayStates.length]);

  const handleRailTouchStart = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (activeDrag || !railRef.current) return;
    const touch = event.touches[0];
    if (!touch) return;
    setTouchSnapDisabled(true);
    const paneWidth = railRef.current.clientWidth || 1;
    touchGestureRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      startIndex: Math.max(0, Math.min(windowDayStates.length - 1, Math.round(railRef.current.scrollLeft / paneWidth))),
    };
  }, [activeDrag, windowDayStates.length]);

  const handleRailTouchEnd = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    const gesture = touchGestureRef.current;
    touchGestureRef.current = null;
    if (!gesture || activeDrag || programmaticRailScrollRef.current || !railRef.current || !windowDayStates.length) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const deltaX = touch.clientX - gesture.startX;
    const deltaY = touch.clientY - gesture.startY;
    const paneWidth = railRef.current.clientWidth || 1;
    const currentIndex = Math.max(0, Math.min(windowDayStates.length - 1, Math.round(railRef.current.scrollLeft / paneWidth)));
    let nextIndex = currentIndex;
    if (Math.abs(deltaX) >= SWIPE_COMMIT_DISTANCE_PX && Math.abs(deltaX) > Math.abs(deltaY)) {
      nextIndex = Math.max(0, Math.min(windowDayStates.length - 1, gesture.startIndex + (deltaX < 0 ? 1 : -1)));
    }
    snapToPaneIndex(nextIndex, "auto", true);
  }, [activeDrag, snapToPaneIndex, windowDayStates.length]);

  const mobileCollisionDetection = useMemo<CollisionDetection>(() => {
    return (args) => {
      const filtered = args.droppableContainers.filter((container) => {
        const node = container.node.current;
        const pane = node instanceof HTMLElement ? node.closest("[data-mobile-pane-id]") : null;
        const paneId = pane instanceof HTMLElement ? pane.dataset.mobilePaneId ?? null : null;
        return !paneId || visiblePaneIds.includes(paneId);
      });
      return bucketsFirstCollisionDetection({ ...args, droppableContainers: filtered });
    };
  }, [visiblePaneIds]);

  if (!anchorDayState) return null;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
      collisionDetection={mobileCollisionDetection}
      measuring={{
        droppable: { strategy: MeasuringStrategy.Always },
      }}
      autoScroll={{
        enabled: false,
        threshold: { x: 0, y: 0.2 },
        acceleration: 1,
      }}
    >
      <div className="relative flex h-full w-full flex-col bg-white" onKeyDownCapture={handleArrowKeyFocus}>
        {(status === "loading" || !days.length) && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-white/60 backdrop-blur-sm">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-sky-500" />
          </div>
        )}

        <div className="flex h-full flex-col">
          <div
            ref={railRef}
            data-testid="mobile-timeline-rail"
            className={`flex flex-1 ${activeDrag ? "overflow-x-hidden [scroll-snap-type:none]" : touchSnapDisabled ? "overflow-x-auto [scroll-snap-type:none]" : "overflow-x-auto snap-x snap-mandatory"} overflow-y-hidden`}
            onScroll={handleRailScroll}
            onTouchStart={handleRailTouchStart}
            onTouchEnd={handleRailTouchEnd}
            onTouchCancel={() => {
              touchGestureRef.current = null;
              setTouchSnapDisabled(false);
            }}
            style={{ touchAction: activeDrag ? "pan-y" : "pan-x" }}
          >
            {windowDayStates.map((state) => {
              const isAnchorPane = state.day.isoDate === anchorDayState.day.isoDate;
              return (
                <div
                  key={state.day.isoDate}
                  data-mobile-pane-id={state.day.isoDate}
                  className="flex min-h-0 min-w-full snap-start flex-col"
                >
                  <div className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-100 bg-white px-3 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <button
                      type="button"
                      aria-label="前へ 1日"
                      disabled={status === "loading"}
                      onClick={(e) => {
                        e.preventDefault();
                        scrollToPane(-1);
                      }}
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-[10px] text-slate-700 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      {"<1"}
                    </button>
                    <div className="flex items-center gap-2 text-slate-800">
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
                      <div className="flex flex-col items-center gap-0">
                        <span>{state.day.label}</span>
                        <span className="text-[10px] text-slate-400 normal-case tracking-normal">
                          {state.day.isoDate}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label="次へ 1日"
                      disabled={status === "loading"}
                      onClick={(e) => {
                        e.preventDefault();
                        scrollToPane(1);
                      }}
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-[10px] text-slate-700 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      {'1>'}
                    </button>
                  </div>
                  {state.calendarAllDay.length > 0 ? (
                    <div className="border-b border-emerald-100 bg-emerald-50/80 px-3 py-2">
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">終日（Google）</div>
                      <div className="flex flex-wrap gap-2">
                        {state.calendarAllDay.map((item) => {
                          const meta = formatAllDayMeta({ entry: item, fallbackIsoDate: state.day.isoDate });
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
                              <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase leading-tight tracking-wide text-emerald-700">G</span>
                              <span className="flex min-w-0 flex-col gap-0.5">
                                <span className="truncate max-w-[180px]">{item.title || "Google予定"}</span>
                                {meta ? <span className="truncate text-[10px] font-normal text-emerald-700">{meta}</span> : null}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  <div className="grid flex-1 overflow-hidden" style={{ gridTemplateColumns: "1fr 1fr" }}>
                    <div
                      ref={(node) => {
                        if (isAnchorPane) {
                          setAnchorTimelineNode(node);
                        }
                      }}
                      onScroll={(e) => {
                        if (isAnchorPane) {
                          onAnchorTimelineScroll?.(state.day.isoDate, e.currentTarget.scrollTop);
                        } else {
                          onScroll?.(e.currentTarget.scrollTop);
                        }
                      }}
                      className="min-w-0 border-r border-slate-100 bg-white overflow-y-auto"
                      style={{ touchAction: "pan-y" }}
                    >
                      <div
                        className="relative grid h-full grid-cols-1"
                        data-testid={isAnchorPane ? "timeline-grid" : undefined}
                        style={{ minHeight: Math.max(timelineViewportHeight, getTimelineHeight(hourHeight)) }}
                      >
                        <MobileTimelineColumn
                          day={state.day}
                          events={state.events}
                          indicatorVisible={state.indicatorVisible}
                          indicatorPosition={state.indicatorPosition}
                          openCardModal={openCardModal}
                          onToggleCheck={onToggleCheck}
                          pointerPreview={pointerPreview}
                          activeDragCardId={activeDragCardId}
                          calendarEvents={state.calendarTimed}
                          onExternalEventClick={onExternalEventClick}
                          timelineStartHour={timelineStartHour}
                          onCardContextMenu={onCardContextMenu}
                          onCardContextMenuByKeyboard={onCardContextMenuByKeyboard}
                          contextMenuCardId={contextMenuCardId}
                          hourHeight={hourHeight}
                          activeStackItem={activeStackItem}
                          setActiveStackItem={setActiveStackItem}
                          currentIsoDate={currentIsoDate}
                          currentMinutes={currentMinutes}
                        />
                      </div>
                    </div>

                    <div
                      ref={(el) => registerAbScrollContainer?.(state.day.isoDate, visiblePaneIds.includes(state.day.isoDate) ? el : null)}
                      data-ab-scroll-container="true"
                      data-ab-day={state.day.isoDate}
                      className="min-w-0 overflow-y-auto overflow-x-hidden border-l border-slate-100 scrollbar-ab-thin [scrollbar-gutter:stable]"
                      style={{ touchAction: "pan-y" }}
                    >
                      <div className="space-y-3 px-3 pb-4">
                        {state.abMeta?.sections.map((section) => {
                          const items = state.activeBuckets[section.bucket] ?? [];
                          return (
                            <MobileAbBucket
                              key={`${state.day.isoDate}-${section.bucket}`}
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
              );
            })}
          </div>
        </div>
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
          openButtonTestId={`cardOpenButton-mobile-ab-${item.card_id}`}
          showOpenButton
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
