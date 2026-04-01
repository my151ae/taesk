import { useDroppable } from '@dnd-kit/core';
import { useState } from 'react';
import clsx from 'clsx';
import { TimelineBucketItem } from '@/app/(board)/_utils/timeline-helpers';
import { buildTimelineCardTimeText } from '@/app/(board)/_components/timeline/timeline-card-meta';
import { bucketKeyToDueBucket } from '@/lib/bucket-normalization';
import { DraggableCard } from './TimelineDraggableCard';
import {
    TimelineCard,
    TIMELINE_LIST_CARD_NOTE_CLAMP_CLASS,
} from './TimelineCard';

const DROP_ZONE_MARGIN_PX = 12;

type TimelineBucketCardProps = {
    item: TimelineBucketItem;
    bucketKey: string;
    openCardModal: (shortId: string | null) => void;
    onToggleCheck: (cardId: string, checked: boolean) => void;
    onRenameCardTitle?: (cardId: string, nextTitle: string) => Promise<boolean>;
    showFallbackBottomLine?: boolean;
    onCardContextMenu: (e: React.MouseEvent, cardId: string) => void;
    onCardContextMenuByKeyboard: (cardId: string, rect: DOMRect) => void;
    isContextMenuOpen: boolean;
    onCreateBucketCard?: (bucketKey: string, afterCardId?: string) => void;
    isSelected?: boolean;
    isActive?: boolean;
    selectionLane?: string;
    onShiftSelect?: (args: {
        cardId: string;
        laneId: string;
        activeCardId: string | null;
        activeLaneId: string | null;
    }) => void;
    onClearSelection?: () => void;
    onActivateCard?: (cardId: string, laneId: string) => void;
    activeCardId?: string | null;
    activeLaneId?: string | null;
    autoStartTitleEdit?: boolean;
    onAutoStartTitleEditConsumed?: () => void;
};

export const TimelineBucketCard = ({
    item,
    bucketKey,
    openCardModal,
    onToggleCheck,
    onRenameCardTitle,
    showFallbackBottomLine = false,
    onCardContextMenu,
    onCardContextMenuByKeyboard,
    isContextMenuOpen,
    onCreateBucketCard,
    isSelected = false,
    isActive = false,
    selectionLane,
    onShiftSelect,
    onClearSelection,
    onActivateCard,
    activeCardId,
    activeLaneId,
    autoStartTitleEdit = false,
    onAutoStartTitleEditConsumed,
}: TimelineBucketCardProps) => {
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const { setNodeRef: setTopRef, isOver: isOverTop } = useDroppable({
        id: `bucket-item-top:${bucketKey}:${item.card_id}`,
        data: { type: 'bucket-item-top', bucketKey, cardId: item.card_id },
    });

    const { setNodeRef: setBottomRef, isOver: isOverBottom } = useDroppable({
        id: `bucket-item-bottom:${bucketKey}:${item.card_id}`,
        data: { type: 'bucket-item-bottom', bucketKey, cardId: item.card_id },
    });

    return (
        <DraggableCard
            id={`bucket:${item.card_id}`}
            data={{ kind: 'bucket', cardId: item.card_id, bucketKey, item }}
            // コンテキストメニュー表示中はDnD無効化
            disabled={isContextMenuOpen || isEditingTitle}
        >
            <div className="relative min-w-0 pt-4 select-none has-[:focus]:z-10" data-testid={`ab-card-${item.card_id}`} data-bucket={bucketKey} onContextMenu={(e) => onCardContextMenu(e, item.card_id)}>
                {/* Drop Zones */}
                <div
                    ref={setTopRef}
                    className="absolute left-0 right-0 z-20 pointer-events-none"
                    style={{ top: -DROP_ZONE_MARGIN_PX, height: `calc(50% + ${DROP_ZONE_MARGIN_PX}px)` }}
                />
                <div
                    ref={setBottomRef}
                    className="absolute left-0 right-0 z-20 pointer-events-none"
                    style={{ bottom: -DROP_ZONE_MARGIN_PX, height: `calc(50% + ${DROP_ZONE_MARGIN_PX}px)` }}
                />

                {/* Indicators */}
                {isOverTop && <div className="absolute left-0 right-0 top-0 h-0.5 bg-sky-500 z-30" />}
                {(isOverBottom || showFallbackBottomLine) && (
                    <div className="absolute left-0 right-0 bottom-0 h-0.5 bg-sky-500 z-30" />
                )}

                <TimelineCard
                    title={item.title || ""}
                    checked={item.checked}
                    checklist={item.checklist}
                    content={item.content ?? null}
                    onToggleCheck={(next) => onToggleCheck(item.card_id, next)}
                    cardId={item.card_id}
                    badgeLabel={bucketKeyToDueBucket(bucketKey).toUpperCase()}
                    timeText={buildTimelineCardTimeText(item, {
                        includeDate: true,
                        includeTime: false,
                        includeDuration: true,
                    })}
                    timePlacement="out-top"
                    note={item.excerpt ?? undefined}
                    noteClampClass={TIMELINE_LIST_CARD_NOTE_CLAMP_CLASS}
                    notePreviewLines={3}
                    rightMeta={null}
                    onOpen={() => {
                        openCardModal(item.short_id);
                    }}
                    openButtonTestId={`cardOpenButton-${item.card_id}`}
                    paddingClass="py-1"
                    className={clsx(
                        "min-h-0 cursor-grab active:cursor-grabbing",
                        isActive && "shadow-md"
                    )}
                    shortcutContext={{
                        scope: 'board',
                        region: 'main-panel',
                        view: 'timeline',
                        part: 'card',
                    }}
                    onOpenContextMenu={(rect) => onCardContextMenuByKeyboard(item.card_id, rect)}
                    focusGroup="bucket"
                    onCreateNext={() => onCreateBucketCard?.(bucketKey, item.card_id)}
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
                    onRenameTitle={onRenameCardTitle ? (nextTitle) => onRenameCardTitle(item.card_id, nextTitle).then(() => undefined) : undefined}
                    onTitleEditStateChange={setIsEditingTitle}
                />
            </div>
        </DraggableCard>
    );
};
