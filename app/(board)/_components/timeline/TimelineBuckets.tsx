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
                        return (
                            <DroppableBucket key={section.bucket} bucketKey={section.bucket} disabled={status === 'loading'}>
                                {(isOver) => (
                                    <div className={`border border-slate-100 bg-slate-50/70 py-3 shadow-inner min-h-[240px] ${!isA ? 'flex-1' : ''}`}>
                                        <p className="text-[11px] font-semibold text-slate-600 px-3">{section.label}</p>
                                        <p className="text-[10px] text-slate-400 px-3">{section.helper}</p>
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
