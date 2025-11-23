import { useDroppable } from '@dnd-kit/core';
import { ReactNode, KeyboardEvent, PointerEvent, MouseEvent, useState } from 'react';
import clsx from 'clsx';
import {
    TimelineDay,
    TimelineEvent,
    HOUR_HEIGHT,
    HOURS,
    TIMELINE_HEIGHT,
    minuteToPixels,
    getMinutesFromTime,
    timeLabel,
    minutesToTime,
    calculateEventLayout,
    EventLayout
} from '@/app/(board)/_utils/timeline-helpers';
import { DraggableCard } from './TimelineDraggableCard';
import { ActiveResizeState } from '@/app/(board)/_hooks/useTimelineDragAndDrop';

type ActiveDragState = {
    cardId: string;
    startMinutes: number;
    duration: number;
};

type PointerPreviewState = {
    visible: boolean;
    startMinutes: number;
    durationMinutes: number;
    dayIso: string | null;
};

type TimelineGridProps = {
    days: TimelineDay[];
    eventsByDay: Record<string, TimelineEvent[]>;
    indicatorTop: number | null;
    indicatorDayIso: string | null;
    timelineViewportHeight: number;
    activeDrag: ActiveDragState | null;
    pointerPreview: PointerPreviewState;
    activeResize: ActiveResizeState | null;
    openCardModal: (shortId: string | null, source: string) => void;
    handleEventKeyDown: (event: TimelineEvent, native: KeyboardEvent<HTMLElement>) => void;
    handleColumnClick: (day: TimelineDay, minutes: number) => void;
    handleResizeStart: (e: PointerEvent, cardId: string, startMinutes: number, duration: number) => void;
    handleResizeMove: (e: PointerEvent) => void;
    handleResizeEnd: (e: PointerEvent) => void;
};

const DroppableColumn = ({ children, day }: { children: ReactNode; day: TimelineDay }) => {
    const { setNodeRef } = useDroppable({ id: `day:${day.isoDate}`, data: { type: 'timeline-column', day } });
    return (
        <div ref={setNodeRef} className="relative h-full">
            {children}
        </div>
    );
};

