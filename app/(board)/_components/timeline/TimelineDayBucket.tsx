import clsx from 'clsx';
import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import type { BucketCreateRequest } from './bucket-create-request';
import { TimelineBucketCard } from './TimelineBucketCard';
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
    onRenameCardTitle?: (cardId: string, nextTitle: string) => Promise<boolean>;
    bucketIndicator: BucketIndicator | null;
    onCreateBucketCard?: (bucketKey: string, afterCardId?: string) => void;
    onRequestCreateBucketCard?: (request: BucketCreateRequest) => void;
    onCardContextMenu: (e: React.MouseEvent, cardId: string) => void;
    onCardContextMenuByKeyboard: (cardId: string, rect: DOMRect) => void;
    contextMenuCardId: string | null;
    selectedCardIds: ReadonlySet<string>;
    selectionLeadCardId: string | null;
    onShiftSelect: (args: {
        cardId: string;
        laneId: string;
        activeCardId: string | null;
        activeLaneId: string | null;
    }) => void;
    onClearSelection: () => void;
    onActivateCard: (cardId: string, laneId: string) => void;
    activeCardId: string | null;
    activeLaneId: string | null;
    pendingTitleEditCardId: string | null;
    onPendingTitleEditConsumed: () => void;
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

type SectionMeasurements = {
    headerHeight: number;
    bodyNaturalHeight: number;
    peekMinBodyHeight: number;
    emptyBodyMinHeight: number;
    compactEmptyBodyMinHeight: number;
};

type BucketEmptyStateVariant = 'compact' | 'hidden';

type SectionLayout = {
    bodyHeight: number;
    totalHeight: number;
    emptyStateVariant?: BucketEmptyStateVariant;
};

const SECTION_ORDER: readonly ActiveBucketSection[] = ['completed', 'a', 'b'];
const FALLBACK_HEADER_HEIGHT_PX = 32;
const FALLBACK_PEEK_BODY_HEIGHT_PX = 96;
const MIN_PEEK_BODY_HEIGHT_PX = 64;
const FALLBACK_COMPLETED_BODY_HEIGHT_PX = 96;
const FALLBACK_EMPTY_BODY_HEIGHT_PX = 40;
const COMPACT_EMPTY_BODY_HEIGHT_PX = 40;
const FALLBACK_BUCKET_VIEWPORT_HEIGHT_PX = 480;
const CONTENT_CHROME_ALLOWANCE_PX = 8;
const BUCKET_CARD_STACK_CHROME_ALLOWANCE_PX = 16;
const PRIORITY_FIT_TOLERANCE_PX = 2;

const DEFAULT_MEASUREMENTS: Record<ActiveBucketSection, SectionMeasurements> = {
    completed: {
        headerHeight: FALLBACK_HEADER_HEIGHT_PX,
        bodyNaturalHeight: 0,
        peekMinBodyHeight: FALLBACK_COMPLETED_BODY_HEIGHT_PX,
        emptyBodyMinHeight: 0,
        compactEmptyBodyMinHeight: 0,
    },
    a: {
        headerHeight: FALLBACK_HEADER_HEIGHT_PX,
        bodyNaturalHeight: FALLBACK_EMPTY_BODY_HEIGHT_PX,
        peekMinBodyHeight: FALLBACK_PEEK_BODY_HEIGHT_PX,
        emptyBodyMinHeight: FALLBACK_EMPTY_BODY_HEIGHT_PX,
        compactEmptyBodyMinHeight: COMPACT_EMPTY_BODY_HEIGHT_PX,
    },
    b: {
        headerHeight: FALLBACK_HEADER_HEIGHT_PX,
        bodyNaturalHeight: FALLBACK_EMPTY_BODY_HEIGHT_PX,
        peekMinBodyHeight: FALLBACK_PEEK_BODY_HEIGHT_PX,
        emptyBodyMinHeight: FALLBACK_EMPTY_BODY_HEIGHT_PX,
        compactEmptyBodyMinHeight: COMPACT_EMPTY_BODY_HEIGHT_PX,
    },
};

