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
    TimelineEvent,
    getMinutesFromTime,
} from '@/app/(board)/_utils/timeline-helpers';
import type { BucketIndicator } from '@/app/(board)/_hooks/useTimelineDragAndDrop';

type TimelineDayBucketProps = {
    day: TimelineDay;
    events: readonly TimelineEvent[];
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

type ActiveBucketSection = 'completed' | 'a' | 'b';
type PrimaryBucketSection = Exclude<ActiveBucketSection, 'completed'>;
type CompletedBucketSource = 'a' | 'b';
type CompletedEntry =
    | {
        source: 'event';
        item: TimelineEvent;
    }
    | {
        source: 'bucket';
        item: TimelineBucketItem;
        sourceBucket: CompletedBucketSource;
    };

const SECTION_ORDER: readonly ActiveBucketSection[] = ['completed', 'a', 'b'];
const PRIMARY_SECTION_ORDER: readonly PrimaryBucketSection[] = ['a', 'b'];
const HEADER_HEIGHT_PX = 32;
const PREVIEW_CARD_HEIGHT_PX = 78;
const COMPACT_BUCKET_SECTION_PADDING_PX = 8;
const EMPTY_SECTION_BODY_HEIGHT_PX = 18;
const COMPACT_EMPTY_HEIGHT_PX = HEADER_HEIGHT_PX + EMPTY_SECTION_BODY_HEIGHT_PX;
const COMPLETED_SUMMARY_ROW_HEIGHT_PX = HEADER_HEIGHT_PX;
const EXPANDED_CARD_HEIGHT_PX = 78;
const EXPANDED_SECTION_PADDING_PX = 8;
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

function resolveCompletedBucketBadgeLabel(item: TimelineBucketItem, fallbackBucket: CompletedBucketSource) {
    if (item.due_bucket === 'a' || item.due_bucket === 'b') {
        return item.due_bucket.toUpperCase();
    }
    return fallbackBucket.toUpperCase();
}

function resolveCompletedEventBadgeLabel(item: TimelineEvent) {
    return item.due_bucket?.toUpperCase() ?? 'A';
}

function pickFirstNonEmptyPrimarySection(counts: Record<ActiveBucketSection, number>): PrimaryBucketSection | null {
    for (const section of PRIMARY_SECTION_ORDER) {
        if (counts[section] > 0) return section;
    }
    return null;
}

function findNextNonEmptyPrimarySection(
    current: PrimaryBucketSection,
    counts: Record<ActiveBucketSection, number>
): PrimaryBucketSection {
    const currentIndex = PRIMARY_SECTION_ORDER.indexOf(current);
    for (let step = 1; step <= PRIMARY_SECTION_ORDER.length; step += 1) {
        const nextSection = PRIMARY_SECTION_ORDER[(currentIndex + step) % PRIMARY_SECTION_ORDER.length];
        if (counts[nextSection] > 0) return nextSection;
    }
    return current;
}

function resolveCompactSectionRowHeight(section: ActiveBucketSection, itemCount: number, previewCount: number) {
    if (section === 'completed') return COMPLETED_SUMMARY_ROW_HEIGHT_PX;
    if (itemCount === 0) return COMPACT_EMPTY_HEIGHT_PX;
    return HEADER_HEIGHT_PX + (previewCount * PREVIEW_CARD_HEIGHT_PX) + COMPACT_BUCKET_SECTION_PADDING_PX;
}

function compareNullableNumber(a: number | null | undefined, b: number | null | undefined) {
    const left = a ?? Number.MAX_SAFE_INTEGER;
    const right = b ?? Number.MAX_SAFE_INTEGER;
    return left - right;
}

function compareString(a: string | null | undefined, b: string | null | undefined) {
    return (a ?? '').localeCompare(b ?? '', 'en', { sensitivity: 'base' });
}

function sortCompletedEvents(items: readonly TimelineEvent[]) {
    return [...items].sort((left, right) => (
        compareNullableNumber(getMinutesFromTime(left.due_start ?? null), getMinutesFromTime(right.due_start ?? null)) ||
        compareNullableNumber(getMinutesFromTime(left.due_end ?? null), getMinutesFromTime(right.due_end ?? null)) ||
        compareString(left.title, right.title) ||
        compareString(left.card_id, right.card_id)
    ));
}

function sortCompletedBuckets(items: readonly TimelineBucketItem[]) {
    return [...items].sort((left, right) => (
        compareNullableNumber(left.bucketPosition, right.bucketPosition) ||
        compareString(left.title, right.title) ||
        compareString(left.card_id, right.card_id)
    ));
}

function StaticTimelineRow({
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
    timeText,
    openSource = 'bucket-list',
    checkedVisualTone = 'default',
}: {
    item: TimelineBucketItem | TimelineEvent;
    badgeLabel?: string | null;
    openCardModal: (shortId: string | null, source: string) => void;
    onToggleCheck: (cardId: string, checked: boolean) => void;
    onCardContextMenu: (e: React.MouseEvent, cardId: string) => void;
    onCardContextMenuByKeyboard: (cardId: string, rect: DOMRect) => void;
    dataTestId?: string;
    badgeTestId?: string;
    notePreviewLines?: number;
    cardClassName?: string;
    timeText?: ReactNode;
    openSource?: string;
    checkedVisualTone?: 'default' | 'timeline-dim';
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
                timeText={timeText}
                timePlacement="out-top"
                note={item.excerpt ?? undefined}
                noteClampClass={TIMELINE_LIST_CARD_NOTE_CLAMP_CLASS}
                notePreviewLines={notePreviewLines}
                rightMeta={null}
                onOpen={() => openCardModal(item.short_id, openSource)}
                paddingClass="py-1"
                className={clsx('min-h-0', cardClassName)}
                checkedVisualTone={checkedVisualTone}
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
    events,
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
    const completedA = useMemo(() => sortCompletedBuckets(bucketsA.filter((item) => item.checked)), [bucketsA]);
    const completedB = useMemo(() => sortCompletedBuckets(bucketsB.filter((item) => item.checked)), [bucketsB]);
    const completedEvents = useMemo(() => sortCompletedEvents(events.filter((item) => item.checked)), [events]);
    const completedEntries = useMemo<CompletedEntry[]>(
        () => [
            ...completedEvents.map((item) => ({ source: 'event' as const, item })),
            ...completedA.map((item) => ({ source: 'bucket' as const, item, sourceBucket: 'a' as const })),
            ...completedB.map((item) => ({ source: 'bucket' as const, item, sourceBucket: 'b' as const })),
        ],
        [completedA, completedB, completedEvents]
    );
    const completedCount = completedEntries.length;
    const totalCount = events.length + bucketsA.length + bucketsB.length;
    const sectionCounts = useMemo<Record<ActiveBucketSection, number>>(
        () => ({
            completed: completedEntries.length,
            a: activeA.length,
            b: activeB.length,
        }),
        [activeA.length, activeB.length, completedEntries.length]
    );
    const resolvePrimaryFallbackSection = useCallback(
        (preferred: PrimaryBucketSection) => {
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

    const layout = useMemo(() => {
        const previewCounts: Record<ActiveBucketSection, number> = {
            completed: 0,
            a: 0,
            b: 0,
        };
        const completedCompactHeight = resolveCompactSectionRowHeight('completed', sectionCounts.completed, 0);
        const compactAHeight = resolveCompactSectionRowHeight('a', sectionCounts.a, 0);
        const compactBHeight = resolveCompactSectionRowHeight('b', sectionCounts.b, 0);

        if (!expandedSection || sectionCounts[expandedSection] === 0) {
            return {
                previewCounts,
                rowTemplate: [
                    `${completedCompactHeight}px`,
                    `${compactAHeight}px`,
                    `${compactBHeight}px`,
                    'minmax(0,1fr)',
                ].join(' '),
            };
        }

        for (const section of PRIMARY_SECTION_ORDER) {
            if (section !== expandedSection && sectionCounts[section] > 0) {
                previewCounts[section] = 1;
            }
        }

        const containerHeight = viewportHeight ?? FALLBACK_BUCKET_VIEWPORT_HEIGHT_PX;
        const compactHeights = SECTION_ORDER
            .filter((section) => section !== expandedSection)
            .reduce((sum, section) => sum + resolveCompactSectionRowHeight(section, sectionCounts[section], previewCounts[section]), 0);
        const minimumExpandedHeight = HEADER_HEIGHT_PX;
        const maxExpandedHeight = Math.max(minimumExpandedHeight, containerHeight - compactHeights);
        const ratioCappedHeight = Math.max(
            minimumExpandedHeight,
            Math.min(MAX_EXPANDED_SECTION_HEIGHT_PX, Math.floor(containerHeight * MAX_EXPANDED_SECTION_RATIO))
        );
        const desiredExpandedHeight =
            HEADER_HEIGHT_PX +
            (sectionCounts[expandedSection] * EXPANDED_CARD_HEIGHT_PX) +
            EXPANDED_SECTION_PADDING_PX;
        const expandedHeight = Math.min(maxExpandedHeight, ratioCappedHeight, desiredExpandedHeight);

        let remainingHeight = containerHeight - compactHeights - expandedHeight;
        for (const section of PRIMARY_SECTION_ORDER) {
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

        if (expandedSection === 'completed') {
            return {
                previewCounts,
                rowTemplate: [
                    `${expandedHeight}px`,
                    `${resolveCompactSectionRowHeight('a', sectionCounts.a, previewCounts.a)}px`,
                    `${resolveCompactSectionRowHeight('b', sectionCounts.b, previewCounts.b)}px`,
                    '0px',
                ].join(' '),
            };
        }

        return {
            previewCounts,
            rowTemplate: [
                `${completedCompactHeight}px`,
                `${expandedSection === 'a' ? expandedHeight : resolveCompactSectionRowHeight('a', sectionCounts.a, previewCounts.a)}px`,
                `${expandedSection === 'b' ? expandedHeight : resolveCompactSectionRowHeight('b', sectionCounts.b, previewCounts.b)}px`,
                'minmax(0,1fr)',
            ].join(' '),
        };
    }, [expandedSection, sectionCounts, viewportHeight]);

    const renderSectionHeader = ({
        label,
        section,
        count,
        countValue,
        bodyId,
        countTestId,
    }: {
        label: string;
        section: ActiveBucketSection;
        count: number;
        countValue?: ReactNode;
        bodyId: string;
        countTestId: string;
    }) => {
        const isExpanded = expandedSection === section && count > 0;
        const lineClass = section === 'b' ? 'border-y' : 'border-b';
        const isToggleable = count > 0;
        const toggleLabel = !isToggleable ? 'Empty' : isExpanded ? 'Close' : 'Open';

        return (
            <button
                type="button"
                aria-expanded={isExpanded}
                aria-controls={bodyId}
                aria-label={isToggleable ? `${label} ${toggleLabel}` : `${label} Empty`}
                disabled={!isToggleable}
                onClick={() => handleSectionToggle(section)}
                className={clsx(
                    'flex min-h-8 w-full min-w-0 items-center justify-between gap-3 px-2 py-1 text-left transition-colors duration-150',
                    lineClass,
                    'border-slate-200/90 bg-slate-100/70',
                    isToggleable
                        ? 'cursor-pointer hover:bg-white/80 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-inset'
                        : 'cursor-default'
                )}
                data-testid={`bucket-toggle-${section}-${day.isoDate}`}
            >
                <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[10px] font-semibold text-slate-700">{label}</span>
                    <CountBadge value={countValue ?? count} testId={countTestId} />
                </span>
                <span
                    className={clsx(
                        'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-none transition-colors duration-150',
                        !isToggleable
                            ? 'border-slate-200 bg-slate-100 text-slate-400'
                            : isExpanded
                                ? 'border-sky-200 bg-sky-50 text-sky-700'
                                : 'border-slate-200 bg-white text-slate-500'
                    )}
                >
                    <span>{toggleLabel}</span>
                    {isToggleable ? (
                        <span
                            aria-hidden="true"
                            className={clsx('text-[11px] transition-transform duration-200', isExpanded ? 'rotate-180' : '')}
                        >
                            ▾
                        </span>
                    ) : null}
                </span>
            </button>
        );
    };

    const renderBucketAddSlot = ({
        isOver,
        onClick,
        testId,
        sticky = false,
        revealClassName,
        showDropLine = false,
    }: {
        isOver: boolean;
        onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
        testId: string;
        sticky?: boolean;
        revealClassName?: string;
        showDropLine?: boolean;
    }) => (
        <div
            className={clsx(
                'pointer-events-none relative mx-[1px] h-0 shrink-0',
                sticky ? 'sticky top-0 z-10' : 'z-10'
            )}
        >
            {showDropLine && isOver ? (
                <span
                    aria-hidden="true"
                    className="absolute inset-x-0 top-0 h-0.5 -translate-y-1/2 bg-sky-400"
                />
            ) : null}
            <button
                type="button"
                disabled={status === 'loading' || !onCreateBucketCard}
                onClick={onClick}
                className={clsx(
                    'pointer-events-auto absolute left-1/2 top-0 flex h-4 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border text-[9px] leading-none shadow-[0_1px_2px_rgba(15,23,42,0.08)] transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50',
                    'scale-90 opacity-75 hover:scale-100 hover:opacity-100 focus-visible:scale-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300',
                    !isOver && revealClassName,
                    isOver
                        ? 'border-sky-400 bg-sky-50 text-sky-700'
                        : 'border-slate-300/90 bg-white text-slate-400 hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700'
                )}
                aria-label="Add card"
                data-testid={testId}
            >
                <span aria-hidden="true">＋</span>
            </button>
        </div>
    );

    const renderCompactPreview = ({
        section,
        previews,
        bucketKey,
        isOver = false,
    }: {
        section: PrimaryBucketSection;
        previews: Array<{ item: TimelineBucketItem }>;
        bucketKey?: string;
        isOver?: boolean;
    }) => (
        <div
            id={`bucket-panel-${section}-${day.isoDate}`}
            data-testid={`bucket-preview-${section}-${day.isoDate}`}
            className={clsx(
                'mt-1 flex-1 min-h-0 space-y-1 pl-[1px] py-[1px]',
                bucketKey ? 'overflow-y-auto overflow-x-hidden scrollbar-ab-thin [scrollbar-gutter:stable]' : 'overflow-hidden'
            )}
        >
            {bucketKey
                ? renderBucketAddSlot({
                    isOver,
                    sticky: false,
                    testId: `ab-add-top-${bucketKey}`,
                    revealClassName:
                        'md:pointer-events-none md:opacity-0 md:group-hover/section:pointer-events-auto md:group-hover/section:opacity-100 md:group-focus-within/section:pointer-events-auto md:group-focus-within/section:opacity-100',
                    onClick: (e) => {
                        e.stopPropagation();
                        onCreateBucketCard?.(bucketKey);
                    },
                })
                : null}
            {previews.map((preview, index) => {
                const row = (
                    <StaticTimelineRow
                        item={preview.item}
                        openCardModal={openCardModal}
                        onToggleCheck={onToggleCheck}
                        onCardContextMenu={onCardContextMenu}
                        onCardContextMenuByKeyboard={onCardContextMenuByKeyboard}
                        notePreviewLines={2}
                        cardClassName={bucketKey ? 'cursor-grab active:cursor-grabbing select-none' : undefined}
                        timeText={buildTimelineCardTimeText(preview.item, {
                            includeDate: true,
                            includeTime: false,
                            includeDuration: true,
                        })}
                    />
                );

                if (!bucketKey) {
                    return <div key={preview.item.card_id ?? index}>{row}</div>;
                }

                return (
                    <div key={preview.item.card_id} className="group/item relative">
                        <DraggableCard
                            id={`bucket-preview:${preview.item.card_id}`}
                            data={{ kind: 'bucket', cardId: preview.item.card_id, bucketKey, item: preview.item }}
                        >
                            {row}
                        </DraggableCard>
                        {renderBucketAddSlot({
                            isOver,
                            sticky: false,
                            testId: `ab-add-after-${preview.item.card_id}`,
                            revealClassName:
                                'md:pointer-events-none md:opacity-0 md:group-hover/item:pointer-events-auto md:group-hover/item:opacity-100 md:group-focus-within/item:pointer-events-auto md:group-focus-within/item:opacity-100',
                            onClick: (e) => {
                                e.stopPropagation();
                                onCreateBucketCard?.(bucketKey, preview.item.card_id);
                            },
                        })}
                    </div>
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
        section: PrimaryBucketSection;
        label: string;
        items: readonly TimelineBucketItem[];
        bucket: PrimaryBucketSection;
    }) => {
        const bucketKey = `${day.key}_${bucket}`;
        const isExpanded = expandedSection === section && items.length > 0;
        const bodyId = `bucket-panel-${section}-${day.isoDate}`;
        const count = items.length;

        if (isExpanded) {
            return (
                <section
                    data-testid={`bucket-section-${section}-${day.isoDate}`}
                    className="min-h-0 overflow-hidden"
                >
                    <DroppableBucket bucketKey={bucketKey} disabled={status === 'loading'}>
                        {(isOver) => (
                            <div className="group/section flex h-full min-h-0 min-w-0 flex-col overflow-hidden border border-slate-100 bg-slate-50/70 shadow-inner transition-[height,max-height,opacity,background-color] duration-200 ease-out">
                                {renderSectionHeader({
                                    label,
                                    section,
                                    count,
                                    bodyId,
                                    countTestId: `bucket-count-${section}-${day.isoDate}`,
                                })}
                                <div
                                    id={bodyId}
                                    ref={(el) => registerScrollContainer?.(day.isoDate, el, bucket)}
                                    data-ab-scroll-container="true"
                                    className="mt-1 flex-1 min-h-0 min-w-0 space-y-1 overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-ab-thin [scrollbar-gutter:stable] pl-[1px] py-[1px]"
                                >
                                    {renderBucketAddSlot({
                                        isOver,
                                        sticky: true,
                                        testId: `ab-add-top-${bucketKey}`,
                                        revealClassName:
                                            'md:pointer-events-none md:opacity-0 md:group-hover/section:pointer-events-auto md:group-hover/section:opacity-100 md:group-focus-within/section:pointer-events-auto md:group-focus-within/section:opacity-100',
                                        onClick: (e) => {
                                            e.stopPropagation();
                                            onCreateBucketCard?.(bucketKey);
                                        },
                                    })}
                                    {items.map((item) => (
                                        <div key={item.card_id} className="group/item relative">
                                            <TimelineBucketCard
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
                                            {renderBucketAddSlot({
                                                isOver,
                                                testId: `ab-add-after-${item.card_id}`,
                                                revealClassName:
                                                    'md:pointer-events-none md:opacity-0 md:group-hover/item:pointer-events-auto md:group-hover/item:opacity-100 md:group-focus-within/item:pointer-events-auto md:group-focus-within/item:opacity-100',
                                                onClick: (e) => {
                                                    e.stopPropagation();
                                                    onCreateBucketCard?.(bucketKey, item.card_id);
                                                },
                                            })}
                                        </div>
                                    ))}
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
                            <div className="group/section flex h-full min-h-0 min-w-0 flex-col overflow-hidden border border-slate-100 bg-slate-50/70 shadow-inner transition-[height,max-height,opacity,background-color] duration-200 ease-out">
                                {renderSectionHeader({
                                    label,
                                    section,
                                    count,
                                    bodyId,
                                    countTestId: `bucket-count-${section}-${day.isoDate}`,
                                })}
                                <div
                                    id={bodyId}
                                    className="flex min-h-0 flex-1 flex-col pl-[1px] py-0.5"
                                >
                                    {renderBucketAddSlot({
                                        isOver,
                                        testId: `ab-add-top-${bucketKey}`,
                                        showDropLine: true,
                                        revealClassName:
                                            'md:pointer-events-none md:opacity-0 md:group-hover/section:pointer-events-auto md:group-hover/section:opacity-100 md:group-focus-within/section:pointer-events-auto md:group-focus-within/section:opacity-100',
                                        onClick: (e) => {
                                            e.stopPropagation();
                                            onCreateBucketCard?.(bucketKey);
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
                                'group/section flex h-full min-h-0 min-w-0 flex-col overflow-hidden border border-slate-100 bg-slate-50/70 shadow-inner transition-[height,max-height,opacity,background-color] duration-200 ease-out',
                                isOver ? 'bg-sky-50/60' : ''
                            )}
                        >
                            {renderSectionHeader({
                                label,
                                section,
                                count,
                                bodyId,
                                countTestId: `bucket-count-${section}-${day.isoDate}`,
                            })}
                            <div className="flex min-h-0 flex-1 flex-col">
                                {renderCompactPreview({
                                    section,
                                    previews: items.slice(0, layout.previewCounts[section]).map((item) => ({ item })),
                                    bucketKey,
                                    isOver,
                                })}
                            </div>
                        </div>
                    )}
                </DroppableBucket>
            </section>
        );
    };

    const renderCompletedEntryRow = (entry: CompletedEntry) => {
        if (entry.source === 'event') {
            return (
                <StaticTimelineRow
                    key={entry.item.card_id}
                    item={entry.item}
                    badgeLabel={resolveCompletedEventBadgeLabel(entry.item)}
                    openCardModal={openCardModal}
                    onToggleCheck={onToggleCheck}
                    onCardContextMenu={onCardContextMenu}
                    onCardContextMenuByKeyboard={onCardContextMenuByKeyboard}
                    dataTestId={`completed-card-${entry.item.card_id}`}
                    badgeTestId={`completed-badge-${entry.item.card_id}`}
                    timeText={buildTimelineCardTimeText(entry.item, { includeDuration: true })}
                    openSource="timeline"
                    checkedVisualTone="timeline-dim"
                />
            );
        }

        return (
            <StaticTimelineRow
                key={entry.item.card_id}
                item={entry.item}
                badgeLabel={resolveCompletedBucketBadgeLabel(entry.item, entry.sourceBucket)}
                openCardModal={openCardModal}
                onToggleCheck={onToggleCheck}
                onCardContextMenu={onCardContextMenu}
                onCardContextMenuByKeyboard={onCardContextMenuByKeyboard}
                dataTestId={`completed-card-${entry.item.card_id}`}
                badgeTestId={`completed-badge-${entry.item.card_id}`}
                timeText={buildTimelineCardTimeText(entry.item, {
                    includeDate: true,
                    includeTime: false,
                    includeDuration: true,
                })}
                openSource="bucket-list"
                checkedVisualTone="timeline-dim"
            />
        );
    };

    const renderCompletedSection = () => {
        const section: ActiveBucketSection = 'completed';
        const count = completedEntries.length;
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
                            className="mt-1 flex-1 min-h-0 space-y-1 overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-ab-thin [scrollbar-gutter:stable] pl-[1px] py-[1px]"
                        >
                            {completedEntries.map((entry) => renderCompletedEntryRow(entry))}
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
                {renderCompletedSection()}
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
            </div>
        </div>
    );
});
