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
    onToggleCheck: (cardId: string, checked: boolean) => void;
    shrinkToHalf?: boolean;
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
    onToggleCheck,
    shrinkToHalf = false,
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
        // If ghost exists, it handles the double-click, so do nothing here
        if (selectedSlot && selectedSlot.day === day.isoDate) {
            return;
        }

        // Calculate position from double-click
        const rect = e.currentTarget.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const minutes = Math.floor((y / HOUR_HEIGHT) * 60);
        const snapped = Math.round(minutes / 15) * 15;
        handleColumnClick(day, snapped);
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
                                top: minuteToPixels(selectedSlot.minutes),
                                height: minuteToPixels(60),
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
                            className="pointer-events-none absolute z-10 border border-dashed border-sky-300 bg-sky-50/40"
                            style={{
                                top: minuteToPixels(pointerPreview.startMinutes),
                                height: minuteToPixels(pointerPreview.durationMinutes),
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
                                onToggleCheck={onToggleCheck}
                            />
                        ))}
                    </div>
                </div>
            </DroppableColumn>
        </div>
    );
});
