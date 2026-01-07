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
import { useState, useRef, useCallback, KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import {
    TimelineEvent,
    TimelineBucketItem,
    TimelineDay,
    TimelineResponse,
    HOUR_HEIGHT,
    TIMELINE_HEIGHT,
    minutesToTime,
    getMinutesFromTime,
    pointerMinutesFromEvent,
    toLocalDay,
    withJstMidnight,
} from '@/app/(board)/_utils/timeline-helpers';
import type { DueBucket } from '@/lib/supabase';

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

type PlacementMeta = {
    target: 'timeline' | 'bucket';
    bucketKey?: string;
    sourceEvent?: TimelineEvent;
    sourceBucketItem?: TimelineBucketItem;
    defaultDuration?: number;
    localDueDate?: string | null;
};

export const bucketsFirstCollisionDetection: CollisionDetection = (args) => {
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
    editingCardId?: string | null;
    timelineStartHour?: number;
};

export function useTimelineDragAndDrop({
    data,
    setData,
    applyPatch,
    timelineScrollRef,
    abScrollContainersRef,
    bucketDayMap,
    dataMode,
    editingCardId,
    timelineStartHour = 0,
}: UseTimelineDragAndDropProps) {
    const [activeDrag, setActiveDrag] = useState<ActiveDragState | null>(null);
    const activeDragRef = useRef<ActiveDragState | null>(null);
    const [pointerPreview, setPointerPreview] = useState<PointerPreviewState>(HIDDEN_POINTER_PREVIEW);
    const [activeResize, setActiveResize] = useState<ActiveResizeState | null>(null);
    const [bucketIndicator, setBucketIndicator] = useState<BucketIndicator | null>(null);
    const dragAutoScrollRef = useRef<{
        raf: number | null;
        velocityPxPerSecond: number;
        el: HTMLDivElement | null;
        lastTimestamp: number | null;
    }>({
        raf: null,
        velocityPxPerSecond: 0,
        el: null,
        lastTimestamp: null,
    });
    const latestPointerRef = useRef<{ x: number; y: number } | null>(null);
    const pointerTrackingHandlerRef = useRef<((e: globalThis.PointerEvent) => void) | null>(null);
    const dragStartPointerRef = useRef<{ x: number; y: number } | null>(null);

    const extractClientPoint = (evt: unknown): { x: number; y: number } | null => {
        if (!evt || typeof evt !== 'object') return null;
        if ('clientX' in evt && 'clientY' in evt) {
            const x = (evt as { clientX?: unknown }).clientX;
            const y = (evt as { clientY?: unknown }).clientY;
            if (typeof x === 'number' && typeof y === 'number') return { x, y };
        }
        if ('touches' in evt || 'changedTouches' in evt) {
            const anyEvt = evt as TouchEvent;
            const touch = anyEvt.touches?.[0] ?? anyEvt.changedTouches?.[0] ?? null;
            if (touch && typeof touch.clientX === 'number' && typeof touch.clientY === 'number') {
                return { x: touch.clientX, y: touch.clientY };
            }
        }
        return null;
    };

    const sensors = useSensors(
        useSensor(MouseSensor, {
            activationConstraint: { distance: 10 },
        }),
        useSensor(TouchSensor, {
            activationConstraint: { delay: 150, tolerance: 10 },
        })
    );

    const persistPlacement = useCallback(
        (cardId: string, payload: Record<string, unknown>, meta: PlacementMeta) => {
            setData((current) => {
                if (!current) return current;

                const nextEvents = [...current.events];
                const nextBuckets = Object.entries(current.abBuckets || {}).reduce(
                    (acc, [key, items]) => {
                        acc[key] = [...(items ?? [])];
                        return acc;
                    },
                    {} as Record<string, TimelineBucketItem[]>
                );

                let removedBucketItem: TimelineBucketItem | null = null;
                Object.values(nextBuckets).forEach((items) => {
                    const index = items.findIndex((item) => item.card_id === cardId);
                    if (index >= 0) {
                        removedBucketItem = items[index];
                        items.splice(index, 1);
                    }
                });

                let removedEvent: TimelineEvent | null = null;
                const eventIndex = nextEvents.findIndex((event) => event.card_id === cardId);
                if (eventIndex >= 0) {
                    removedEvent = nextEvents.splice(eventIndex, 1)[0];
                }

                const baseEvent = removedEvent ?? meta.sourceEvent ?? null;
                const baseBucketItem = removedBucketItem ?? meta.sourceBucketItem ?? null;

                const payloadDueDate = (payload.due_date as string | null) ?? null;

                if (meta.target === 'timeline') {
                    const nextStart = (payload.due_start as string | null) ?? baseEvent?.due_start ?? baseBucketItem?.due_start ?? null;
                    const nextEnd = (payload.due_end as string | null) ?? baseEvent?.due_end ?? baseBucketItem?.due_end ?? null;
                    const nextDate = meta.localDueDate ?? toLocalDay(payloadDueDate) ?? baseEvent?.due_date ?? baseBucketItem?.due_date ?? null;
                    const startMinutes = getMinutesFromTime(nextStart);
                    const endMinutes = getMinutesFromTime(nextEnd);
                    const durationMinutes =
                        startMinutes != null && endMinutes != null
                            ? Math.max(endMinutes - startMinutes, 15)
                            : baseEvent?.durationMinutes ?? baseEvent?.duration ?? baseBucketItem?.duration ?? meta.defaultDuration ?? 60;

                    const replacement: TimelineEvent = {
                        card_id: cardId,
                        due_date: nextDate ?? '',
                        due_start: nextStart,
                        due_end: nextEnd,
                        due_bucket: (payload.due_bucket as DueBucket | null) ?? baseEvent?.due_bucket ?? null,
                        durationMinutes,
                        title: baseEvent?.title ?? baseBucketItem?.title ?? 'Untitled card',
                        tags: baseEvent?.tags ?? baseBucketItem?.tags ?? [],
                        checklist: baseEvent?.checklist ?? baseBucketItem?.checklist ?? null,
                        priority: baseEvent?.priority ?? null,
                        checked: baseEvent?.checked ?? baseBucketItem?.checked ?? false,
                        assignee_id: baseEvent?.assignee_id ?? baseBucketItem?.assignee_id ?? null,
                        assignee_ids: baseEvent?.assignee_ids ?? baseBucketItem?.assignee_ids ?? null,
                        assigned_to: baseEvent?.assigned_to ?? baseBucketItem?.assigned_to ?? null,
                        short_id: baseEvent?.short_id ?? baseBucketItem?.short_id ?? null,
                        slug: baseEvent?.slug ?? baseBucketItem?.slug ?? null,
                    };

                    nextEvents.push(replacement);
                    nextEvents.sort((a, b) => {
                        if (a.due_date === b.due_date) {
                            const aStart = getMinutesFromTime(a.due_start) ?? 0;
                            const bStart = getMinutesFromTime(b.due_start) ?? 0;
                            return aStart - bStart;
                        }
                        return (a.due_date ?? '').localeCompare(b.due_date ?? '');
                    });

                    return { ...current, events: nextEvents, abBuckets: nextBuckets };
                }

                if (meta.target === 'bucket' && meta.bucketKey) {
                    if (!nextBuckets[meta.bucketKey]) {
                        nextBuckets[meta.bucketKey] = [];
                    }

                    const bucketItems = nextBuckets[meta.bucketKey];
                    const bucketPosition = (payload.due_bucket_position as number | null) ?? Date.now();
                    const nextBucketItem: TimelineBucketItem = {
                        card_id: cardId,
                        title: baseBucketItem?.title ?? baseEvent?.title ?? 'Untitled card',
                        due_date: meta.localDueDate ?? toLocalDay(payloadDueDate) ?? baseBucketItem?.due_date ?? null,
                        due_start: (payload.due_start as string | null) ?? null,
                        due_end: (payload.due_end as string | null) ?? null,
                        checked: baseBucketItem?.checked ?? baseEvent?.checked ?? false,
                        checklist: baseBucketItem?.checklist ?? baseEvent?.checklist ?? null,
                        tags: baseBucketItem?.tags ?? baseEvent?.tags ?? [],
                        assignee_id: baseBucketItem?.assignee_id ?? baseEvent?.assignee_id ?? null,
                        assignee_ids: baseBucketItem?.assignee_ids ?? baseEvent?.assignee_ids ?? null,
                        assigned_to: baseBucketItem?.assigned_to ?? baseEvent?.assigned_to ?? null,
                        short_id: baseBucketItem?.short_id ?? baseEvent?.short_id ?? null,
                        slug: baseBucketItem?.slug ?? baseEvent?.slug ?? null,
                        bucketPosition,
                    };

                    bucketItems.unshift(nextBucketItem);
                    bucketItems.sort((a, b) => (b.bucketPosition ?? 0) - (a.bucketPosition ?? 0));
                    return { ...current, events: nextEvents, abBuckets: nextBuckets };
                }

                return current;
            });

            if (dataMode === 'api') {
                applyPatch(cardId, payload);
            }
        },
        [applyPatch, dataMode, setData]
    );

    const handleDragStart = (event: DragStartEvent) => {
        const cardId = event.active.data.current?.cardId as string | undefined;
        if (!cardId) return;
        if (editingCardId && editingCardId === cardId) return;
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
        console.log('[timeline] drag start', { cardId, kind });
        if (kind === 'event') {
            const eventData = event.active.data.current?.event as TimelineEvent;
            const startMinutes = getMinutesFromTime(eventData?.due_start ?? null) ?? 0;
            const duration = Math.max(eventData.durationMinutes ?? eventData.duration ?? 60, 15);
            const dragState: ActiveDragState = { cardId, startMinutes, duration };
            setActiveDrag(dragState);
            activeDragRef.current = dragState;
        } else {
            const bucketItem = event.active.data.current?.item as TimelineBucketItem;
            const duration = Math.max(bucketItem?.duration ?? 60, 15);
            const dragState: ActiveDragState = { cardId, startMinutes: 9 * 60, duration };
            setActiveDrag(dragState);
            activeDragRef.current = dragState;
        }
        setPointerPreview(HIDDEN_POINTER_PREVIEW);
    };

    const [isOverABList, setIsOverABList] = useState(false);

    const resolvePointerClientY = (event: DragMoveEvent | DragEndEvent): number | null => {
        const latest = latestPointerRef.current;
        if (latest) return latest.y;
        const activeRect = event.active.rect.current;
        if (activeRect?.translated) {
            return activeRect.translated.top + (activeRect.translated.height ?? 0) / 2;
        }
        if (activeRect?.initial) {
            return activeRect.initial.top + (activeRect.initial.height ?? 0) / 2 + (event.delta?.y ?? 0);
        }
        const start = dragStartPointerRef.current;
        if (start) return start.y + (event.delta?.y ?? 0);

        const activator = event.activatorEvent as unknown;
        if (activator && typeof activator === 'object' && 'clientY' in activator) {
            const val = (activator as { clientY?: unknown }).clientY;
            if (typeof val === 'number') {
                return val;
            }
        }
        return null;
    };

    const resolvePointerClientX = (event: DragMoveEvent | DragEndEvent): number | null => {
        const latest = latestPointerRef.current;
        if (latest) return latest.x;

        const activeRect = event.active.rect.current;
        if (activeRect?.translated) {
            return activeRect.translated.left + (activeRect.translated.width ?? 0) / 2;
        }
        if (activeRect?.initial) {
            return activeRect.initial.left + (activeRect.initial.width ?? 0) / 2 + (event.delta?.x ?? 0);
        }
        const start = dragStartPointerRef.current;
        if (start) return start.x + (event.delta?.x ?? 0);
        return null;
    };

    const stopDragAutoScroll = useCallback(() => {
        const state = dragAutoScrollRef.current;
        state.velocityPxPerSecond = 0;
        state.el = null;
        state.lastTimestamp = null;
        if (state.raf != null) {
            cancelAnimationFrame(state.raf);
            state.raf = null;
        }
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
            let best: { el: HTMLDivElement; distance: number } | null = null;
            for (const el of Object.values(containers)) {
                if (!el) continue;
                const rect = el.getBoundingClientRect();
                if (!(pointerX >= rect.left && pointerX <= rect.right)) continue;
                const distance =
                    pointerY < rect.top ? rect.top - pointerY : pointerY > rect.bottom ? pointerY - rect.bottom : 0;
                if (!best || distance < best.distance) best = { el, distance };
            }
            return best?.el ?? null;
        },
        [abScrollContainersRef]
    );

    const ensureDragAutoScrollLoop = useCallback(() => {
        const state = dragAutoScrollRef.current;
        if (state.raf != null) return;

        const tick = (now: number) => {
            const current = dragAutoScrollRef.current;
            if (!activeDragRef.current || !current.el || current.velocityPxPerSecond === 0) {
                current.raf = null;
                current.lastTimestamp = null;
                return;
            }

            const last = current.lastTimestamp ?? now;
            const deltaMs = Math.max(0, Math.min(64, now - last));
            current.lastTimestamp = now;

            const maxTop = Math.max(0, current.el.scrollHeight - current.el.clientHeight);
            const deltaPx = (current.velocityPxPerSecond * deltaMs) / 1000;
            current.el.scrollTop = Math.max(0, Math.min(maxTop, current.el.scrollTop + deltaPx));
            current.raf = requestAnimationFrame(tick);
        };

        state.raf = requestAnimationFrame(tick);
    }, []);

    const updateDragAutoScroll = useCallback(
        (event: DragMoveEvent) => {
            const pointerX = resolvePointerClientX(event);
            const pointerY = resolvePointerClientY(event);
            if (pointerX == null || pointerY == null) {
                stopDragAutoScroll();
                return;
            }

            const hoveredAbEl = (() => {
                if (typeof document === 'undefined') return findAbScrollContainerAtPointer(pointerX, pointerY);
                const top = document.elementFromPoint(pointerX, pointerY);
                const match = top?.closest?.('[data-ab-scroll-container="true"]') as HTMLDivElement | null | undefined;
                return match ?? findAbScrollContainerAtPointer(pointerX, pointerY);
            })();
            const timelineEl = timelineScrollRef.current;
            const hoveredTimelineEl = (() => {
                if (!timelineEl) return null;
                if (typeof document !== 'undefined') {
                    const top = document.elementFromPoint(pointerX, pointerY);
                    if (top && timelineEl.contains(top)) return timelineEl;
                }
                const rect = timelineEl.getBoundingClientRect();
                if (
                    pointerX >= rect.left &&
                    pointerX <= rect.right &&
                    pointerY >= rect.top &&
                    pointerY <= rect.bottom
                ) {
                    return timelineEl;
                }
                return null;
            })();

            // Prefer A/B. Even if it can't scroll, don't fall through to timeline while pointer is over A/B.
            const targetEl = hoveredAbEl ?? hoveredTimelineEl ?? null;
            if (!targetEl) {
                stopDragAutoScroll();
                return;
            }

            const rect = targetEl.getBoundingClientRect();
            const threshold = Math.max(24, rect.height * 0.2);
            const topZone = rect.top + threshold;
            const bottomZone = rect.bottom - threshold;

            let velocityPxPerSecond = 0;
            const maxSpeedPxPerSecond = 240;
            const deadZoneRatio = 0.10;
            if (pointerY < topZone) {
                const intensity = Math.min(1, (topZone - pointerY) / threshold);
                if (intensity > deadZoneRatio) {
                    const t = (intensity - deadZoneRatio) / (1 - deadZoneRatio);
                    const eased = 1 - (1 - t) * (1 - t); // easeOutQuad: accelerates earlier, but stays smooth near edge entry
                    velocityPxPerSecond = -maxSpeedPxPerSecond * eased;
                }
            } else if (pointerY > bottomZone) {
                const intensity = Math.min(1, (pointerY - bottomZone) / threshold);
                if (intensity > deadZoneRatio) {
                    const t = (intensity - deadZoneRatio) / (1 - deadZoneRatio);
                    const eased = 1 - (1 - t) * (1 - t); // easeOutQuad
                    velocityPxPerSecond = maxSpeedPxPerSecond * eased;
                }
            }

            const isScrollable = targetEl.scrollHeight > targetEl.clientHeight + 1;
            const canScrollUp = targetEl.scrollTop > 0;
            const canScrollDown = targetEl.scrollTop + targetEl.clientHeight < targetEl.scrollHeight - 1;
            if (
                !isScrollable ||
                (velocityPxPerSecond < 0 && !canScrollUp) ||
                (velocityPxPerSecond > 0 && !canScrollDown)
            ) {
                velocityPxPerSecond = 0;
            }

            const state = dragAutoScrollRef.current;
            state.el = targetEl;
            state.velocityPxPerSecond = velocityPxPerSecond;
            if (velocityPxPerSecond !== 0) ensureDragAutoScrollLoop();
            else stopDragAutoScroll();
        },
        [ensureDragAutoScrollLoop, findAbScrollContainerAtPointer, stopDragAutoScroll, timelineScrollRef]
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

        const pointerX = resolvePointerClientX(event);
        const pointerY = resolvePointerClientY(event);
        const hoveredAbEl =
            pointerX != null && pointerY != null ? findAbScrollContainerAtPointer(pointerX, pointerY) : null;

        // Check if over A/B list
        const isAB = overType === 'ab-bucket' || overType === 'bucket-item' || overType === 'bucket-item-top' || overType === 'bucket-item-bottom';
        const isOverAbArea = Boolean(hoveredAbEl) || isAB;
        if (isOverAbArea !== isOverABList) {
            setIsOverABList(isOverAbArea);
        }
        updateDragAutoScroll(event);

        if (overType === 'ab-bucket') {
            const bucketKey = event.over?.data.current?.bucketKey as string | undefined;
            const items = bucketKey && data?.abBuckets ? data.abBuckets[bucketKey] ?? [] : [];
            if (bucketKey && items.length) {
                const pointerY = resolvePointerClientY(event);
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

        if (overType !== 'timeline-column') {
            if (pointerPreview.visible) {
                setPointerPreview(HIDDEN_POINTER_PREVIEW);
            }
            return;
        }
        const day = event.over?.data.current?.day as TimelineDay | undefined;
        const scrollTop = timelineScrollRef.current?.scrollTop ?? 0;
        const pointerMinutes = pointerMinutesFromEvent(event, {
            scrollTop,
            columnRect: event.over?.rect
                ? { top: event.over.rect.top, height: event.over.rect.height }
                : undefined,
            startHour: timelineStartHour,
        });
        const fallbackPointer = currentDrag.startMinutes + (event.delta.y / HOUR_HEIGHT) * 60;
        let nextStart = pointerMinutes ?? fallbackPointer;
        nextStart = Math.round(nextStart / 5) * 5;
        nextStart = Math.max(0, Math.min(23 * 60 + 55, nextStart));
        const desiredEnd = nextStart + currentDrag.duration;
        const endMinutes = Math.min(desiredEnd, 24 * 60 - 1);
        const durationMinutes = Math.max(endMinutes - nextStart, 1);
        setPointerPreview({
            visible: true,
            startMinutes: nextStart,
            durationMinutes,
            dayIso: day?.isoDate ?? null,
        });
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over, delta } = event;
        stopDragAutoScroll();
        stopPointerTracking();
        setActiveDrag(null);
        activeDragRef.current = null;
        setPointerPreview(HIDDEN_POINTER_PREVIEW);
        setIsOverABList(false);
        setBucketIndicator(null);

        if (!over) return;
        const cardId = active.data.current?.cardId as string | undefined;
        if (!cardId) return;

        const sourceEvent = active.data.current?.event as TimelineEvent | undefined;
        const sourceBucketItem = active.data.current?.item as TimelineBucketItem | undefined;

        const overType = over.data.current?.type;

        console.log('[timeline] drag end', {
            cardId,
            overType,
            from: active.data.current?.kind,
            data: active.data.current,
        });

        if (overType === 'bucket-item-top' || overType === 'bucket-item-bottom') {
            const bucketKey = over.data.current?.bucketKey as string | undefined;
            const targetCardId = over.data.current?.cardId as string | undefined;
            if (!bucketKey || !targetCardId) return;
            const bucketItems = data?.abBuckets?.[bucketKey];
            if (!bucketItems?.length) return;
            if (targetCardId === cardId && active.data.current?.bucketKey === bucketKey) {
                return;
            }
            const targetIndex = bucketItems.findIndex((item) => item.card_id === targetCardId);
            if (targetIndex === -1) return;
            const targetItem = bucketItems[targetIndex];

            let bucketPosition: number;

            if (overType === 'bucket-item-top') {
                // Insert before target (same as previous logic)
                const prevItem = bucketItems[targetIndex - 1];
                if (prevItem?.bucketPosition != null && targetItem.bucketPosition != null) {
                    bucketPosition = (prevItem.bucketPosition + targetItem.bucketPosition) / 2;
                } else if (targetItem.bucketPosition != null) {
                    bucketPosition = targetItem.bucketPosition + 1;
                } else if (prevItem?.bucketPosition != null) {
                    bucketPosition = prevItem.bucketPosition + 1;
                } else {
                    bucketPosition = Date.now();
                }
            } else {
                // Insert after target
                const nextItem = bucketItems[targetIndex + 1];
                if (targetItem.bucketPosition != null && nextItem?.bucketPosition != null) {
                    bucketPosition = (targetItem.bucketPosition + nextItem.bucketPosition) / 2;
                } else if (targetItem.bucketPosition != null) {
                    bucketPosition = targetItem.bucketPosition - 1000; // Arbitrary gap
                } else {
                    bucketPosition = Date.now();
                }
            }

            const dayIso = bucketDayMap[bucketKey] ?? null;
            const payload = {
                due_bucket: bucketKey.split('_')[1] as DueBucket, // Extract 'a' or 'b' from '<day>_a' style keys
                due_date: withJstMidnight(dayIso),
                due_start: null,
                due_end: null,
                due_bucket_position: bucketPosition,
            };
            console.debug('[timeline] drop into bucket-item', { cardId, bucketKey, bucketPosition, overType });
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
            const day = over.data.current?.day as TimelineDay | undefined;
            if (!day) return;
            const scrollTop = timelineScrollRef.current?.scrollTop ?? 0;
            const pointerMinutes = pointerMinutesFromEvent(event, {
                scrollTop,
                columnRect: over.rect ? { top: over.rect.top, height: over.rect.height } : undefined,
            });
            const fallbackPointer = activeDrag.startMinutes + (delta.y / HOUR_HEIGHT) * 60;
            let nextStart = pointerMinutes ?? fallbackPointer;
            nextStart = Math.round(nextStart / 5) * 5;
            nextStart = Math.max(0, Math.min(23 * 60 + 55, nextStart));
            let nextEnd = nextStart + activeDrag.duration;

            // Preserve due_bucket from source card
            let sourceDueBucket: DueBucket | null = null;

            // Priority 1: Get bucket from source event (timeline to timeline)
            if (sourceEvent?.due_bucket) {
                sourceDueBucket = sourceEvent.due_bucket as DueBucket;
                console.debug('[timeline] Preserving bucket from timeline event:', sourceDueBucket);
            }
            // Priority 2: Get bucket from source bucket item (A/B list to timeline)
            else if (sourceBucketItem && active.data.current?.bucketKey) {
                const bucketKey = active.data.current.bucketKey as string;
                sourceDueBucket = bucketKey.split('_')[1] as DueBucket;
                console.debug('[timeline] Extracting bucket from A/B list:', { bucketKey, extracted: sourceDueBucket });
            }
            // Priority 3: If still no bucket, log warning
            else {
                console.warn('[timeline] No source bucket found, will be set to null', {
                    hasSourceEvent: !!sourceEvent,
                    hasSourceBucketItem: !!sourceBucketItem,
                    sourceEventBucket: sourceEvent?.due_bucket,
                    bucketKey: active.data.current?.bucketKey,
                });
            }

            const payload = {
                due_bucket: sourceDueBucket,
                due_date: withJstMidnight(day.isoDate),
                due_start: minutesToTime(nextStart),
                due_end: minutesToTime(Math.min(nextEnd, 24 * 60 - 1)),
                due_bucket_position: sourceEvent?.due_bucket_position ?? sourceBucketItem?.bucketPosition ?? null,
            };
            console.debug('[timeline] drop into timeline', {
                cardId,
                day: day.isoDate,
                start: nextStart,
                preservedBucket: sourceDueBucket,
                sourceType: sourceEvent ? 'event' : sourceBucketItem ? 'bucket-item' : 'unknown'
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
            const bucketKey = over.data.current?.bucketKey as string;
            const dayIso = bucketDayMap[bucketKey] ?? null;
            const bucketItems = data?.abBuckets?.[bucketKey] ?? [];
            const fallbackTargetCardId =
                bucketIndicator?.bucketKey === bucketKey ? bucketIndicator.cardId : bucketItems[0]?.card_id ?? null;

            let bucketPosition = Date.now();
            if (fallbackTargetCardId && bucketItems.length) {
                const targetIndex = bucketItems.findIndex((item) => item.card_id === fallbackTargetCardId);
                const targetItem = targetIndex >= 0 ? bucketItems[targetIndex] : null;
                const nextItem = targetIndex >= 0 ? bucketItems[targetIndex + 1] : null;
                if (targetItem?.bucketPosition != null && nextItem?.bucketPosition != null) {
                    bucketPosition = (targetItem.bucketPosition + nextItem.bucketPosition) / 2;
                } else if (targetItem?.bucketPosition != null) {
                    bucketPosition = targetItem.bucketPosition - 1000; // place after the target item
                }
            }
            const payload = {
                due_bucket: bucketKey.split('_')[1] as DueBucket, // Extract 'a' or 'b'
                due_date: withJstMidnight(dayIso),
                due_start: null,
                due_end: null,
                due_bucket_position: bucketPosition,
            };
            console.debug('[timeline] drop into bucket', { cardId, bucketKey, bucketPosition });
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
        const deltaMinutes = Math.round((deltaY / HOUR_HEIGHT) * 60 / 5) * 5;

        if (activeResize.edge === 'bottom') {
            const newDuration = Math.max(5, activeResize.originalDuration + deltaMinutes);
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
            if (newDuration < 5) {
                newDuration = 5;
                newStart = activeResize.originalStartMinutes + activeResize.originalDuration - 5;
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
    }, [activeResize]);

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
