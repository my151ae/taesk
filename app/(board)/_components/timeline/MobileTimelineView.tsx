"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    TimelineDay,
    TimelineEvent,
    TimelineBucketItem,
    buildAbMeta,
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
    const [touchStart, setTouchStart] = useState<number | null>(null);
    const [touchEnd, setTouchEnd] = useState<number | null>(null);

    // Ensure activeDayIndex is valid
    useEffect(() => {
        if (activeDayIndex >= days.length) {
            setActiveDayIndex(0);
        }
    }, [days.length, activeDayIndex]);

    const activeDay = days[activeDayIndex];

    // Handle swipe without drag animation
    const minSwipeDistance = 50;

    const onTouchStart = (e: React.TouchEvent) => {
        setTouchEnd(null);
        setTouchStart(e.targetTouches[0].clientX);
    };

    const onTouchMove = (e: React.TouchEvent) => {
        setTouchEnd(e.targetTouches[0].clientX);
    };

    const onTouchEnd = () => {
        if (!touchStart || !touchEnd) return;

        const distance = touchStart - touchEnd;
        const isLeftSwipe = distance > minSwipeDistance;
        const isRightSwipe = distance < -minSwipeDistance;

        if (isLeftSwipe && activeDayIndex < days.length - 1) {
            setActiveDayIndex((prev) => prev + 1);
        }
        if (isRightSwipe && activeDayIndex > 0) {
            setActiveDayIndex((prev) => prev - 1);
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

    // Get A/B header labels
    const abMeta = buildAbMeta(activeDay);
    const aSection = abMeta.sections.find(s => s.bucket.endsWith('_a'));

    return (
        <div className="relative h-full overflow-hidden" ref={containerRef}>
            {/* Dynamic Mobile Header - matches PC layout */}
            <div className="z-30 grid border-b border-slate-100 bg-white text-xs font-semibold uppercase tracking-wide text-slate-500"
                style={{ gridTemplateColumns: '45px 1fr 1fr' }}
            >
                <div className="flex items-end justify-start border-r border-slate-100 px-2 py-3 text-left">
                    <span className="leading-none text-[10px]">GMT+09</span>
                </div>
                <div className="px-3 py-3 text-center border-r border-slate-100">
                    <p className="text-slate-800">{activeDay.label}</p>
                    <p className="text-[10px] text-slate-400">{activeDay.isoDate}</p>
                </div>
                <div className="px-3 py-3 text-left">
                    {aSection && (
                        <>
                            <p className="text-[11px] text-slate-600">{aSection.label}</p>
                            <p className="text-[10px] text-slate-400">{aSection.helper}</p>
                        </>
                    )}
                </div>
            </div>

            <AnimatePresence initial={false} mode="wait">
                <motion.div
                    key={activeDay.key}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="h-full w-full overflow-hidden"
                    onTouchStart={onTouchStart}
                    onTouchMove={onTouchMove}
                    onTouchEnd={onTouchEnd}
                >
                    <div className="relative h-full grid overflow-hidden" style={{ gridTemplateColumns: '1fr 1fr' }}>
                        {/* Timeline Grid (includes axis internally) */}
                        <div className="overflow-hidden">
                            <TimelineGrid
                                days={[activeDay]}
                                eventsByDay={eventsByDay}
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
                                axisWidth={45}
                            />
                        </div>
                        {/* A/B List (right side, fixed) */}
                        <div className="overflow-hidden border-l border-slate-100">
                            <TimelineBuckets
                                days={[activeDay]}
                                abBuckets={activeAbBuckets}
                                floatingLayerTop={floatingLayerTop}
                                status={status}
                                openCardModal={openCardModal}
                                onToggleCheck={onToggleCheck}
                                axisWidth={0}
                            />
                        </div>
                    </div>
                </motion.div>
            </AnimatePresence>
        </div>
    );
}
