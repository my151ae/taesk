"use client";

import { useMemo } from 'react';
import clsx from 'clsx';
import {
    TimelineDay,
    TimelineEvent,
    TimelineBucketItem,
    formatDayLabel,
    timeLabel,
    minutesToTime,
    formatDuration
} from '@/app/(board)/_utils/timeline-helpers';

type DesktopListViewProps = {
    days: TimelineDay[];
    eventsByDay: Record<string, TimelineEvent[]>;
    abBuckets: Record<string, TimelineBucketItem[]>;
    openCardModal: (shortId: string | null, source: string) => void;
    onToggleCheck: (cardId: string, checked: boolean) => void;
};

export function DesktopListView({
    days,
    eventsByDay,
    abBuckets,
    openCardModal,
    onToggleCheck,
}: DesktopListViewProps) {
    const daysWithEvents = useMemo(() => {
        return days.filter(day => {
            const hasTimelineEvents = (eventsByDay[day.isoDate]?.length ?? 0) > 0;
            const hasAbItems = (abBuckets[`${day.key}_a`]?.length ?? 0) > 0 ||
                (abBuckets[`${day.key}_b`]?.length ?? 0) > 0;
            return hasTimelineEvents || hasAbItems;
        });
    }, [days, eventsByDay, abBuckets]);

    if (daysWithEvents.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 bg-white rounded-2xl border border-dashed border-slate-200">
                <p className="text-slate-400 text-sm font-medium">予定が入っている日はありません</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-6 px-4 pb-20">
            {daysWithEvents.map((day) => {
                const timelineEvents = eventsByDay[day.isoDate] || [];
                const bucketA = abBuckets[`${day.key}_a`] || [];
                const bucketB = abBuckets[`${day.key}_b`] || [];

                // Combine and sort events
                const allDayEvents = [...timelineEvents].sort((a, b) => {
                    const aStart = a.due_start || '00:00';
                    const bStart = b.due_start || '00:00';
                    return aStart.localeCompare(bStart);
                });

                return (
                    <div key={day.isoDate} className="flex gap-6 group">
                        {/* Day Column */}
                        <div className="w-32 shrink-0 pt-2">
                            <div className="sticky top-6">
                                <div className={clsx(
                                    "text-2xl font-bold transition-colors",
                                    day.label === 'Today' ? "text-sky-600" : "text-slate-900"
                                )}>
                                    {day.isoDate.split('-')[2]}
                                </div>
                                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                                    {formatDayLabel(day.isoDate)}
                                </div>
                            </div>
                        </div>

                        {/* Events Column */}
                        <div className="flex-1 space-y-1">
                            {/* Timeline Events */}
                            {allDayEvents.map((event) => (
                                <div
                                    key={event.card_id}
                                    onClick={() => openCardModal(event.short_id, 'list-view')}
                                    className="flex items-center gap-4 p-3 bg-white rounded-xl border border-slate-100 hover:border-sky-200 hover:shadow-sm transition-all cursor-pointer group/item"
                                >
                                    <div className="flex items-center gap-1 min-w-[120px]">
                                        <div className={clsx(
                                            "w-2.5 h-2.5 rounded-full",
                                            event.checked ? "bg-slate-200" : "bg-sky-500"
                                        )} />
                                        <div className="text-xs font-medium text-slate-500">
                                            {event.due_start?.slice(0, 5) ?? '--:--'} 〜 {event.due_end?.slice(0, 5) ?? '--:--'}
                                        </div>
                                    </div>
                                    <div className={clsx(
                                        "flex-1 font-medium text-sm transition-colors",
                                        event.checked ? "text-slate-400 line-through" : "text-slate-700"
                                    )}>
                                        {event.title || 'Untitled'}
                                    </div>
                                    {event.durationMinutes && (
                                        <div className="text-[10px] font-bold text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded uppercase">
                                            {formatDuration(event.durationMinutes)}
                                        </div>
                                    )}
                                </div>
                            ))}

                            {/* A/B Items as secondary */}
                            {(bucketA.length > 0 || bucketB.length > 0) && (
                                <div className="grid grid-cols-2 gap-2 mt-2">
                                    <div className="space-y-1">
                                        {bucketA.map(item => (
                                            <div
                                                key={item.card_id}
                                                onClick={() => openCardModal(item.short_id, 'list-view')}
                                                className="flex items-center gap-2 px-3 py-2 bg-slate-50/50 rounded-lg border border-transparent hover:border-slate-200 transition-all cursor-pointer"
                                            >
                                                <div className="w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" />
                                                <div className={clsx(
                                                    "text-xs truncate transition-colors",
                                                    item.checked ? "text-slate-400 line-through" : "text-slate-600 font-medium"
                                                )}>
                                                    {item.title || 'Untitled'}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="space-y-1">
                                        {bucketB.map(item => (
                                            <div
                                                key={item.card_id}
                                                onClick={() => openCardModal(item.short_id, 'list-view')}
                                                className="flex items-center gap-2 px-3 py-2 bg-slate-50/50 rounded-lg border border-transparent hover:border-slate-200 transition-all cursor-pointer"
                                            >
                                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                                                <div className={clsx(
                                                    "text-xs truncate transition-colors",
                                                    item.checked ? "text-slate-400 line-through" : "text-slate-600 font-medium"
                                                )}>
                                                    {item.title || 'Untitled'}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
