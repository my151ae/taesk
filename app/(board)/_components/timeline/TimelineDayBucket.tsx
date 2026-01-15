import { memo, ReactNode } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { TimelineBucketCard } from './TimelineBucketCard';
import {
    TimelineDay,
    TimelineBucketItem,
    buildAbMeta,
} from '@/app/(board)/_utils/timeline-helpers';
import type { BucketIndicator } from '@/app/(board)/_hooks/useTimelineDragAndDrop';

type TimelineDayBucketProps = {
    day: TimelineDay;
    bucketsA: readonly TimelineBucketItem[];
    bucketsB: readonly TimelineBucketItem[];
    floatingLayerTop: number;
    viewportHeight?: number;
    registerScrollContainer?: (dayIso: string, el: HTMLDivElement | null) => void;
    status: string;
    openCardModal: (shortId: string | null, source: string) => void;
    onToggleCheck: (cardId: string, checked: boolean) => void;
    bucketIndicator: BucketIndicator | null;
    onCreateBucketCard?: (bucketKey: string, afterCardId?: string) => void;
    onCardContextMenu: (e: React.MouseEvent, cardId: string) => void;
    onCardContextMenuByKeyboard: (cardId: string, rect: DOMRect) => void;
    contextMenuCardId: string | null;
    onUpdateCardTitle?: (cardId: string, newTitle: string, previousTitle: string) => void;
    createdCardId?: string | null;
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

export const TimelineDayBucket = memo(function TimelineDayBucket({
    day,
    bucketsA,
    bucketsB,
    floatingLayerTop,
    viewportHeight,
    registerScrollContainer,
    status,
    openCardModal,
    onToggleCheck,
    bucketIndicator,
    onCreateBucketCard,
    onCardContextMenu,
    onCardContextMenuByKeyboard,
    contextMenuCardId,
    onUpdateCardTitle,
    createdCardId,
}: TimelineDayBucketProps) {
    const meta = buildAbMeta(day);

    return (
        <div
            ref={(el) => registerScrollContainer?.(day.isoDate, el)}
            data-ab-scroll-container="true"
            data-ab-day={day.isoDate}
            className="pointer-events-auto w-full min-w-0 border-l border-slate-100 md:border-slate-200 bg-white overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-200"
            style={{ height: viewportHeight ? `${viewportHeight}px` : `calc(100vh - ${floatingLayerTop}px)` }}
        >
            <div className="flex min-h-full flex-col gap-0.5">
                {meta.sections.map((section) => {
                    const items = section.bucket.endsWith('_a') ? bucketsA : bucketsB;
                    const isA = section.bucket.endsWith('_a');
                    const lastCardId = items.length ? items[items.length - 1]?.card_id : undefined;
                    return (
                        <DroppableBucket key={section.bucket} bucketKey={section.bucket} disabled={status === 'loading'}>
                            {(isOver) => (
                                <div className={`border border-slate-100 bg-slate-50/70 py-2 shadow-inner min-h-[240px] ${!isA ? 'flex-1' : ''}`}>
                                    <div className="flex items-center justify-between px-3">
                                        <p className="text-[10px] font-semibold text-slate-600">{section.label}</p>
                                        <button
                                            type="button"
                                            aria-label="カードを追加"
                                            disabled={status === 'loading' || !onCreateBucketCard}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onCreateBucketCard?.(section.bucket);
                                            }}
                                            className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-transparent text-slate-500 hover:border-slate-200 hover:bg-white hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
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
                                                    onCardContextMenu={onCardContextMenu}
                                                    onCardContextMenuByKeyboard={onCardContextMenuByKeyboard}
                                                    isContextMenuOpen={contextMenuCardId === item.card_id}
                                                    onUpdateCardTitle={onUpdateCardTitle}
                                                    initialIsEditing={createdCardId === item.card_id}
                                                    onCreateBucketCard={onCreateBucketCard}
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
                                            className="flex w-full items-center gap-2 rounded-none border border-slate-200/70 bg-white/60 px-3 py-2 text-[11px] font-semibold text-slate-400 hover:border-sky-300 hover:bg-white hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
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
});