function bucketSectionFrameClass(section: ActiveBucketSection, isOver = false) {
    return clsx(
        'group/section flex h-full min-h-0 min-w-0 flex-col overflow-hidden transition-[background-color,border-color] duration-200 ease-out',
        section === 'completed' ? 'border border-slate-200 bg-white shadow-inner' : 'border border-slate-100 bg-slate-50/70 shadow-inner',
        isOver ? 'border-sky-200 bg-sky-50/60' : ''
    );
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

function resolveCompletedBucketBadgeLabel(item: TimelineBucketItem, fallbackBucket: CompletedBucketSource) {
    if (item.due_bucket === 'a' || item.due_bucket === 'b') {
        return item.due_bucket.toUpperCase();
    }
    return fallbackBucket.toUpperCase();
}

function resolveCompletedEventBadgeLabel(item: TimelineEvent) {
    return item.due_bucket?.toUpperCase() ?? 'A';
}

function resolveCompletedCountBadgeTone(done: number, total: number): 'neutral' | 'danger' | 'warning' | 'success' {
    if (total === 0) {
        return 'neutral';
    }
    if (done === 0) {
        return 'danger';
    }
    if (done === total) {
        return 'success';
    }
    return 'warning';
}

function resolveMeasuredPeekHeight(contentNode: HTMLDivElement | null, section: ActiveBucketSection) {
    if (!contentNode) {
        return section === 'completed' ? FALLBACK_COMPLETED_BODY_HEIGHT_PX : FALLBACK_PEEK_BODY_HEIGHT_PX;
    }

    const selector = section === 'completed' ? '[data-testid^="completed-card-"]' : '[data-testid^="ab-card-"]';
    const firstCardNode = contentNode.querySelector<HTMLElement>(selector);
    if (!firstCardNode) {
        return section === 'completed' ? FALLBACK_COMPLETED_BODY_HEIGHT_PX : FALLBACK_PEEK_BODY_HEIGHT_PX;
    }

    const firstCardHeight = Math.ceil(firstCardNode.getBoundingClientRect().height);
    if (firstCardHeight <= 0) {
        return section === 'completed' ? FALLBACK_COMPLETED_BODY_HEIGHT_PX : FALLBACK_PEEK_BODY_HEIGHT_PX;
    }

    return Math.max(MIN_PEEK_BODY_HEIGHT_PX, firstCardHeight + CONTENT_CHROME_ALLOWANCE_PX);
}

function resolveRenderedBodyHeight(
    contentNode: HTMLDivElement | null,
    scrollContainerNode: HTMLDivElement | null,
    section: ActiveBucketSection,
    count: number
) {
    if (!contentNode) {
        return DEFAULT_MEASUREMENTS[section].bodyNaturalHeight;
    }

    if (count === 0) {
        return Math.ceil(contentNode.getBoundingClientRect().height) + (section === 'completed' ? 0 : CONTENT_CHROME_ALLOWANCE_PX);
    }

    const selector = section === 'completed' ? '[data-testid^="completed-card-"]' : '[data-testid^="ab-card-"]';
    const cardNodes = contentNode.querySelectorAll<HTMLElement>(selector);
    const lastCardNode = cardNodes.item(cardNodes.length - 1);
    if (!lastCardNode) {
        return scrollContainerNode
            ? Math.ceil(scrollContainerNode.scrollHeight)
            : DEFAULT_MEASUREMENTS[section].bodyNaturalHeight;
    }

    const contentRect = contentNode.getBoundingClientRect();
    const lastCardRect = lastCardNode.getBoundingClientRect();
    const renderedHeight = Math.ceil(lastCardRect.bottom - contentRect.top);
    return Math.max(
        0,
        renderedHeight + (section === 'completed' ? 0 : BUCKET_CARD_STACK_CHROME_ALLOWANCE_PX)
    );
}

function pickFallbackAbPriority(counts: Record<ActiveBucketSection, number>): PrimaryBucketSection {
    if (counts.a > 0) return 'a';
    if (counts.b > 0) return 'b';
    return 'a';
}

function resolveBucketBodyLayout({
    count,
    naturalBodyHeight,
    peekMinBodyHeight,
    emptyBodyMinHeight,
    compactEmptyBodyMinHeight,
    availableBodyHeight,
    isPriority,
    allowCompactEmpty = true,
}: {
    count: number;
    naturalBodyHeight: number;
    peekMinBodyHeight: number;
    emptyBodyMinHeight: number;
    compactEmptyBodyMinHeight: number;
    availableBodyHeight: number;
    isPriority: boolean;
    allowCompactEmpty?: boolean;
}): Pick<SectionLayout, 'bodyHeight' | 'emptyStateVariant'> {
    if (availableBodyHeight <= 0) {
        return { bodyHeight: 0, emptyStateVariant: 'hidden' };
    }

    if (count === 0) {
        if (isPriority) {
            return {
                bodyHeight: Math.min(compactEmptyBodyMinHeight, availableBodyHeight),
                emptyStateVariant: 'compact',
            };
        }

        if (!allowCompactEmpty) {
            return { bodyHeight: 0, emptyStateVariant: 'hidden' };
        }

        if (availableBodyHeight < compactEmptyBodyMinHeight) {
            return { bodyHeight: 0, emptyStateVariant: 'hidden' };
        }

        return {
            bodyHeight: Math.min(compactEmptyBodyMinHeight, availableBodyHeight),
            emptyStateVariant: 'compact',
        };
    }

    if (!isPriority && availableBodyHeight <= peekMinBodyHeight) {
        if (availableBodyHeight >= compactEmptyBodyMinHeight) {
            return {
                bodyHeight: compactEmptyBodyMinHeight,
                emptyStateVariant: 'compact',
            };
        }

        return {
            bodyHeight: 0,
            emptyStateVariant: 'hidden',
        };
    }

    const minimumVisibleHeight = isPriority
        ? Math.min(peekMinBodyHeight, availableBodyHeight)
        : peekMinBodyHeight;

    return {
        bodyHeight: Math.min(Math.max(naturalBodyHeight, minimumVisibleHeight), availableBodyHeight),
        emptyStateVariant: 'hidden',
    };
}

const DroppableBucket = ({
    children,
    bucketKey,
    disabled,
}: {
    children: (isOver: boolean) => ReactNode;
    bucketKey: string;
    disabled?: boolean;
}) => {
    const { setNodeRef, isOver } = useDroppable({ id: `bucket-drop:${bucketKey}`, data: { type: 'ab-bucket', bucketKey } });
    const highlight = !disabled && isOver ? 'bg-slate-100/50' : '';
    return (
        <div
            ref={setNodeRef}
            className={`flex h-full min-h-0 w-full flex-col ${highlight}`}
            data-dnd="ab-bucket"
            data-bucket-key={bucketKey}
        >
            {children(isOver)}
        </div>
    );
};

function CountBadge({
    value,
    testId,
    tone = 'neutral',
}: {
    value: ReactNode;
    testId?: string;
    tone?: 'neutral' | 'danger' | 'warning' | 'success';
}) {
    return (
        <span
            className={clsx(
                'rounded-full px-2 py-0.5 text-[10px] font-semibold leading-tight',
                tone === 'neutral' && 'bg-slate-200 text-slate-700',
                tone === 'danger' && 'bg-rose-100 text-rose-700',
                tone === 'warning' && 'bg-amber-100 text-amber-700',
                tone === 'success' && 'bg-emerald-100 text-emerald-700'
            )}
            data-testid={testId}
        >
            {value}
        </span>
    );
}

function StaticTimelineRow({
    item,
    badgeLabel,
    openCardModal,
    onToggleCheck,
    onRenameCardTitle,
    onCardContextMenu,
    onCardContextMenuByKeyboard,
    dataTestId,
    badgeTestId,
    openButtonTestId,
    notePreviewLines = 3,
    cardClassName,
    timeText,
    openSource = 'bucket-list',
    checkedVisualTone = 'default',
    isSelected = false,
    selectionLane,
    onShiftSelect,
    onClearSelection,
    onActivateCard,
    activeCardId,
    activeLaneId,
    autoStartTitleEdit = false,
    onAutoStartTitleEditConsumed,
}: {
    item: TimelineBucketItem | TimelineEvent;
    badgeLabel?: string | null;
    openCardModal: (shortId: string | null, source: string) => void;
    onToggleCheck: (cardId: string, checked: boolean) => void;
    onRenameCardTitle?: (cardId: string, nextTitle: string) => Promise<boolean>;
    onCardContextMenu: (e: React.MouseEvent, cardId: string) => void;
    onCardContextMenuByKeyboard: (cardId: string, rect: DOMRect) => void;
    dataTestId?: string;
    badgeTestId?: string;
    openButtonTestId?: string;
    notePreviewLines?: number;
    cardClassName?: string;
    timeText?: ReactNode;
    openSource?: string;
    checkedVisualTone?: 'default' | 'timeline-dim';
    isSelected?: boolean;
    selectionLane?: string | null;
    onShiftSelect?: (args: {
        cardId: string;
        laneId: string;
        activeCardId: string | null;
        activeLaneId: string | null;
    }) => void;
    onClearSelection?: () => void;
    onActivateCard?: (cardId: string, laneId: string) => void;
    activeCardId?: string | null;
    activeLaneId?: string | null;
    autoStartTitleEdit?: boolean;
    onAutoStartTitleEditConsumed?: () => void;
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
                openButtonTestId={openButtonTestId}
                showOpenButton
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
                isSelected={isSelected}
                selectionLane={selectionLane}
                onShiftSelect={onShiftSelect}
                onClearSelection={onClearSelection}
                onActivateCard={onActivateCard}
                activeCardId={activeCardId}
                activeLaneId={activeLaneId}
                autoStartTitleEdit={autoStartTitleEdit}
                onAutoStartTitleEditConsumed={onAutoStartTitleEditConsumed}
                inlineTitleEdit
                onRenameTitle={onRenameCardTitle ? (nextTitle) => onRenameCardTitle(item.card_id, nextTitle).then(() => undefined) : undefined}
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
    onRenameCardTitle,
    bucketIndicator,
    onCreateBucketCard,
    onRequestCreateBucketCard,
    onCardContextMenu,
    onCardContextMenuByKeyboard,
    contextMenuCardId,
    selectedCardIds,
    selectionLeadCardId,
    onShiftSelect,
    onClearSelection,
    onActivateCard,
    activeCardId,
    activeLaneId,
    pendingTitleEditCardId,
    onPendingTitleEditConsumed,
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
            completed: completedCount,
            a: activeA.length,
            b: activeB.length,
        }),
        [activeA.length, activeB.length, completedCount]
    );

    const [abPrioritySection, setAbPrioritySection] = useState<PrimaryBucketSection>(() => pickFallbackAbPriority(sectionCounts));
    const [completedPriority, setCompletedPriority] = useState(() => completedCount > 0 && activeA.length === 0 && activeB.length === 0);
    const [measurements, setMeasurements] = useState<Record<ActiveBucketSection, SectionMeasurements>>(DEFAULT_MEASUREMENTS);
    const previousCountsRef = useRef(sectionCounts);

    const headerRefs = useRef<Record<ActiveBucketSection, HTMLButtonElement | null>>({
        completed: null,
        a: null,
        b: null,
    });
    const contentRefs = useRef<Record<ActiveBucketSection, HTMLDivElement | null>>({
        completed: null,
        a: null,
        b: null,
    });
    const scrollContainerRefs = useRef<Record<ActiveBucketSection, HTMLDivElement | null>>({
        completed: null,
        a: null,
        b: null,
    });

    useEffect(() => {
        const previousCounts = previousCountsRef.current;
        previousCountsRef.current = sectionCounts;

        if (sectionCounts.a > 0 || sectionCounts.b > 0) {
            setAbPrioritySection((current) => (
                sectionCounts[current] > 0 ? current : pickFallbackAbPriority(sectionCounts)
            ));
        }

        if (sectionCounts.completed === 0) {
            setCompletedPriority(false);
            return;
        }

        if (sectionCounts.a === 0 && sectionCounts.b === 0) {
            setCompletedPriority(true);
            return;
        }

        if (previousCounts.completed === 0 && sectionCounts.completed > 0 && sectionCounts.a === 0 && sectionCounts.b === 0) {
            setCompletedPriority(true);
        }
    }, [sectionCounts]);

    const recomputeMeasurements = useCallback(() => {
        setMeasurements((current) => {
            let changed = false;
            const next = { ...current };

            for (const section of SECTION_ORDER) {
                const headerNode = headerRefs.current[section];
                const contentNode = contentRefs.current[section];
                const scrollContainerNode = scrollContainerRefs.current[section];
                const count = sectionCounts[section];
                const measuredHeader = headerNode ? Math.ceil(headerNode.getBoundingClientRect().height) : DEFAULT_MEASUREMENTS[section].headerHeight;
                const measuredContent = resolveRenderedBodyHeight(contentNode, scrollContainerNode, section, count);

                const peekMinBodyHeight = resolveMeasuredPeekHeight(contentNode, section);
                const emptyBodyMinHeight = section === 'completed'
                    ? 0
                    : Math.max(FALLBACK_EMPTY_BODY_HEIGHT_PX, count === 0 ? measuredContent : FALLBACK_EMPTY_BODY_HEIGHT_PX);
                const bodyNaturalHeight = count > 0
                    ? measuredContent
                    : 0;
                const compactEmptyBodyMinHeight = section === 'completed' ? 0 : COMPACT_EMPTY_BODY_HEIGHT_PX;

                const previous = current[section];
                const nextMeasurement: SectionMeasurements = {
                    headerHeight: measuredHeader,
                    bodyNaturalHeight,
                    peekMinBodyHeight,
                    emptyBodyMinHeight,
                    compactEmptyBodyMinHeight,
                };

                if (
                    previous.headerHeight !== nextMeasurement.headerHeight ||
                    previous.bodyNaturalHeight !== nextMeasurement.bodyNaturalHeight ||
                    previous.peekMinBodyHeight !== nextMeasurement.peekMinBodyHeight ||
                    previous.emptyBodyMinHeight !== nextMeasurement.emptyBodyMinHeight ||
                    previous.compactEmptyBodyMinHeight !== nextMeasurement.compactEmptyBodyMinHeight
                ) {
                    changed = true;
                    next[section] = nextMeasurement;
                }
            }

            return changed ? next : current;
        });
    }, [sectionCounts]);

    useEffect(() => {
        recomputeMeasurements();

        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(() => recomputeMeasurements());
        for (const section of SECTION_ORDER) {
            const headerNode = headerRefs.current[section];
            const contentNode = contentRefs.current[section];
            if (headerNode) observer.observe(headerNode);
            if (contentNode) observer.observe(contentNode);
        }
        return () => observer.disconnect();
    }, [recomputeMeasurements, abPrioritySection, completedPriority, activeA.length, activeB.length, completedEntries.length, viewportHeight]);

    const containerHeight = viewportHeight ?? FALLBACK_BUCKET_VIEWPORT_HEIGHT_PX;

    const sectionLayout = useMemo<Record<ActiveBucketSection, SectionLayout>>(() => {
        const headerTotalHeight = SECTION_ORDER.reduce((sum, section) => sum + measurements[section].headerHeight, 0);
        const availableBodyHeight = Math.max(0, containerHeight - headerTotalHeight);

        const completedBodyHeight = completedPriority && completedCount > 0
            ? Math.min(measurements.completed.bodyNaturalHeight, availableBodyHeight)
            : 0;
        const availableAbBodyHeight = Math.max(0, availableBodyHeight - completedBodyHeight);
        const secondarySection: PrimaryBucketSection = abPrioritySection === 'a' ? 'b' : 'a';
        const hasAnyAbCards = sectionCounts.a > 0 || sectionCounts.b > 0;
        const secondaryCompactReserve = availableAbBodyHeight >= measurements[secondarySection].compactEmptyBodyMinHeight
            ? measurements[secondarySection].compactEmptyBodyMinHeight
            : 0;

        const priorityLayout = resolveBucketBodyLayout({
            count: sectionCounts[abPrioritySection],
            naturalBodyHeight: measurements[abPrioritySection].bodyNaturalHeight,
            peekMinBodyHeight: measurements[abPrioritySection].peekMinBodyHeight,
            emptyBodyMinHeight: measurements[abPrioritySection].emptyBodyMinHeight,
            compactEmptyBodyMinHeight: measurements[abPrioritySection].compactEmptyBodyMinHeight,
            availableBodyHeight: Math.max(0, availableAbBodyHeight - secondaryCompactReserve),
            isPriority: true,
        });
        const secondaryLayout = resolveBucketBodyLayout({
            count: sectionCounts[secondarySection],
            naturalBodyHeight: measurements[secondarySection].bodyNaturalHeight,
            peekMinBodyHeight: measurements[secondarySection].peekMinBodyHeight,
            emptyBodyMinHeight: measurements[secondarySection].emptyBodyMinHeight,
            compactEmptyBodyMinHeight: measurements[secondarySection].compactEmptyBodyMinHeight,
            availableBodyHeight: Math.max(0, availableAbBodyHeight - priorityLayout.bodyHeight),
            isPriority: false,
            allowCompactEmpty: sectionCounts[abPrioritySection] > 0 || !hasAnyAbCards,
        });

        const bodyHeightMap: Record<ActiveBucketSection, number> = {
            completed: completedBodyHeight,
            a: 0,
            b: 0,
        };
        const emptyStateVariantMap: Record<PrimaryBucketSection, BucketEmptyStateVariant> = {
            a: 'hidden',
            b: 'hidden',
        };

        bodyHeightMap[abPrioritySection] = priorityLayout.bodyHeight;
        bodyHeightMap[secondarySection] = secondaryLayout.bodyHeight;
        emptyStateVariantMap[abPrioritySection] = priorityLayout.emptyStateVariant ?? 'hidden';
        emptyStateVariantMap[secondarySection] = secondaryLayout.emptyStateVariant ?? 'hidden';

        const unusedAbBodyHeight = Math.max(
            0,
            availableAbBodyHeight - bodyHeightMap.a - bodyHeightMap.b
        );

        if (unusedAbBodyHeight > 0) {
            bodyHeightMap[abPrioritySection] += unusedAbBodyHeight;
        }

        return {
            completed: {
                bodyHeight: bodyHeightMap.completed,
                totalHeight: measurements.completed.headerHeight + bodyHeightMap.completed,
            },
            a: {
                bodyHeight: bodyHeightMap.a,
                totalHeight: measurements.a.headerHeight + bodyHeightMap.a,
                emptyStateVariant: emptyStateVariantMap.a,
            },
            b: {
                bodyHeight: bodyHeightMap.b,
                totalHeight: measurements.b.headerHeight + bodyHeightMap.b,
                emptyStateVariant: emptyStateVariantMap.b,
            },
        };
    }, [
        completedCount,
        containerHeight,
        measurements,
        abPrioritySection,
        completedPriority,
        sectionCounts,
    ]);

    const setHeaderRef = useCallback((section: ActiveBucketSection, node: HTMLButtonElement | null) => {
        headerRefs.current[section] = node;
    }, []);

    const setContentRef = useCallback((section: ActiveBucketSection, node: HTMLDivElement | null) => {
        contentRefs.current[section] = node;
    }, []);

    const handlePriorityPress = useCallback((section: ActiveBucketSection) => {
        if (section === 'completed' && sectionCounts.completed === 0) return;
        if (section === 'completed') {
            setCompletedPriority((current) => !current);
            return;
        }

        setCompletedPriority(false);
        setAbPrioritySection((current) => {
            if (current !== section) {
                return section;
            }

            return section === 'a' ? 'b' : 'a';
        });
    }, [sectionCounts.completed]);

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
                disabled={status === 'loading' || !onRequestCreateBucketCard}
                tabIndex={-1}
                data-arrow-skip="true"
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

    const renderCompactEmptyBucketDropZone = ({
        bucketKey,
        isOver,
    }: {
        bucketKey: string;
        isOver: boolean;
    }) => (
        <button
            type="button"
            disabled={status === 'loading' || !onRequestCreateBucketCard}
            tabIndex={-1}
            data-arrow-skip="true"
            onClick={(e) => {
                e.stopPropagation();
                onRequestCreateBucketCard?.({
                    bucketKey,
                    clientX: e.clientX,
                    clientY: e.clientY,
                    anchorRect: e.currentTarget.getBoundingClientRect(),
                });
            }}
            className={clsx(
                'mx-2 flex h-8 w-[calc(100%-16px)] items-center justify-center rounded-md border border-dashed px-3 transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
                isOver
                    ? 'border-sky-400 bg-sky-50 text-sky-700'
                    : 'border-slate-300 bg-white text-slate-400 hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700'
            )}
            data-testid={`ab-compact-empty-dropzone-${bucketKey}`}
        >
            <span className="flex items-center gap-2 text-[10px] font-semibold">
                <span
                    aria-hidden="true"
                    className={clsx(
                        'inline-flex h-4 w-4 items-center justify-center rounded-full border bg-white text-[9px] leading-none',
                        isOver ? 'border-sky-400 text-sky-700' : 'border-slate-300 text-slate-500'
                    )}
                >
                    ＋
                </span>
                <span>Drop or add card</span>
            </span>
        </button>
    );

    const renderSectionHeader = ({
        label,
        section,
        count,
        countValue,
        countTestId,
        countBadgeTone,
    }: {
        label: string;
        section: ActiveBucketSection;
        count: number;
        countValue?: ReactNode;
        countTestId: string;
        countBadgeTone?: 'neutral' | 'danger' | 'warning' | 'success';
    }) => {
        const isPriority = section === 'completed'
            ? completedPriority
            : !completedPriority && abPrioritySection === section;
        const isDisabled = section === 'completed' ? count === 0 : false;
        const lineClass = section === 'completed' ? 'border-b' : 'border-b border-dashed';

        return (
            <button
                ref={(node) => setHeaderRef(section, node)}
                type="button"
                aria-pressed={isPriority}
                aria-label={isPriority ? `${label}を優先中` : `${label}を優先表示`}
                data-focus-group="bucket"
                data-focus-part="section-button"
                disabled={isDisabled}
                onClick={() => handlePriorityPress(section)}
                className={clsx(
                    'flex min-h-8 w-full min-w-0 select-none items-center justify-between gap-3 px-2 py-1 text-left transition-colors duration-150',
                    lineClass,
                    section === 'completed' ? 'border-slate-200/90 bg-white' : 'border-slate-200/90 bg-slate-100/70',
                    isDisabled
                        ? 'cursor-default opacity-70'
                        : 'cursor-pointer hover:bg-white/80 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-inset'
                )}
                data-testid={`bucket-toggle-${section}-${day.isoDate}`}
            >
                <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[10px] font-semibold text-slate-700">{label}</span>
                    <CountBadge value={countValue ?? count} testId={countTestId} tone={countBadgeTone} />
                </span>
                <span
                    className={clsx(
                        'inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-none transition-colors duration-150',
                        isDisabled
                            ? 'border-slate-200 bg-slate-100 text-slate-400'
                            : isPriority
                                ? 'border-sky-200 bg-sky-50 text-sky-700'
                                : 'border-slate-200 bg-white text-slate-500'
                    )}
                >
                    {isPriority ? '優先中' : '優先表示'}
                </span>
            </button>
        );
    };

    const renderBucketContent = ({
        section,
        items,
        bucketKey,
        isOver,
        emptyStateVariant,
    }: {
        section: PrimaryBucketSection;
        items: readonly TimelineBucketItem[];
        bucketKey: string;
        isOver: boolean;
        emptyStateVariant: BucketEmptyStateVariant;
    }) => (
        <div
            ref={(node) => setContentRef(section, node)}
            className="min-h-0 min-w-0 space-y-1 pl-[1px] py-[1px]"
        >
            {items.length > 0 && emptyStateVariant !== 'compact' ? (
                renderBucketAddSlot({
                    isOver,
                    sticky: false,
                    testId: `ab-add-top-${bucketKey}`,
                    revealClassName:
                        'md:pointer-events-none md:opacity-0 md:group-hover/section:pointer-events-auto md:group-hover/section:opacity-100 md:group-focus-within/section:pointer-events-auto md:group-focus-within/section:opacity-100',
                    onClick: (e) => {
                        e.stopPropagation();
                        onRequestCreateBucketCard?.({
                            bucketKey,
                            clientX: e.clientX,
                            clientY: e.clientY,
                            anchorRect: e.currentTarget.getBoundingClientRect(),
                        });
                    },
                })
            ) : null}

            {emptyStateVariant === 'compact' ? (
                renderCompactEmptyBucketDropZone({ bucketKey, isOver })
            ) : items.length === 0 ? (
                null
            ) : (
                items.map((item) => (
                    <div key={item.card_id} className="group/item relative">
                        <TimelineBucketCard
                            item={item}
                            bucketKey={bucketKey}
                            openCardModal={(shortId) => openCardModal(shortId, 'bucket-list')}
                            onToggleCheck={onToggleCheck}
                            onRenameCardTitle={onRenameCardTitle}
                            showFallbackBottomLine={bucketIndicator?.bucketKey === bucketKey && bucketIndicator.cardId === item.card_id}
                            onCardContextMenu={onCardContextMenu}
                            onCardContextMenuByKeyboard={onCardContextMenuByKeyboard}
                            isContextMenuOpen={contextMenuCardId === item.card_id}
                            onCreateBucketCard={onCreateBucketCard}
                            isSelected={selectedCardIds.has(item.card_id)}
                            isActive={selectionLeadCardId === item.card_id || activeCardId === item.card_id}
                            selectionLane={`bucket:${bucketKey}`}
                            onShiftSelect={onShiftSelect}
                            onClearSelection={onClearSelection}
                            onActivateCard={onActivateCard}
                            activeCardId={activeCardId}
                            activeLaneId={activeLaneId}
                            autoStartTitleEdit={pendingTitleEditCardId === item.card_id}
                            onAutoStartTitleEditConsumed={onPendingTitleEditConsumed}
                        />
                        {renderBucketAddSlot({
                            isOver,
                            testId: `ab-add-after-${item.card_id}`,
                            revealClassName:
                                'md:pointer-events-none md:opacity-0 md:group-hover/item:pointer-events-auto md:group-hover/item:opacity-100 md:group-focus-within/item:pointer-events-auto md:group-focus-within/item:opacity-100',
                            onClick: (e) => {
                                e.stopPropagation();
                                onRequestCreateBucketCard?.({
                                    bucketKey,
                                    afterCardId: item.card_id,
                                    clientX: e.clientX,
                                    clientY: e.clientY,
                                    anchorRect: e.currentTarget.getBoundingClientRect(),
                                });
                            },
                        })}
                    </div>
                ))
            )}
        </div>
    );

    const renderBucketSection = ({
        section,
        label,
        items,
    }: {
        section: PrimaryBucketSection;
        label: string;
        items: readonly TimelineBucketItem[];
    }) => {
        const bucketKey = `${day.key}_${section}`;
        const layout = sectionLayout[section];

        return (
            <section
                data-testid={`bucket-section-${section}-${day.isoDate}`}
                className="min-h-0 overflow-hidden"
                style={{ height: `${layout.totalHeight}px` }}
            >
                <DroppableBucket bucketKey={bucketKey} disabled={status === 'loading'}>
                    {(isOver) => (
                        <div className={bucketSectionFrameClass(section, isOver)}>
                            {renderSectionHeader({
                                label,
                                section,
                                count: items.length,
                                countTestId: `bucket-count-${section}-${day.isoDate}`,
                            })}
                            <div
                                ref={(node) => {
                                    scrollContainerRefs.current[section] = node;
                                    registerScrollContainer?.(day.isoDate, node, section);
                                }}
                                data-ab-scroll-container="true"
                                className={clsx(
                                    'min-h-0 min-w-0 overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-ab-thin [scrollbar-gutter:stable]',
                                    layout.emptyStateVariant === 'compact' ? 'pt-1' : 'pt-2'
                                )}
                                style={{ height: `${layout.bodyHeight}px` }}
                            >
                                {renderBucketContent({
                                    section,
                                    items,
                                    bucketKey,
                                    isOver,
                                    emptyStateVariant: layout.emptyStateVariant ?? 'hidden',
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
                    openButtonTestId={`cardOpenButton-timeline-${entry.item.card_id}`}
                    timeText={buildTimelineCardTimeText(entry.item, { includeDuration: true })}
                    openSource="timeline"
                    checkedVisualTone="timeline-dim"
                    isSelected={selectedCardIds.has(entry.item.card_id)}
                    selectionLane={`timeline:${day.isoDate}`}
                    onShiftSelect={onShiftSelect}
                    onClearSelection={onClearSelection}
                    onActivateCard={onActivateCard}
                    activeCardId={activeCardId}
                    activeLaneId={activeLaneId}
                    autoStartTitleEdit={pendingTitleEditCardId === entry.item.card_id}
                    onAutoStartTitleEditConsumed={onPendingTitleEditConsumed}
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
                openButtonTestId={`cardOpenButton-bucket-list-${entry.item.card_id}`}
                timeText={buildTimelineCardTimeText(entry.item, {
                    includeDate: true,
                    includeTime: false,
                    includeDuration: true,
                })}
                openSource="bucket-list"
                checkedVisualTone="timeline-dim"
                isSelected={selectedCardIds.has(entry.item.card_id)}
                selectionLane={`bucket:${day.isoDate}_${entry.sourceBucket}`}
                onShiftSelect={onShiftSelect}
                onClearSelection={onClearSelection}
                onActivateCard={onActivateCard}
                activeCardId={activeCardId}
                activeLaneId={activeLaneId}
                autoStartTitleEdit={pendingTitleEditCardId === entry.item.card_id}
                onAutoStartTitleEditConsumed={onPendingTitleEditConsumed}
            />
        );
    };

    const renderCompletedSection = () => {
        const layout = sectionLayout.completed;

        return (
            <section
                data-testid={`bucket-section-completed-${day.isoDate}`}
                className="min-h-0 overflow-hidden"
                style={{ height: `${layout.totalHeight}px` }}
            >
                <div className={bucketSectionFrameClass('completed')}>
                    {renderSectionHeader({
                        label: 'Completed',
                        section: 'completed',
                        count: completedEntries.length,
                        countValue: `${completedCount}/${totalCount}`,
                        countTestId: `bucket-count-completed-${day.isoDate}`,
                        countBadgeTone: resolveCompletedCountBadgeTone(completedCount, totalCount),
                    })}
                    <div
                        ref={(node) => {
                            scrollContainerRefs.current.completed = node;
                        }}
                        className="min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-ab-thin [scrollbar-gutter:stable]"
                        style={{ height: `${layout.bodyHeight}px` }}
                    >
                        <div
                            ref={(node) => setContentRef('completed', node)}
                            className="min-h-0 space-y-1 pl-[1px] py-[1px]"
                        >
                            {completedEntries.map((entry) => renderCompletedEntryRow(entry))}
                        </div>
                    </div>
                </div>
            </section>
        );
    };

    return (
        <div
            data-ab-day={day.isoDate}
            className="pointer-events-auto w-full min-w-0 min-h-0 overflow-hidden border-l border-slate-100 bg-white md:border-slate-200"
            style={{ height: viewportHeight ? `${viewportHeight}px` : `calc(100vh - ${floatingLayerTop}px)` }}
        >
            <div
                className="grid h-full min-h-0 content-start gap-0 transition-[grid-template-rows] duration-200 ease-out"
                style={{
                    gridTemplateRows: [
                        `${sectionLayout.completed.totalHeight}px`,
                        `${sectionLayout.a.totalHeight}px`,
                        `${sectionLayout.b.totalHeight}px`,
                    ].join(' '),
                }}
            >
                {renderCompletedSection()}
                {renderBucketSection({
                    section: 'a',
                    label: 'A: Critical',
                    items: activeA,
                })}
                {renderBucketSection({
                    section: 'b',
                    label: 'B: Stretch',
                    items: activeB,
                })}
            </div>
        </div>
    );
});
