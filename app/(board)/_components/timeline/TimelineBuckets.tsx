import { useDroppable } from '@dnd-kit/core';
import { ReactNode } from 'react';
import {
    TimelineDay,
    TimelineBucketItem,
    AB_CARD_META,
    timeLabel
} from '@/app/(board)/_utils/timeline-helpers';
import { DraggableCard } from './TimelineDraggableCard';

type TimelineBucketsProps = {
    days: TimelineDay[];
    abBuckets: Record<string, TimelineBucketItem[]>;
    floatingLayerTop: number;
    status: string;
    openCardModal: (shortId: string | null, source: string) => void;
};

const DroppableBucket = ({ children, bucketKey, disabled }: { children: ReactNode; bucketKey: string; disabled?: boolean }) => {
    const { setNodeRef, isOver } = useDroppable({ id: `bucket-drop:${bucketKey}`, data: { type: 'ab-bucket', bucketKey } });
    const highlight = !disabled && isOver ? 'rounded-2xl ring-2 ring-sky-300 ring-offset-2 ring-offset-slate-50' : '';
    return (
        <div ref={setNodeRef} className={highlight}>
            {children}
        </div>
    );
};

const AbBucketDraggableCard = ({
    item,
    bucketKey,
    openCardModal,
}: {
    item: TimelineBucketItem;
    bucketKey: string;
    openCardModal: (shortId: string | null) => void;
}) => {
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
                className="rounded-md bg-white px-3 py-2 text-xs shadow-sm"
                data-testid={`ab-card-${item.card_id}`}
                data-bucket={bucketKey}
            >
                <div className="flex items-start gap-2 text-slate-700">
                    <input
                        type="checkbox"
                        checked={item.checked}
                        readOnly
                        className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-sky-500"
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

export default function TimelineBuckets({
    days,
    abBuckets,
    floatingLayerTop,
    status,
    openCardModal,
}: TimelineBucketsProps) {
    if (!days.length) return null;
    const templateColumns = `80px repeat(${days.length}, minmax(0, 1fr))`;

    const renderAbCard = (day: TimelineDay) => {
        const meta = AB_CARD_META[day.key];
        if (!meta) return null;

        return (
            <div className="pointer-events-auto rounded-2xl border border-slate-100 bg-white/95 p-4 shadow-xl ring-1 ring-black/5 backdrop-blur">
                <div className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-500">
                    <span>{meta.title}</span>
                    <span>{day.isoDate}</span>
                </div>
                <div className="mt-3 space-y-4">
                    {meta.sections.map((section) => {
                        const items = abBuckets[section.bucket] ?? [];
                        return (
                            <DroppableBucket key={section.bucket} bucketKey={section.bucket} disabled={status === 'loading'}>
                                <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3 shadow-inner">
                                    <p className="text-[11px] font-semibold text-slate-600">{section.label}</p>
                                    <p className="text-[10px] text-slate-400">{section.helper}</p>
                                    <div className="mt-2 space-y-1">
                                        {items.length === 0 ? (
                                            <p className="text-[11px] text-slate-400">Drop cards here</p>
                                        ) : (
                                            items.slice(0, 3).map((item) => (
                                                <AbBucketDraggableCard
                                                    key={item.card_id}
                                                    item={item}
                                                    bucketKey={section.bucket}
                                                    openCardModal={(shortId) => openCardModal(shortId, 'bucket-list')}
                                                />
                                            ))
                                        )}
                                        {items.length > 3 && (
                                            <p className="text-[10px] text-slate-400">and {items.length - 3} more…</p>
                                        )}
                                    </div>
                                </div>
                            </DroppableBucket>
                        );
                    })}
                </div>
            </div>
        );
    };

    return (
        <div
            className="pointer-events-none sticky z-20 h-0 overflow-visible"
            style={{ top: floatingLayerTop }}
        >
            <div className="grid" style={{ gridTemplateColumns: templateColumns }}>
                <div />
                {days.map((day) => (
                    <div key={day.key} className="relative flex justify-end px-2 sm:px-4">
                        <div className="pointer-events-auto w-[210px] max-w-full sm:max-w-[220px]">
                            {renderAbCard(day)}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
