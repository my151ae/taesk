import { memo, ReactNode, useMemo, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { TimelineBucketCard } from './TimelineBucketCard';
import {
    TimelineCard,
    TIMELINE_LIST_CARD_NOTE_CLAMP_CLASS,
} from './TimelineCard';
import { buildTimelineCardTimeText } from '@/app/(board)/_components/timeline/timeline-card-meta';
import {
    TimelineDay,
    TimelineBucketItem,
} from '@/app/(board)/_utils/timeline-helpers';
import type { BucketIndicator } from '@/app/(board)/_hooks/useTimelineDragAndDrop';

type TimelineDayBucketProps = {
    day: TimelineDay;
    bucketsA: readonly TimelineBucketItem[];
    bucketsB: readonly TimelineBucketItem[];
    floatingLayerTop: number;
    viewportHeight?: number;
    registerScrollContainer?: (dayIso: string, el: HTMLDivElement | null, bucket?: 'a' | 'b') => void;
    status: string;
    openCardModal: (shortId: string | null, source: string) => void;
    onToggleCheck: (cardId: string, checked: boolean) => void;
    bucketIndicator: BucketIndicator | null;
    onCreateBucketCard?: (bucketKey: string, afterCardId?: string) => void;
    onCardContextMenu: (e: React.MouseEvent, cardId: string) => void;
    onCardContextMenuByKeyboard: (cardId: string, rect: DOMRect) => void;
    contextMenuCardId: string | null;
};

type CompletedBucketSource = 'a' | 'b';

const DroppableBucket = ({ children, bucketKey, disabled }: { children: (isOver: boolean) => ReactNode; bucketKey: string; disabled?: boolean }) => {
    const { setNodeRef, isOver } = useDroppable({ id: `bucket-drop:${bucketKey}`, data: { type: 'ab-bucket', bucketKey } });
    const highlight = !disabled && isOver ? 'bg-slate-100/50' : '';
    return (
        <div
            ref={setNodeRef}
            className={`flex min-h-0 flex-1 flex-col ${highlight}`}
            data-dnd="ab-bucket"
            data-bucket-key={bucketKey}
        >
            {children(isOver)}
        </div>
    );
};

function CountBadge({ count, testId }: { count: number; testId?: string }) {
    return (
        <span
            className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold leading-tight text-slate-700"
            data-testid={testId}
        >
            {count}
        </span>
    );
}

function resolveCompletedBadgeLabel(item: TimelineBucketItem, fallbackBucket: CompletedBucketSource) {
    if (item.due_bucket === 'a' || item.due_bucket === 'b') {
        return item.due_bucket.toUpperCase();
    }
    return fallbackBucket.toUpperCase();
}

function CompletedBucketCard({
    item,
    sourceBucket,
    openCardModal,
    onToggleCheck,
    onCardContextMenu,
    onCardContextMenuByKeyboard,
}: {
    item: TimelineBucketItem;
    sourceBucket: CompletedBucketSource;
    openCardModal: (shortId: string | null) => void;
    onToggleCheck: (cardId: string, checked: boolean) => void;
    onCardContextMenu: (e: React.MouseEvent, cardId: string) => void;
    onCardContextMenuByKeyboard: (cardId: string, rect: DOMRect) => void;
}) {
    const badgeLabel = resolveCompletedBadgeLabel(item, sourceBucket);

    return (
        <div
            className="relative min-w-0 pt-4 has-[:focus]:z-10 transition-opacity duration-150"
            data-testid={`completed-card-${item.card_id}`}
            onContextMenu={(e) => onCardContextMenu(e, item.card_id)}
        >
            <span
                className="pointer-events-none absolute right-[6px] top-[3px] z-20 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold leading-none text-slate-500 shadow-sm"
                data-testid={`completed-badge-${item.card_id}`}
            >
                {badgeLabel}
            </span>
            <TimelineCard
                title={item.title || ''}
                checked={item.checked}
                checklist={item.checklist}
                content={item.content ?? null}
                onToggleCheck={(next) => onToggleCheck(item.card_id, next)}
                cardId={item.card_id}
                timeText={buildTimelineCardTimeText(item, {
                    includeDate: true,
                    includeTime: false,
                    includeDuration: true,
                })}
                timePlacement="out-top"
                note={item.excerpt ?? undefined}
                noteClampClass={TIMELINE_LIST_CARD_NOTE_CLAMP_CLASS}
                notePreviewLines={3}
                rightMeta={null}
                onOpen={() => openCardModal(item.short_id)}
                openButtonTestId={`completed-open-${item.card_id}`}
                paddingClass="py-1"
                className="min-h-0"
                shortcutContext={{
                    scope: 'board',
                    region: 'main-panel',
                    view: 'timeline',
                    part: 'card',
                }}
                onOpenContextMenu={(rect) => onCardContextMenuByKeyboard(item.card_id, rect)}
                focusGroup="bucket"
            />
        </div>
    );
}

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
}: TimelineDayBucketProps) {
    const [completedExpanded, setCompletedExpanded] = useState(false);
    const activeA = useMemo(() => bucketsA.filter((item) => !item.checked), [bucketsA]);
    const activeB = useMemo(() => bucketsB.filter((item) => !item.checked), [bucketsB]);
    const completedA = useMemo(() => bucketsA.filter((item) => item.checked), [bucketsA]);
    const completedB = useMemo(() => bucketsB.filter((item) => item.checked), [bucketsB]);
    const completedItems = useMemo(
        () => [
            ...completedA.map((item) => ({ item, sourceBucket: 'a' as const })),
            ...completedB.map((item) => ({ item, sourceBucket: 'b' as const })),
        ],
        [completedA, completedB]
    );
    const completedPanelId = `completed-panel-${day.isoDate}`;
    const hasExpandedCompleted = completedExpanded && completedItems.length > 0;
    const aMaxHeight = viewportHeight
        ? `${Math.floor(viewportHeight * (hasExpandedCompleted ? 0.52 : 0.65))}px`
        : hasExpandedCompleted
            ? '52%'
            : '65%';
    const completedSectionHeight = hasExpandedCompleted
        ? (viewportHeight ? Math.max(180, Math.floor(viewportHeight * 0.34)) : 220)
        : 0;

    const renderBucketSection = ({
        bucketKey,
        label,
        items,
        bucket,
    }: {
        bucketKey: string;
        label: string;
        items: readonly TimelineBucketItem[];
        bucket: CompletedBucketSource;
    }) => {
        const lastCardId = items.length ? items[items.length - 1]?.card_id : undefined;

        return (
            <div
                className={bucket === 'a' ? 'flex min-h-0 min-w-0 grow shrink basis-[65%] flex-col' : 'flex min-h-[160px] min-w-0 grow shrink basis-0 flex-col'}
                style={bucket === 'a' ? { maxHeight: aMaxHeight } : { minHeight: '160px' }}
            >
                <DroppableBucket bucketKey={bucketKey} disabled={status === 'loading'}>
                    {(isOver) => (
                        <div className="flex h-full min-h-0 min-w-0 flex-col border border-slate-100 bg-slate-50/70 py-2 shadow-inner transition-colors duration-150">
                            <div className="flex items-center justify-between gap-2 px-3">
                                <div className="flex min-w-0 items-center gap-2">
                                    <p className="truncate text-[10px] font-semibold text-slate-600">{label}</p>
                                    <CountBadge count={items.length} />
                                </div>
                                <button
                                    type="button"
                                    aria-label={`${label} にカードを追加`}
                                    disabled={status === 'loading' || !onCreateBucketCard}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onCreateBucketCard?.(bucketKey);
                                    }}
                                    className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-transparent text-slate-500 hover:border-slate-200 hover:bg-white hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                                    data-testid={`ab-add-${bucketKey}`}
                                >
                                    <span className="text-base leading-none">＋</span>
                                </button>
                            </div>
                            <div
                                ref={(el) => registerScrollContainer?.(day.isoDate, el, bucket)}
                                data-ab-scroll-container="true"
                                className="mt-2 flex-1 min-h-0 min-w-0 space-y-1 overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-200 p-[1px]"
                            >
                                {items.length === 0 && isOver && (
                                    <div className="mb-2 h-0.5 bg-sky-500" />
                                )}
                                {items.length === 0 && !isOver ? (
                                    <p className="px-3 text-[11px] text-slate-400">Drop cards here</p>
                                ) : (
                                    items.map((item) => (
                                        <TimelineBucketCard
                                            key={item.card_id}
                                            item={item}
                                            bucketKey={bucketKey}
                                            openCardModal={(shortId) => openCardModal(shortId, 'bucket-list')}
                                            onToggleCheck={onToggleCheck}
                                            showFallbackBottomLine={
                                                bucketIndicator?.bucketKey === bucketKey && bucketIndicator.cardId === item.card_id
                                            }
                                            onCardContextMenu={onCardContextMenu}
                                            onCardContextMenuByKeyboard={onCardContextMenuByKeyboard}
                                            isContextMenuOpen={contextMenuCardId === item.card_id}
                                            onCreateBucketCard={onCreateBucketCard}
                                        />
                                    ))
                                )}
                                <button
                                    type="button"
                                    disabled={status === 'loading' || !onCreateBucketCard}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onCreateBucketCard?.(bucketKey, lastCardId);
                                    }}
                                    className="flex w-full items-center gap-2 rounded-none border border-slate-200/70 bg-white/60 px-3 py-2 text-[11px] font-semibold text-slate-400 hover:border-sky-300 hover:bg-white hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                                    data-testid={`ab-add-bottom-${bucketKey}`}
                                >
                                    <span className="text-base leading-none">＋</span>
                                    <span>追加</span>
                                </button>
                            </div>
                        </div>
                    )}
                </DroppableBucket>
            </div>
        );
    };

    return (
        <div
            data-ab-day={day.isoDate}
            className="pointer-events-auto w-full min-w-0 min-h-0 border-l border-slate-100 bg-white overflow-hidden md:border-slate-200"
            style={{ height: viewportHeight ? `${viewportHeight}px` : `calc(100vh - ${floatingLayerTop}px)` }}
        >
            <div className="flex h-full min-h-0 flex-col gap-0.5">
                {renderBucketSection({
                    bucketKey: `${day.key}_a`,
                    label: 'A: Critical',
                    items: activeA,
                    bucket: 'a',
                })}
                {renderBucketSection({
                    bucketKey: `${day.key}_b`,
                    label: 'B: Stretch',
                    items: activeB,
                    bucket: 'b',
                })}

                <section
                    className="flex shrink-0 flex-col overflow-hidden border border-slate-100 bg-slate-50/70 py-2 shadow-inner transition-[max-height,min-height] duration-200 ease-out"
                    style={hasExpandedCompleted ? { minHeight: '180px', maxHeight: `${completedSectionHeight}px` } : undefined}
                >
                    <div className="flex items-center justify-between gap-2 px-3">
                        <button
                            type="button"
                            aria-expanded={completedExpanded}
                            aria-controls={completedPanelId}
                            aria-label={`Completed ${completedItems.length} 件`}
                            onClick={() => setCompletedExpanded((prev) => !prev)}
                            className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-0.5 py-0.5 text-left text-slate-600 transition-colors duration-150 hover:text-slate-800"
                            data-testid={`completed-toggle-${day.isoDate}`}
                        >
                            <span className="flex min-w-0 items-center gap-2">
                                <span className="truncate text-[10px] font-semibold">Completed</span>
                                <CountBadge count={completedItems.length} testId={`completed-count-${day.isoDate}`} />
                            </span>
                            <span
                                aria-hidden="true"
                                className={`text-xs transition-transform duration-200 ${completedExpanded ? 'rotate-180' : ''}`}
                            >
                                ▾
                            </span>
                        </button>
                    </div>
                    <div
                        id={completedPanelId}
                        className="mt-2 flex-1 min-h-0 overflow-hidden transition-[opacity] duration-200 ease-out"
                        style={{
                            opacity: completedExpanded ? 1 : 0,
                        }}
                        hidden={!completedExpanded}
                    >
                        <div className="min-h-0 space-y-1 overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-200 p-[1px]">
                            {completedItems.length === 0 ? (
                                <p
                                    className="px-3 py-1 text-[11px] text-slate-400"
                                    data-testid={`completed-empty-${day.isoDate}`}
                                >
                                    完了カードはありません
                                </p>
                            ) : (
                                completedItems.map(({ item, sourceBucket }) => {
                                    return (
                                        <CompletedBucketCard
                                            key={item.card_id}
                                            item={item}
                                            sourceBucket={sourceBucket}
                                            openCardModal={(shortId) => openCardModal(shortId, 'bucket-list')}
                                            onToggleCheck={onToggleCheck}
                                            onCardContextMenu={onCardContextMenu}
                                            onCardContextMenuByKeyboard={onCardContextMenuByKeyboard}
                                        />
                                    );
                                })
                            )}
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
});
