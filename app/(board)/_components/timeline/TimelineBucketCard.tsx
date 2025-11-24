import { useDroppable } from '@dnd-kit/core';
import { TimelineBucketItem, timeLabel } from '@/app/(board)/_utils/timeline-helpers';
import { DraggableCard } from './TimelineDraggableCard';

type TimelineBucketCardProps = {
    item: TimelineBucketItem;
    bucketKey: string;
    openCardModal: (shortId: string | null) => void;
};

export const TimelineBucketCard = ({
    item,
    bucketKey,
    openCardModal,
}: TimelineBucketCardProps) => {
    const { setNodeRef } = useDroppable({
        id: `bucket-item:${bucketKey}:${item.card_id}`,
        data: { type: 'bucket-item', bucketKey, cardId: item.card_id },
    });

    return (
        <DraggableCard
            id={`bucket:${item.card_id}`}
            data={{ kind: 'bucket', cardId: item.card_id, bucketKey, item }}
            extraNodeRef={setNodeRef}
        >
            <div
                className="bg-white px-3 py-2 text-xs shadow-sm"
                data-testid={`ab-card-${item.card_id}`}
                data-bucket={bucketKey}
            >
                <div className="flex items-start gap-2 text-slate-700">
                    <input
                        type="checkbox"
                        checked={item.checked}
                        readOnly
                        className="mt-0.5 h-3.5 w-3.5 border-slate-300 text-sky-500"
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
                            className="flex h-6 w-6 flex-shrink-0 items-center justify-center self-start rounded-full border border-slate-200 text-[10px] font-semibold text-slate-500 hover:border-sky-300 hover:text-sky-600"
                            aria-label="Open card"
                            data-testid={`cardOpenButton-${item.card_id}`}
                        >
                            ↗
                        </button>
                    </div>
                </div>
            </div>
        </DraggableCard>
    );
};
