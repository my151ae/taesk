"use client";

import { useMemo } from 'react';
import clsx from 'clsx';
import {
    TimelineDay,
    TimelineEvent,
    TimelineBucketItem,
    formatDayLabel,
    formatDuration,
    ExternalCalendarEntry,
    minutesToTime
} from '@/app/(board)/_utils/timeline-helpers';

type MobileListViewProps = {
    days: TimelineDay[];
    eventsByDay: Record<string, TimelineEvent[]>;
    abBuckets: Record<string, TimelineBucketItem[]>;
    calendarEventsByDay: Record<string, ExternalCalendarEntry[]>;
    calendarAllDayEventsByDay: Record<string, ExternalCalendarEntry[]>;
    openCardModal: (shortId: string | null, source: string) => void;
    onToggleCheck: (cardId: string, checked: boolean) => void;
    onExternalEventClick?: (entry: ExternalCalendarEntry) => void;
    onCardContextMenu?: (e: React.MouseEvent, cardId: string) => void;
};

export default function MobileListView({
    days,
    eventsByDay,
    abBuckets,
    calendarEventsByDay,
    calendarAllDayEventsByDay,
    openCardModal,
    onToggleCheck,
    onExternalEventClick,
    onCardContextMenu,
}: MobileListViewProps) {
    const daysWithEvents = useMemo(() => {
        return days.filter(day => {
            const hasTimelineEvents = (eventsByDay[day.isoDate]?.length ?? 0) > 0;
            const hasAbItems = (abBuckets[`${day.key}_a`]?.length ?? 0) > 0 ||
                (abBuckets[`${day.key}_b`]?.length ?? 0) > 0;
            const hasGoogleEvents = (calendarEventsByDay[day.isoDate]?.length ?? 0) > 0 ||
                (calendarAllDayEventsByDay[day.isoDate]?.length ?? 0) > 0;
            return hasTimelineEvents || hasAbItems || hasGoogleEvents;
        });
    }, [days, eventsByDay, abBuckets, calendarEventsByDay, calendarAllDayEventsByDay]);

    if (daysWithEvents.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
                <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4 text-2xl">📅</div>
                <p className="text-slate-500 font-medium">予定が入っている日はありません</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col pb-20 animate-in fade-in slide-in-from-bottom-2 duration-300">
            {daysWithEvents.map((day) => {
                const timelineEvents = eventsByDay[day.isoDate] || [];
                const bucketA = abBuckets[`${day.key}_a`] || [];
                const bucketB = abBuckets[`${day.key}_b`] || [];

                const allTimelineEvents = [...timelineEvents].sort((a, b) => {
                    const aStart = a.due_start || '00:00';
                    const bStart = b.due_start || '00:00';
                    return aStart.localeCompare(bStart);
                });

                return (
                    <div key={day.isoDate} className="mb-8 last:mb-0">
                        {/* Day Header */}
                        <div className="sticky top-0 z-10 bg-[#f4f5f7]/95 backdrop-blur-sm px-4 py-2 border-b border-slate-100 flex items-baseline gap-2">
                            <span className="text-lg font-bold text-slate-900">{day.isoDate.split('-')[2]}</span>
                            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{formatDayLabel(day.isoDate)}</span>
                        </div>

                        <div className="px-4 mt-3 space-y-2">
                            {/* Timeline Events */}
                            {allTimelineEvents.map((event) => (
                                <div
                                    key={event.card_id}
                                    onClick={() => openCardModal(event.short_id, 'mobile-list-view')}
                                    className="flex flex-col gap-1 p-3 bg-white rounded-xl shadow-sm border border-slate-50 ring-1 ring-black/5 active:scale-[0.98] transition-transform"
                                >
                                    <div className="flex justify-between items-center">
                                        <div
                                            className="flex items-center gap-1 min-w-0 flex-1 mr-2"
                                            onContextMenu={(e) => {
                                                e.preventDefault();
                                                onCardContextMenu?.(e as unknown as React.MouseEvent, event.card_id);
                                            }}
                                        >
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onToggleCheck(event.card_id, !event.checked);
                                                }}
                                                className="p-1 -ml-1 hover:bg-slate-100 rounded-md transition-colors"
                                            >
                                                <div className={clsx(
                                                    "w-4 h-4 rounded-md border-2 flex items-center justify-center transition-all",
                                                    event.checked
                                                        ? "bg-slate-400 border-slate-400"
                                                        : "bg-white border-slate-300"
                                                )}>
                                                    {event.checked && (
                                                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                        </svg>
                                                    )}
                                                </div>
                                            </button>
                                            <div className={clsx(
                                                "text-sm font-semibold transition-colors truncate pt-[2px]",
                                                event.checked ? "text-slate-400 line-through" : "text-slate-800"
                                            )}>
                                                {event.title || 'Untitled'}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            {(event.duration || event.durationMinutes) && (
                                                <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded">
                                                    {formatDuration((event.duration || event.durationMinutes)!)}
                                                </span>
                                            )}
                                            <span className="text-[10px] font-bold text-slate-400 whitespace-nowrap">
                                                {event.due_start?.slice(0, 5) ?? '--:--'}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            ))}

                            {/* Google Events */}
                            {([...(calendarAllDayEventsByDay[day.isoDate] || []), ...(calendarEventsByDay[day.isoDate] || [])]).map((gEvent) => (
                                <div
                                    key={gEvent.id}
                                    onClick={() => onExternalEventClick?.(gEvent)}
                                    className="flex flex-col gap-1 p-3 bg-white rounded-xl shadow-sm border border-emerald-50 ring-1 ring-emerald-500/10 active:scale-[0.98] transition-transform"
                                >
                                    <div className="flex justify-between items-center">
                                        <div className="flex items-center gap-1.5">
                                            <div className="w-2 h-2 rounded-full bg-emerald-500" />
                                            <span className="text-[10px] font-bold text-emerald-600">
                                                {gEvent.isAllDay ? 'All Day' : (
                                                    `${minutesToTime(gEvent.startMinutes).slice(0, 5)} - ${minutesToTime(gEvent.startMinutes + gEvent.durationMinutes).slice(0, 5)}`
                                                )}
                                            </span>
                                        </div>
                                        <span className="text-[9px] font-bold text-emerald-500 bg-emerald-50 px-1.5 py-0.5 rounded uppercase">
                                            Google
                                        </span>
                                    </div>
                                    <div className="text-sm font-semibold text-slate-800">
                                        {gEvent.title}
                                    </div>
                                </div>
                            ))}

                            {/* A/B Items unified style */}
                            {(bucketA.length > 0 || bucketB.length > 0) && (
                                <div className="space-y-2 pt-1">
                                    {/* Bucket A */}
                                    {bucketA.map(item => (
                                        <div
                                            key={item.card_id}
                                            onClick={() => openCardModal(item.short_id, 'mobile-list-view')}
                                            className="flex flex-col gap-1 p-3 bg-white rounded-xl shadow-sm border border-slate-50 ring-1 ring-black/5 active:scale-[0.98] transition-transform"
                                        >
                                            <div className="flex justify-between items-center">
                                                <div
                                                    className="flex items-center gap-1 min-w-0 flex-1 mr-2"
                                                    onContextMenu={(e) => {
                                                        e.preventDefault();
                                                        onCardContextMenu?.(e as unknown as React.MouseEvent, item.card_id);
                                                    }}
                                                >
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onToggleCheck(item.card_id, !item.checked);
                                                        }}
                                                        className="p-1 -ml-1 hover:bg-slate-100 rounded-md transition-colors"
                                                    >
                                                        <div className={clsx(
                                                            "w-4 h-4 rounded-md border-2 flex items-center justify-center transition-all",
                                                            item.checked
                                                                ? "bg-slate-400 border-slate-400"
                                                                : "bg-white border-slate-300"
                                                        )}>
                                                            {item.checked && (
                                                                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                                </svg>
                                                            )}
                                                        </div>
                                                    </button>
                                                    <div className={clsx(
                                                        "text-sm font-semibold transition-colors truncate ml-0.5 pt-[2px]",
                                                        item.checked ? "text-slate-400 line-through" : "text-slate-800"
                                                    )}>
                                                        {item.title || 'Untitled'}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    {item.duration && (
                                                        <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded uppercase">
                                                            {formatDuration(item.duration)}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                    {/* Bucket B */}
                                    {bucketB.map(item => (
                                        <div
                                            key={item.card_id}
                                            onClick={() => openCardModal(item.short_id, 'mobile-list-view')}
                                            className="flex flex-col gap-1 p-3 bg-white rounded-xl shadow-sm border border-slate-50 ring-1 ring-black/5 active:scale-[0.98] transition-transform"
                                        >
                                            <div className="flex justify-between items-center">
                                                <div
                                                    className="flex items-center gap-1 min-w-0 flex-1 mr-2"
                                                    onContextMenu={(e) => {
                                                        e.preventDefault();
                                                        onCardContextMenu?.(e as unknown as React.MouseEvent, item.card_id);
                                                    }}
                                                >
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onToggleCheck(item.card_id, !item.checked);
                                                        }}
                                                        className="p-1 -ml-1 hover:bg-slate-100 rounded-md transition-colors"
                                                    >
                                                        <div className={clsx(
                                                            "w-4 h-4 rounded-md border-2 flex items-center justify-center transition-all",
                                                            item.checked
                                                                ? "bg-slate-400 border-slate-400"
                                                                : "bg-white border-slate-300"
                                                        )}>
                                                            {item.checked && (
                                                                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                                </svg>
                                                            )}
                                                        </div>
                                                    </button>
                                                    <div className={clsx(
                                                        "text-sm font-semibold transition-colors truncate ml-0.5 pt-[2px]",
                                                        item.checked ? "text-slate-400 line-through" : "text-slate-800"
                                                    )}>
                                                        {item.title || 'Untitled'}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    {item.duration && (
                                                        <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded uppercase">
                                                            {formatDuration(item.duration)}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
