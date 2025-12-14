import { KeyboardEvent, PointerEvent, memo } from 'react';
import { DraggableCard } from './TimelineDraggableCard';
import { TimelineCard } from './TimelineCard';
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
    onToggleCheck: (cardId: string, checked: boolean) => void;
    onClearGhost: () => void;
};

export const TimelineEventItem = memo(function TimelineEventItem({
    event,
    layout,
    activeResize,
    openCardModal,
    handleEventKeyDown,
    handleResizeStart,
    handleResizeMove,
    handleResizeEnd,
    onToggleCheck,
    onClearGhost,
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
                className="absolute transition hover:border-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                style={{
                    top,
                    height,
                    left: layout?.left ?? '0%',
                    width: layout?.width ?? '100%',
                }}
                onClick={(e) => {
                    e.stopPropagation();
                    onClearGhost();
                }}
            >
                <TimelineCard
                    title={event.title || 'Untitled card'}
                    checked={event.checked}
                    onToggleCheck={(next) => onToggleCheck(event.card_id, next)}
                    badgeLabel={(event.due_bucket ?? 'a').toUpperCase()}
                    timeText={timeLabel(event.due_start, event.due_end)}
                    onOpen={() => openCardModal(event.short_id, 'event-button')}
                    openButtonTestId={`cardOpenButton-${event.card_id}`}
                    dataTestId="timeline-event"
                    tabIndex={0}
                    role="group"
                    onKeyDown={(native) => handleEventKeyDown(event, native)}
                    className="w-full h-full pt-4"
                />
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
