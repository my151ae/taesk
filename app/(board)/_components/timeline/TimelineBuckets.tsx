import { useDroppable } from '@dnd-kit/core';
import { ReactNode } from 'react';
import {
    TimelineDay,
    TimelineBucketItem,
    AB_CARD_META,
    timeLabel
} from '@/app/(board)/_utils/timeline-helpers';
import { DraggableCard } from './TimelineDraggableCard';
import { TimelineBucketCard } from './TimelineBucketCard';

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
            <div
                className="pointer-events-auto border-l border-slate-200 bg-white/95 p-4 shadow-xl backdrop-blur overflow-y-auto"
                style={{ height: `calc(100vh - ${floatingLayerTop}px)` }}
            >
                <div className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-500">
                    <span>{meta.title}</span>
                    <span>{day.isoDate}</span>
                </div>
                <div className="mt-3 space-y-4">
                    {meta.sections.map((section) => {
                        const items = abBuckets[section.bucket] ?? [];
                        return (
                            <DroppableBucket key={section.bucket} bucketKey={section.bucket} disabled={status === 'loading'}>
                                <div className="border border-slate-100 bg-slate-50/70 p-3 shadow-inner">
                                    <p className="text-[11px] font-semibold text-slate-600">{section.label}</p>
                                    <p className="text-[10px] text-slate-400">{section.helper}</p>
                                    <div className="mt-2 space-y-1">
                                        {items.length === 0 ? (
                                            <p className="text-[11px] text-slate-400">Drop cards here</p>
                                        ) : (
                                            items.map((item) => (
                                                <TimelineBucketCard
                                                    key={item.card_id}
                                                    item={item}
                                                    bucketKey={section.bucket}
                                                    openCardModal={(shortId) => openCardModal(shortId, 'bucket-list')}
                                                />
                                            ))
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
                    <div key={day.key} className="relative flex justify-end">
                        <div className="pointer-events-auto w-[210px] max-w-full sm:max-w-[220px]">
                            {renderAbCard(day)}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
