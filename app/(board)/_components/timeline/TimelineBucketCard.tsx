import { useDroppable } from '@dnd-kit/core';
import { TimelineBucketItem, timeLabel } from '@/app/(board)/_utils/timeline-helpers';
import { bucketKeyToDueBucket } from '@/lib/bucket-normalization';
import { DraggableCard } from './TimelineDraggableCard';
import { TimelineCard } from './TimelineCard';

type TimelineBucketCardProps = {
    item: TimelineBucketItem;
    bucketKey: string;
    openCardModal: (shortId: string | null) => void;
    onToggleCheck: (cardId: string, checked: boolean) => void;
};

export const TimelineBucketCard = ({
    item,
    bucketKey,
    openCardModal,
    onToggleCheck,
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
        >
            <div className="relative" data-testid={`ab-card-${item.card_id}`} data-bucket={bucketKey}>
                {/* Drop Zones */}
                <div ref={setTopRef} className="absolute top-0 left-0 right-0 h-1/2 z-20 pointer-events-none" />
                <div ref={setBottomRef} className="absolute bottom-0 left-0 right-0 h-1/2 z-20 pointer-events-none" />

                {/* Indicators */}
                {isOverTop && <div className="absolute left-0 right-0 top-0 h-0.5 bg-sky-500 z-30" />}
                {isOverBottom && <div className="absolute left-0 right-0 bottom-0 h-0.5 bg-sky-500 z-30" />}

                <TimelineCard
                    title={item.title || 'Untitled card'}
                    checked={item.checked}
                    onToggleCheck={(next) => onToggleCheck(item.card_id, next)}
                    badgeLabel={bucketKeyToDueBucket(bucketKey).toUpperCase()}
                    timeText={item.due_start ? timeLabel(item.due_start, item.due_end) : null}
                    timePlacement="top"
                    onOpen={() => openCardModal(item.short_id)}
                    openButtonTestId={`cardOpenButton-${item.card_id}`}
                    className="h-10"
                />
            </div>
        </DraggableCard>
    );
};
