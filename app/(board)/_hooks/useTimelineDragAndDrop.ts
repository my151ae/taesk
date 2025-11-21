import {
    useSensor,
    useSensors,
    PointerSensor,
    DragStartEvent,
    DragMoveEvent,
    DragEndEvent,
    DragCancelEvent,
    UniqueIdentifier,
    CollisionDetection,
    pointerWithin,
    rectIntersection,
} from '@dnd-kit/core';
import { useState, useRef, useCallback } from 'react';
import {
    TimelineEvent,
    TimelineBucketItem,
    TimelineDay,
    HOUR_HEIGHT,
    TIMELINE_HEIGHT,
    minuteToPixels,
    getMinutesFromTime,
    withJstMidnight,
    toLocalDay,
    AXIS_WIDTH,
    minutesToTime,
} from '@/app/(board)/_utils/timeline-helpers';

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

export type PlacementMeta = {
    target: 'timeline' | 'bucket';
    bucketKey?: string;
    sourceEvent?: TimelineEvent;
    sourceBucketItem?: TimelineBucketItem;
    defaultDuration?: number;
    localDueDate?: string | null;
};

type UseTimelineDragAndDropProps = {
    persistPlacement: (
        cardId: string,
        payload: any,
        meta: PlacementMeta
    ) => void;
    timelineScrollRef: React.RefObject<HTMLDivElement>;
    bucketDayMap: Record<string, string | null>;
};

