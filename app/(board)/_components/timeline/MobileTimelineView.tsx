"use client";

import { useEffect, useMemo } from "react";
import clsx from "clsx";
import { DndContext, MeasuringStrategy, useDroppable, DragOverlay } from "@dnd-kit/core";
import {
  HOUR_HEIGHT,
  getDisplayHours,
  TIMELINE_HEIGHT,
  calculateEventLayout,
  minuteToPixels,
  timeLabel,
  minutesToTime,
  EventLayout,
  TimelineBucketItem,
  TimelineDay,
  TimelineEvent,
  buildAbMeta,
  getMinutesFromTime,
  ExternalCalendarEntry,
  formatDuration,
} from "@/app/(board)/_utils/timeline-helpers";
import { bucketKeyToDueBucket } from "@/lib/bucket-normalization";
import { DraggableCard } from "@/app/(board)/_components/timeline/TimelineDraggableCard";
import { TimelineCard } from "@/app/(board)/_components/timeline/TimelineCard";
import { bucketsFirstCollisionDetection, type useTimelineDragAndDrop } from "@/app/(board)/_hooks/useTimelineDragAndDrop";

type DragAndDropBindings = ReturnType<typeof useTimelineDragAndDrop>;



function MobileTimelineColumn({
  day,
  events,
  indicatorVisible,
  indicatorPosition,
  layoutMap,
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
}: {
  day: TimelineDay;
  events: TimelineEvent[];
  indicatorVisible: boolean;
  indicatorPosition: number;
  layoutMap: Record<string, EventLayout>;
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
}) {
  const { setNodeRef } = useDroppable({ id: `day:${day.isoDate}`, data: { type: "timeline-column", day } });
  const calendarLayout = calculateEventLayout(
    calendarEvents.map((entry) => ({
      card_id: entry.id,
      due_date: day.isoDate,
      due_start: minutesToTime(entry.startMinutes),
      due_end: minutesToTime(entry.startMinutes + entry.durationMinutes),
      durationMinutes: entry.durationMinutes,
      title: entry.title,
      tags: [],
      priority: null,
      checked: false,
      short_id: null,
      slug: null,
    }))
  );

  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-0" style={{ height: TIMELINE_HEIGHT }}>
        {getDisplayHours(timelineStartHour).map((hour, idx) => (
          <div
            key={hour}
            className="absolute left-0 right-0 border-b border-slate-200"
            style={{ top: idx * HOUR_HEIGHT }}
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

      <div ref={setNodeRef} className="relative" style={{ height: TIMELINE_HEIGHT }}>
        {pointerPreview.visible && pointerPreview.dayIso === day.isoDate && (
          <div
            className="pointer-events-none absolute z-10 border border-dashed border-sky-400 bg-sky-50/60"
            style={{
              top: minuteToPixels(pointerPreview.startMinutes, timelineStartHour),
              height: minuteToPixels(pointerPreview.startMinutes + pointerPreview.durationMinutes, timelineStartHour) - minuteToPixels(pointerPreview.startMinutes, timelineStartHour),
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

        {calendarEvents.map((calendarEvent) => {
          const layout = calendarLayout[calendarEvent.id];
          return (
            <button
              key={calendarEvent.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onExternalEventClick?.(calendarEvent);
              }}
              className="absolute z-0 rounded-md border border-emerald-200 bg-emerald-50/80 px-2 py-1 text-[10px] text-emerald-700 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.15)] text-left hover:bg-emerald-100"
              style={{
                top: minuteToPixels(calendarEvent.startMinutes, timelineStartHour),
                height: Math.max(minuteToPixels(calendarEvent.startMinutes + calendarEvent.durationMinutes, timelineStartHour) - minuteToPixels(calendarEvent.startMinutes, timelineStartHour), 18),
                left: layout?.left ?? "0%",
                width: layout?.width ?? "100%",
              }}
            >
              <div className="flex items-center gap-1">
                <span className="truncate font-semibold">{calendarEvent.title || "Google予定"}</span>
                <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase leading-tight tracking-wide text-emerald-700">
                  G
                </span>
              </div>
              <p className="text-[9px] text-emerald-600">
                {calendarEvent.isAllDay
                  ? "終日"
                  : timeLabel(
                    minutesToTime(calendarEvent.startMinutes),
                    minutesToTime(calendarEvent.startMinutes + calendarEvent.durationMinutes)
                  )}
              </p>
            </button>
          );
        })}

        {events.map((event) => {
          const start = getMinutesFromTime(event.due_start ?? null) ?? 0;
          const duration = event.durationMinutes ?? 60;
          const top = minuteToPixels(start, timelineStartHour);
          const height = Math.max(minuteToPixels(start + duration, timelineStartHour) - minuteToPixels(start, timelineStartHour), 10);
          const layout = layoutMap[event.card_id];

          return (
            <DraggableCard
              key={event.card_id}
              id={`event:${event.card_id}`}
              data={{ kind: "event", event, cardId: event.card_id }}
              attachListenersToChild
              disabled={contextMenuCardId === event.card_id}
            >
              <div
                className="absolute"
                style={{
                  top,
                  height,
                  left: layout?.left ?? "0%",
                  width: layout?.width ?? "100%",
                }}
                onContextMenu={(e) => onCardContextMenu(e, event.card_id)}
              >
                <TimelineCard
                  title={event.title || ""}
                  checked={event.checked}
                  onToggleCheck={(next) => onToggleCheck(event.card_id, next)}
                  badgeLabel={(event.due_bucket ?? 'a').toUpperCase()}
                  duration={undefined}
                  timeText={`${timeLabel(event.due_start, event.due_end)} (${formatDuration(Math.max(event.durationMinutes ?? 60, 0))})`}
                  timePlacement={(event.durationMinutes ?? 60) < 55 ? 'out-top' : 'top'}
                  onOpen={() => openCardModal(event.short_id, "mobile-timeline")}
                  className={`w-full h-full ${(event.durationMinutes ?? 60) < 55 ? 'pt-0' : 'pt-4'}`}
                  tabIndex={0}
                  onOpenContextMenu={(rect) => onCardContextMenuByKeyboard(event.card_id, rect)}
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
  const lastCardId = items.length ? items[items.length - 1]?.card_id : undefined;

  return (
    <div
      ref={setBucketRef}
      className={`border border-slate-200 bg-slate-50/70 shadow-inner ${isOver ? "ring-1 ring-sky-200 bg-slate-50" : ""}`}
    >
      <div className="border-b border-slate-200 px-3 py-1.5">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold text-slate-700">{sectionLabel}</p>
          <button
            type="button"
            aria-label="カードを追加"
            onClick={(e) => {
              e.stopPropagation();
              onCreateBucketCard(bucketKey);
            }}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-transparent text-slate-500 hover:border-slate-200 hover:bg-white hover:text-sky-700"
            data-testid={`ab-add-${bucketKey}`}
          >
            <span className="text-base leading-none">＋</span>
          </button>
        </div>
      </div>
      <div className="space-y-1 px-2 pb-2">
        {items.length === 0 ? (
          <p className="px-1 py-3 text-[11px] text-slate-400">{isOver ? "ここにドロップ" : "カードがありません"}</p>
        ) : (
          items.map((item) => (
            <MobileBucketCard
              key={item.card_id}
              item={item}
              bucketKey={bucketKey}
              openCardModal={openCardModal}
              onToggleCheck={onToggleCheck}
              bucketIndicator={bucketIndicator}
              onCardContextMenu={onCardContextMenu}
              onCardContextMenuByKeyboard={onCardContextMenuByKeyboard}
              isContextMenuOpen={contextMenuCardId === item.card_id}
            />
          ))
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCreateBucketCard(bucketKey, lastCardId);
          }}
          className="flex w-full items-center gap-2 rounded-none border border-slate-200/70 bg-white/60 px-3 py-2 text-[11px] font-semibold text-slate-400 hover:border-sky-300 hover:bg-white hover:text-sky-700"
          data-testid={`ab-add-bottom-${bucketKey}`}
        >
          <span className="text-base leading-none">＋</span>
          <span>追加</span>
        </button>
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
  registerAbScrollContainer?: (dayIso: string, el: HTMLDivElement | null) => void;
  eventsByDay: Record<string, TimelineEvent[]>;
  abBuckets: Record<string, TimelineBucketItem[]>;
  calendarEventsByDay: Record<string, ExternalCalendarEntry[]>;
  calendarAllDayByDay: Record<string, ExternalCalendarEntry[]>;
  indicatorTop: number | null;
  indicatorDayIso: string | null;
  timelineViewportHeight: number;
  openCardModal: (shortId: string | null, source: string) => void;
  onCreateBucketCard: (bucketKey: string, afterCardId?: string) => void;
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
  calendarEventsByDay,
  calendarAllDayByDay,
  indicatorTop,
  indicatorDayIso,
  timelineViewportHeight,
  openCardModal,
  onCreateBucketCard,
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
}: MobileTimelineViewProps) {
  useEffect(() => {
    onMount?.();
  }, [onMount]);

  const activeDay = useMemo(() => days[activeDayIndex] ?? days[0] ?? null, [activeDayIndex, days]);

  const eventsForDay = useMemo(() => {
    if (!activeDay) return [] as TimelineEvent[];
    return eventsByDay[activeDay.isoDate] ?? [];
  }, [activeDay, eventsByDay]);

  const calendarTimedEventsForDay = useMemo(() => {
    if (!activeDay) return [] as ExternalCalendarEntry[];
    return calendarEventsByDay[activeDay.isoDate] ?? [];
  }, [activeDay, calendarEventsByDay]);

  const calendarAllDayForDay = useMemo(() => {
    if (!activeDay) return [] as ExternalCalendarEntry[];
    return calendarAllDayByDay[activeDay.isoDate] ?? [];
  }, [activeDay, calendarAllDayByDay]);

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

  const formatAllDayMeta = (entry: ExternalCalendarEntry) => {
    const startIso = entry.startDate ?? entry.dayIso ?? activeDay?.isoDate ?? null;
    const endIso = entry.endDate ? shiftIsoDate(entry.endDate, -1) : startIso;
    const startLabel = formatShortDate(startIso);
    const endLabel = formatShortDate(endIso);
    const range = startLabel && endLabel && startLabel !== endLabel ? `${startLabel}–${endLabel}` : startLabel ?? endLabel;
    const tzLabel = entry.displayTz && entry.displayTz !== "Asia/Tokyo" ? entry.displayTz : null;
    return [range, tzLabel].filter(Boolean).join(" · ");
  };

  const layoutMap = useMemo(() => calculateEventLayout(eventsForDay), [eventsForDay]);
  const abMeta = useMemo(() => (activeDay ? buildAbMeta(activeDay) : null), [activeDay]);

  const activeDayIso = activeDay?.isoDate ?? null;
  const indicatorVisible = indicatorTop != null && !!activeDayIso && indicatorDayIso === activeDayIso;
  const indicatorPosition = indicatorTop ?? 0;
  const activeBuckets = useMemo(() => {
    if (!activeDay) return {} as Record<string, TimelineBucketItem[]>;
    const entries = Object.entries(abBuckets || {}).filter(([key]) => key.startsWith(activeDay.key));
    return Object.fromEntries(entries);
  }, [abBuckets, activeDay]);
  const activeDragCardId = activeDrag?.cardId ?? null;
  const overlayBucketEntry = useMemo(() => {
    const entries = Object.entries(activeBuckets);
    for (const [key, items] of entries) {
      const found = items.find((item) => item.card_id === activeDragCardId);
      if (found) return { key, item: found };
    }
    return null;
  }, [activeBuckets, activeDragCardId]);
  const overlayBucketCard = overlayBucketEntry?.item ?? null;
  const overlayBucketKey = overlayBucketEntry?.key ?? null;
  const overlayTimelineEvent = eventsForDay.find((event) => event.card_id === activeDragCardId);
  const overlayCardData = useMemo(() => {
    if (overlayTimelineEvent) {
      return {
        title: overlayTimelineEvent.title || "",
        badge: overlayTimelineEvent.due_bucket ?? "a",
        timeText: `${timeLabel(overlayTimelineEvent.due_start, overlayTimelineEvent.due_end)} (${formatDuration(overlayTimelineEvent.durationMinutes ?? 60)})`,
      };
    }
    if (overlayBucketCard) {
      return {
        title: overlayBucketCard.title || "",
        badge: overlayBucketKey ? bucketKeyToDueBucket(overlayBucketKey) : "a",
        timeText: overlayBucketCard.duration
          ? `(${formatDuration(overlayBucketCard.duration)}) ${overlayBucketCard.due_start ? timeLabel(overlayBucketCard.due_start, overlayBucketCard.due_end) : ""}`
          : (overlayBucketCard.due_start ? timeLabel(overlayBucketCard.due_start, overlayBucketCard.due_end) : null),
      };
    }
    return null;
  }, [overlayBucketCard, overlayBucketKey, overlayTimelineEvent]);

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
        enabled: false,
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

        <div className="flex h-full flex-col">
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

          {calendarAllDayForDay.length > 0 && (
            <div className="border-b border-emerald-100 bg-emerald-50/80 px-3 py-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                終日（Google）
              </div>
              <div className="flex flex-wrap gap-2">
                {calendarAllDayForDay.map((item) => {
                  const meta = formatAllDayMeta(item);
                  return (
                    <button
                      key={item.id}
                      type="button"
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

          <div
            className="grid flex-1 overflow-hidden"
            style={{ gridTemplateColumns: "1fr 1fr" }}
          >
            <div
              ref={timelineScrollRef}
              onScroll={(e) => onScroll?.(e.currentTarget.scrollTop)}
              className="min-w-0 border-r border-slate-100 bg-white overflow-y-auto"
            >
              <div className="relative grid h-full grid-cols-[60px_1fr]" style={{ minHeight: Math.max(timelineViewportHeight, TIMELINE_HEIGHT) }}>
                <div className="relative border-r border-slate-100 text-[10px] font-semibold text-slate-500">
                  {getDisplayHours(timelineStartHour).map((hour, idx) => (
                    <div key={hour} className="flex h-10 items-start justify-end pr-2">
                      {idx === 0 ? null : <span className="-mt-1 leading-none">{hour}</span>}
                    </div>
                  ))}
                </div>

                <MobileTimelineColumn
                  day={activeDay}
                  events={eventsForDay}
                  indicatorVisible={indicatorVisible}
                  indicatorPosition={indicatorPosition}
                  layoutMap={layoutMap}
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
                />
              </div>
            </div>

            <div
              ref={(el) => registerAbScrollContainer?.(activeDay.isoDate, el)}
              data-ab-scroll-container="true"
              data-ab-day={activeDay.isoDate}
              className="min-w-0 overflow-y-auto border-l border-slate-100 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-200"
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
      </div>

      <DragOverlay dropAnimation={null}>
        {overlayCardData ? (
          <MobileDragOverlayCard
            title={overlayCardData.title}
            badge={overlayCardData.badge}
            timeText={overlayCardData.timeText}
          />
        ) : null}
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
        className="relative flex w-full flex-col select-none"
        onContextMenu={(e) => onCardContextMenu(e, item.card_id)}
      >
        <TimelineCard
          title={item.title || ""}
          checked={item.checked}
          onToggleCheck={(checked) => onToggleCheck(item.card_id, checked)}
          badgeLabel={bucketKeyToDueBucket(bucketKey).toUpperCase()}
          duration={undefined}
          timeText={
            <span className="flex gap-1">
              {item.duration ? <span>({formatDuration(item.duration)})</span> : null}
              {item.due_start ? timeLabel(item.due_start, item.due_end) : null}
            </span>
          }
          onOpen={() => openCardModal(item.short_id, "mobile-ab")}
          timePlacement="inline"
          className="w-full"
          tabIndex={0}
          onOpenContextMenu={(rect) => onCardContextMenuByKeyboard(item.card_id, rect)}
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
          <div className="absolute left-0 right-0 bottom-0 h-0.5 bg-sky-500 z-30" />
        )}
      </div>
    </DraggableCard>
  );
}

function MobileDragOverlayCard({
  title,
  badge,
  timeText,
}: {
  title: string;
  badge: string;
  timeText: string | null;
}) {
  return (
    <div className="pointer-events-none w-[220px] max-w-[260px] rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
      <div className="flex items-start gap-2">
        <span className="rounded-full border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-600 shadow-sm">
          {badge.toUpperCase()}
        </span>
        <div className={clsx("min-w-0 flex-1 text-[12px] font-semibold leading-tight line-clamp-2 break-words", !title ? "text-slate-400" : "text-slate-800")}>
          {title || "Untitled card"}
        </div>
      </div>
      {timeText ? <div className="mt-1 text-[11px] text-slate-600">{timeText}</div> : null}
    </div>
  );
}
