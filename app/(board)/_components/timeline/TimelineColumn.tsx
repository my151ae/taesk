import { ReactNode, memo, MouseEvent, type Dispatch, type SetStateAction } from 'react';
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
    type StackedTimelineItemKind,
    timeLabel,
    ExternalCalendarEntry,
    detailedTimeLabel
} from '@/app/(board)/_utils/timeline-helpers';
import { TimelineEventItem } from './TimelineEventItem';
import { TimelineCard } from './TimelineCard';
import { ActiveResizeState } from '@/app/(board)/_hooks/useTimelineDragAndDrop';
import {
    buildStackedTimelineColumnLayout,
    buildTimelineInteractionLock,
} from '@/app/(board)/_components/timeline/timeline-render-model';

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
    hourHeight?: number;
    activeStackItem: { kind: StackedTimelineItemKind; id: string } | null;
    setActiveStackItem: Dispatch<SetStateAction<{ kind: StackedTimelineItemKind; id: string } | null>>;
    selectedCardIds: ReadonlySet<string>;
    selectionLeadCardId: string | null;
    onShiftSelect: (args: {
        cardId: string;
        laneId: string;
        activeCardId: string | null;
        activeLaneId: string | null;
    }) => void;
    onClearSelection: () => void;
    onActivateCard: (cardId: string, laneId: string) => void;
    activeCardId: string | null;
    activeLaneId: string | null;
};