export function useTimelineDragAndDrop({
    persistPlacement,
    timelineScrollRef,
    bucketDayMap,
}: UseTimelineDragAndDropProps) {
    const [activeDrag, setActiveDrag] = useState<ActiveDragState | null>(null);
    const activeDragRef = useRef<ActiveDragState | null>(null);
    const [pointerPreview, setPointerPreview] = useState<PointerPreviewState>(HIDDEN_POINTER_PREVIEW);

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: { distance: 5 },
        })
    );

    const handleDragStart = (event: DragStartEvent) => {
        const cardId = event.active.data.current?.cardId as string | undefined;
        if (!cardId) return;
        const kind = event.active.data.current?.kind as 'event' | 'bucket';
        console.log('[timeline] drag start', { cardId, kind });
        if (kind === 'event') {
            const eventData = event.active.data.current?.event as TimelineEvent;
            const startMinutes = getMinutesFromTime(eventData?.due_start ?? null) ?? 0;
            const duration = Math.max(eventData.durationMinutes ?? 60, 15);
            const dragState: ActiveDragState = { cardId, startMinutes, duration };
            setActiveDrag(dragState);
            activeDragRef.current = dragState;
        } else {
            const dragState: ActiveDragState = { cardId, startMinutes: 9 * 60, duration: 60 };
            setActiveDrag(dragState);
            activeDragRef.current = dragState;
        }
        setPointerPreview(HIDDEN_POINTER_PREVIEW);
    };

    const pointerMinutesFromEvent = (
        event: DragEndEvent | DragMoveEvent,
        options?: {
            scrollTop?: number;
            columnRect?: { top: number; height: number };
        }
    ): number | null => {
        const scrollTop = options?.scrollTop ?? 0;
        const columnRect = options?.columnRect;
        const translated = event.active.rect.current?.translated;
        const sourceInitial = event.active.rect.current?.initial;
        const elementTop = translated?.top ?? (sourceInitial ? sourceInitial.top + event.delta.y : null);
        if (elementTop == null) return null;

        let relativeY: number;
        if (columnRect) {
            relativeY = elementTop - columnRect.top;
        } else {
            relativeY = elementTop - AXIS_WIDTH + scrollTop;
        }

        const maxHeight = columnRect?.height ?? TIMELINE_HEIGHT;
        const clamped = Math.max(0, Math.min(relativeY, maxHeight));
        const minutes = Math.round((clamped / HOUR_HEIGHT) * 60 / 15) * 15;
        return Math.max(0, Math.min(23 * 60 + 45, minutes));
    };

    const handleDragMove = (event: DragMoveEvent) => {
        const currentDrag = activeDragRef.current;
        if (!currentDrag) {
            if (pointerPreview.visible) {
                setPointerPreview(HIDDEN_POINTER_PREVIEW);
            }
            return;
        }
        const overType = event.over?.data.current?.type;
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
        });
        const fallbackPointer = currentDrag.startMinutes + (event.delta.y / HOUR_HEIGHT) * 60;
        let nextStart = pointerMinutes ?? fallbackPointer;
        nextStart = Math.round(nextStart / 15) * 15;
        nextStart = Math.max(0, Math.min(23 * 60 + 45, nextStart));
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
        setActiveDrag(null);
        activeDragRef.current = null;
        setPointerPreview(HIDDEN_POINTER_PREVIEW);

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
            to: overType,
        });

        if (overType === 'timeline-column') {
            const dayIso = over.data.current?.dayIso as string;
            const scrollTop = timelineScrollRef.current?.scrollTop ?? 0;
            const pointerMinutes = pointerMinutesFromEvent(event, {
                scrollTop,
                columnRect: over.rect ? { top: over.rect.top, height: over.rect.height } : undefined,
            });

            // Fallback if pointerMinutes fails (shouldn't happen if over column)
            // But let's use the same logic as dragMove
            const currentDrag = activeDrag; // Note: activeDrag is null here because we set it to null above. 
            // We should use a local var or the one from closure if we didn't set it to null yet.
            // Actually we set it to null at start of function.
            // We need to capture it before setting to null?
            // Or just re-calculate.
            // The `activeDrag` state is null, but `activeDragRef` was null too.
            // Wait, we need the drag state to know duration.
            // We can get duration from sourceEvent or sourceBucketItem or just calculate.

            // Let's fix the ordering.
        }
    };

    // Re-implement handleDragEnd correctly
    const handleDragEndCorrect = (event: DragEndEvent) => {
        const { active, over } = event;
        const currentDrag = activeDragRef.current; // Capture before clearing

        setActiveDrag(null);
        activeDragRef.current = null;
        setPointerPreview(HIDDEN_POINTER_PREVIEW);

        if (!over || !currentDrag) return;
        const cardId = active.data.current?.cardId as string | undefined;
        if (!cardId) return;

        const sourceEvent = active.data.current?.event as TimelineEvent | undefined;
        const sourceBucketItem = active.data.current?.item as TimelineBucketItem | undefined;
        const overType = over.data.current?.type;

        if (overType === 'timeline-column') {
            const dayIso = over.data.current?.dayIso as string;
            const scrollTop = timelineScrollRef.current?.scrollTop ?? 0;
            const pointerMinutes = pointerMinutesFromEvent(event, {
                scrollTop,
                columnRect: over.rect ? { top: over.rect.top, height: over.rect.height } : undefined,
            });

            let nextStart = pointerMinutes ?? currentDrag.startMinutes;
            nextStart = Math.round(nextStart / 15) * 15;
            nextStart = Math.max(0, Math.min(23 * 60 + 45, nextStart));

            // Calculate end
            const duration = currentDrag.duration;
            const nextEnd = Math.min(nextStart + duration, 24 * 60 - 1);

            const payload = {
                due_channel: 'timeline',
                due_bucket: null,
                due_date: withJstMidnight(dayIso),
                due_start: minutesToTime(nextStart),
                due_end: minutesToTime(nextEnd),
                due_bucket_position: null,
            };

            console.debug('[timeline] drop onto timeline', { cardId, dayIso, nextStart, nextEnd });
            persistPlacement(cardId, payload, {
                target: 'timeline',
                sourceEvent,
                sourceBucketItem,
                defaultDuration: duration,
                localDueDate: dayIso,
            });
        } else if (overType === 'ab-bucket' || overType === 'bucket-item') {
            const bucketKey = (over.data.current?.bucketKey as string) || (over.data.current?.bucketKey as string);
            if (!bucketKey) return;

            const dayIso = bucketDayMap[bucketKey] ?? null;
            const bucketPosition = Date.now();
            const payload = {
                due_channel: 'ab-list',
                due_bucket: bucketKey,
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
                defaultDuration: currentDrag.duration,
            });
        }
    };

    const handleDragCancel = (event: DragCancelEvent) => {
        setActiveDrag(null);
        activeDragRef.current = null;
        setPointerPreview(HIDDEN_POINTER_PREVIEW);
    };

    const bucketsFirstCollisionDetection: CollisionDetection = (args) => {
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
            return type === 'bucket-item' || type === 'ab-bucket';
        });

        if (bucketCollisions.length) {
            return bucketCollisions;
        }

        return pointerCollisions;
    };

    return {
        sensors,
        activeDrag,
        pointerPreview,
        handleDragStart,
        handleDragMove,
        handleDragEnd: handleDragEndCorrect,
        handleDragCancel,
        bucketsFirstCollisionDetection,
    };
}
