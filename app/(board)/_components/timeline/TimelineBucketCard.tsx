import { useDroppable } from '@dnd-kit/core';
import { useLayoutEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { TimelineBucketItem } from '@/app/(board)/_utils/timeline-helpers';
import { buildTimelineCardFloatingLabel, buildTimelineCardStatusItems } from '@/app/(board)/_components/timeline/timeline-card-meta';
import { bucketKeyToDueBucket } from '@/lib/bucket-normalization';
import { DraggableCard } from './TimelineDraggableCard';
import {
    TimelineCard,
    TIMELINE_LIST_CARD_NOTE_CLAMP_CLASS,
} from './TimelineCard';

const DROP_ZONE_MARGIN_PX = 12;
const MIN_DROP_PLACEHOLDER_HEIGHT_PX = 52;

const resolveBucketShortcutSection = (bucketKey: string): 'a' | 'b' =>
    bucketKey.endsWith('_a') ? 'a' : 'b';

type TimelineBucketCardProps = {
    item: TimelineBucketItem;
    bucketKey: string;
    openCardModal: (shortId: string | null) => void;
    onToggleCheck: (cardId: string, checked: boolean) => void;
    onRenameCardTitle?: (cardId: string, nextTitle: string) => Promise<boolean>;
    dropIndicatorMode?: 'before' | 'after' | null;
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
    activeDragCardId?: string | null;
    autoStartTitleEdit?: boolean;
    onAutoStartTitleEditConsumed?: () => void;
};

export const TimelineBucketCard = ({
    item,
    bucketKey,
    openCardModal,
    onToggleCheck,
    onRenameCardTitle,
    dropIndicatorMode = null,
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
    activeDragCardId,
    autoStartTitleEdit = false,
    onAutoStartTitleEditConsumed,
}: TimelineBucketCardProps) => {
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const cardMeasureRef = useRef<HTMLDivElement | null>(null);
    const [cardHeight, setCardHeight] = useState(MIN_DROP_PLACEHOLDER_HEIGHT_PX);
    const { setNodeRef: setTopRef } = useDroppable({
        id: `bucket-item-top:${bucketKey}:${item.card_id}`,
        data: { type: 'bucket-item-top', bucketKey, cardId: item.card_id },
    });

    const { setNodeRef: setBottomRef } = useDroppable({
        id: `bucket-item-bottom:${bucketKey}:${item.card_id}`,
        data: { type: 'bucket-item-bottom', bucketKey, cardId: item.card_id },
    });
    const placeholderHeight = Math.max(cardHeight, MIN_DROP_PLACEHOLDER_HEIGHT_PX);
    const showDropBefore = dropIndicatorMode === 'before';
    const showDropAfter = dropIndicatorMode === 'after';
    const isDraggingThisCard = activeDragCardId === item.card_id;

    useLayoutEffect(() => {
        const node = cardMeasureRef.current;
        if (!node) return;

        const updateHeight = () => {
            const nextHeight = Math.ceil(node.getBoundingClientRect().height);
            if (Number.isFinite(nextHeight) && nextHeight > 0) {
                setCardHeight(nextHeight);
            }
        };

        updateHeight();
        const resizeObserver = new ResizeObserver(updateHeight);
        resizeObserver.observe(node);
        return () => resizeObserver.disconnect();
    }, []);

    return (
        <DraggableCard
            id={`bucket:${item.card_id}`}
            data={{ kind: 'bucket', cardId: item.card_id, bucketKey, item }}
            // コンテキストメニュー表示中はDnD無効化
            disabled={isContextMenuOpen || isEditingTitle}
        >
            {(dragHandleProps) => (
            <div
                className={clsx(
                    "relative min-w-0 pt-4 select-none has-[:focus]:z-10",
                    isDraggingThisCard && "h-0 overflow-hidden pt-0"
                )}
                data-testid={`ab-card-${item.card_id}`}
                data-bucket-card-id={item.card_id}
                data-bucket={bucketKey}
                onContextMenu={(e) => onCardContextMenu(e, item.card_id)}
            >
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
                {showDropBefore && (
                    <div
                        aria-hidden="true"
                        className="mb-2 rounded-lg border-2 border-sky-500 bg-sky-500 shadow-inner"
                        style={{ height: placeholderHeight, backgroundColor: 'rgb(226 232 240 / 0.7)' }}
                    />
                )}
                <div ref={cardMeasureRef}>

                <TimelineCard
                    title={item.title || ""}
                    checked={item.checked}
                    checklist={item.checklist}
                    content={item.content ?? null}
                    onToggleCheck={(next) => onToggleCheck(item.card_id, next)}
                    cardId={item.card_id}
                    statusItems={buildTimelineCardStatusItems(item, {
                        includeTags: true,
                        includeTime: false,
                        includeDuration: false,
                        includeBucket: false,
                    })}
                    timeText={buildTimelineCardFloatingLabel(item, {
                        bucketLabel: bucketKeyToDueBucket(bucketKey).toUpperCase(),
                        includeDate: true,
                        includeTime: false,
                        includeDuration: true,
                    })}
                    timePlacement="out-top"
                    note={item.excerpt ?? undefined}
                    noteClampClass={TIMELINE_LIST_CARD_NOTE_CLAMP_CLASS}
                    notePreviewLines={2}
                    rightMeta={item.is_parent ? `子${item.child_count ?? 0}` : null}
                    onOpen={() => {
                        openCardModal(item.short_id);
                    }}
                    openButtonTestId={`cardOpenButton-${item.card_id}`}
                    showOpenButton
                    paddingClass="py-1"
                    className={clsx(
                        "min-h-0",
                        isActive && "shadow-md"
                    )}
                    shortcutContext={{
                        scope: 'board',
                        region: 'main-panel',
                        view: 'timeline',
                        section: resolveBucketShortcutSection(bucketKey),
                        part: 'card',
                    }}
                    onOpenContextMenu={(rect) => onCardContextMenuByKeyboard(item.card_id, rect)}
                    focusGroup="bucket"
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
                    dragHandleProps={dragHandleProps}
                />
                </div>
                {showDropAfter && (
                    <div
                        aria-hidden="true"
                        className="mt-2 rounded-lg border-2 border-sky-500 bg-sky-500 shadow-inner"
                        style={{ height: placeholderHeight, backgroundColor: 'rgb(226 232 240 / 0.7)' }}
                    />
                )}
            </div>
            )}
        </DraggableCard>
    );
};