const DroppableColumn = ({ children, day }: { children: ReactNode; day: TimelineDay }) => {
    const { setNodeRef } = useDroppable({ id: `day:${day.isoDate}`, data: { type: 'timeline-column', day } });
    return (
        <div
            ref={setNodeRef}
            className="relative h-full"
            data-dnd="timeline-column"
            data-day-iso={day.isoDate}
        >
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
    hourHeight,
    activeStackItem,
    setActiveStackItem,
    selectedCardIds,
    selectionLeadCardId,
    onShiftSelect,
    onClearSelection,
    onActivateCard,
    activeCardId,
    activeLaneId,
}: TimelineColumnProps) {
    // Use default if undefined
    const currentHourHeight = hourHeight ?? HOUR_HEIGHT;
    const indicatorVisibleInDay = indicatorTop != null && indicatorDayIso === day.isoDate;
    const indicatorPosition = indicatorTop ?? 0;
    const isFirstColumn = index === 0;
    const { combinedItems, stackedLayout } = buildStackedTimelineColumnLayout({
        events,
        calendarEvents,
        device: 'desktop',
        hourHeight: currentHourHeight,
    });
    const interactionLocked = buildTimelineInteractionLock({
        activeDragCardId,
        activeResize,
        contextMenuCardId,
        selectedSlotVisible: Boolean(selectedSlot),
    });

    const handleSingleClick = (e: MouseEvent, dayIso: string) => {
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const minutesRelative = Math.floor((y / currentHourHeight) * 60);
        const snappedRelative = Math.round(minutesRelative / 5) * 5;
        // Convert relative minutes to absolute minutes
        const absoluteMinutes = (snappedRelative + timelineStartHour * 60) % (24 * 60);
        setActiveStackItem(null);
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
        const minutesRelative = Math.floor((y / currentHourHeight) * 60);
        const snappedRelative = Math.round(minutesRelative / 5) * 5;
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
                    onClick={(e) => {
                        onClearSelection();
                        handleSingleClick(e, day.isoDate);
                    }}
                >
                    {/* Phantom Card */}
                    {selectedSlot && selectedSlot.day === day.isoDate && (
                        <div
                            className="absolute border-2 border-dashed border-blue-300 bg-blue-50/50 z-10 cursor-pointer"
                            style={{
                                top: minuteToPixels(selectedSlot.minutes, timelineStartHour, currentHourHeight),
                                height: minuteToPixels(60 + timelineStartHour * 60, timelineStartHour, currentHourHeight) - minuteToPixels(0 + timelineStartHour * 60, timelineStartHour, currentHourHeight), // Fixed height 60m
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
                            <div key={hour} className="absolute left-0 right-0" style={{ top: idx * currentHourHeight }}>
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
                                top: minuteToPixels(pointerPreview.startMinutes, timelineStartHour, currentHourHeight),
                                height: minuteToPixels(pointerPreview.startMinutes + pointerPreview.durationMinutes, timelineStartHour, currentHourHeight) - minuteToPixels(pointerPreview.startMinutes, timelineStartHour, currentHourHeight),
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
                                const calendarEvent = item.entry as ExternalCalendarEntry;
                                const layout = stackedLayout[item.key];
                                const isActive = activeStackItem?.kind === 'calendar' && activeStackItem.id === calendarEvent.id;
                                return (
                                    <div
                                        key={`calendar-${calendarEvent.id}`}
                                        className="absolute transition hover:border-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                                        data-stack-mode={layout?.presentationMode ?? 'full-width'}
                                        data-column-span={layout?.columnSpan ?? 1}
                                        data-cluster-columns={layout?.clusterColumns ?? 1}
                                        data-slot-index={layout?.slotIndex ?? 0}
                                        style={{
                                            top: minuteToPixels(calendarEvent.startMinutes, timelineStartHour, currentHourHeight),
                                            height: Math.max(minuteToPixels(calendarEvent.startMinutes + calendarEvent.durationMinutes, timelineStartHour, currentHourHeight) - minuteToPixels(calendarEvent.startMinutes, timelineStartHour, currentHourHeight), 20),
                                            left: layout?.left ?? '0%',
                                            width: layout?.width ?? '100%',
                                            zIndex: isActive ? 30 : (layout?.baseZIndex ?? 10),
                                        }}
                                    >
                                        <TimelineCard
                                            title={calendarEvent.title || "Google予定"}
                                            checked={false}
                                            onToggleCheck={() => {}}
                                            badgeLabel="G"
                                            timeText={
                                                layout?.isTimeOverlapped && !isActive
                                                    ? null
                                                    : detailedTimeLabel(minutesToTime(calendarEvent.startMinutes), minutesToTime(calendarEvent.startMinutes + calendarEvent.durationMinutes), calendarEvent.durationMinutes)
                                            }
                                            timePlacement="out-top"
                                            onOpen={() => {
                                                if (!interactionLocked) {
                                                    setActiveStackItem({ kind: 'calendar', id: calendarEvent.id });
                                                }
                                                onExternalEventClick?.(calendarEvent);
                                            }}
                                            dataTestId="timeline-calendar-event"
                                            tabIndex={0}
                                            role="group"
                                            focusGroup="timeline"
                                            onFocus={() => {
                                                if (interactionLocked) return;
                                                setActiveStackItem({ kind: 'calendar', id: calendarEvent.id });
                                            }}
                                            onBlur={() => {
                                                setActiveStackItem((current) => {
                                                    if (current?.kind === 'calendar' && current.id === calendarEvent.id) {
                                                        return null;
                                                    }
                                                    return current;
                                                });
                                            }}
                                            className={clsx(
                                                "w-full h-full pt-0 transition-[box-shadow,transform,ring-color] border-emerald-200",
                                                isActive ? "ring-2 ring-sky-400 shadow-md" : "hover:ring-2 hover:ring-emerald-200 focus:ring-2 focus:ring-emerald-500"
                                            )}
                                            backgroundClass="bg-gradient-to-r from-emerald-50 from-40% to-emerald-50/10"
                                            titleClassName="text-emerald-800"
                                            hideLeftColumn={true}
                                            cardId={`calendar-${calendarEvent.id}`}
                                            onClearSelection={onClearSelection}
                                        />
                                    </div>
                                );
                            }

                            const event = item.entry as TimelineEvent;
                            return (
                                <TimelineEventItem
                                    key={`card-${event.card_id}`}
                                    event={event}
                                    layout={stackedLayout[item.key]}
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
                                    isActive={
                                        selectionLeadCardId === event.card_id ||
                                        (activeStackItem?.kind === 'card' && activeStackItem.id === event.card_id)
                                    }
                                    zIndex={
                                        (
                                            selectionLeadCardId === event.card_id ||
                                            (activeStackItem?.kind === 'card' && activeStackItem.id === event.card_id)
                                        )
                                            ? 30
                                            : (stackedLayout[item.key]?.baseZIndex ?? 20)
                                    }
                                    onFocusCard={() => {
                                        if (interactionLocked) return;
                                        setActiveStackItem({ kind: 'card', id: event.card_id });
                                    }}
                                    onBlurCard={() => {
                                        if (contextMenuCardId === event.card_id) return;
                                        setActiveStackItem((current) => {
                                            if (current?.kind === 'card' && current.id === event.card_id) {
                                                return null;
                                            }
                                            return current;
                                        });
                                    }}
                                    onCreateNext={() => {
                                        const endMinutes = (getMinutesFromTime(event.due_start ?? null) ?? 0) + (event.durationMinutes ?? 60);
                                        handleColumnClick(day, endMinutes);
                                    }}
                                    hourHeight={currentHourHeight}
                                    isSelected={selectedCardIds.has(event.card_id)}
                                    selectionLane={`timeline:${day.isoDate}`}
                                    onShiftSelect={onShiftSelect}
                                    onClearSelection={onClearSelection}
                                    onActivateCard={onActivateCard}
                                    activeCardId={activeCardId}
                                    activeLaneId={activeLaneId}
                                />
                            );
                        })}
                    </div>
                </div>
            </DroppableColumn>
        </div>
    );
});
