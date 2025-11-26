import { useDroppable } from '@dnd-kit/core';
import { TimelineBucketItem, timeLabel } from '@/app/(board)/_utils/timeline-helpers';
import { bucketKeyToDueBucket } from '@/lib/bucket-normalization';
import { DraggableCard } from './TimelineDraggableCard';

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
            <div
                className="bg-white px-3 py-2 text-xs shadow-sm relative"
                data-testid={`ab-card-${item.card_id}`}
                data-bucket={bucketKey}
            >
                {/* Drop Zones */}
                <div ref={setTopRef} className="absolute top-0 left-0 right-0 h-1/2 z-20 pointer-events-none" />
                <div ref={setBottomRef} className="absolute bottom-0 left-0 right-0 h-1/2 z-20 pointer-events-none" />

                {/* Indicators */}
                {isOverTop && <div className="absolute left-0 right-0 top-0 h-0.5 bg-sky-500 z-30" />}
                {isOverBottom && <div className="absolute left-0 right-0 bottom-0 h-0.5 bg-sky-500 z-30" />}

                <div className="flex items-start gap-2 text-slate-700">
                    <input
                        type="checkbox"
                        checked={item.checked}
                        onChange={(e) => {
                            e.stopPropagation();
                            onToggleCheck(item.card_id, e.target.checked);
                        }}
                        className="mt-0.5 h-3.5 w-3.5 border-slate-300 text-sky-500 cursor-pointer"
                    />
                    <div className="flex min-w-0 flex-1 items-start gap-1">
                        <div className="flex-1 text-left">
                            <span className="block line-clamp-2">{item.title || 'Untitled card'}</span>
                            {item.due_start && (
                                <span className="text-[10px] text-slate-400">{timeLabel(item.due_start, item.due_end)}</span>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={(native) => {
                                native.stopPropagation();
                                openCardModal(item.short_id);
                            }}
                            onPointerDown={(native) => {
                                native.stopPropagation();
                            }}
                            className="flex h-7 items-center gap-1 self-start rounded-full border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-600 shadow-sm transition hover:border-sky-300 hover:text-sky-700"
                            aria-label="Open card"
                            data-testid={`cardOpenButton-${item.card_id}`}
                        >
                            <span className="text-[11px] font-bold leading-none">
                                {bucketKeyToDueBucket(bucketKey).toUpperCase()}
                            </span>
                            <span aria-hidden="true" className="text-[12px] leading-none">›</span>
                        </button>
                    </div>
                </div>
            </div>
        </DraggableCard>
    );
};
