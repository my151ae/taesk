"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence, PanInfo } from "framer-motion";
import {
    TimelineDay,
    TimelineEvent,
    TimelineBucketItem,
} from "@/app/(board)/_utils/timeline-helpers";
import TimelineGrid from "@/app/(board)/_components/timeline/TimelineGrid";
import TimelineBuckets from "@/app/(board)/_components/timeline/TimelineBuckets";
import { ActiveResizeState } from "@/app/(board)/_hooks/useTimelineDragAndDrop";

type ActiveDragState = {
    cardId: string;
    startMinutes: number;
    duration: number;
};

type PointerPreviewState = {
    visible: boolean;
    startMinutes: number;
    durationMinutes: number;
    dayIso: string | null;
};

type MobileTimelineViewProps = {
    days: TimelineDay[];
    eventsByDay: Record<string, TimelineEvent[]>;
    abBuckets: Record<string, TimelineBucketItem[]>;
    indicatorTop: number | null;
    indicatorDayIso: string | null;
    timelineViewportHeight: number;
    activeDrag: ActiveDragState | null;
    pointerPreview: PointerPreviewState;
    activeResize: ActiveResizeState | null;
    openCardModal: (shortId: string | null, source: string) => void;
    handleEventKeyDown: (event: TimelineEvent, native: React.KeyboardEvent<HTMLElement>) => void;
    handleColumnClick: (day: TimelineDay, minutes: number) => void;
    handleResizeStart: (e: React.PointerEvent, cardId: string, startMinutes: number, duration: number, edge: 'top' | 'bottom') => void;
    handleResizeMove: (e: React.PointerEvent) => void;
    handleResizeEnd: (e: React.PointerEvent) => void;
    onToggleCheck: (cardId: string, checked: boolean) => void;
    status: string;
    floatingLayerTop: number;
};

const SWIPE_THRESHOLD = 50;

export default function MobileTimelineView({
    days,
    eventsByDay,
    abBuckets,
    indicatorTop,
    indicatorDayIso,
    timelineViewportHeight,
    activeDrag,
    pointerPreview,
    activeResize,
    openCardModal,
    handleEventKeyDown,
    handleColumnClick,
    handleResizeStart,
    handleResizeMove,
    handleResizeEnd,
    onToggleCheck,
    status,
    floatingLayerTop,
}: MobileTimelineViewProps) {
    const [activeDayIndex, setActiveDayIndex] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);

    // Ensure activeDayIndex is valid
    useEffect(() => {
        if (activeDayIndex >= days.length) {
            setActiveDayIndex(0);
        }
    }, [days.length, activeDayIndex]);

    const activeDay = days[activeDayIndex];

    const handleDragEnd = (event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
        const offset = info.offset.x;
        const velocity = info.velocity.x;

        if (offset < -SWIPE_THRESHOLD || velocity < -500) {
            // Swipe left -> Next day
            if (activeDayIndex < days.length - 1) {
                setActiveDayIndex((prev) => prev + 1);
            }
        } else if (offset > SWIPE_THRESHOLD || velocity > 500) {
            // Swipe right -> Previous day
            if (activeDayIndex > 0) {
                setActiveDayIndex((prev) => prev - 1);
            }
        }
    };

    if (!activeDay) return null;

    // Filter buckets for the active day
    const activeAbBuckets = Object.entries(abBuckets).reduce((acc, [key, items]) => {
        if (key.startsWith(activeDay.key)) {
            acc[key] = items;
        }
        return acc;
    }, {} as Record<string, TimelineBucketItem[]>);

    return (
        <div className="relative h-full overflow-hidden" ref={containerRef}>
            {/* Day Indicator / Navigation Dots could go here if needed */}
            <div className="flex justify-center gap-2 py-2">
                {days.map((day, index) => (
                    <div
                        key={day.key}
                        className={`h-2 w-2 rounded-full transition-colors ${index === activeDayIndex ? "bg-sky-500" : "bg-slate-300"
                            }`}
                    />
                ))}
            </div>

            <AnimatePresence initial={false} mode="wait">
                <motion.div
                    key={activeDay.key}
                    initial={{ x: 0, opacity: 1 }} // Start at center
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: 0, opacity: 0 }} // Fade out in place
                    transition={{
                        x: { type: "spring", stiffness: 300, damping: 30 },
                        opacity: { duration: 0.2 }
                    }}
                    drag="x"
                    dragConstraints={{ left: 0, right: 0 }}
                    dragElastic={0.2}
                    onDragEnd={handleDragEnd}
                    className="h-full w-full"
                >
                    <div className="relative h-full">
                        {/* We render TimelineBuckets and TimelineGrid for the SINGLE active day */}
                        {/* Note: TimelineBuckets/Grid expect arrays, so we pass single-item arrays */}
                        <TimelineBuckets
                            days={[activeDay]}
                            abBuckets={activeAbBuckets}
                            floatingLayerTop={floatingLayerTop}
                            status={status}
                            openCardModal={openCardModal}
                            onToggleCheck={onToggleCheck}
                        />
                        <TimelineGrid
                            days={[activeDay]}
                            eventsByDay={eventsByDay} // Grid handles filtering by day internally
                            indicatorTop={indicatorTop}
                            indicatorDayIso={indicatorDayIso}
                            timelineViewportHeight={timelineViewportHeight}
                            activeDrag={activeDrag}
                            pointerPreview={pointerPreview}
                            activeResize={activeResize}
                            openCardModal={openCardModal}
                            handleEventKeyDown={handleEventKeyDown}
                            handleColumnClick={handleColumnClick}
                            handleResizeStart={handleResizeStart}
                            handleResizeMove={handleResizeMove}
                            handleResizeEnd={handleResizeEnd}
                            onToggleCheck={onToggleCheck}
                        />
                    </div>
                </motion.div>
            </AnimatePresence>
        </div>
    );
}
