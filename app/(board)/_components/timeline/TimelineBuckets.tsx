import { useDroppable } from '@dnd-kit/core';
import { ReactNode } from 'react';
import {
    TimelineDay,
    TimelineBucketItem,
    buildAbMeta,
} from '@/app/(board)/_utils/timeline-helpers';
import { BucketIndicator } from '@/app/(board)/_hooks/useTimelineDragAndDrop';
import { TimelineBucketCard } from './TimelineBucketCard';

type TimelineBucketsProps = {
    days: TimelineDay[];
    abBuckets: Record<string, TimelineBucketItem[]>;
    floatingLayerTop: number;
    status: string;
    openCardModal: (shortId: string | null, source: string) => void;
    onToggleCheck: (cardId: string, checked: boolean) => void;
    bucketIndicator: BucketIndicator | null;
    onCreateBucketCard?: (bucketKey: string, afterCardId?: string) => void;
    axisWidth?: number;
};

const DroppableBucket = ({ children, bucketKey, disabled }: { children: (isOver: boolean) => ReactNode; bucketKey: string; disabled?: boolean }) => {
    const { setNodeRef, isOver } = useDroppable({ id: `bucket-drop:${bucketKey}`, data: { type: 'ab-bucket', bucketKey } });
    const highlight = !disabled && isOver ? 'bg-slate-100/50' : '';
    return (
        <div ref={setNodeRef} className={highlight}>
            {children(isOver)}
        </div>
    );
};

export default function TimelineBuckets({
    days,
    abBuckets,
    floatingLayerTop,
    status,
    openCardModal,
    onToggleCheck,
    bucketIndicator,
    onCreateBucketCard,
    axisWidth = 80,
}: TimelineBucketsProps) {
    if (!days.length) return null;
    const templateColumns = `${axisWidth}px repeat(${days.length}, minmax(0, 1fr))`;

    const renderAbCard = (day: TimelineDay) => {
        const meta = buildAbMeta(day);

        return (
            <div
                className="pointer-events-auto border-l border-slate-100 md:border-slate-200 bg-white overflow-y-auto overflow-x-hidden"
                style={{ height: `calc(100vh - ${floatingLayerTop}px)` }}
            >
                <div className="flex flex-col gap-0.5 h-full">
                    {meta.sections.map((section) => {
                        const items = abBuckets[section.bucket] ?? [];
                        const isA = section.bucket.endsWith('_a');
                        const lastCardId = items.length ? items[items.length - 1]?.card_id : undefined;
                        return (
                            <DroppableBucket key={section.bucket} bucketKey={section.bucket} disabled={status === 'loading'}>
                                {(isOver) => (
                                    <div className={`border border-slate-100 bg-slate-50/70 py-3 shadow-inner min-h-[240px] ${!isA ? 'flex-1' : ''}`}>
                                        <div className="flex items-center justify-between px-3">
                                            <p className="text-[11px] font-semibold text-slate-600">{section.label}</p>
                                            <button
                                                type="button"
                                                aria-label="カードを追加"
                                                disabled={status === 'loading' || !onCreateBucketCard}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onCreateBucketCard?.(section.bucket);
                                                }}
                                                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-slate-500 hover:border-slate-200 hover:bg-white hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                                                data-testid={`ab-add-${section.bucket}`}
                                            >
                                                <span className="text-base leading-none">＋</span>
                                            </button>
                                        </div>
                                        <div className="mt-2 space-y-1">
                                            {items.length === 0 && isOver && (
                                                <div className="mb-2 h-0.5 bg-sky-500" />
                                            )}
                                            {items.length === 0 && !isOver ? (
                                                <p className="text-[11px] text-slate-400 px-3">Drop cards here</p>
                                            ) : (
                                                items.map((item) => (
                                                    <TimelineBucketCard
                                                        key={item.card_id}
                                                        item={item}
                                                        bucketKey={section.bucket}
                                                        openCardModal={(shortId) => openCardModal(shortId, 'bucket-list')}
                                                        onToggleCheck={onToggleCheck}
                                                        showFallbackBottomLine={
                                                            bucketIndicator?.bucketKey === section.bucket && bucketIndicator.cardId === item.card_id
                                                        }
                                                    />
                                                ))
                                            )}
                                            <button
                                                type="button"
                                                disabled={status === 'loading' || !onCreateBucketCard}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onCreateBucketCard?.(section.bucket, lastCardId);
                                                }}
                                                className="mx-2 flex w-[calc(100%-1rem)] items-center gap-2 rounded-lg border border-slate-200/70 bg-white/60 px-3 py-2 text-[11px] font-semibold text-slate-400 hover:border-sky-300 hover:bg-white hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                                                data-testid={`ab-add-bottom-${section.bucket}`}
                                            >
                                                <span className="text-base leading-none">＋</span>
                                                <span>追加</span>
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </DroppableBucket>
                        );
                    })}
                </div>
            </div>
        );
    };

    // If axisWidth is 0, render buckets directly without grid wrapper (for mobile column layout)
    if (axisWidth === 0) {
        return (
            <>
                {days.map((day) => (
                    <div key={day.key} className="h-full">
                        {renderAbCard(day)}
                    </div>
                ))}
            </>
        );
    }

    // Default grid layout (for PC)
    return (
        <div
            className="pointer-events-none sticky z-20 h-0 overflow-visible"
            style={{ top: 0 }}
        >
            <div className="grid" style={{ gridTemplateColumns: templateColumns }}>
                <div />
                {days.map((day) => (
                    <div key={day.key} className="relative flex justify-end">
                        <div className="w-1/2 md:w-[calc(50%-3px)]">
                            {renderAbCard(day)}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
