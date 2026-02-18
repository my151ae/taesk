import {
    useSensor,
    useSensors,
    MouseSensor,
    TouchSensor,
    DragStartEvent,
    DragMoveEvent,
    DragEndEvent,
    CollisionDetection,
    pointerWithin,
    rectIntersection,
    UniqueIdentifier,
} from '@dnd-kit/core';
import { useState, useRef, useCallback, useMemo, KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import {
    TimelineEvent,
    TimelineBucketItem,
    TimelineDay,
    TimelineResponse,
    minutesToTime,
    getMinutesFromTime,
    pointerMinutesFromEvent,
    withJstMidnight,
} from '@/app/(board)/_utils/timeline-helpers';
import type { DueBucket } from '@/lib/supabase';
import {
    extractClientPoint,
    resolvePointerClientX,
    resolvePointerClientY,
} from '@/app/(board)/_hooks/timeline-dnd-pointer';
import {
    buildBucketDropPayload,
    buildTimelineDropPayload,
    resolveBucketDropPosition,
    resolveBucketInsertPosition,
    resolveSourceDueBucket,
} from '@/app/(board)/_hooks/timeline-dnd-drop';
import {
    createPersistPlacement,
} from '@/app/(board)/_hooks/timeline-dnd-persist';
import {
    createDragAutoScrollState,
    stopAutoScroll,
    updateAutoScroll,
} from '@/app/(board)/_hooks/timeline-dnd-autoscroll';

export type ActiveDragState = {
    cardId: string;
    startMinutes: number;
    duration: number;
};

export type PointerPreviewState = {
    visible: boolean;
    startMinutes: number;
    durationMinutes: number;
    dayIso: string | null;
};

export const HIDDEN_POINTER_PREVIEW: PointerPreviewState = {
    visible: false,
    startMinutes: 0,
    durationMinutes: 0,
    dayIso: null,
};

export type BucketIndicator = {
    bucketKey: string;
    cardId: string | null;
};

export type ActiveResizeState = {
    cardId: string;
    startMinutes: number;
    duration: number;
    originalStartMinutes: number;
    originalDuration: number;
    startY: number;
    edge: 'top' | 'bottom';
};

export const bucketsFirstCollisionDetection: CollisionDetection = (args) => {
    const pointer = args.pointerCoordinates;
    if (pointer && typeof document !== 'undefined') {
        const top = document.elementFromPoint(pointer.x, pointer.y);
        const timelineHit = top?.closest?.('[data-dnd="timeline-column"]');
        const abHit = top?.closest?.('[data-dnd="ab-bucket"]');

        if (timelineHit && !abHit) {
            const timelineCollisions = pointerWithin({
                ...args,
                droppableContainers: args.droppableContainers.filter(
                    (entry) => entry.data.current?.type === 'timeline-column'
                ),
            });
            if (timelineCollisions.length) {
                return timelineCollisions;
            }
        }

        if (abHit) {
            const bucketCollisions = pointerWithin({
                ...args,
                droppableContainers: args.droppableContainers.filter((entry) => {
                    const type = entry.data.current?.type;
                    return type === 'bucket-item' || type === 'bucket-item-top' || type === 'bucket-item-bottom' || type === 'ab-bucket';
                }),
            });
            if (bucketCollisions.length) {
                return bucketCollisions;
            }
        }
    }

    const pointerCollisions = pointerWithin(args);
    if (!pointerCollisions.length) {
        return rectIntersection(args);
    }

    const droppableFor = (id: UniqueIdentifier) => {
        const match = args.droppableContainers.find((entry) => entry.id === id);
        return match?.data.current?.type;
    };
    const bucketCollisions = pointerCollisions.filter(({ id }) => {
        const type = droppableFor(id);
        return type === 'bucket-item' || type === 'bucket-item-top' || type === 'bucket-item-bottom' || type === 'ab-bucket';
    });

    if (bucketCollisions.length) {
        return bucketCollisions;
    }

    return pointerCollisions;
};

type UseTimelineDragAndDropProps = {
    data: TimelineResponse | null;
    setData: React.Dispatch<React.SetStateAction<TimelineResponse | null>>;
    applyPatch: (cardId: string, payload: Record<string, unknown>) => Promise<void>;
    timelineScrollRef: React.RefObject<HTMLDivElement>;
    abScrollContainersRef?: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
    bucketDayMap: Record<string, string | null>;
    dataMode: 'api' | 'mock';
    timelineStartHour?: number;
    hourHeight?: number;
};

export function useTimelineDragAndDrop({
    data,
    setData,
    applyPatch,
    timelineScrollRef,
    abScrollContainersRef,
    bucketDayMap,
    dataMode,
    timelineStartHour = 0,
    hourHeight = 40,
}: UseTimelineDragAndDropProps) {
    const [activeDrag, setActiveDrag] = useState<ActiveDragState | null>(null);
    const activeDragRef = useRef<ActiveDragState | null>(null);
    const [pointerPreview, setPointerPreview] = useState<PointerPreviewState>(HIDDEN_POINTER_PREVIEW);
    const [activeResize, setActiveResize] = useState<ActiveResizeState | null>(null);
    const [bucketIndicator, setBucketIndicator] = useState<BucketIndicator | null>(null);
    const dragAutoScrollRef = useRef(createDragAutoScrollState());
    const latestPointerRef = useRef<{ x: number; y: number } | null>(null);
    const pointerTrackingHandlerRef = useRef<((e: globalThis.PointerEvent) => void) | null>(null);
    const dragStartPointerRef = useRef<{ x: number; y: number } | null>(null);

    const sensors = useSensors(
        useSensor(MouseSensor, {
            activationConstraint: { distance: 10 },
        }),
        useSensor(TouchSensor, {
            activationConstraint: { delay: 150, tolerance: 10 },
        })
    );

    const persistPlacement = useMemo(
        () =>
            createPersistPlacement({
                setData,
                dataMode,
                applyPatch,
            }),
        [applyPatch, dataMode, setData]
    );

    const handleDragStart = (event: DragStartEvent) => {
        const cardId = event.active.data.current?.cardId as string | undefined;
        if (!cardId) return;
        dragStartPointerRef.current =
            extractClientPoint(event.activatorEvent) ??
            (() => {
                const initial = event.active.rect.current?.initial;
                if (initial) {
                    return { x: initial.left + (initial.width ?? 0) / 2, y: initial.top + (initial.height ?? 0) / 2 };
                }
                return null;
            })();
        if (typeof window !== 'undefined' && !pointerTrackingHandlerRef.current) {
            const handler = (e: globalThis.PointerEvent) => {
                latestPointerRef.current = { x: e.clientX, y: e.clientY };
            };
            pointerTrackingHandlerRef.current = handler;
            window.addEventListener('pointermove', handler, { passive: true });
        }
        const kind = event.active.data.current?.kind as 'event' | 'bucket';
        if (kind === 'event') {
            const eventData = event.active.data.current?.event as TimelineEvent;
            const startMinutes = getMinutesFromTime(eventData?.due_start ?? null) ?? 0;
            const duration = Math.max(eventData.durationMinutes ?? eventData.duration ?? 60, 0);
            const dragState: ActiveDragState = { cardId, startMinutes, duration };
            setActiveDrag(dragState);
            activeDragRef.current = dragState;
        } else {
            const bucketItem = event.active.data.current?.item as TimelineBucketItem;
            const duration = Math.max(bucketItem?.duration ?? 60, 0);
            const dragState: ActiveDragState = { cardId, startMinutes: 9 * 60, duration };
            setActiveDrag(dragState);
            activeDragRef.current = dragState;
        }
        setPointerPreview(HIDDEN_POINTER_PREVIEW);
    };

    const [isOverABList, setIsOverABList] = useState(false);

    const resolveTimelineTargetAtPointer = useCallback(
        (pointerX: number | null, pointerY: number | null) => {
            if (pointerX == null || pointerY == null) return null;
            if (typeof document === 'undefined') return null;
            const top = document.elementFromPoint(pointerX, pointerY);
            const columnEl = top?.closest?.('[data-dnd="timeline-column"]') as HTMLElement | null | undefined;
            if (!columnEl) return null;
            const dayIso = columnEl.getAttribute('data-day-iso');
            if (!dayIso) return null;
            const day = data?.days?.find((entry) => entry.isoDate === dayIso) ?? null;
            if (!day) return null;
            const rect = columnEl.getBoundingClientRect();
            return { day, rect };
        },
        [data?.days]
    );

    const stopDragAutoScroll = useCallback(() => {
        stopAutoScroll(dragAutoScrollRef.current);
    }, []);

    const stopPointerTracking = useCallback(() => {
        if (typeof window === 'undefined') return;
        const handler = pointerTrackingHandlerRef.current;
        if (handler) {
            window.removeEventListener('pointermove', handler);
            pointerTrackingHandlerRef.current = null;
        }
        latestPointerRef.current = null;
        dragStartPointerRef.current = null;
    }, []);

    const findAbScrollContainerAtPointer = useCallback(
        (pointerX: number, pointerY: number): HTMLDivElement | null => {
            const containers = abScrollContainersRef?.current;
            if (!containers) return null;
            for (const el of Object.values(containers)) {
                if (!el) continue;
                const rect = el.getBoundingClientRect();
                if (
                    pointerX >= rect.left &&
                    pointerX <= rect.right &&
                    pointerY >= rect.top &&
                    pointerY <= rect.bottom
                ) {
                    return el;
                }
            }
            return null;
        },
        [abScrollContainersRef]
    );

    const resolvePointerForAutoScroll = useCallback(
        (event: DragMoveEvent) => ({
            x: resolvePointerClientX(event, latestPointerRef.current, dragStartPointerRef.current),
            y: resolvePointerClientY(event, latestPointerRef.current, dragStartPointerRef.current),
        }),
        []
    );

    const updateDragAutoScroll = useCallback(
        (event: DragMoveEvent) => {
            updateAutoScroll({
                event,
                state: dragAutoScrollRef.current,
                resolvePointer: resolvePointerForAutoScroll,
                timelineScrollRef,
                findAbScrollContainerAtPointer,
                hasActiveDrag: () => Boolean(activeDragRef.current),
            });
        },
        [findAbScrollContainerAtPointer, resolvePointerForAutoScroll, timelineScrollRef]
    );

    const handleDragMove = (event: DragMoveEvent) => {
        const currentDrag = activeDragRef.current;
        if (!currentDrag) {
            stopDragAutoScroll();
            if (pointerPreview.visible) {
                setPointerPreview(HIDDEN_POINTER_PREVIEW);
            }
            return;
        }
        const overType = event.over?.data.current?.type;

            const pointerX = resolvePointerClientX(event, latestPointerRef.current, dragStartPointerRef.current);
            const pointerY = resolvePointerClientY(event, latestPointerRef.current, dragStartPointerRef.current);
        const visualTimelineTarget = resolveTimelineTargetAtPointer(pointerX, pointerY);
        const hoveredAbEl =
            pointerX != null && pointerY != null ? findAbScrollContainerAtPointer(pointerX, pointerY) : null;

        // Check if over A/B list
        const isAB = overType === 'ab-bucket' || overType === 'bucket-item' || overType === 'bucket-item-top' || overType === 'bucket-item-bottom';
        const isOverAbArea = !visualTimelineTarget && (Boolean(hoveredAbEl) || isAB);
        if (isOverAbArea !== isOverABList) {
            setIsOverABList(isOverAbArea);
        }
        updateDragAutoScroll(event);

        if (!visualTimelineTarget && overType === 'ab-bucket') {
            const bucketKey = event.over?.data.current?.bucketKey as string | undefined;
            const items = bucketKey && data?.abBuckets ? data.abBuckets[bucketKey] ?? [] : [];
            if (bucketKey && items.length) {
                    const pointerY = resolvePointerClientY(event, latestPointerRef.current, dragStartPointerRef.current);
                const bucketRect = event.over?.rect;
                let targetIndex = 0;
                if (bucketRect && pointerY != null) {
                    const relativeY = pointerY - bucketRect.top;
                    const clampedY = Math.max(0, Math.min(bucketRect.height, relativeY));
                    const ratio = bucketRect.height > 0 ? clampedY / bucketRect.height : 0;
                    targetIndex = Math.min(items.length - 1, Math.max(0, Math.round(ratio * (items.length - 1))));
                }
                setBucketIndicator({ bucketKey, cardId: items[targetIndex]?.card_id ?? null });
            } else {
                setBucketIndicator(null);
            }
        } else if (bucketIndicator) {
            setBucketIndicator(null);
        }

        if (!visualTimelineTarget && overType !== 'timeline-column') {
            if (pointerPreview.visible) {
                setPointerPreview(HIDDEN_POINTER_PREVIEW);
            }
            return;
        }
        const day = visualTimelineTarget?.day ?? (event.over?.data.current?.day as TimelineDay | undefined);
        const columnRect = visualTimelineTarget?.rect ?? (event.over?.rect ? { top: event.over.rect.top, height: event.over.rect.height } : undefined);
        const scrollTop = timelineScrollRef.current?.scrollTop ?? 0;
        const pointerMinutes = pointerMinutesFromEvent(event, {
            scrollTop,
            columnRect,
            startHour: timelineStartHour,
            hourHeight,
        });
        const fallbackPointer = currentDrag.startMinutes + (event.delta.y / hourHeight) * 60;
        let nextStart = pointerMinutes ?? fallbackPointer;
        nextStart = Math.round(nextStart / 5) * 5;
        nextStart = Math.max(0, Math.min(23 * 60 + 55, nextStart));
        const desiredEnd = nextStart + currentDrag.duration;
        const endMinutes = Math.min(desiredEnd, 24 * 60 - 1);
        const durationMinutes = Math.max(endMinutes - nextStart, 0);
        setPointerPreview({
            visible: true,
            startMinutes: nextStart,
            durationMinutes,
            dayIso: day?.isoDate ?? null,
        });
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over, delta } = event;
        const pointerX = resolvePointerClientX(event, latestPointerRef.current, dragStartPointerRef.current);
        const pointerY = resolvePointerClientY(event, latestPointerRef.current, dragStartPointerRef.current);
        const visualTimelineTarget = resolveTimelineTargetAtPointer(pointerX, pointerY);
        stopDragAutoScroll();
        stopPointerTracking();
        setActiveDrag(null);
        activeDragRef.current = null;
        setPointerPreview(HIDDEN_POINTER_PREVIEW);
        setIsOverABList(false);
        setBucketIndicator(null);

        if (!over && !visualTimelineTarget) return;
        const cardId = active.data.current?.cardId as string | undefined;
        if (!cardId) return;

        const sourceEvent = active.data.current?.event as TimelineEvent | undefined;
        const sourceBucketItem = active.data.current?.item as TimelineBucketItem | undefined;

        const overType = visualTimelineTarget ? 'timeline-column' : over?.data.current?.type;

        if (overType === 'bucket-item-top' || overType === 'bucket-item-bottom') {
            const bucketKey = over?.data.current?.bucketKey as string | undefined;
            const targetCardId = over?.data.current?.cardId as string | undefined;
            if (!bucketKey || !targetCardId) return;
            const bucketItems = data?.abBuckets?.[bucketKey];
            if (!bucketItems?.length) return;
            if (targetCardId === cardId && active.data.current?.bucketKey === bucketKey) {
                return;
            }
            const bucketPosition = resolveBucketInsertPosition({
                bucketItems,
                targetCardId,
                mode: overType === 'bucket-item-top' ? 'before' : 'after',
            });

            const dayIso = bucketDayMap[bucketKey] ?? null;
            const payload = buildBucketDropPayload({
                bucketKey,
                dayIso,
                duration: activeDrag?.duration ?? sourceEvent?.durationMinutes ?? sourceEvent?.duration ?? sourceBucketItem?.duration ?? 60,
                bucketPosition,
            });
            persistPlacement(cardId, payload, {
                target: 'bucket',
                bucketKey,
                sourceEvent,
                sourceBucketItem,
                localDueDate: dayIso,
            });
            return;
        }

        if (overType === 'timeline-column' && activeDrag) {
            const day = visualTimelineTarget?.day ?? (over?.data.current?.day as TimelineDay | undefined);
            if (!day) return;
            const scrollTop = timelineScrollRef.current?.scrollTop ?? 0;
            const pointerMinutes = pointerMinutesFromEvent(event, {
                scrollTop,
                columnRect: visualTimelineTarget?.rect
                    ? { top: visualTimelineTarget.rect.top, height: visualTimelineTarget.rect.height }
                    : over?.rect
                        ? { top: over.rect.top, height: over.rect.height }
                        : undefined,
                hourHeight,
            });
            const fallbackPointer = activeDrag.startMinutes + (delta.y / hourHeight) * 60;
            let nextStart = pointerMinutes ?? fallbackPointer;
            nextStart = Math.round(nextStart / 5) * 5;
            nextStart = Math.max(0, Math.min(23 * 60 + 55, nextStart));
            const sourceDueBucket = resolveSourceDueBucket({
                sourceEvent,
                sourceBucketItem,
                sourceBucketKey: active.data.current?.bucketKey as string | undefined,
            });
            const payload = buildTimelineDropPayload({
                dayIso: day.isoDate,
                nextStart,
                duration: activeDrag.duration,
                sourceDueBucket,
                sourceEvent,
                sourceBucketItem,
            });
            persistPlacement(cardId, payload, {
                target: 'timeline',
                sourceEvent,
                sourceBucketItem,
                defaultDuration: activeDrag.duration,
                localDueDate: day.isoDate,
            });
            return;
        }

        if (overType === 'ab-bucket') {
            const bucketKey = over?.data.current?.bucketKey as string;
            const dayIso = bucketDayMap[bucketKey] ?? null;
            const bucketItems = data?.abBuckets?.[bucketKey] ?? [];
            const fallbackTargetCardId =
                bucketIndicator?.bucketKey === bucketKey ? bucketIndicator.cardId : bucketItems[0]?.card_id ?? null;

            const bucketPosition = resolveBucketDropPosition({
                bucketItems,
                bucketKey,
                activeCardId: cardId,
                targetCardId: fallbackTargetCardId,
            });
            const payload = buildBucketDropPayload({
                bucketKey,
                dayIso,
                duration: activeDrag?.duration ?? sourceEvent?.durationMinutes ?? sourceEvent?.duration ?? sourceBucketItem?.duration ?? 60,
                bucketPosition,
            });
            persistPlacement(cardId, payload, {
                target: 'bucket',
                bucketKey,
                sourceEvent,
                sourceBucketItem,
                localDueDate: dayIso,
                defaultDuration: activeDrag?.duration,
            });
        }
    };

    const handleDragCancel = () => {
        stopDragAutoScroll();
        stopPointerTracking();
        setActiveDrag(null);
        activeDragRef.current = null;
        setPointerPreview(HIDDEN_POINTER_PREVIEW);
        setIsOverABList(false);
        setBucketIndicator(null);
    };

    const handleEventKeyDown = (
        event: TimelineEvent,
        native: KeyboardEvent<HTMLElement>
    ) => {
        if (!['ArrowUp', 'ArrowDown'].includes(native.key)) return;
        if (!native.altKey || native.ctrlKey || native.metaKey || native.shiftKey) return;
        native.preventDefault();
        const direction = native.key === 'ArrowUp' ? -5 : 5;
        const startMinutes = getMinutesFromTime(event.due_start ?? null) ?? 0;
        const duration = event.durationMinutes ?? 60;
        const nextStart = Math.max(0, Math.min(23 * 60 + 55, startMinutes + direction));
        const nextEnd = nextStart + duration;
        persistPlacement(
            event.card_id,
            {
                due_bucket: (event.due_bucket as DueBucket) ?? null,
                due_date: withJstMidnight(event.due_date ?? null),
                due_start: minutesToTime(nextStart),
                due_end: minutesToTime(Math.min(nextEnd, 24 * 60 - 1)),
                due_bucket_position: event.due_bucket_position ?? null,
            },
            {
                target: 'timeline',
                sourceEvent: event,
                defaultDuration: duration,
                localDueDate: event.due_date ?? null,
            }
        );
    };

    const handleResizeStart = useCallback((e: ReactPointerEvent, cardId: string, startMinutes: number, duration: number, edge: 'top' | 'bottom') => {
        e.preventDefault();
        e.stopPropagation();
        const target = e.currentTarget as HTMLElement;
        target.setPointerCapture(e.pointerId);
        setActiveResize({
            cardId,
            startMinutes,
            duration,
            originalStartMinutes: startMinutes,
            originalDuration: duration,
            startY: e.clientY,
            edge,
        });
    }, []);

    const handleResizeMove = useCallback((e: ReactPointerEvent) => {
        if (!activeResize) return;
        e.preventDefault();
        e.stopPropagation();

        const deltaY = e.clientY - activeResize.startY;
        const deltaMinutes = Math.round((deltaY / hourHeight) * 60 / 5) * 5;

        if (activeResize.edge === 'bottom') {
            const newDuration = Math.max(0, activeResize.originalDuration + deltaMinutes);
            const endMinutes = activeResize.startMinutes + newDuration;
            const maxEnd = 24 * 60;
            const cappedDuration = Math.min(newDuration, maxEnd - activeResize.startMinutes);

            if (cappedDuration !== activeResize.duration) {
                setActiveResize(prev => prev ? { ...prev, duration: cappedDuration } : null);
            }
        } else { // activeResize.edge === 'top'
            let newStart = activeResize.originalStartMinutes + deltaMinutes;
            let newDuration = activeResize.originalDuration - deltaMinutes;

            // Ensure minimum duration
            if (newDuration < 0) {
                newDuration = 0;
                newStart = activeResize.originalStartMinutes + activeResize.originalDuration;
            }

            // Ensure start time is not negative
            if (newStart < 0) {
                newStart = 0;
                newDuration = activeResize.originalStartMinutes + activeResize.originalDuration;
            }

            if (newStart !== activeResize.startMinutes || newDuration !== activeResize.duration) {
                setActiveResize(prev => prev ? { ...prev, startMinutes: newStart, duration: newDuration } : null);
            }
        }
    }, [activeResize, hourHeight]);

    const handleResizeEnd = useCallback((e: ReactPointerEvent) => {
        if (!activeResize) return;
        e.preventDefault();
        e.stopPropagation();
        const target = e.currentTarget as HTMLElement;
        target.releasePointerCapture(e.pointerId);

        if (activeResize.duration !== activeResize.originalDuration || activeResize.startMinutes !== activeResize.originalStartMinutes) {
            const cardId = activeResize.cardId;
            const newEnd = activeResize.startMinutes + activeResize.duration;
            const payload: Record<string, unknown> = {
                due_end: minutesToTime(newEnd),
                duration: activeResize.duration,
            };
            if (activeResize.edge === 'top') {
                payload.due_start = minutesToTime(activeResize.startMinutes);
            }

            setData(current => {
                if (!current) return current;
                const nextEvents = current.events.map(ev => {
                    if (ev.card_id === cardId) {
                        return {
                            ...ev,
                            durationMinutes: activeResize.duration,
                            duration: activeResize.duration,
                            due_end: minutesToTime(newEnd),
                            due_start: minutesToTime(activeResize.startMinutes)
                        };
                    }
                    return ev;
                });
                return { ...current, events: nextEvents };
            });

            if (dataMode === 'api') {
                applyPatch(cardId, payload);
            }
        }

        setActiveResize(null);
    }, [activeResize, applyPatch, dataMode, setData]);

    return {
        sensors,
        activeDrag,
        pointerPreview,
        activeResize,
        bucketIndicator,
        isOverABList,
        handleDragStart,
        handleDragMove,
        handleDragEnd,
        handleDragCancel,
        handleEventKeyDown,
        handleResizeStart,
        handleResizeMove,
        handleResizeEnd,
    };
}
