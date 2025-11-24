import { ReactNode, memo, MouseEvent } from 'react';
import { useDroppable } from '@dnd-kit/core';
import clsx from 'clsx';
import {
    TimelineDay,
    TimelineEvent,
    HOUR_HEIGHT,
    HOURS,
    TIMELINE_HEIGHT,
    minuteToPixels,
    minutesToTime,
    calculateEventLayout,
    timeLabel
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
    events: TimelineEvent[];
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
    setSelectedSlot: (slot: { day: string, minutes: number } | null) => void;
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
    setSelectedSlot
}: TimelineColumnProps) {
    const layoutMap = calculateEventLayout(events);
    const indicatorVisibleInDay = indicatorTop != null && indicatorDayIso === day.isoDate;
    const indicatorPosition = indicatorTop ?? 0;
    const isFirstColumn = index === 0;

    const handleSingleClick = (e: MouseEvent, dayIso: string) => {
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const minutes = Math.floor((y / HOUR_HEIGHT) * 60);
        const snapped = Math.round(minutes / 15) * 15;
        setSelectedSlot({ day: dayIso, minutes: snapped });
    };

    const handleDoubleClick = (e: MouseEvent<HTMLDivElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const minutes = Math.floor((y / HOUR_HEIGHT) * 60);
        const snapped = Math.round(minutes / 15) * 15;
        handleColumnClick(day, snapped);
        setSelectedSlot(null);
    };

    return (
        <DroppableColumn key={day.isoDate} day={day}>
            <div
                className="relative h-full border-l border-slate-100 pl-2 pr-[225px] pb-8 select-none"
                style={{ minHeight: timelineViewportHeight }}
                onDoubleClick={handleDoubleClick}
                onClick={(e) => handleSingleClick(e, day.isoDate)}
            >
                {/* Phantom Card */}
                {selectedSlot && selectedSlot.day === day.isoDate && (
                    <div
                        className="absolute border-2 border-dashed border-blue-300 bg-blue-50/50 pointer-events-none z-10"
                        style={{
                            top: minuteToPixels(selectedSlot.minutes),
                            height: minuteToPixels(60),
                            left: 8,
                            right: 225,
                        }}
                    >
                        <div className="p-1 text-xs text-blue-500 font-medium">
                            {minutesToTime(selectedSlot.minutes).slice(0, 5)}
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

                {activeDragCardId && pointerPreview.visible && pointerPreview.dayIso === day.isoDate && (
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
                    {events.map((event) => (
                        <TimelineEventItem
                            key={event.card_id}
                            event={event}
                            layout={layoutMap[event.card_id]}
                            activeResize={activeResize}
                            openCardModal={openCardModal}
                            handleEventKeyDown={handleEventKeyDown}
                            handleResizeStart={handleResizeStart}
                            handleResizeMove={handleResizeMove}
                            handleResizeEnd={handleResizeEnd}
                        />
                    ))}
                </div>
            </div>
        </DroppableColumn>
    );
});
