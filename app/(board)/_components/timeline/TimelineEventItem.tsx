import { FocusEvent, KeyboardEvent, PointerEvent, memo, useState } from 'react';
import clsx from 'clsx';
import { DraggableCard } from './TimelineDraggableCard';
import { TimelineCard } from './TimelineCard';
import {
    TimelineEvent,
    minuteToPixels,
    getMinutesFromTime,
    detailedTimeLabel,
    minutesToTime,
    StackedEventLayout
} from '@/app/(board)/_utils/timeline-helpers';
import { ActiveResizeState } from '@/app/(board)/_hooks/useTimelineDragAndDrop';

type TimelineEventItemProps = {
    event: TimelineEvent;
    layout?: StackedEventLayout;
    activeResize: ActiveResizeState | null;
    openCardModal: (shortId: string | null, source: string) => void;
    handleEventKeyDown: (event: TimelineEvent, native: KeyboardEvent<HTMLElement>) => void;
    onCardContextMenuByKeyboard: (cardId: string, rect: DOMRect) => void;
    handleResizeStart: (e: PointerEvent, cardId: string, startMinutes: number, duration: number, edge: 'top' | 'bottom') => void;
    handleResizeMove: (e: PointerEvent) => void;
    handleResizeEnd: (e: PointerEvent) => void;
    onToggleCheck: (cardId: string, checked: boolean) => void;
    onRenameCardTitle?: (cardId: string, nextTitle: string) => Promise<boolean>;
    onClearGhost: () => void;
    timelineStartHour?: number;
    onCardContextMenu: (e: React.MouseEvent, cardId: string) => void;
    isContextMenuOpen: boolean;
    onCreateNext?: () => void;
    hourHeight?: number;
    zIndex?: number;
    isActive?: boolean;
    onFocusCard?: () => void;
    onBlurCard?: (event: FocusEvent<HTMLDivElement>) => void;
    isSelected?: boolean;
    onShiftSelect?: (args: {
        cardId: string;
        laneId: string;
        activeCardId: string | null;
        activeLaneId: string | null;
    }) => void;
    onClearSelection?: () => void;
    selectionLane?: string;
    onActivateCard?: (cardId: string, laneId: string) => void;
    activeCardId?: string | null;
    activeLaneId?: string | null;
    autoStartTitleEdit?: boolean;
    onAutoStartTitleEditConsumed?: () => void;
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
    onRenameCardTitle,
    onClearGhost,
    timelineStartHour = 0,
    onCardContextMenu,
    isContextMenuOpen,
    onCreateNext,
    hourHeight,
    zIndex,
    isActive = false,
    onFocusCard,
    onBlurCard,
    isSelected = false,
    onShiftSelect,
    onClearSelection,
    selectionLane,
    onActivateCard,
    activeCardId,
    activeLaneId,
    autoStartTitleEdit = false,
    onAutoStartTitleEditConsumed,
}: TimelineEventItemProps) {
    const [isEditingTitle, setIsEditingTitle] = useState(false);
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

    const top = minuteToPixels(start, timelineStartHour, hourHeight);
    const height = Math.max(minuteToPixels(start + duration, timelineStartHour, hourHeight) - minuteToPixels(start, timelineStartHour, hourHeight), 20);

    return (
        <DraggableCard
            key={event.card_id}
            id={`event:${event.card_id}`}
            data={{ kind: 'event', event, cardId: event.card_id }}
            attachListenersToChild
            // コンテキストメニュー表示中はDnD無効化
            disabled={isContextMenuOpen || isEditingTitle}
        >
            <div
                className="absolute transition hover:border-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                data-stack-mode={layout?.presentationMode ?? 'full-width'}
                data-column-span={layout?.columnSpan ?? 1}
                data-cluster-columns={layout?.clusterColumns ?? 1}
                data-slot-index={layout?.slotIndex ?? 0}
                style={{
                    top,
                    height,
                    left: layout?.left ?? '0%',
                    width: layout?.width ?? '100%',
                    zIndex: zIndex ?? layout?.baseZIndex ?? 20,
                }}
                onContextMenu={(e) => onCardContextMenu(e, event.card_id)}
            >
                <TimelineCard
                    title={event.title || ""}
                    checked={event.checked}
                    checklist={event.checklist}
                    content={event.content ?? null}
                    onToggleCheck={(next) => onToggleCheck(event.card_id, next)}
                    cardId={event.card_id}
                    badgeLabel={(event.due_bucket ?? 'a').toUpperCase()}
                    timeText={
                        layout?.isTimeOverlapped && !isActive && !activeResize
                            ? null
                            : detailedTimeLabel(displayStart, displayEnd, duration)
                    }
                    rightMeta={undefined}
                    timePlacement="out-top"
                    note={event.excerpt ?? undefined}
                    onOpen={() => {
                        openCardModal(event.short_id, 'timeline');
                    }}
                    openButtonTestId={`cardOpenButton-timeline-${event.card_id}`}
                    showOpenButton
                    dataTestId="timeline-event"
                    tabIndex={0}
                    role="group"
                    focusGroup="timeline"
                    shortcutContext={{
                        scope: 'board',
                        region: 'main-panel',
                        view: 'timeline',
                        part: 'card',
                        legacyContext: 'timeline-card',
                    }}
                    onKeyDown={(native) => handleEventKeyDown(event, native)}
                    onOpenContextMenu={(rect) => onCardContextMenuByKeyboard(event.card_id, rect)}
                    onFocus={() => {
                        onClearGhost();
                        onFocusCard?.();
                    }}
                    onBlur={onBlurCard}
                    className={clsx(
                        "w-full h-full pt-0 transition-[box-shadow,transform,ring-color]",
                        isActive && "ring-2 ring-sky-400 shadow-md"
                    )}
                    backgroundClass="bg-gradient-to-r from-white from-40% to-white/10"
                    checkedVisualTone="timeline-dim"
                    onCreateNext={onCreateNext}
                    isSelected={isSelected}
                    selectionLane={selectionLane}
                    onShiftSelect={onShiftSelect}
                    onClearSelection={onClearSelection}
                    onActivateCard={onActivateCard}
                    activeCardId={activeCardId}
                    activeLaneId={activeLaneId}
                    autoStartTitleEdit={autoStartTitleEdit}
                    onAutoStartTitleEditConsumed={onAutoStartTitleEditConsumed}
                    inlineTitleEdit
                    onRenameTitle={onRenameCardTitle ? (nextTitle) => onRenameCardTitle(event.card_id, nextTitle).then(() => undefined) : undefined}
                    onTitleEditStateChange={setIsEditingTitle}
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