export default function TimelineGrid({
    days,
    eventsByDay,
    indicatorTop,
    indicatorDayIso,
    timelineViewportHeight,
    activeDrag,
    pointerPreview,
    activeResize,
    openCardModal,
    handleEventKeyDown,
    handleColumnClick,
    handleResizeStart,
    handleResizeMove,
    handleResizeEnd,
}: TimelineGridProps) {
    const [selectedSlot, setSelectedSlot] = useState<{ day: string, minutes: number } | null>(null);

    const renderEvent = (event: TimelineEvent, layout?: EventLayout) => {
        const start = getMinutesFromTime(event.due_start ?? null) ?? 0;
        let duration = Math.max(event.durationMinutes ?? 60, 30);

        if (activeResize && activeResize.cardId === event.card_id) {
            duration = activeResize.duration;
        }

        const top = minuteToPixels(start);
        const height = Math.max(minuteToPixels(duration), 32);

        return (
            <DraggableCard
                key={event.card_id}
                id={`event:${event.card_id}`}
                data={{ kind: 'event', event, cardId: event.card_id }}
                attachListenersToChild
            >
                <div
                    role="group"
                    tabIndex={0}
                    onKeyDown={(native) => handleEventKeyDown(event, native)}
                    data-testid="timeline-event"
                    className="absolute flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                    style={{
                        top,
                        height,
                        left: layout?.left ?? '0%',
                        width: layout?.width ?? '100%',
                    }}
                    onClick={(e) => {
                        e.stopPropagation();
                        setSelectedSlot(null);
                    }}
                >
                    <div className="flex items-start gap-2">
                        <span
                            aria-hidden="true"
                            className={clsx(
                                'flex h-3.5 w-3.5 items-center justify-center rounded border text-[8px] font-bold',
                                event.checked ? 'border-sky-500 bg-sky-500 text-white' : 'border-slate-300 bg-white text-transparent'
                            )}
                        >
                            ✓
                        </span>
                        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-1 text-[11px] font-semibold text-slate-800">
                            <span className="min-w-0 flex-1 break-words leading-tight">
                                {event.title || 'Untitled card'}
                            </span>
                            <span
                                className="text-[10px] font-semibold text-slate-500 whitespace-nowrap"
                                title={timeLabel(event.due_start, event.due_end)}
                            >
                                {timeLabel(event.due_start, event.due_end)}
                            </span>
                        </div>
                        <button
                            type="button"
                            onClick={(native) => {
                                native.stopPropagation();
                                openCardModal(event.short_id, 'event-button');
                            }}
                            onPointerDown={(native) => {
                                native.stopPropagation();
                            }}
                            className="ml-1 flex h-6 w-6 flex-shrink-0 items-center justify-center self-start rounded-full border border-slate-200 text-[10px] font-semibold text-slate-500 hover:border-sky-300 hover:text-sky-600"
                            aria-label="Open card"
                            data-testid={`cardOpenButton-${event.card_id}`}
                        >
                            ↗
                        </button>
                    </div>

                    <div
                        className="absolute bottom-0 left-0 right-0 h-3 cursor-ns-resize opacity-0 hover:opacity-100"
                        onPointerDown={(e) => handleResizeStart(e, event.card_id, start, duration)}
                        onPointerMove={handleResizeMove}
                        onPointerUp={handleResizeEnd}
                    />
                </div>
            </DraggableCard >
        );
    };

    const renderColumn = (day: TimelineDay, index: number) => {
        const events = eventsByDay[day.isoDate] ?? [];
        const layoutMap = calculateEventLayout(events);
        const indicatorVisibleInDay = indicatorTop != null && indicatorDayIso === day.isoDate;
        const indicatorPosition = indicatorTop ?? 0;
        const isFirstColumn = index === 0;

        const handleSingleClick = (e: React.MouseEvent, dayIso: string) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const y = e.clientY - rect.top;
            const minutes = Math.floor((y / HOUR_HEIGHT) * 60);
            const snapped = Math.floor(minutes / 30) * 30;
            setSelectedSlot({ day: dayIso, minutes: snapped });
        };

        const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const y = e.clientY - rect.top;
            const minutes = Math.round((y / HOUR_HEIGHT) * 60);
            handleColumnClick(day, minutes);
        };

        return (
            <DroppableColumn key={day.isoDate} day={day}>
                <div
                    className="relative h-full border-l border-slate-100 px-4 pb-8 select-none"
                    style={{ minHeight: timelineViewportHeight }}
                    onDoubleClick={handleDoubleClick}
                    onClick={(e) => handleSingleClick(e, day.isoDate)}
                >
                    {/* Phantom Card */}
                    {selectedSlot?.day === day.isoDate && (
                        <div
                            className="absolute rounded border-2 border-dashed border-blue-300 bg-blue-50/50 pointer-events-none z-10"
                            style={{
                                top: minuteToPixels(selectedSlot.minutes),
                                height: minuteToPixels(60),
                                left: 16,
                                right: 16,
                                width: 'calc(100% - 32px)'
                            }}
                        >
                            <div className="p-1 text-xs text-blue-500 font-medium">
                                {minutesToTime(selectedSlot.minutes)}
                            </div>
                        </div>
                    )}

                    <div
                        className="pointer-events-none absolute"
                        style={{ height: TIMELINE_HEIGHT, left: isFirstColumn ? -2 : 0, right: 0, top: 0 }}
                    >
                        {HOURS.map((hour, idx) => (
                            <div
                                key={hour}
                                className={clsx(
                                    'absolute left-0 right-0 border-b border-slate-200',
                                    idx === 0 ? '' : 'border-dashed'
                                )}
                                style={{ top: idx * HOUR_HEIGHT }}
                            />
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

                    {activeDrag?.cardId && pointerPreview.visible && pointerPreview.dayIso === day.isoDate && (
                        <div
                            className="pointer-events-none absolute left-4 right-4 z-10 border border-dashed border-sky-300 bg-sky-50/40"
                            style={{
                                top: minuteToPixels(pointerPreview.startMinutes),
                                height: minuteToPixels(pointerPreview.durationMinutes),
                            }}
                        >
                            <div className="px-3 py-2 text-[10px] font-semibold text-slate-500">
                                {timeLabel(
                                    minutesToTime(pointerPreview.startMinutes),
                                    minutesToTime(pointerPreview.startMinutes + pointerPreview.durationMinutes)
                                )}
                            </div>
                        </div>
                    )}

                    <div className="relative" style={{ height: TIMELINE_HEIGHT }}>
                        {events.map((event) => renderEvent(event, layoutMap[event.card_id]))}
                    </div>
                </div>
            </DroppableColumn>
        );
    };

    if (!days.length) return null;

    return (
        <div className="relative">
            <div
                className="grid"
                data-timeline-grid
                data-testid="timeline-grid"
                style={{ gridTemplateColumns: days.length ? `80px repeat(${days.length}, minmax(0, 1fr))` : '80px' }}
            >
                <aside className="relative border-r border-slate-100 text-xs text-slate-500">
                    {HOURS.map((hour) => (
                        <div key={hour} className="flex h-10 items-start justify-end pr-3">
                            {hour === '00:00' ? null : (
                                <span className="-mt-1 leading-none tracking-tight text-slate-600">
                                    {hour}
                                </span>
                            )}
                        </div>
                    ))}
                </aside>
                {days.map((day, index) => renderColumn(day, index))}
            </div>
        </div>
    );
}
