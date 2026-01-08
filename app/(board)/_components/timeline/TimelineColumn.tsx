import { ReactNode, memo, MouseEvent } from 'react';
import { useDroppable } from '@dnd-kit/core';
import clsx from 'clsx';
import {
    TimelineDay,
    TimelineEvent,
    HOUR_HEIGHT,
    getDisplayHours,
    TIMELINE_HEIGHT,
    minuteToPixels,
    minutesToTime,
    getMinutesFromTime,
    calculateEventLayout,
    timeLabel,
    ExternalCalendarEntry
} from '@/app/(board)/_utils/timeline-helpers';
import { TimelineEventItem } from './TimelineEventItem';
import { ActiveResizeState } from '@/app/(board)/_hooks/useTimelineDragAndDrop';

type PointerPreviewState = {
    visible: boolean;
    startMinutes: number;
    durationMinutes: number;
    dayIso: string | null;
};

type TimelineColumnProps = {
    day: TimelineDay;
    events: ReadonlyArray<TimelineEvent>;
    index: number;
    indicatorTop: number | null;
    indicatorDayIso: string | null;
    timelineViewportHeight: number;
    activeDragCardId: string | null;
    pointerPreview: PointerPreviewState;
    activeResize: ActiveResizeState | null;
    selectedSlot: { day: string, minutes: number } | null;
    openCardModal: (shortId: string | null, source: string) => void;
    handleEventKeyDown: (event: TimelineEvent, native: React.KeyboardEvent<HTMLElement>) => void;
    handleColumnClick: (day: TimelineDay, minutes: number) => void;
    handleResizeStart: (e: React.PointerEvent, cardId: string, startMinutes: number, duration: number, edge: 'top' | 'bottom') => void;
    handleResizeMove: (e: React.PointerEvent) => void;
    handleResizeEnd: (e: React.PointerEvent) => void;
    onToggleCheck: (cardId: string, checked: boolean) => void;
    shrinkToHalf?: boolean;
    setSelectedSlot: (slot: { day: string, minutes: number } | null) => void;
    calendarEvents: ExternalCalendarEntry[];
    onExternalEventClick?: (entry: ExternalCalendarEntry) => void;
    timelineStartHour?: number;
    onCardContextMenu: (e: React.MouseEvent, cardId: string) => void;
    onCardContextMenuByKeyboard: (cardId: string, rect: DOMRect) => void;
    contextMenuCardId: string | null;
    // インライン編集用
    onUpdateCardTitle?: (cardId: string, newTitle: string, previousTitle: string) => void;
};

const DroppableColumn = ({ children, day }: { children: ReactNode; day: TimelineDay }) => {
    const { setNodeRef } = useDroppable({ id: `day:${day.isoDate}`, data: { type: 'timeline-column', day } });
    return (
        <div ref={setNodeRef} className="relative h-full">
            {children}
        </div>
    );
};

