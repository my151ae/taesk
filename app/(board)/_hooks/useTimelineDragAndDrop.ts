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
    TimelineOverdueItem,
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

export type DragSourceKind = 'event' | 'bucket' | 'overdue';

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

export type DragSession = ActiveDragState & {
    sourceKind: DragSourceKind;
    pointerPreview: PointerPreviewState;
    bucketIndicator: BucketIndicator | null;
    isOverABList: boolean;
};

export type InteractionState =
    | { mode: 'idle' }
    | { mode: 'dragging'; dragSession: DragSession }
    | { mode: 'resizing'; resize: ActiveResizeState };

type ExplicitDropTarget =
    | {
        type: 'timeline-column';
        day: TimelineDay;
        rect: { top: number; height: number };
    }
    | {
        type: 'ab-bucket';
        bucketKey: string;
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
    const [interactionState, setInteractionState] = useState<InteractionState>({ mode: 'idle' });
    const interactionStateRef = useRef<InteractionState>({ mode: 'idle' });
    const activeDragRef = useRef<DragSession | null>(null);
    const dragAutoScrollRef = useRef(createDragAutoScrollState());
    const latestPointerRef = useRef<{ x: number; y: number } | null>(null);
    const pointerTrackingHandlerRef = useRef<((e: globalThis.PointerEvent) => void) | null>(null);
    const dragStartPointerRef = useRef<{ x: number; y: number } | null>(null);

    const dragSession = interactionState.mode === 'dragging' ? interactionState.dragSession : null;
    const activeResize = interactionState.mode === 'resizing' ? interactionState.resize : null;
    const activeDrag: ActiveDragState | null = dragSession
        ? {
            cardId: dragSession.cardId,
            startMinutes: dragSession.startMinutes,
            duration: dragSession.duration,
        }
        : null;
    const pointerPreview = dragSession?.pointerPreview ?? HIDDEN_POINTER_PREVIEW;
    const bucketIndicator = dragSession?.bucketIndicator ?? null;
    const isOverABList = dragSession?.isOverABList ?? false;

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

    const commitInteractionState = useCallback((nextState: InteractionState) => {
        interactionStateRef.current = nextState;
        activeDragRef.current = nextState.mode === 'dragging' ? nextState.dragSession : null;
        setInteractionState(nextState);
    }, []);

    const setDraggingSession = useCallback((dragSession: DragSession) => {
        commitInteractionState({ mode: 'dragging', dragSession });
    }, [commitInteractionState]);

    const updateDraggingSession = useCallback((updater: (current: DragSession) => DragSession) => {
        const currentState = interactionStateRef.current;
        if (currentState.mode !== 'dragging') return;
        setDraggingSession(updater(currentState.dragSession));
    }, [setDraggingSession]);

    const setResizeInteraction = useCallback((resize: ActiveResizeState) => {
        commitInteractionState({ mode: 'resizing', resize });
    }, [commitInteractionState]);

    const updateResizeInteraction = useCallback((updater: (current: ActiveResizeState) => ActiveResizeState) => {
        const currentState = interactionStateRef.current;
        if (currentState.mode !== 'resizing') return;
        setResizeInteraction(updater(currentState.resize));
    }, [setResizeInteraction]);

    const resetInteractionState = useCallback(() => {
        commitInteractionState({ mode: 'idle' });
    }, [commitInteractionState]);

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
        const kind = event.active.data.current?.kind as DragSourceKind;
        let nextSession: DragSession | null = null;
        if (kind === 'event') {
            const eventData = event.active.data.current?.event as TimelineEvent;
            const startMinutes = getMinutesFromTime(eventData?.due_start ?? null) ?? 0;
            const duration = Math.max(eventData.durationMinutes ?? eventData.duration ?? 60, 0);
            nextSession = {
                cardId,
                startMinutes,
                duration,
                sourceKind: kind,
                pointerPreview: HIDDEN_POINTER_PREVIEW,
                bucketIndicator: null,
                isOverABList: false,
            };
        } else if (kind === 'bucket') {
            const bucketItem = event.active.data.current?.item as TimelineBucketItem;
            const duration = Math.max(bucketItem?.duration ?? 60, 0);
            nextSession = {
                cardId,
                startMinutes: 9 * 60,
                duration,
                sourceKind: kind,
                pointerPreview: HIDDEN_POINTER_PREVIEW,
                bucketIndicator: null,
                isOverABList: false,
            };
        } else {
            const overdueItem = event.active.data.current?.item as TimelineOverdueItem;
            const startMinutes = getMinutesFromTime(overdueItem?.due_start ?? null) ?? 9 * 60;
            const duration = Math.max(overdueItem?.duration ?? 60, 0);
            nextSession = {
                cardId,
                startMinutes,
                duration,
                sourceKind: kind,
                pointerPreview: HIDDEN_POINTER_PREVIEW,
                bucketIndicator: null,
                isOverABList: false,
            };
        }
        if (!nextSession) return;
        setDraggingSession(nextSession);
    };

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

    const resolveDragEndClientPoint = useCallback(
        (event: DragEndEvent) => {
            const translated = event.active.rect.current?.translated;
            if (translated) {
                return {
                    x: translated.left + (translated.width ?? 0) / 2,
                    y: translated.top + (translated.height ?? 0) / 2,
                };
            }
            const x = resolvePointerClientX(event, latestPointerRef.current, dragStartPointerRef.current);
            const y = resolvePointerClientY(event, latestPointerRef.current, dragStartPointerRef.current);
            if (x == null || y == null) return null;
            return { x, y };
        },
        []
    );

    const isClientPointInsideViewport = useCallback((point: { x: number; y: number } | null) => {
        if (!point || typeof window === 'undefined') return false;
        return (
            point.x >= 0 &&
            point.y >= 0 &&
            point.x <= window.innerWidth &&
            point.y <= window.innerHeight
        );
    }, []);

    const resolveExplicitDropTargetAtPoint = useCallback(
        (point: { x: number; y: number } | null): ExplicitDropTarget | null => {
            if (!isClientPointInsideViewport(point)) return null;
            if (typeof document === 'undefined' || !point) return null;
            const top = document.elementFromPoint(point.x, point.y);
            if (!top) return null;

            const timelineColumn = top.closest?.('[data-dnd="timeline-column"]') as HTMLElement | null | undefined;
            if (timelineColumn) {
                const dayIso = timelineColumn.getAttribute('data-day-iso');
                const day = dayIso ? data?.days?.find((entry) => entry.isoDate === dayIso) ?? null : null;
                if (day) {
                    const rect = timelineColumn.getBoundingClientRect();
                    return {
                        type: 'timeline-column',
                        day,
                        rect: { top: rect.top, height: rect.height },
                    };
                }
            }

            const bucketEl = top.closest?.('[data-dnd="ab-bucket"]') as HTMLElement | null | undefined;
            if (bucketEl) {
                const bucketKey = bucketEl.getAttribute('data-bucket-key');
                if (bucketKey) {
                    return {
                        type: 'ab-bucket',
                        bucketKey,
                    };
                }
            }

            return null;
        },
        [data?.days, isClientPointInsideViewport]
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

    const isPointerInAbColumn = useCallback(
        (pointerX: number): boolean => {
            const containers = abScrollContainersRef?.current;
            if (!containers) return false;
            for (const el of Object.values(containers)) {
                if (!el) continue;
                const rect = el.getBoundingClientRect();
                if (pointerX >= rect.left && pointerX <= rect.right) {
                    return true;
                }
            }
            return false;
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
                isPointerInAbColumn,
                hasActiveDrag: () => Boolean(activeDragRef.current),
            });
        },
        [findAbScrollContainerAtPointer, isPointerInAbColumn, resolvePointerForAutoScroll, timelineScrollRef]
    );

    const handleDragMove = (event: DragMoveEvent) => {
        const currentState = interactionStateRef.current;
        const currentDrag = currentState.mode === 'dragging' ? currentState.dragSession : null;
        if (!currentDrag) {
            stopDragAutoScroll();
            if (dragSession?.pointerPreview.visible) {
                resetInteractionState();
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
        const nextBucketIndicator =
            !visualTimelineTarget && overType === 'ab-bucket'
                ? (() => {
                    const bucketKey = event.over?.data.current?.bucketKey as string | undefined;
                    const items = bucketKey && data?.abBuckets ? data.abBuckets[bucketKey] ?? [] : [];
                    if (bucketKey && items.length) {
                        const nextPointerY = resolvePointerClientY(event, latestPointerRef.current, dragStartPointerRef.current);
                        const bucketRect = event.over?.rect;
                        let targetIndex = 0;
                        if (bucketRect && nextPointerY != null) {
                            const relativeY = nextPointerY - bucketRect.top;
                            const clampedY = Math.max(0, Math.min(bucketRect.height, relativeY));
                            const ratio = bucketRect.height > 0 ? clampedY / bucketRect.height : 0;
                            targetIndex = Math.min(items.length - 1, Math.max(0, Math.round(ratio * (items.length - 1))));
                        }
                        return { bucketKey, cardId: items[targetIndex]?.card_id ?? null } satisfies BucketIndicator;
                    }
                    return null;
                })()
                : null;
        updateDragAutoScroll(event);

        if (!visualTimelineTarget && overType !== 'timeline-column') {
            updateDraggingSession(() => ({
                ...currentDrag,
                isOverABList: isOverAbArea,
                bucketIndicator: nextBucketIndicator,
                pointerPreview: HIDDEN_POINTER_PREVIEW,
            }));
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
        const nextSession: DragSession = {
            ...currentDrag,
            isOverABList: isOverAbArea,
            bucketIndicator: nextBucketIndicator,
            pointerPreview: {
                visible: true,
                startMinutes: nextStart,
                durationMinutes,
                dayIso: day?.isoDate ?? null,
            },
        };
        setDraggingSession(nextSession);
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over, delta } = event;
        const dragEndPoint = resolveDragEndClientPoint(event);
        const explicitDropTarget = resolveExplicitDropTargetAtPoint(dragEndPoint);
        stopDragAutoScroll();
        stopPointerTracking();
        const completedDrag =
            interactionStateRef.current.mode === 'dragging' ? interactionStateRef.current.dragSession : null;
        resetInteractionState();

        if (!isClientPointInsideViewport(dragEndPoint)) return;
        if (!over && !explicitDropTarget) return;
        const cardId = active.data.current?.cardId as string | undefined;
        if (!cardId) return;

        const sourceEvent = active.data.current?.kind === 'event'
            ? (active.data.current?.event as TimelineEvent | undefined)
            : undefined;
        const sourceBucketItem = active.data.current?.kind === 'bucket'
            ? (active.data.current?.item as TimelineBucketItem | undefined)
            : undefined;
        const sourceOverdueItem = active.data.current?.kind === 'overdue'
            ? (active.data.current?.item as TimelineOverdueItem | undefined)
            : undefined;

        const overType = explicitDropTarget?.type ?? over?.data.current?.type;

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
                duration: completedDrag?.duration ?? sourceEvent?.durationMinutes ?? sourceEvent?.duration ?? sourceOverdueItem?.duration ?? sourceBucketItem?.duration ?? 60,
                bucketPosition,
            });
            persistPlacement(cardId, payload, {
                target: 'bucket',
                bucketKey,
                sourceEvent,
                sourceBucketItem,
                sourceOverdueItem,
                localDueDate: dayIso,
            });
            return;
        }

        if (overType === 'timeline-column' && completedDrag) {
            const day =
                explicitDropTarget?.type === 'timeline-column'
                    ? explicitDropTarget.day
                    : (over?.data.current?.day as TimelineDay | undefined);
            if (!day) return;
            const scrollTop = timelineScrollRef.current?.scrollTop ?? 0;
            const pointerMinutes = pointerMinutesFromEvent(event, {
                scrollTop,
                columnRect: explicitDropTarget?.type === 'timeline-column'
                    ? explicitDropTarget.rect
                    : over?.rect
                        ? { top: over.rect.top, height: over.rect.height }
                        : undefined,
                hourHeight,
            });
            const fallbackPointer = completedDrag.startMinutes + (delta.y / hourHeight) * 60;
            let nextStart = pointerMinutes ?? fallbackPointer;
            nextStart = Math.round(nextStart / 5) * 5;
            nextStart = Math.max(0, Math.min(23 * 60 + 55, nextStart));
            const sourceDueBucket = resolveSourceDueBucket({
                sourceEvent,
                sourceBucketItem,
                sourceOverdueItem,
                sourceBucketKey: active.data.current?.bucketKey as string | undefined,
            });
            const payload = buildTimelineDropPayload({
                dayIso: day.isoDate,
                nextStart,
                duration: completedDrag.duration,
                sourceDueBucket,
                sourceEvent,
                sourceBucketItem,
                sourceOverdueItem,
            });
            persistPlacement(cardId, payload, {
                target: 'timeline',
                sourceEvent,
                sourceBucketItem,
                sourceOverdueItem,
                defaultDuration: completedDrag.duration,
                localDueDate: day.isoDate,
            });
            return;
        }

        if (overType === 'ab-bucket') {
            const bucketKey =
                explicitDropTarget?.type === 'ab-bucket'
                    ? explicitDropTarget.bucketKey
                    : (over?.data.current?.bucketKey as string);
            const dayIso = bucketDayMap[bucketKey] ?? null;
            const bucketItems = data?.abBuckets?.[bucketKey] ?? [];
            const fallbackTargetCardId =
                bucketIndicator?.bucketKey === bucketKey ? bucketIndicator.cardId : bucketItems[0]?.card_id ?? null;

            const bucketPosition = resolveBucketDropPosition({
                bucketItems,
                bucketKey,
                activeCardId: cardId,
                targetCardId: completedDrag?.bucketIndicator?.bucketKey === bucketKey ? completedDrag.bucketIndicator.cardId : fallbackTargetCardId,
            });
            const payload = buildBucketDropPayload({
                bucketKey,
                dayIso,
                duration: completedDrag?.duration ?? sourceEvent?.durationMinutes ?? sourceEvent?.duration ?? sourceOverdueItem?.duration ?? sourceBucketItem?.duration ?? 60,
                bucketPosition,
            });
            persistPlacement(cardId, payload, {
                target: 'bucket',
                bucketKey,
                sourceEvent,
                sourceBucketItem,
                sourceOverdueItem,
                localDueDate: dayIso,
                defaultDuration: completedDrag?.duration,
            });
        }
    };

    const handleDragCancel = () => {
        stopDragAutoScroll();
        stopPointerTracking();
        resetInteractionState();
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
        setResizeInteraction({
            cardId,
            startMinutes,
            duration,
            originalStartMinutes: startMinutes,
            originalDuration: duration,
            startY: e.clientY,
            edge,
        });
    }, [setResizeInteraction]);

    const handleResizeMove = useCallback((e: ReactPointerEvent) => {
        const currentState = interactionStateRef.current;
        if (currentState.mode !== 'resizing') return;
        const currentResize = currentState.resize;
        e.preventDefault();
        e.stopPropagation();

        const deltaY = e.clientY - currentResize.startY;
        const deltaMinutes = Math.round((deltaY / hourHeight) * 60 / 5) * 5;

        if (currentResize.edge === 'bottom') {
            const newDuration = Math.max(0, currentResize.originalDuration + deltaMinutes);
            const endMinutes = currentResize.startMinutes + newDuration;
            const maxEnd = 24 * 60;
            const cappedDuration = Math.min(newDuration, maxEnd - currentResize.startMinutes);

            if (cappedDuration !== currentResize.duration) {
                updateResizeInteraction((resize) => ({ ...resize, duration: cappedDuration }));
            }
        } else { // activeResize.edge === 'top'
            let newStart = currentResize.originalStartMinutes + deltaMinutes;
            let newDuration = currentResize.originalDuration - deltaMinutes;

            // Ensure minimum duration
            if (newDuration < 0) {
                newDuration = 0;
                newStart = currentResize.originalStartMinutes + currentResize.originalDuration;
            }

            // Ensure start time is not negative
            if (newStart < 0) {
                newStart = 0;
                newDuration = currentResize.originalStartMinutes + currentResize.originalDuration;
            }

            if (newStart !== currentResize.startMinutes || newDuration !== currentResize.duration) {
                updateResizeInteraction((resize) => ({
                    ...resize,
                    startMinutes: newStart,
                    duration: newDuration,
                }));
            }
        }
    }, [hourHeight, updateResizeInteraction]);

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

        resetInteractionState();
    }, [activeResize, applyPatch, dataMode, resetInteractionState, setData]);

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
