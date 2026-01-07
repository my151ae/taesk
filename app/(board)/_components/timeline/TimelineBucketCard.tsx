import { useDroppable } from '@dnd-kit/core';
import clsx from 'clsx';
import { TimelineBucketItem, timeLabel, formatDuration } from '@/app/(board)/_utils/timeline-helpers';
import { bucketKeyToDueBucket } from '@/lib/bucket-normalization';
import { DraggableCard } from './TimelineDraggableCard';
import { TimelineCard } from './TimelineCard';

const DROP_ZONE_MARGIN_PX = 12;

type TimelineBucketCardProps = {
    item: TimelineBucketItem;
    bucketKey: string;
    openCardModal: (shortId: string | null) => void;
    onToggleCheck: (cardId: string, checked: boolean) => void;
    showFallbackBottomLine?: boolean;
    onCardContextMenu: (e: React.MouseEvent, cardId: string) => void;
    isContextMenuOpen: boolean;
};

export const TimelineBucketCard = ({
    item,
    bucketKey,
    openCardModal,
    onToggleCheck,
    showFallbackBottomLine = false,
    onCardContextMenu,
    isContextMenuOpen,
}: TimelineBucketCardProps) => {
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
            disabled={isContextMenuOpen}
        >
            <div className="relative" data-testid={`ab-card-${item.card_id}`} data-bucket={bucketKey} onContextMenu={(e) => onCardContextMenu(e, item.card_id)}>
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
                    onToggleCheck={(next) => onToggleCheck(item.card_id, next)}
                    badgeLabel={bucketKeyToDueBucket(bucketKey).toUpperCase()}
                    duration={undefined}
                    timeText={
                        <span className="flex gap-1">
                            {item.duration ? <span>({formatDuration(item.duration)})</span> : null}
                            {item.due_start ? timeLabel(item.due_start, item.due_end) : null}
                        </span>
                    }
                    timePlacement="top"
                    onOpen={() => openCardModal(item.short_id)}
                    openButtonTestId={`cardOpenButton-${item.card_id}`}
                    className="min-h-[40px] pt-4 pb-1"
                />
            </div>
        </DraggableCard>
    );
};
