import { memo, type Dispatch, type SetStateAction } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { TimelineColumn } from './TimelineColumn';
import { TimelineDayBucket } from './TimelineDayBucket';
import type { BucketCreateRequest } from './bucket-create-request';
import type {
    TimelineDay,
    TimelineEvent,
    TimelineBucketItem,
    ExternalCalendarEntry,
    StackedTimelineItemKind,
} from '@/app/(board)/_utils/timeline-helpers';
import type { ActiveResizeState, BucketIndicator } from '@/app/(board)/_hooks/useTimelineDragAndDrop';

type PointerPreviewState = {
    visible: boolean;
    startMinutes: number;
    durationMinutes: number;
    dayIso: string | null;
};

type DaySectionProps = {
    day: TimelineDay;
    index: number;

    // Timeline用
    events: readonly TimelineEvent[];
    indicatorTop: number | null;
    indicatorDayIso: string | null;
    timelineViewportHeight: number;
    activeDragCardId: string | null;
    pointerPreview: PointerPreviewState;
    activeResize: ActiveResizeState | null;
    selectedSlot: { day: string; minutes: number } | null;
    handleEventKeyDown: (event: TimelineEvent, native: ReactKeyboardEvent<HTMLElement>) => void;
    handleColumnClick: (day: TimelineDay, minutes: number) => void;
    handleResizeStart: (e: ReactPointerEvent, cardId: string, startMinutes: number, duration: number, edge: 'top' | 'bottom') => void;
    handleResizeMove: (e: ReactPointerEvent) => void;
    handleResizeEnd: (e: ReactPointerEvent) => void;
    setSelectedSlot: (slot: { day: string; minutes: number } | null) => void;
    calendarEvents: ExternalCalendarEntry[];
    onExternalEventClick?: (entry: ExternalCalendarEntry) => void;
    timelineStartHour?: number;

    // A/Bリスト用
    bucketsA: readonly TimelineBucketItem[];
    bucketsB: readonly TimelineBucketItem[];
    bucketIndicator: BucketIndicator | null;
    onCreateBucketCard?: (bucketKey: string, afterCardId?: string) => void;
    onRequestCreateBucketCard?: (request: BucketCreateRequest) => void;
    viewportHeight?: number;
    registerAbScrollContainer?: (dayIso: string, el: HTMLDivElement | null, bucket?: 'a' | 'b') => void;
    floatingLayerTop: number;
    status: string;

    // 共通
    openCardModal: (shortId: string | null, source: string) => void;
    onToggleCheck: (cardId: string, checked: boolean) => void;
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

export const DaySection = memo(function DaySection({
    day,
    index,
    events,
    indicatorTop,
    indicatorDayIso,
    timelineViewportHeight,
    activeDragCardId,
    pointerPreview,
    activeResize,
    selectedSlot,
    handleEventKeyDown,
    handleColumnClick,
    handleResizeStart,
    handleResizeMove,
    handleResizeEnd,
    setSelectedSlot,
    calendarEvents,
    onExternalEventClick,
    timelineStartHour,
    bucketsA,
    bucketsB,
    bucketIndicator,
    onCreateBucketCard,
    onRequestCreateBucketCard,
    viewportHeight,
    registerAbScrollContainer,
    floatingLayerTop,
    status,
    openCardModal,
    onToggleCheck,
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
}: DaySectionProps) {
    return (
        <div className="day-section grid grid-cols-2 h-full min-w-0">
            {/* Timeline部分（左半分） */}
            <div className="timeline-col h-full min-w-0 overflow-hidden">
                <TimelineColumn
                    day={day}
                    events={events}
                    index={index}
                    indicatorTop={indicatorTop}
                    indicatorDayIso={indicatorDayIso}
                    timelineViewportHeight={timelineViewportHeight}
                    activeDragCardId={activeDragCardId}
                    pointerPreview={pointerPreview}
                    activeResize={activeResize}
                    selectedSlot={selectedSlot}
                    openCardModal={openCardModal}
                    handleEventKeyDown={handleEventKeyDown}
                    handleColumnClick={handleColumnClick}
                    handleResizeStart={handleResizeStart}
                    handleResizeMove={handleResizeMove}
                    handleResizeEnd={handleResizeEnd}
                    onToggleCheck={onToggleCheck}
                    shrinkToHalf={false}
                    setSelectedSlot={setSelectedSlot}
                    calendarEvents={calendarEvents}
                    onExternalEventClick={onExternalEventClick}
                    timelineStartHour={timelineStartHour}
                    onCardContextMenu={onCardContextMenu}
                    onCardContextMenuByKeyboard={onCardContextMenuByKeyboard}
                    contextMenuCardId={contextMenuCardId}
                    hourHeight={hourHeight}
                    activeStackItem={activeStackItem}
                    setActiveStackItem={setActiveStackItem}
                    selectedCardIds={selectedCardIds}
                    selectionLeadCardId={selectionLeadCardId}
                    onShiftSelect={onShiftSelect}
                    onClearSelection={onClearSelection}
                    onActivateCard={onActivateCard}
                    activeCardId={activeCardId}
                    activeLaneId={activeLaneId}
                />
            </div>

            {/* A/Bリスト部分（右半分、sticky配置） */}
            <div className="ab-col relative min-w-0 border-l border-slate-100">
                <div
                    className="sticky z-20 w-full min-w-0"
                    style={{ top: 0 }}
                >
                    <TimelineDayBucket
                        day={day}
                        events={events}
                        bucketsA={bucketsA}
                        bucketsB={bucketsB}
                        floatingLayerTop={floatingLayerTop}
                        viewportHeight={viewportHeight}
                        registerScrollContainer={registerAbScrollContainer}
                        status={status}
                        openCardModal={openCardModal}
                        onToggleCheck={onToggleCheck}
                        bucketIndicator={bucketIndicator}
                        onCreateBucketCard={onCreateBucketCard}
                        onRequestCreateBucketCard={onRequestCreateBucketCard}
                        onCardContextMenu={onCardContextMenu}
                        onCardContextMenuByKeyboard={onCardContextMenuByKeyboard}
                        contextMenuCardId={contextMenuCardId}
                        selectedCardIds={selectedCardIds}
                        selectionLeadCardId={selectionLeadCardId}
                        onShiftSelect={onShiftSelect}
                        onClearSelection={onClearSelection}
                        onActivateCard={onActivateCard}
                        activeCardId={activeCardId}
                        activeLaneId={activeLaneId}
                    />
                </div>
            </div>
        </div>
    );
});
