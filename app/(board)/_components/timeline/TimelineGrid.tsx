import { ReactNode, KeyboardEvent, PointerEvent, MouseEvent, useState, useEffect } from 'react';
import {
    TimelineDay,
    TimelineEvent,
    HOURS,
} from '@/app/(board)/_utils/timeline-helpers';
import { ActiveResizeState } from '@/app/(board)/_hooks/useTimelineDragAndDrop';
import { TimelineColumn } from './TimelineColumn';

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
    handleResizeStart: (e: PointerEvent, cardId: string, startMinutes: number, duration: number, edge: 'top' | 'bottom') => void;
    handleResizeMove: (e: PointerEvent) => void;
    handleResizeEnd: (e: PointerEvent) => void;
    onToggleCheck: (cardId: string, checked: boolean) => void;
    axisWidth?: number;
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
    onToggleCheck,
    axisWidth = 80,
}: TimelineGridProps) {
    const [selectedSlot, setSelectedSlot] = useState<{ day: string, minutes: number } | null>(null);

    // Clear ghost card when clicking outside
    useEffect(() => {
        const handleGlobalClick = () => setSelectedSlot(null);
        window.addEventListener('click', handleGlobalClick);
        return () => window.removeEventListener('click', handleGlobalClick);
    }, []);

    if (!days.length) return null;

    return (
        <div className="relative">
            <div
                className="grid"
                data-timeline-grid
                data-testid="timeline-grid"
                style={{ gridTemplateColumns: days.length ? `${axisWidth}px repeat(${days.length}, minmax(0, 1fr))` : `${axisWidth}px` }}
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
                {days.map((day, index) => (
                    <TimelineColumn
                        key={day.isoDate}
                        day={day}
                        events={eventsByDay[day.isoDate] ?? []}
                        index={index}
                        indicatorTop={indicatorTop}
                        indicatorDayIso={indicatorDayIso}
                        timelineViewportHeight={timelineViewportHeight}
                        activeDragCardId={activeDrag?.cardId ?? null}
                        pointerPreview={pointerPreview}
                        activeResize={activeResize}
                        selectedSlot={selectedSlot}
                        openCardModal={(shortId, source) => {
                            setSelectedSlot(null);
                            openCardModal(shortId, source);
                        }}
                        handleEventKeyDown={handleEventKeyDown}
                        handleColumnClick={handleColumnClick}
                        handleResizeStart={handleResizeStart}
                        handleResizeMove={handleResizeMove}
                        handleResizeEnd={handleResizeEnd}
                        onToggleCheck={onToggleCheck}
                        setSelectedSlot={setSelectedSlot}
                    />
                ))}
            </div>
        </div>
    );
}
