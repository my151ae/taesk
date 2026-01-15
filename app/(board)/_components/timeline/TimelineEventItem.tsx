import { KeyboardEvent, PointerEvent, memo, useState, useCallback } from 'react';
import { DraggableCard } from './TimelineDraggableCard';
import { TimelineCard } from './TimelineCard';
import {
    TimelineEvent,
    minuteToPixels,
    getMinutesFromTime,
    timeLabel,
    detailedTimeLabel,
    minutesToTime,
    formatDuration,
    EventLayout
} from '@/app/(board)/_utils/timeline-helpers';
import { ActiveResizeState } from '@/app/(board)/_hooks/useTimelineDragAndDrop';

type TimelineEventItemProps = {
    event: TimelineEvent;
    layout?: EventLayout;
    activeResize: ActiveResizeState | null;
    openCardModal: (shortId: string | null, source: string) => void;
    handleEventKeyDown: (event: TimelineEvent, native: KeyboardEvent<HTMLElement>) => void;
    onCardContextMenuByKeyboard: (cardId: string, rect: DOMRect) => void;
    handleResizeStart: (e: PointerEvent, cardId: string, startMinutes: number, duration: number, edge: 'top' | 'bottom') => void;
    handleResizeMove: (e: PointerEvent) => void;
    handleResizeEnd: (e: PointerEvent) => void;
    onToggleCheck: (cardId: string, checked: boolean) => void;
    onClearGhost: () => void;
    timelineStartHour?: number;
    onCardContextMenu: (e: React.MouseEvent, cardId: string) => void;
    isContextMenuOpen: boolean;
    // インライン編集用
    onUpdateCardTitle?: (cardId: string, newTitle: string, previousTitle: string) => void;
    initialIsEditing?: boolean;
    onCreateNext?: () => void;
};

export const TimelineEventItem = memo(function TimelineEventItem({
    event,
    layout,
    activeResize,
    openCardModal,
    handleEventKeyDown,
    onCardContextMenuByKeyboard,
    handleResizeStart,
    handleResizeMove,
    handleResizeEnd,
    onToggleCheck,
    onClearGhost,
    timelineStartHour = 0,
    onCardContextMenu,
    isContextMenuOpen,
    onUpdateCardTitle,
    initialIsEditing = false,
    onCreateNext,
}: TimelineEventItemProps) {
    // タイトル編集中の状態
    const [isEditingTitle, setIsEditingTitle] = useState(initialIsEditing);

    let start = getMinutesFromTime(event.due_start ?? null) ?? 0;
    let duration = event.durationMinutes ?? 60;
    let displayStart = event.due_start;
    let displayEnd = event.due_end;

    if (activeResize && activeResize.cardId === event.card_id) {
        start = activeResize.startMinutes;
        duration = activeResize.duration;
        displayStart = minutesToTime(start);
        displayEnd = minutesToTime(start + duration);
    }

    const top = minuteToPixels(start, timelineStartHour);
    const height = Math.max(minuteToPixels(start + duration, timelineStartHour) - minuteToPixels(start, timelineStartHour), 20);

    // 幅のパーセンテージを取得（例: "33.33%" → 33.33）
    const widthPercent = layout?.width ? parseFloat(layout.width.replace('%', '')) : 100;
    const isNarrow = widthPercent <= 40; // 40%以下は時間を外に出す
    const isSmall = duration < 55 || isNarrow;

    const handleTitleChange = useCallback((newTitle: string, previousTitle: string) => {
        onUpdateCardTitle?.(event.card_id, newTitle, previousTitle);
    }, [event.card_id, onUpdateCardTitle]);

    return (
        <DraggableCard
            key={event.card_id}
            id={`event:${event.card_id}`}
            data={{ kind: 'event', event, cardId: event.card_id }}
            attachListenersToChild
            // 編集中またはコンテキストメニュー表示中はDnD無効化
            disabled={isContextMenuOpen || isEditingTitle}
        >
            <div
                className="absolute transition hover:border-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                style={{
                    top,
                    height,
                    left: layout?.left ?? '0%',
                    width: layout?.width ?? '100%',
                }}
                onContextMenu={(e) => onCardContextMenu(e, event.card_id)}
            >
                <TimelineCard
                    title={event.title || ""}
                    checked={event.checked}
                    onToggleCheck={(next) => onToggleCheck(event.card_id, next)}
                    badgeLabel={(event.due_bucket ?? 'a').toUpperCase()}
                    duration={undefined}
                    timeText={detailedTimeLabel(displayStart, displayEnd, duration)}
                    rightMeta={undefined}
                    timePlacement={isSmall ? 'out-top' : 'top'}
                    onOpen={() => {
                        openCardModal(event.short_id, 'timeline');
                    }}
                    dataTestId="timeline-event"
                    tabIndex={0}
                    role="group"
                    onKeyDown={(native) => handleEventKeyDown(event, native)}
                    onOpenContextMenu={(rect) => onCardContextMenuByKeyboard(event.card_id, rect)}
                    focusGroup="timeline"
                    className="w-full h-full pt-0"
                    // インライン編集
                    onTitleChange={onUpdateCardTitle ? handleTitleChange : undefined}
                    isEditingTitle={isEditingTitle}
                    onEditingChange={setIsEditingTitle}
                    backgroundClass="bg-gradient-to-r from-white from-40% to-white/10"
                    onCreateNext={onCreateNext}
                />
                <div
                    className="absolute top-0 left-1/2 -ml-8 w-16 h-4 -mt-2 cursor-ns-resize z-10 flex items-center justify-center group"
                    onPointerDown={(e) => handleResizeStart(e, event.card_id, start, duration, 'top')}
                    onPointerMove={handleResizeMove}
                    onPointerUp={handleResizeEnd}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="w-8 h-1 bg-slate-400/0 rounded-full group-hover:bg-slate-300/80 transition-colors" />
                </div>
                <div
                    className="absolute bottom-0 left-1/2 -ml-8 w-16 h-4 -mb-2 cursor-ns-resize z-10 flex items-center justify-center group"
                    onPointerDown={(e) => handleResizeStart(e, event.card_id, start, duration, 'bottom')}
                    onPointerMove={handleResizeMove}
                    onPointerUp={handleResizeEnd}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="w-8 h-1 bg-slate-400/0 rounded-full group-hover:bg-slate-300/80 transition-colors" />
                </div>
            </div>
        </DraggableCard >
    );
});
