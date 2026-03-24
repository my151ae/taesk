import clsx from 'clsx';
import { memo, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { TimelineBucketCard } from './TimelineBucketCard';
import { DraggableCard } from './TimelineDraggableCard';
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

type ActiveBucketSection = 'a' | 'b' | 'completed';
type CompletedBucketSource = 'a' | 'b';
type CompletedBucketEntry = {
    item: TimelineBucketItem;
    sourceBucket: CompletedBucketSource;
};

const SECTION_ORDER: readonly ActiveBucketSection[] = ['a', 'b', 'completed'];
const PRIMARY_SECTION_ORDER: readonly Exclude<ActiveBucketSection, 'completed'>[] = ['a', 'b'];
const HEADER_HEIGHT_PX = 32;
const PREVIEW_CARD_HEIGHT_PX = 78;
const COMPACT_BUCKET_FOOTER_HEIGHT_PX = 20;
const COMPACT_EMPTY_HEIGHT_PX = HEADER_HEIGHT_PX + COMPACT_BUCKET_FOOTER_HEIGHT_PX;
const COMPLETED_SUMMARY_ROW_HEIGHT_PX = HEADER_HEIGHT_PX;
const EXPANDED_CARD_HEIGHT_PX = 78;
const EXPANDED_AB_FOOTER_HEIGHT_PX = 48;
const FALLBACK_BUCKET_VIEWPORT_HEIGHT_PX = 480;
const MAX_PREVIEW_ITEMS = 2;
const MAX_EXPANDED_SECTION_RATIO = 0.52;
const MAX_EXPANDED_SECTION_HEIGHT_PX = 420;

const DroppableBucket = ({ children, bucketKey, disabled }: { children: (isOver: boolean) => ReactNode; bucketKey: string; disabled?: boolean }) => {
    const { setNodeRef, isOver } = useDroppable({ id: `bucket-drop:${bucketKey}`, data: { type: 'ab-bucket', bucketKey } });
    const highlight = !disabled && isOver ? 'bg-slate-100/50' : '';
    return (
        <div
            ref={setNodeRef}
            className={`flex h-full min-h-0 w-full flex-1 flex-col ${highlight}`}
            data-dnd="ab-bucket"
            data-bucket-key={bucketKey}
        >
            {children(isOver)}
        </div>
    );
};

function CountBadge({ value, testId }: { value: ReactNode; testId?: string }) {
    return (
        <span
            className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold leading-tight text-slate-700"
            data-testid={testId}
        >
            {value}
        </span>
    );
}

function resolveCompletedBadgeLabel(item: TimelineBucketItem, fallbackBucket: CompletedBucketSource) {
    if (item.due_bucket === 'a' || item.due_bucket === 'b') {
        return item.due_bucket.toUpperCase();
    }
    return fallbackBucket.toUpperCase();
}

function pickFirstNonEmptyPrimarySection(counts: Record<ActiveBucketSection, number>): Exclude<ActiveBucketSection, 'completed'> | null {
    for (const section of PRIMARY_SECTION_ORDER) {
        if (counts[section] > 0) return section;
    }
    return null;
}

function findNextNonEmptyPrimarySection(
    current: Exclude<ActiveBucketSection, 'completed'>,
    counts: Record<ActiveBucketSection, number>
): Exclude<ActiveBucketSection, 'completed'> {
    const currentIndex = PRIMARY_SECTION_ORDER.indexOf(current);
    for (let step = 1; step <= PRIMARY_SECTION_ORDER.length; step += 1) {
        const nextSection = PRIMARY_SECTION_ORDER[(currentIndex + step) % PRIMARY_SECTION_ORDER.length];
        if (counts[nextSection] > 0) return nextSection;
    }
    return current;
}

function resolveCompactSectionRowHeight(itemCount: number, previewCount: number) {
    if (itemCount === 0) return COMPACT_EMPTY_HEIGHT_PX;
    return HEADER_HEIGHT_PX + (previewCount * PREVIEW_CARD_HEIGHT_PX) + COMPACT_BUCKET_FOOTER_HEIGHT_PX;
}

function StaticBucketRow({
    item,
    badgeLabel,
    openCardModal,
    onToggleCheck,
    onCardContextMenu,
    onCardContextMenuByKeyboard,
    dataTestId,
    badgeTestId,
    notePreviewLines = 3,
    cardClassName,
}: {
    item: TimelineBucketItem;
    badgeLabel?: string | null;
    openCardModal: (shortId: string | null) => void;
    onToggleCheck: (cardId: string, checked: boolean) => void;
    onCardContextMenu: (e: React.MouseEvent, cardId: string) => void;
    onCardContextMenuByKeyboard: (cardId: string, rect: DOMRect) => void;
    dataTestId?: string;
    badgeTestId?: string;
    notePreviewLines?: number;
    cardClassName?: string;
}) {
    return (
        <div
            className="relative min-w-0 pt-4 has-[:focus]:z-10 transition-opacity duration-150"
            data-testid={dataTestId}
            onContextMenu={(e) => onCardContextMenu(e, item.card_id)}
        >
            {badgeLabel ? (
                <span
                    className="pointer-events-none absolute right-[8px] top-[8px] z-20 rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] font-bold leading-none text-slate-500 shadow-sm"
                    data-testid={badgeTestId}
                >
                    {badgeLabel}
                </span>
            ) : null}
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
                notePreviewLines={notePreviewLines}
                rightMeta={null}
                onOpen={() => openCardModal(item.short_id)}
                paddingClass="py-1"
                className={clsx('min-h-0', cardClassName)}
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
    const completedCount = completedA.length + completedB.length;
    const totalCount = bucketsA.length + bucketsB.length;
    const sectionCounts = useMemo<Record<ActiveBucketSection, number>>(
        () => ({
            a: activeA.length,
            b: activeB.length,
            completed: completedItems.length,
        }),
        [activeA.length, activeB.length, completedItems.length]
    );
    const resolvePrimaryFallbackSection = useCallback(
        (preferred: Exclude<ActiveBucketSection, 'completed'>) => {
            if (sectionCounts[preferred] > 0) return preferred;
            return pickFirstNonEmptyPrimarySection(sectionCounts) ?? 'a';
        },
        [sectionCounts]
    );
    const [activeSection, setActiveSection] = useState<ActiveBucketSection>(() => resolvePrimaryFallbackSection('a'));
    const previousCountsRef = useRef(sectionCounts);
    const expandedSection = useMemo<ActiveBucketSection | null>(() => {
        if (activeSection === 'completed') {
            return sectionCounts.completed > 0 ? 'completed' : resolvePrimaryFallbackSection('a');
        }
        if (sectionCounts[activeSection] > 0) return activeSection;
        return pickFirstNonEmptyPrimarySection(sectionCounts);
    }, [activeSection, resolvePrimaryFallbackSection, sectionCounts]);

    useEffect(() => {
        const previousCounts = previousCountsRef.current;
        previousCountsRef.current = sectionCounts;

        if (previousCounts[activeSection] > 0 && sectionCounts[activeSection] === 0) {
            const nextSection = resolvePrimaryFallbackSection('a');
            if (nextSection !== activeSection) {
                setActiveSection(nextSection);
            }
        }
    }, [activeSection, resolvePrimaryFallbackSection, sectionCounts]);

    const handleSectionToggle = useCallback((section: ActiveBucketSection) => {
        setActiveSection((current) => {
            if (current === section) {
                if (section === 'completed') {
                    return resolvePrimaryFallbackSection('a');
                }
                return findNextNonEmptyPrimarySection(section, sectionCounts);
            }

            if (sectionCounts[section] === 0) {
                return current;
            }

            return section;
        });
    }, [resolvePrimaryFallbackSection, sectionCounts]);

    const handleAddAndExpand = useCallback((section: 'a' | 'b', bucketKey: string) => {
        setActiveSection(section);
        onCreateBucketCard?.(bucketKey);
    }, [onCreateBucketCard]);

    const layout = useMemo(
        () => {
            const previewCounts: Record<ActiveBucketSection, number> = {
                a: 0,
                b: 0,
                completed: 0,
            };
            const completedCompactHeight = COMPLETED_SUMMARY_ROW_HEIGHT_PX;

            if (!expandedSection || sectionCounts[expandedSection] === 0) {
                return {
                    previewCounts,
                    rowTemplate: [
                        `${resolveCompactSectionRowHeight(sectionCounts.a, 0)}px`,
                        `${resolveCompactSectionRowHeight(sectionCounts.b, 0)}px`,
                        'minmax(0,1fr)',
                        `${completedCompactHeight}px`,
                    ].join(' '),
                };
            }

            SECTION_ORDER.forEach((section) => {
                if (section !== expandedSection && section !== 'completed' && sectionCounts[section] > 0) {
                    previewCounts[section] = 1;
                }
            });

            const containerHeight = viewportHeight ?? FALLBACK_BUCKET_VIEWPORT_HEIGHT_PX;
            const compactHeights = SECTION_ORDER
                .filter((section) => section !== expandedSection)
                .reduce((sum, section) => sum + resolveCompactSectionRowHeight(sectionCounts[section], previewCounts[section]), 0);
            const maxExpandedHeight = Math.max(
                resolveCompactSectionRowHeight(sectionCounts[expandedSection], 1),
                containerHeight - compactHeights
            );
            const ratioCappedHeight = Math.max(
                resolveCompactSectionRowHeight(sectionCounts[expandedSection], 1),
                Math.min(MAX_EXPANDED_SECTION_HEIGHT_PX, Math.floor(containerHeight * MAX_EXPANDED_SECTION_RATIO))
            );
            const desiredExpandedHeight =
                HEADER_HEIGHT_PX +
                (sectionCounts[expandedSection] * EXPANDED_CARD_HEIGHT_PX) +
                (expandedSection === 'completed' ? 0 : EXPANDED_AB_FOOTER_HEIGHT_PX);
            const expandedHeight = Math.min(maxExpandedHeight, ratioCappedHeight, desiredExpandedHeight);

            let remainingHeight = containerHeight - compactHeights - expandedHeight;
            for (const section of SECTION_ORDER) {
                if (section === expandedSection) continue;
                while (
                    remainingHeight >= PREVIEW_CARD_HEIGHT_PX &&
                    previewCounts[section] > 0 &&
                    previewCounts[section] < Math.min(MAX_PREVIEW_ITEMS, sectionCounts[section])
                ) {
                    previewCounts[section] += 1;
                    remainingHeight -= PREVIEW_CARD_HEIGHT_PX;
                }
            }

            return {
                previewCounts,
                rowTemplate:
                    expandedSection === 'completed'
                        ? [
                            `${resolveCompactSectionRowHeight(sectionCounts.a, previewCounts.a)}px`,
                            `${resolveCompactSectionRowHeight(sectionCounts.b, previewCounts.b)}px`,
                            '0px',
                            `${expandedHeight}px`,
                        ].join(' ')
                        : [
                            `${expandedSection === 'a' ? expandedHeight : resolveCompactSectionRowHeight(sectionCounts.a, previewCounts.a)}px`,
                            `${expandedSection === 'b' ? expandedHeight : resolveCompactSectionRowHeight(sectionCounts.b, previewCounts.b)}px`,
                            'minmax(0,1fr)',
                            `${completedCompactHeight}px`,
                        ].join(' '),
            };
        },
        [expandedSection, sectionCounts, viewportHeight]
    );

    const renderSectionHeader = ({
        label,
        section,
        count,
        countValue,
        bodyId,
        countTestId,
        addButton,
    }: {
        label: string;
        section: ActiveBucketSection;
        count: number;
        countValue?: ReactNode;
        bodyId: string;
        countTestId: string;
        addButton?: ReactNode;
    }) => {
        const isExpanded = expandedSection === section && count > 0;
        const lineClass = section === 'a' ? 'border-b' : 'border-y';

        return (
            <div className={clsx('px-0', lineClass, 'border-slate-200/90 bg-slate-100/70')}>
                <div className="grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)_1.75rem] items-center">
                    <div className="flex h-6 w-6 items-center justify-center border-r border-slate-200/70">
                        {addButton ?? <span aria-hidden="true" className="block h-6 w-6" />}
                    </div>
                    <div className="flex min-w-0 items-center gap-2 px-1.5 py-0.5">
                        <span className="truncate text-[10px] font-semibold text-slate-700">{label}</span>
                        <CountBadge value={countValue ?? count} testId={countTestId} />
                    </div>
                    <button
                        type="button"
                        aria-expanded={isExpanded}
                        aria-controls={bodyId}
                        onClick={() => handleSectionToggle(section)}
                        className="flex h-7 w-7 items-center justify-center border-l border-slate-200/70 text-slate-600 transition-colors duration-150 hover:bg-white/70 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-inset"
                        data-testid={`bucket-toggle-${section}-${day.isoDate}`}
                    >
                        <span
                            aria-hidden="true"
                            className={clsx('text-xs transition-transform duration-200', isExpanded ? 'rotate-180' : '')}
                        >
                            ▾
                        </span>
                    </button>
                </div>
            </div>
        );
    };

    const renderCompactPreview = ({
        section,
        previews,
        badgeLabel,
        bucketKey,
    }: {
        section: 'a' | 'b' | 'completed';
        previews: Array<CompletedBucketEntry | { item: TimelineBucketItem }>;
        badgeLabel?: string | null;
        bucketKey?: string;
    }) => (
        <div
            id={`bucket-panel-${section}-${day.isoDate}`}
            data-testid={`bucket-preview-${section}-${day.isoDate}`}
            className="mt-1 flex-1 min-h-0 space-y-1 overflow-hidden p-[1px]"
        >
            {previews.map((preview, index) => {
                const rowBadgeLabel =
                    section === 'completed' && 'sourceBucket' in preview
                        ? resolveCompletedBadgeLabel(preview.item, preview.sourceBucket)
                        : badgeLabel;
                const row = (
                    <StaticBucketRow
                        item={preview.item}
                        badgeLabel={rowBadgeLabel}
                        openCardModal={(shortId) => openCardModal(shortId, 'bucket-list')}
                        onToggleCheck={onToggleCheck}
                        onCardContextMenu={onCardContextMenu}
                        onCardContextMenuByKeyboard={onCardContextMenuByKeyboard}
                        dataTestId={section === 'completed' ? `completed-card-${preview.item.card_id}` : undefined}
                        badgeTestId={section === 'completed' ? `completed-badge-${preview.item.card_id}` : undefined}
                        notePreviewLines={2}
                        cardClassName={bucketKey ? 'cursor-grab active:cursor-grabbing select-none' : undefined}
                    />
                );

                if (!bucketKey) {
                    return <div key={preview.item.card_id ?? index}>{row}</div>;
                }

                return (
                    <DraggableCard
                        key={preview.item.card_id}
                        id={`bucket-preview:${preview.item.card_id}`}
                        data={{ kind: 'bucket', cardId: preview.item.card_id, bucketKey, item: preview.item }}
                    >
                        {row}
                    </DraggableCard>
                );
            })}
        </div>
    );

    const renderBucketSection = ({
        section,
        label,
        items,
        bucket,
    }: {
        section: 'a' | 'b';
        label: string;
        items: readonly TimelineBucketItem[];
        bucket: ActiveBucketSection;
    }) => {
        const bucketKey = `${day.key}_${bucket}`;
        const isExpanded = expandedSection === section && items.length > 0;
        const bodyId = `bucket-panel-${section}-${day.isoDate}`;
        const lastCardId = items.length ? items[items.length - 1]?.card_id : undefined;
        const count = items.length;
        const addButton = (
            <button
                type="button"
                aria-label={`${label} にカードを追加`}
                disabled={status === 'loading' || !onCreateBucketCard}
                onClick={(e) => {
                    e.stopPropagation();
                    handleAddAndExpand(section, bucketKey);
                }}
                className="inline-flex h-6 w-6 items-center justify-center border border-transparent text-slate-500 transition-colors duration-150 hover:bg-white/70 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                data-testid={`ab-add-${bucketKey}`}
            >
                <span className="text-sm leading-none">＋</span>
            </button>
        );
        const renderBucketFooterSlot = ({
            isOver,
            onClick,
        }: {
            isOver: boolean;
            onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
        }) => (
            <button
                type="button"
                disabled={status === 'loading' || !onCreateBucketCard}
                onClick={onClick}
                className={clsx(
                    'relative mt-0.5 mb-1 flex h-4 w-full items-center justify-center overflow-hidden rounded-sm border border-dashed text-slate-500 transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
                    isOver
                        ? 'border-sky-400 bg-sky-50 text-sky-700'
                        : 'border-slate-300/90 bg-white/60 hover:border-sky-300 hover:bg-white hover:text-sky-700'
                )}
                data-testid={`ab-add-bottom-${bucketKey}`}
            >
                {isOver ? (
                    <span
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-sky-500"
                    />
                ) : null}
                <span className="relative z-10 inline-flex h-4 w-4 items-center justify-center text-xs leading-none">＋</span>
            </button>
        );

        if (isExpanded) {
            return (
                <section
                    data-testid={`bucket-section-${section}-${day.isoDate}`}
                    className="min-h-0 overflow-hidden"
                >
                    <DroppableBucket bucketKey={bucketKey} disabled={status === 'loading'}>
                        {(isOver) => (
                            <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border border-slate-100 bg-slate-50/70 shadow-inner transition-[height,max-height,opacity,background-color] duration-200 ease-out">
                                {renderSectionHeader({
                                    label,
                                    section,
                                    count,
                                    bodyId,
                                    countTestId: `bucket-count-${section}-${day.isoDate}`,
                                    addButton,
                                })}
                                <div
                                    id={bodyId}
                                    ref={(el) => registerScrollContainer?.(day.isoDate, el, bucket)}
                                    data-ab-scroll-container="true"
                                    className="mt-1 flex-1 min-h-0 min-w-0 space-y-1 overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-200 p-[1px]"
                                >
                                    {items.length === 0 && isOver ? <div className="mb-2 h-0.5 bg-sky-500" /> : null}
                                    {items.map((item) => (
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
                                    ))}
                                    {renderBucketFooterSlot({
                                        isOver,
                                        onClick: (e) => {
                                            e.stopPropagation();
                                            onCreateBucketCard?.(bucketKey, lastCardId);
                                        },
                                    })}
                                </div>
                            </div>
                        )}
                    </DroppableBucket>
                </section>
            );
        }

        if (count === 0) {
            return (
                <section
                    data-testid={`bucket-section-${section}-${day.isoDate}`}
                    className="min-h-0 overflow-hidden"
                >
                    <DroppableBucket bucketKey={bucketKey} disabled={status === 'loading'}>
                        {(isOver) => (
                            <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border border-slate-100 bg-slate-50/70 shadow-inner transition-[height,max-height,opacity,background-color] duration-200 ease-out">
                                {renderSectionHeader({
                                    label,
                                    section,
                                    count,
                                    bodyId,
                                    countTestId: `bucket-count-${section}-${day.isoDate}`,
                                    addButton,
                                })}
                                <div id={bodyId} className="px-3">
                                    {renderBucketFooterSlot({
                                        isOver,
                                        onClick: (e) => {
                                            e.stopPropagation();
                                            handleAddAndExpand(section, bucketKey);
                                        },
                                    })}
                                </div>
                            </div>
                        )}
                    </DroppableBucket>
                </section>
            );
        }

        return (
                <section
                    data-testid={`bucket-section-${section}-${day.isoDate}`}
                    className="min-h-0 overflow-hidden"
                >
                    <DroppableBucket bucketKey={bucketKey} disabled={status === 'loading'}>
                    {(isOver) => (
                        <div
                            className={clsx(
                                'flex h-full min-h-0 min-w-0 flex-col overflow-hidden border border-slate-100 bg-slate-50/70 shadow-inner transition-[height,max-height,opacity,background-color] duration-200 ease-out',
                                isOver ? 'bg-sky-50/60' : ''
                            )}
                        >
                            {renderSectionHeader({
                                label,
                                section,
                                count,
                                bodyId,
                                countTestId: `bucket-count-${section}-${day.isoDate}`,
                                addButton,
                            })}
                            <div className="flex min-h-0 flex-1 flex-col">
                                {renderCompactPreview({
                                    section,
                                    previews: items.slice(0, layout.previewCounts[section]).map((item) => ({ item })),
                                    bucketKey,
                                })}
                                <div className="px-[1px]">
                                    {renderBucketFooterSlot({
                                        isOver,
                                        onClick: (e) => {
                                            e.stopPropagation();
                                            handleAddAndExpand(section, bucketKey);
                                        },
                                    })}
                                </div>
                            </div>
                        </div>
                    )}
                </DroppableBucket>
            </section>
        );
    };

    const renderCompletedSection = () => {
        const section: ActiveBucketSection = 'completed';
        const count = completedItems.length;
        const isExpanded = expandedSection === section && count > 0;
        const bodyId = `bucket-panel-${section}-${day.isoDate}`;

        return (
            <section
                data-testid={`bucket-section-completed-${day.isoDate}`}
                className="min-h-0 overflow-hidden"
            >
                <div className="flex h-full min-h-0 flex-col overflow-hidden border border-slate-100 bg-slate-50/70 shadow-inner transition-[height,max-height,opacity,background-color] duration-200 ease-out">
                    {renderSectionHeader({
                        label: 'Completed',
                        section,
                        count,
                        countValue: `${completedCount}/${totalCount}`,
                        bodyId,
                        countTestId: `bucket-count-completed-${day.isoDate}`,
                    })}
                    {isExpanded ? (
                        <div
                            id={bodyId}
                            className="mt-1 flex-1 min-h-0 space-y-1 overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-200 p-[1px]"
                        >
                            {completedItems.map(({ item, sourceBucket }) => (
                                <StaticBucketRow
                                    key={item.card_id}
                                    item={item}
                                    badgeLabel={resolveCompletedBadgeLabel(item, sourceBucket)}
                                    openCardModal={(shortId) => openCardModal(shortId, 'bucket-list')}
                                    onToggleCheck={onToggleCheck}
                                    onCardContextMenu={onCardContextMenu}
                                    onCardContextMenuByKeyboard={onCardContextMenuByKeyboard}
                                    dataTestId={`completed-card-${item.card_id}`}
                                    badgeTestId={`completed-badge-${item.card_id}`}
                                />
                            ))}
                        </div>
                    ) : (
                        <div id={bodyId} data-testid={`bucket-preview-completed-${day.isoDate}`} hidden />
                    )}
                </div>
            </section>
        );
    };

    return (
        <div
            data-ab-day={day.isoDate}
            className="pointer-events-auto w-full min-w-0 min-h-0 border-l border-slate-100 bg-white overflow-hidden md:border-slate-200"
            style={{ height: viewportHeight ? `${viewportHeight}px` : `calc(100vh - ${floatingLayerTop}px)` }}
        >
            <div
                className="grid h-full min-h-0 content-start gap-0 transition-[grid-template-rows] duration-200 ease-out"
                style={{ gridTemplateRows: layout.rowTemplate }}
            >
                {renderBucketSection({
                    section: 'a',
                    label: 'A: Critical',
                    items: activeA,
                    bucket: 'a',
                })}
                {renderBucketSection({
                    section: 'b',
                    label: 'B: Stretch',
                    items: activeB,
                    bucket: 'b',
                })}
                <div aria-hidden="true" className="min-h-0" />
                {renderCompletedSection()}
            </div>
        </div>
    );
});