export const TimelineColumn = memo(function TimelineColumn({
    day,
    events,
    index,
    indicatorTop,
    indicatorDayIso,
    timelineViewportHeight,
    activeDragCardId,
    pointerPreview,
    activeResize,
    selectedSlot,
    openCardModal,
    handleEventKeyDown,
    handleColumnClick,
    handleResizeStart,
    handleResizeMove,
    handleResizeEnd,
    onToggleCheck,
    shrinkToHalf = false,
    setSelectedSlot,
    calendarEvents,
    onExternalEventClick,
    timelineStartHour = 0,
    onCardContextMenu,
    onCardContextMenuByKeyboard,
    contextMenuCardId,
    onUpdateCardTitle,
}: TimelineColumnProps) {
    const layoutMap = calculateEventLayout(events);
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
            short_id: entry.eventId ?? entry.id,
            slug: null,
        }))
    );
    const indicatorVisibleInDay = indicatorTop != null && indicatorDayIso === day.isoDate;
    const indicatorPosition = indicatorTop ?? 0;
    const isFirstColumn = index === 0;
    const combinedItems = [
        ...calendarEvents.map((calendarEvent, listIndex) => ({
            kind: 'calendar' as const,
            id: calendarEvent.id,
            listIndex,
            startMinutes: calendarEvent.startMinutes,
            entry: calendarEvent,
        })),
        ...events.map((event, listIndex) => ({
            kind: 'card' as const,
            id: event.card_id,
            listIndex,
            startMinutes: getMinutesFromTime(event.due_start ?? null) ?? 0,
            entry: event,
        })),
    ].sort((a, b) => {
        if (a.startMinutes !== b.startMinutes) return a.startMinutes - b.startMinutes;
        if (a.kind !== b.kind) return a.kind === 'calendar' ? -1 : 1;
        return a.listIndex - b.listIndex;
    });

    const handleSingleClick = (e: MouseEvent, dayIso: string) => {
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const minutesRelative = Math.floor((y / HOUR_HEIGHT) * 60);
        const snappedRelative = Math.round(minutesRelative / 15) * 15;
        // Convert relative minutes to absolute minutes
        const absoluteMinutes = (snappedRelative + timelineStartHour * 60) % (24 * 60);
        setSelectedSlot({ day: dayIso, minutes: absoluteMinutes });
    };

    const handleDoubleClick = (e: MouseEvent<HTMLDivElement>) => {
        // If ghost exists, it handles the double-click, so do nothing here
        if (selectedSlot && selectedSlot.day === day.isoDate) {
            return;
        }

        // Calculate position from double-click
        const rect = e.currentTarget.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const minutesRelative = Math.floor((y / HOUR_HEIGHT) * 60);
        const snappedRelative = Math.round(minutesRelative / 15) * 15;
        const absoluteMinutes = (snappedRelative + timelineStartHour * 60) % (24 * 60);
        handleColumnClick(day, absoluteMinutes);
        setSelectedSlot(null);
    };

    return (
        <div className="relative h-full" style={shrinkToHalf ? { width: '50%' } : undefined}>
            <DroppableColumn key={day.isoDate} day={day}>
                <div
                    className="relative h-full border-l border-slate-100 border-r border-slate-200/50 pb-8 select-none bg-white"
                    style={{
                        minHeight: timelineViewportHeight,
                    }}
                    onDoubleClick={handleDoubleClick}
                    onClick={(e) => handleSingleClick(e, day.isoDate)}
                >
                    {/* Phantom Card */}
                    {selectedSlot && selectedSlot.day === day.isoDate && (
                        <div
                            className="absolute border-2 border-dashed border-blue-300 bg-blue-50/50 z-10 cursor-pointer"
                            style={{
                                top: minuteToPixels(selectedSlot.minutes, timelineStartHour),
                                height: minuteToPixels(60 + timelineStartHour * 60, timelineStartHour) - minuteToPixels(0 + timelineStartHour * 60, timelineStartHour), // Fixed height 60m
                                left: 0,
                                right: 0,
                            }}
                            onClick={(e) => e.stopPropagation()}
                            onDoubleClick={(e) => {
                                e.stopPropagation();
                                handleColumnClick(day, selectedSlot.minutes);
                                setSelectedSlot(null);
                            }}
                        >
                            {/* Time display on top-left, outside the border */}
                            <div className="absolute -top-4 left-0 text-[10px] font-semibold text-blue-600 px-1">
                                {minutesToTime(selectedSlot.minutes).slice(0, 5)}
                            </div>
                        </div>
                    )}

                    <div
                        className="pointer-events-none absolute"
                        style={{ height: TIMELINE_HEIGHT, left: isFirstColumn ? -2 : 0, right: 0, top: 0 }}
                    >
                        {getDisplayHours(timelineStartHour).map((hour, idx) => (
                            <div key={hour} className="absolute left-0 right-0" style={{ top: idx * HOUR_HEIGHT }}>
                                <div
                                    className={clsx(
                                        'border-b border-slate-200',
                                        idx === 0 ? '' : 'border-dashed'
                                    )}
                                />
                                <span
                                    className="absolute -top-4 right-2 text-[11px] font-medium text-slate-400/70"
                                >
                                    {hour}
                                </span>
                            </div>
                        ))}
                    </div>

                    {indicatorVisibleInDay && (
                        <div
                            className="pointer-events-none absolute z-10"
                            style={{ top: indicatorPosition, left: 0, right: 0 }}
                        >
                            <div className="relative h-px bg-red-400/80">
                                <div className="absolute top-1/2 left-0 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500" />
                            </div>
                        </div>
                    )}

                    {activeDragCardId && pointerPreview.visible && pointerPreview.dayIso === day.isoDate && (
                        <div
                            className="pointer-events-none absolute z-10 border border-dashed border-sky-300 bg-sky-50/40"
                            style={{
                                top: minuteToPixels(pointerPreview.startMinutes, timelineStartHour),
                                height: minuteToPixels(pointerPreview.startMinutes + pointerPreview.durationMinutes, timelineStartHour) - minuteToPixels(pointerPreview.startMinutes, timelineStartHour),
                                left: '8px',
                                right: '8px',
                            }}
                        >
                            {/* Time display on top-left, outside the border */}
                            <div className="absolute -top-4 left-0 text-[10px] font-semibold text-sky-600 px-1">
                                {timeLabel(
                                    minutesToTime(pointerPreview.startMinutes),
                                    minutesToTime(pointerPreview.startMinutes + pointerPreview.durationMinutes)
                                )}
                            </div>
                        </div>
                    )}

                    <div className="relative" style={{ height: TIMELINE_HEIGHT }}>
                        {combinedItems.map((item) => {
                            if (item.kind === 'calendar') {
                                const calendarEvent = item.entry;
                                const layout = calendarLayout[calendarEvent.id];
                                return (
                                    <button
                                        key={`calendar-${calendarEvent.id}`}
                                        type="button"
                                        data-focus-group="timeline"
                                        data-focus-part="card"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onExternalEventClick?.(calendarEvent);
                                        }}
                                        className="absolute z-0 rounded-md border border-emerald-200 bg-emerald-50/80 px-2 py-1 text-[10px] text-emerald-700 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.15)] text-left hover:bg-emerald-100"
                                        style={{
                                            top: minuteToPixels(calendarEvent.startMinutes, timelineStartHour),
                                            height: Math.max(minuteToPixels(calendarEvent.startMinutes + calendarEvent.durationMinutes, timelineStartHour) - minuteToPixels(calendarEvent.startMinutes, timelineStartHour), 18),
                                            left: layout?.left ?? '0%',
                                            width: layout?.width ?? '100%',
                                        }}
                                    >
                                        <div className="flex items-center gap-1">
                                            <span className="truncate font-semibold">{calendarEvent.title || 'Google予定'}</span>
                                            <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase leading-tight tracking-wide text-emerald-700">
                                                G
                                            </span>
                                        </div>
                                        <p className="text-[9px] text-emerald-600">
                                            {calendarEvent.isAllDay
                                                ? '終日'
                                                : timeLabel(
                                                    minutesToTime(calendarEvent.startMinutes),
                                                    minutesToTime(calendarEvent.startMinutes + calendarEvent.durationMinutes)
                                                )
                                            }
                                        </p>
                                    </button>
                                );
                            }

                            const event = item.entry;
                            return (
                                <TimelineEventItem
                                    key={`card-${event.card_id}`}
                                    event={event}
                                    layout={layoutMap[event.card_id]}
                                    activeResize={activeResize}
                                    openCardModal={openCardModal}
                                    handleEventKeyDown={handleEventKeyDown}
                                    handleResizeStart={handleResizeStart}
                                    handleResizeMove={handleResizeMove}
                                    handleResizeEnd={handleResizeEnd}
                                    onToggleCheck={onToggleCheck}
                                    onClearGhost={() => setSelectedSlot(null)}
                                    timelineStartHour={timelineStartHour}
                                    onCardContextMenu={onCardContextMenu}
                                    onCardContextMenuByKeyboard={onCardContextMenuByKeyboard}
                                    isContextMenuOpen={contextMenuCardId === event.card_id}
                                    onUpdateCardTitle={onUpdateCardTitle}
                                />
                            );
                        })}
                    </div>
                </div>
            </DroppableColumn>
        </div>
    );
});
