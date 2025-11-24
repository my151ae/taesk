import { KeyboardEvent, PointerEvent, memo } from 'react';
import clsx from 'clsx';
import { DraggableCard } from './TimelineDraggableCard';
import {
    TimelineEvent,
    minuteToPixels,
    getMinutesFromTime,
    timeLabel,
    minutesToTime,
    EventLayout
} from '@/app/(board)/_utils/timeline-helpers';
import { ActiveResizeState } from '@/app/(board)/_hooks/useTimelineDragAndDrop';

type TimelineEventItemProps = {
    event: TimelineEvent;
    layout?: EventLayout;
    activeResize: ActiveResizeState | null;
    openCardModal: (shortId: string | null, source: string) => void;
    handleEventKeyDown: (event: TimelineEvent, native: KeyboardEvent<HTMLElement>) => void;
    handleResizeStart: (e: PointerEvent, cardId: string, startMinutes: number, duration: number, edge: 'top' | 'bottom') => void;
    handleResizeMove: (e: PointerEvent) => void;
    handleResizeEnd: (e: PointerEvent) => void;
};

export const TimelineEventItem = memo(function TimelineEventItem({
    event,
    layout,
    activeResize,
    openCardModal,
    handleEventKeyDown,
    handleResizeStart,
    handleResizeMove,
    handleResizeEnd
}: TimelineEventItemProps) {
    let start = getMinutesFromTime(event.due_start ?? null) ?? 0;
    let duration = Math.max(event.durationMinutes ?? 60, 30);

    if (activeResize && activeResize.cardId === event.card_id) {
        start = activeResize.startMinutes;
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
                className="absolute flex flex-col gap-2 border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                style={{
                    top,
                    height,
                    left: layout?.left ?? '0%',
                    width: layout?.width ?? '100%',
                }}
                onClick={(e) => {
                    e.stopPropagation();
                    // setSelectedSlot(null); // Handled by parent or global click
                }}
            >
                <div className="flex items-start gap-2 pr-6">
                    <span
                        aria-hidden="true"
                        className={clsx(
                            'flex h-3.5 w-3.5 items-center justify-center border text-[8px] font-bold mt-0.5',
                            event.checked ? 'border-sky-500 bg-sky-500 text-white' : 'border-slate-300 bg-white text-transparent'
                        )}
                    >
                        ✓
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-[11px] font-semibold text-slate-800">
                        <span className="break-words leading-tight">
                            {event.title || 'Untitled card'}
                        </span>
                        <span
                            className="text-[10px] font-semibold text-slate-500 whitespace-nowrap"
                            title={timeLabel(event.due_start, event.due_end)}
                        >
                            {timeLabel(event.due_start, event.due_end)}
                        </span>
                    </div>
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
                    className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-[10px] font-semibold text-slate-500 shadow-sm hover:border-sky-300 hover:text-sky-600"
                    aria-label="Open card"
                    data-testid={`cardOpenButton-${event.card_id}`}
                >
                    ↗
                </button>

                <div
                    className="absolute top-0 left-0 right-0 h-3 cursor-ns-resize opacity-0 hover:opacity-100 z-10"
                    onPointerDown={(e) => handleResizeStart(e, event.card_id, start, duration, 'top')}
                    onPointerMove={handleResizeMove}
                    onPointerUp={handleResizeEnd}
                />
                <div
                    className="absolute bottom-0 left-0 right-0 h-3 cursor-ns-resize opacity-0 hover:opacity-100 z-10"
                    onPointerDown={(e) => handleResizeStart(e, event.card_id, start, duration, 'bottom')}
                    onPointerMove={handleResizeMove}
                    onPointerUp={handleResizeEnd}
                />
            </div>
        </DraggableCard >
    );
});
