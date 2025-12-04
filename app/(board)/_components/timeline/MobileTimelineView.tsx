"use client";

import { useEffect, useMemo, useState } from "react";
import { DndContext, MeasuringStrategy, useDroppable, DragOverlay } from "@dnd-kit/core";
import {
  HOUR_HEIGHT,
  HOURS,
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
} from "@/app/(board)/_utils/timeline-helpers";
import { bucketKeyToDueBucket } from "@/lib/bucket-normalization";
import { ChecklistEditor, ChecklistSaveTrigger } from "@/app/(board)/_components/checklist/ChecklistEditor";
import { ChecklistPreview } from "@/app/(board)/_components/checklist/ChecklistPreview";
import { Checklist, normalizeChecklist, EMPTY_CHECKLIST, countNonEmptyLines } from "@/lib/checklist";
import { DraggableCard } from "@/app/(board)/_components/timeline/TimelineDraggableCard";
import { bucketsFirstCollisionDetection, type useTimelineDragAndDrop } from "@/app/(board)/_hooks/useTimelineDragAndDrop";

type DragAndDropBindings = ReturnType<typeof useTimelineDragAndDrop>;

function MobileInlineChecklist({
  cardId,
  checklist,
  editingCardId,
  onChecklistEditingChange,
  onChecklistCommit,
  showCount = false,
  previewClassName,
}: {
  cardId: string;
  checklist: Checklist | null;
  editingCardId: string | null;
  onChecklistEditingChange: (cardId: string, editing: boolean) => void;
  onChecklistCommit: (cardId: string, checklist: Checklist, trigger: ChecklistSaveTrigger) => void;
  showCount?: boolean;
  previewClassName?: string;
}) {
  const [draft, setDraft] = useState<Checklist>(normalizeChecklist(checklist ?? EMPTY_CHECKLIST));

  useEffect(() => {
    if (editingCardId === cardId) return;
    setDraft(normalizeChecklist(checklist ?? EMPTY_CHECKLIST));
  }, [checklist, cardId, editingCardId]);

  const isEditing = editingCardId === cardId;
  const lineCount = countNonEmptyLines(draft);

  return (
    <div className="mt-2 space-y-1">
      {showCount ? <div className="text-[10px] text-slate-500">☑︎ {lineCount}</div> : null}
      {isEditing ? (
        <ChecklistEditor
          value={draft}
          onChange={(next) => setDraft(next)}
          onCommit={async (next, trigger) => {
            const normalized = normalizeChecklist(next);
            await onChecklistCommit(cardId, normalized, trigger);
          }}
          onEditingChange={(editing) => onChecklistEditingChange(cardId, editing)}
          autoSaveDelayMs={1500}
          placeholder="- [ ] タスクを書く"
        />
      ) : (
        <ChecklistPreview
          checklist={draft}
          maxLines={3}
          className={previewClassName}
          onClick={(e) => {
            e.stopPropagation();
            onChecklistEditingChange(cardId, true);
          }}
        />
      )}
    </div>
  );
}

