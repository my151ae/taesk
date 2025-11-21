
import React from 'react';
import { clsx } from 'clsx';
import { useDroppable, useDraggable } from '@dnd-kit/core';
import {
    HOUR_HEIGHT,
    TIMELINE_HEIGHT,
    minuteToPixels,
    getMinutesFromTime,
    minutesToTime,
    timeLabel,
    TimelineDay,
    TimelineEvent,
} from '@/app/(board)/_utils/timeline-helpers';

const HOURS = Array.from({ length: 24 }, (_, hour) => `${hour.toString().padStart(2, "0")}:00`);
const AXIS_WIDTH = 80;

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

interface TimelineGridProps {
    days: TimelineDay[];
    eventsByDay: Record<string, TimelineEvent[]>;
    indicatorTop: number | null;
    indicatorDayIso: string | null;
    timelineViewportHeight: number;
    activeDrag: ActiveDragState | null;
    pointerPreview: PointerPreviewState;
    handleEventKeyDown: (event: TimelineEvent, native: React.KeyboardEvent) => void;
    openCardModalFromTimeline: (shortId: string | null, debugSource?: string) => void;
    floatingLayerTop: number;
}

// Sub-components for DnD
function DroppableColumn({ day, children }: { day: TimelineDay; children: React.ReactNode }) {
    const { setNodeRef } = useDroppable({
        id: `column:${day.isoDate}`,
        data: { type: 'timeline-column', dayIso: day.isoDate },
    });
    return (
        <div ref={setNodeRef} className="flex-1 min-w-[200px] h-full relative z-0">
            {children}
        </div>
    );
}

function DraggableCard({
    id,
    data,
    children,
    attachListenersToChild = false,
}: {
    id: string;
    data: any;
    children: React.ReactNode;
    attachListenersToChild?: boolean;
}) {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id,
        data,
    });

    const style: React.CSSProperties | undefined = transform
        ? {
            transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
            zIndex: 50,
            opacity: isDragging ? 0 : undefined,
        }
        : undefined;

    if (attachListenersToChild) {
        return (
            <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="absolute left-0 right-0">
                {children}
            </div>
        );
    }

    return (
        <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
            {children}
        </div>
    );
}

export default function TimelineGrid({
    days,
    eventsByDay,
    indicatorTop,
    indicatorDayIso,
    timelineViewportHeight,
    activeDrag,
    pointerPreview,
    handleEventKeyDown,
    openCardModalFromTimeline,
    floatingLayerTop,
}: TimelineGridProps) {

    const renderEvent = (event: TimelineEvent) => {
        const start = getMinutesFromTime(event.due_start ?? null) ?? 0;
        const duration = Math.max(event.durationMinutes ?? 60, 30);
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
                    className="absolute left-4 right-4 flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                    style={{ top, height }}
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
                                openCardModalFromTimeline(event.short_id, 'event-button');
                            }}
                            onPointerDown={(native) => {
                                native.stopPropagation();
                            }}
                            className="ml-1 flex h-6 w-6 flex-shrink-0 items-center justify-center self-start rounded-full border border-slate-200 text-[10px] font-semibold text-slate-500 hover:border-sky-300 hover:text-sky-600"
                            aria-label="Open card"
                            data-testid={`cardOpenButton - ${event.card_id} `}
                        >
                            ↗
                        </button>
                    </div>
                </div>
            </DraggableCard>
        );
    };

    const renderColumn = (day: TimelineDay, index: number) => {
        const events = eventsByDay[day.isoDate] ?? [];
        const indicatorVisibleInDay = indicatorTop != null && indicatorDayIso === day.isoDate;
        const indicatorPosition = indicatorTop ?? 0;
        const isFirstColumn = index === 0;

        const pointerPreviewVisible = pointerPreview.visible;
        const pointerPreviewDay = pointerPreview.dayIso;
        const pointerPreviewY = minuteToPixels(pointerPreview.startMinutes);
        const pointerPreviewDuration = pointerPreview.durationMinutes;
        const pointerPreviewStart = timeLabel(
            minutesToTime(pointerPreview.startMinutes),
            minutesToTime(pointerPreview.startMinutes + pointerPreview.durationMinutes)
        ).split(' - ')[0]; // Rough approximation for label
        // Actually timeLabel takes (start, end) strings.
        // We need to convert minutes to time string.
        const startStr = minutesToTime(pointerPreview.startMinutes);
        const endStr = minutesToTime(pointerPreview.startMinutes + pointerPreview.durationMinutes);

        return (
            <DroppableColumn key={day.isoDate} day={day}>
                <div className="relative h-full border-l border-slate-100 px-4 pb-8" style={{ minHeight: timelineViewportHeight }}>
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

                    {activeDrag?.cardId && pointerPreviewVisible && pointerPreviewDay === day.isoDate && (
                        <div
                            className="pointer-events-none absolute left-4 right-4 z-10 border border-dashed border-sky-300 bg-sky-50/40"
                            style={{
                                top: pointerPreviewY,
                                height: minuteToPixels(pointerPreviewDuration),
                            }}
                        >
                            <div className="px-3 py-2 text-[10px] font-semibold text-slate-500">
                                {timeLabel(startStr, endStr)}
                            </div>
                        </div>
                    )}

                    <div className="relative" style={{ height: TIMELINE_HEIGHT }}>
                        {events.map(renderEvent)}
                    </div>
                </div>
            </DroppableColumn>
        );
    };

    const renderFloatingLayer = () => {
        if (!days.length) return null;
        const templateColumns = `80px repeat(${days.length}, minmax(0, 1fr))`;
        return (
            <div
                className="pointer-events-none sticky z-20 h-0 overflow-visible"
                style={{ top: floatingLayerTop }}
            >
                <div className="mx-auto max-w-6xl">
                    <div className="grid" style={{ gridTemplateColumns: templateColumns }}>
                        <div /> {/* Axis spacer */}
                        {days.map((day) => (
                            <div key={day.isoDate} className="px-4">
                                {/* Header content if needed, but this seems to be just for alignment or floating headers? 
                    Actually in original code it renders the day headers sticky?
                    Wait, the day headers are in the main flow usually.
                    Let's check original code.
                */}
                                <div className="flex items-center justify-center rounded-full border border-slate-200 bg-white/90 px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm backdrop-blur">
                                    {day.label}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    };

    const templateColumns = `80px repeat(${days.length}, minmax(0, 1fr))`;

    return (
        <div className="relative">
            {/* Floating headers */}
            {renderFloatingLayer()}

            <div className="grid" style={{ gridTemplateColumns: templateColumns }}>
                {/* Time Axis */}
                <div className="relative border-r border-slate-200 bg-slate-50/50 text-xs font-medium text-slate-400">
                    {HOURS.map((hour, i) => (
                        <div
                            key={hour}
                            className="absolute right-3 -translate-y-1/2"
                            style={{ top: i * HOUR_HEIGHT }}
                        >
                            {hour}
                        </div>
                    ))}
                </div>

                {/* Columns */}
                {days.map((day, index) => renderColumn(day, index))}
            </div>
        </div>
    );
}
