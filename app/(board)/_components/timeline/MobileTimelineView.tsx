"use client";

import { useMemo } from "react";
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
    activeDayIndex: number;
    onPrevDay: () => void;
    onNextDay: () => void;
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

export default function MobileTimelineView({
    days,
    activeDayIndex,
    onPrevDay,
    onNextDay,
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
    const activeDay = useMemo(() => days[activeDayIndex] ?? days[0] ?? null, [activeDayIndex, days]);
    const activeAbBuckets = useMemo(() => {
        if (!activeDay) return {} as Record<string, TimelineBucketItem[]>;
        return Object.entries(abBuckets).reduce((acc, [key, items]) => {
            if (key.startsWith(activeDay.key)) {
                acc[key] = items;
            }
            return acc;
        }, {} as Record<string, TimelineBucketItem[]>);
    }, [abBuckets, activeDay]);

    if (!activeDay) return null;

    const abMeta = buildAbMeta(activeDay);
    const aSection = abMeta.sections.find(s => s.bucket.endsWith('_a'));

    return (
        <div className="flex h-full flex-col bg-white">
            <div className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-100 bg-white px-3 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <button
                    type="button"
                    aria-label="前の日"
                    disabled={status === 'loading'}
                    onClick={(e) => { e.preventDefault(); onPrevDay(); }}
                    className="p-1.5 rounded border border-slate-300 bg-white hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                    <svg className="w-4 h-4 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                </button>
                <div className="flex items-center gap-1 text-slate-800">
                    <span>{activeDay.label}</span>
                    <span className="text-[10px] text-slate-400 normal-case tracking-normal">{activeDay.isoDate} · GMT+09</span>
                </div>
                <button
                    type="button"
                    aria-label="次の日"
                    disabled={status === 'loading'}
                    onClick={(e) => { e.preventDefault(); onNextDay(); }}
                    className="p-1.5 rounded border border-slate-300 bg-white hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                    <svg className="w-4 h-4 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                </button>
            </div>

            <div
                className="grid flex-1 overflow-y-auto"
                style={{ gridTemplateColumns: '55% 45%' }}
            >
                <div className="overflow-hidden min-w-0">
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
                <div className="overflow-hidden border-l border-slate-100 min-w-0">
                    <div className="px-3 py-2">
                        {aSection && (
                            <>
                                <p className="text-[11px] text-slate-600">{aSection.label}</p>
                                <p className="text-[10px] text-slate-400">{aSection.helper}</p>
                            </>
                        )}
                    </div>
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
        </div>
    );
}