function MobileTimelineColumn({
  day,
  events,
  indicatorVisible,
  indicatorPosition,
  layoutMap,
  openCardModal,
  onToggleCheck,
  onChecklistEditingChange,
  onChecklistCommit,
  editingCardId,
  pointerPreview,
  activeDragCardId,
  calendarEvents,
}: {
  day: TimelineDay;
  events: TimelineEvent[];
  indicatorVisible: boolean;
  indicatorPosition: number;
  layoutMap: Record<string, EventLayout>;
  openCardModal: (shortId: string | null, source: string) => void;
  onToggleCheck: (cardId: string, checked: boolean) => void;
  onChecklistEditingChange: (cardId: string, editing: boolean) => void;
  onChecklistCommit: (cardId: string, checklist: Checklist, trigger: ChecklistSaveTrigger) => void;
  editingCardId: string | null;
  pointerPreview: DragAndDropBindings["pointerPreview"];
  activeDragCardId: string | null;
  calendarEvents: ExternalCalendarEntry[];
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
        {HOURS.map((hour, idx) => (
          <div
            key={hour}
            className="absolute left-0 right-0 border-b border-slate-200"
            style={{ top: idx * HOUR_HEIGHT }}
          />
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
              top: minuteToPixels(pointerPreview.startMinutes),
              height: minuteToPixels(pointerPreview.durationMinutes),
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
            <div
              key={calendarEvent.id}
              className="pointer-events-none absolute z-0 rounded-md border border-emerald-200 bg-emerald-50/80 px-2 py-1 text-[10px] text-emerald-700 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.15)]"
              style={{
                top: minuteToPixels(calendarEvent.startMinutes),
                height: Math.max(minuteToPixels(calendarEvent.durationMinutes), 18),
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
            </div>
          );
        })}

        {events.map((event) => {
          const start = getMinutesFromTime(event.due_start ?? null) ?? 0;
          const duration = Math.max(event.durationMinutes ?? 60, 30);
          const top = minuteToPixels(start);
          const height = Math.max(minuteToPixels(duration), 32);
          const layout = layoutMap[event.card_id];
          const isEditing = editingCardId === event.card_id;

          return (
            <DraggableCard
              key={event.card_id}
              id={`event:${event.card_id}`}
              data={{ kind: "event", event, cardId: event.card_id }}
              attachListenersToChild
              disabled={isEditing}
            >
              <div
                className="absolute flex flex-col gap-2 border border-slate-200 bg-white p-3 pt-5 text-left shadow-sm select-none"
                style={{
                  top,
                  height,
                  left: layout?.left ?? "0%",
                  width: layout?.width ?? "100%",
                }}
              >
                <div className="flex items-start gap-2 pr-6">
                  <button
                    type="button"
                    onClick={(native) => {
                      native.stopPropagation();
                      onToggleCheck(event.card_id, !event.checked);
                    }}
                    aria-label={event.checked ? "未完了に戻す" : "完了にする"}
                    className="mt-0.5 flex h-3.5 w-3.5 items-center justify-center border border-slate-300 text-[8px] font-bold text-transparent transition hover:border-sky-400"
                  >
                    {event.checked ? "✓" : ""}
                  </button>
                  <div className="flex min-w-0 flex-1 flex-col gap-1 text-[11px] font-semibold text-slate-800">
                    <span className="break-words leading-tight line-clamp-2">
                      {event.title || "Untitled card"}
                    </span>
                  </div>
                </div>

                <div
                  className="absolute -top-px left-0 px-1 text-[10px] font-semibold text-slate-600"
                  title={timeLabel(event.due_start, event.due_end)}
                >
                  {timeLabel(event.due_start, event.due_end)}
                </div>

                <div className="absolute right-2 top-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openCardModal(event.short_id, "mobile-timeline");
                    }}
                    className="rounded-full border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-600 shadow-sm hover:border-sky-300 hover:text-sky-700"
                  >
                    {(event.due_bucket ?? "a").toUpperCase()}
                  </button>
                </div>

                <MobileInlineChecklist
                  cardId={event.card_id}
                  checklist={event.checklist ?? null}
                  editingCardId={editingCardId}
                  onChecklistEditingChange={onChecklistEditingChange}
                  onChecklistCommit={onChecklistCommit}
                  previewClassName="break-words line-clamp-3"
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
  sectionHelper,
  bucketKey,
  items,
  openCardModal,
  onToggleCheck,
  onChecklistCommit,
  onChecklistEditingChange,
  editingCardId,
  bucketIndicator,
}: {
  sectionLabel: string;
  sectionHelper: string;
  bucketKey: string;
  items: TimelineBucketItem[];
  openCardModal: (shortId: string | null, source: string) => void;
  onToggleCheck: (cardId: string, checked: boolean) => void;
  onChecklistCommit: (cardId: string, checklist: Checklist, trigger: ChecklistSaveTrigger) => void;
  onChecklistEditingChange: (cardId: string, editing: boolean) => void;
  editingCardId: string | null;
  bucketIndicator: DragAndDropBindings["bucketIndicator"];
}) {
  const { setNodeRef: setBucketRef, isOver } = useDroppable({
    id: `bucket-drop:${bucketKey}`,
    data: { type: "ab-bucket", bucketKey },
  });

  return (
    <div
      ref={setBucketRef}
      className={`border border-slate-200 bg-slate-50/70 shadow-inner ${isOver ? "ring-1 ring-sky-200 bg-slate-50" : ""}`}
    >
      <div className="border-b border-slate-200 px-3 py-2">
        <p className="text-[11px] font-semibold text-slate-700">{sectionLabel}</p>
        <p className="text-[10px] text-slate-400">{sectionHelper}</p>
      </div>
      <div className="divide-y divide-slate-100">
        {items.length === 0 ? (
          <p className="px-3 py-3 text-[11px] text-slate-400">{isOver ? "ここにドロップ" : "カードがありません"}</p>
        ) : (
          items.map((item) => (
            <MobileBucketCard
              key={item.card_id}
              item={item}
              bucketKey={bucketKey}
              openCardModal={openCardModal}
              onToggleCheck={onToggleCheck}
              onChecklistCommit={onChecklistCommit}
              onChecklistEditingChange={onChecklistEditingChange}
              editingCardId={editingCardId}
              bucketIndicator={bucketIndicator}
            />
          ))
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
  eventsByDay: Record<string, TimelineEvent[]>;
  abBuckets: Record<string, TimelineBucketItem[]>;
  calendarEventsByDay: Record<string, ExternalCalendarEntry[]>;
  indicatorTop: number | null;
  indicatorDayIso: string | null;
  timelineViewportHeight: number;
  openCardModal: (shortId: string | null, source: string) => void;
  onToggleCheck: (cardId: string, checked: boolean) => void;
  onChecklistCommit: (cardId: string, checklist: Checklist, trigger: ChecklistSaveTrigger) => void;
  onChecklistEditingChange: (cardId: string, editing: boolean) => void;
  editingCardId: string | null;
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
};

export default function MobileTimelineView({
  timelineScrollRef,
  days,
  activeDayIndex,
  onPrevDay,
  onNextDay,
  eventsByDay,
  abBuckets,
  calendarEventsByDay,
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
  bucketIndicator,
  isOverABList,
  pointerPreview,
  activeDrag,
}: MobileTimelineViewProps) {
  const activeDay = useMemo(() => days[activeDayIndex] ?? days[0] ?? null, [activeDayIndex, days]);

  const eventsForDay = useMemo(() => {
    if (!activeDay) return [] as TimelineEvent[];
    return eventsByDay[activeDay.isoDate] ?? [];
  }, [activeDay, eventsByDay]);

  const calendarEventsForDay = useMemo(() => {
    if (!activeDay) return [] as ExternalCalendarEntry[];
    return calendarEventsByDay[activeDay.isoDate] ?? [];
  }, [activeDay, calendarEventsByDay]);

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

          <div
            className="grid flex-1 overflow-hidden"
            style={{ gridTemplateColumns: "1fr 1fr" }}
          >
            <div
              ref={timelineScrollRef}
              className="min-w-0 border-r border-slate-100 bg-white overflow-y-auto"
            >
              <div className="relative grid h-full grid-cols-[60px_1fr]" style={{ minHeight: Math.max(timelineViewportHeight, TIMELINE_HEIGHT) }}>
                <div className="relative border-r border-slate-100 text-[10px] font-semibold text-slate-500">
                  {HOURS.map((hour, idx) => (
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
                  onChecklistEditingChange={onChecklistEditingChange}
                  onChecklistCommit={onChecklistCommit}
                  editingCardId={editingCardId}
                  pointerPreview={pointerPreview}
                  activeDragCardId={activeDragCardId}
                  calendarEvents={calendarEventsForDay}
                />
              </div>
            </div>

            <div className="min-w-0 overflow-y-auto border-l border-slate-100">
              <div className="space-y-3 px-3 pb-4">
                {abMeta?.sections.map((section) => {
                  const items = activeBuckets[section.bucket] ?? [];
                  return (
                    <MobileAbBucket
                      key={section.bucket}
                      sectionLabel={section.label}
                      sectionHelper={section.helper}
                      bucketKey={section.bucket}
                      items={items}
                      openCardModal={openCardModal}
                      onToggleCheck={onToggleCheck}
                      onChecklistCommit={onChecklistCommit}
                      onChecklistEditingChange={onChecklistEditingChange}
                      editingCardId={editingCardId}
                      bucketIndicator={bucketIndicator}
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
            checklistCount={overlayCardData.checklistCount}
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
  onChecklistCommit,
  onChecklistEditingChange,
  editingCardId,
  bucketIndicator,
}: {
  item: TimelineBucketItem;
  bucketKey: string;
  openCardModal: (shortId: string | null, source: string) => void;
  onToggleCheck: (cardId: string, checked: boolean) => void;
  onChecklistCommit: (cardId: string, checklist: Checklist, trigger: ChecklistSaveTrigger) => void;
  onChecklistEditingChange: (cardId: string, editing: boolean) => void;
  editingCardId: string | null;
  bucketIndicator: DragAndDropBindings["bucketIndicator"];
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
  const isEditing = editingCardId === item.card_id;

  return (
    <DraggableCard
      key={item.card_id}
      id={`bucket:${item.card_id}`}
      data={{ kind: "bucket", cardId: item.card_id, bucketKey, item }}
      attachListenersToChild
      disabled={isEditing}
    >
      <div
        className="relative flex w-full flex-col gap-1 px-3 py-3 select-none"
      >
        <div className="absolute right-2 top-2">
          <button
            type="button"
            className="rounded-full border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-600 shadow-sm hover:border-sky-300 hover:text-sky-700"
            onClick={(e) => {
              e.stopPropagation();
              openCardModal(item.short_id, "mobile-ab");
            }}
            aria-label="カード詳細を開く"
          >
            {bucketKeyToDueBucket(bucketKey).toUpperCase()}
          </button>
        </div>

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

        <MobileInlineChecklist
          cardId={item.card_id}
          checklist={item.checklist ?? null}
          editingCardId={editingCardId}
          onChecklistEditingChange={onChecklistEditingChange}
          onChecklistCommit={onChecklistCommit}
          showCount
          previewClassName="break-words line-clamp-3"
        />

        <div className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={item.checked}
            onChange={(e) => {
              e.stopPropagation();
              onToggleCheck(item.card_id, e.target.checked);
            }}
            className="mt-0.5 h-3.5 w-3.5 cursor-pointer border-slate-300 text-sky-500"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-[12px] font-semibold text-slate-800 leading-tight line-clamp-2 break-words">
              {item.title || "Untitled card"}
            </span>
            {item.due_start && (
              <span className="text-[10px] text-slate-500 leading-tight">{timeLabel(item.due_start, item.due_end)}</span>
            )}
          </div>
        </div>
      </div>
    </DraggableCard>
  );
}

function MobileDragOverlayCard({
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
