import clsx from 'clsx';
import { memo, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

type ActiveBucketSection = 'a' | 'b' | 'completed';
type CompletedBucketSource = 'a' | 'b';
type CompletedBucketEntry = {
    item: TimelineBucketItem;
    sourceBucket: CompletedBucketSource;
};

const SECTION_ORDER: readonly ActiveBucketSection[] = ['a', 'b', 'completed'];
const COMPACT_WITH_CARD_HEIGHT_PX = 104;
const COMPACT_EMPTY_HEIGHT_PX = 40;

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

function pickFirstNonEmptySection(counts: Record<ActiveBucketSection, number>): ActiveBucketSection | null {
    for (const section of SECTION_ORDER) {
        if (counts[section] > 0) return section;
    }
    return null;
}

function findNextNonEmptySection(current: ActiveBucketSection, counts: Record<ActiveBucketSection, number>): ActiveBucketSection {
    const currentIndex = SECTION_ORDER.indexOf(current);
    for (let step = 1; step <= SECTION_ORDER.length; step += 1) {
        const nextSection = SECTION_ORDER[(currentIndex + step) % SECTION_ORDER.length];
        if (counts[nextSection] > 0) return nextSection;
    }
    return current;
}

function resolveSectionRowHeight(section: ActiveBucketSection, expandedSection: ActiveBucketSection | null, counts: Record<ActiveBucketSection, number>) {
    if (expandedSection === section && counts[section] > 0) {
        return 'minmax(0, 1fr)';
    }

    return `${counts[section] > 0 ? COMPACT_WITH_CARD_HEIGHT_PX : COMPACT_EMPTY_HEIGHT_PX}px`;
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
    const sectionCounts = useMemo<Record<ActiveBucketSection, number>>(
        () => ({
            a: activeA.length,
            b: activeB.length,
            completed: completedItems.length,
        }),
        [activeA.length, activeB.length, completedItems.length]
    );
    const resolveFallbackSection = useCallback(
        (preferred: ActiveBucketSection) => {
            if (sectionCounts[preferred] > 0) return preferred;
            return pickFirstNonEmptySection(sectionCounts) ?? 'a';
        },
        [sectionCounts]
    );
    const [activeSection, setActiveSection] = useState<ActiveBucketSection>(() => resolveFallbackSection('a'));
    const previousCountsRef = useRef(sectionCounts);
    const expandedSection = sectionCounts[activeSection] > 0 ? activeSection : pickFirstNonEmptySection(sectionCounts);

    useEffect(() => {
        const previousCounts = previousCountsRef.current;
        previousCountsRef.current = sectionCounts;

        if (previousCounts[activeSection] > 0 && sectionCounts[activeSection] === 0) {
            const nextSection = resolveFallbackSection('a');
            if (nextSection !== activeSection) {
                setActiveSection(nextSection);
            }
        }
    }, [activeSection, resolveFallbackSection, sectionCounts]);

    const handleSectionToggle = useCallback((section: ActiveBucketSection) => {
        setActiveSection((current) => {
            if (current === section) {
                return findNextNonEmptySection(current, sectionCounts);
            }

            if (sectionCounts[section] === 0) {
                return current;
            }

            return section;
        });
    }, [sectionCounts]);

    const handleAddAndExpand = useCallback((section: 'a' | 'b', bucketKey: string) => {
        setActiveSection(section);
        onCreateBucketCard?.(bucketKey);
    }, [onCreateBucketCard]);

    const rowTemplate = useMemo(
        () =>
            SECTION_ORDER
                .map((section) => resolveSectionRowHeight(section, expandedSection, sectionCounts))
                .join(' '),
        [expandedSection, sectionCounts]
    );

    const renderSectionHeader = ({
        label,
        section,
        count,
        bodyId,
        countTestId,
        addButton,
    }: {
        label: string;
        section: ActiveBucketSection;
        count: number;
        bodyId: string;
        countTestId: string;
        addButton?: ReactNode;
    }) => {
        const isExpanded = expandedSection === section && count > 0;
        const lineClass = section === 'a' ? 'border-b' : 'border-y';

        return (
            <div className={clsx('px-0', lineClass, 'border-slate-200/90 bg-slate-100/70')}>
                <div className="grid min-w-0 grid-cols-[1.75rem_minmax(0,1fr)_1.75rem] items-center">
                    <div className="flex h-7 w-7 items-center justify-center border-r border-slate-200/70">
                        {addButton ?? <span aria-hidden="true" className="block h-7 w-7" />}
                    </div>
                    <div className="flex min-w-0 items-center gap-2 px-1.5 py-0.5">
                        <span className="truncate text-[10px] font-semibold text-slate-700">{label}</span>
                        <CountBadge count={count} testId={countTestId} />
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
        preview,
        badgeLabel,
    }: {
        section: 'a' | 'b' | 'completed';
        preview: CompletedBucketEntry | { item: TimelineBucketItem };
        badgeLabel?: string | null;
    }) => (
        <div
            id={`bucket-panel-${section}-${day.isoDate}`}
            data-testid={`bucket-preview-${section}-${day.isoDate}`}
            className="mt-2 flex-1 min-h-0 overflow-hidden p-[1px]"
        >
            <StaticBucketRow
                item={preview.item}
                badgeLabel={badgeLabel}
                openCardModal={(shortId) => openCardModal(shortId, 'bucket-list')}
                onToggleCheck={onToggleCheck}
                onCardContextMenu={onCardContextMenu}
                onCardContextMenuByKeyboard={onCardContextMenuByKeyboard}
                dataTestId={section === 'completed' ? `completed-card-${preview.item.card_id}` : undefined}
                badgeTestId={section === 'completed' ? `completed-badge-${preview.item.card_id}` : undefined}
                notePreviewLines={2}
            />
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
        bucket: CompletedBucketSource;
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
                className="inline-flex h-7 w-7 items-center justify-center border border-transparent text-slate-500 transition-colors duration-150 hover:bg-white/70 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                data-testid={`ab-add-${bucketKey}`}
            >
                <span className="text-base leading-none">＋</span>
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
                            <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border border-slate-100 bg-slate-50/70 pb-2 shadow-inner transition-[height,max-height,opacity,background-color] duration-200 ease-out">
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
                        {() => (
                            <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border border-slate-100 bg-slate-50/70 pb-2 shadow-inner transition-[height,max-height,opacity,background-color] duration-200 ease-out">
                                {renderSectionHeader({
                                    label,
                                    section,
                                    count,
                                    bodyId,
                                    countTestId: `bucket-count-${section}-${day.isoDate}`,
                                    addButton,
                                })}
                                <div id={bodyId} hidden />
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
                <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border border-slate-100 bg-slate-50/70 pb-2 shadow-inner transition-[height,max-height,opacity,background-color] duration-200 ease-out">
                    {renderSectionHeader({
                        label,
                        section,
                        count,
                        bodyId,
                        countTestId: `bucket-count-${section}-${day.isoDate}`,
                        addButton,
                    })}
                    {renderCompactPreview({
                        section,
                        preview: { item: items[0] },
                    })}
                </div>
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
                <div className="flex h-full min-h-0 flex-col overflow-hidden border border-slate-100 bg-slate-50/70 pb-2 shadow-inner transition-[height,max-height,opacity,background-color] duration-200 ease-out">
                    {renderSectionHeader({
                        label: 'Completed',
                        section,
                        count,
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
                    ) : count > 0 ? (
                        renderCompactPreview({
                            section: 'completed',
                            preview: completedItems[0],
                            badgeLabel: resolveCompletedBadgeLabel(completedItems[0].item, completedItems[0].sourceBucket),
                        })
                    ) : (
                        <div id={bodyId} hidden />
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
                style={{ gridTemplateRows: rowTemplate }}
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
                {renderCompletedSection()}
            </div>
        </div>
    );
});
