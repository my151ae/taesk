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
    formatDuration,
    ExternalCalendarEntry
} from '@/app/(board)/_utils/timeline-helpers';

type DesktopListViewProps = {
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

export function DesktopListView({
    days,
    eventsByDay,
    abBuckets,
    calendarEventsByDay,
    calendarAllDayEventsByDay,
    openCardModal,
    onToggleCheck,
    onExternalEventClick,
    onCardContextMenu,
}: DesktopListViewProps) {
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
                            {/* Taesk Events with Checkboxes */}
                            {allDayEvents.map((event) => (
                                <div
                                    key={event.card_id}
                                    onClick={() => openCardModal(event.short_id, 'list-view')}
                                    onContextMenu={(e) => onCardContextMenu?.(e, event.card_id)}
                                    className="flex w-full items-center gap-1 p-3 bg-white rounded-xl border border-slate-100 hover:border-sky-200 hover:shadow-sm transition-all cursor-pointer group/item"
                                >
                                    <div className="flex items-center gap-2 min-w-[110px]">
                                        <div className="w-2.5 h-2.5 rounded-full bg-sky-500 shrink-0" />
                                        <div className="text-xs font-medium text-slate-500 whitespace-nowrap">
                                            {`${event.due_start?.slice(0, 5) ?? '--:--'} 〜 ${event.due_end?.slice(0, 5) ?? '--:--'}`}
                                        </div>
                                    </div>
                                    <div className="flex-1 flex items-center gap-1 min-w-0">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onToggleCheck(event.card_id, !event.checked);
                                            }}
                                            className="shrink-0"
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
                                            "font-medium text-sm transition-colors truncate pt-[2px]",
                                            event.checked ? "text-slate-400 line-through" : "text-slate-700"
                                        )}>
                                            {event.title || 'Untitled'}
                                        </div>
                                    </div>
                                    {(event.duration || event.durationMinutes) ? (
                                        <div className="text-[10px] font-bold text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded lowercase">
                                            {formatDuration((event.duration || event.durationMinutes)!)}
                                        </div>
                                    ) : null}
                                </div>
                            ))}

                            {/* Google Events */}
                            {([...(calendarAllDayEventsByDay[day.isoDate] || []), ...(calendarEventsByDay[day.isoDate] || [])]).map((gEvent) => (
                                <div
                                    key={gEvent.id}
                                    onClick={() => onExternalEventClick?.(gEvent)}
                                    className="flex w-full items-center gap-1 p-3 bg-white rounded-xl border border-slate-100 hover:border-emerald-200 hover:shadow-sm transition-all cursor-pointer group/item"
                                >
                                    <div className="flex items-center gap-2 min-w-[110px]">
                                        <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
                                        <div className="text-xs font-medium text-slate-500 whitespace-nowrap">
                                            {gEvent.isAllDay ? 'All Day' : (
                                                `${minutesToTime(gEvent.startMinutes).slice(0, 5)} 〜 ${minutesToTime(gEvent.startMinutes + gEvent.durationMinutes).slice(0, 5)}`
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex-1 font-medium text-sm text-slate-700 truncate ml-6">
                                        {gEvent.title}
                                    </div>
                                    <div className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded uppercase">
                                        Google
                                    </div>
                                </div>
                            ))}

                            {/* A/B Items unified style and width */}
                            {(bucketA.length > 0 || bucketB.length > 0) && (
                                <div className="space-y-1">
                                    {[...bucketA.map(i => ({ ...i, bkey: 'a' })), ...bucketB.map(i => ({ ...i, bkey: 'b' }))].map((item) => (
                                        <div
                                            key={item.card_id}
                                            onClick={() => openCardModal(item.short_id, 'list-view')}
                                            onContextMenu={(e) => onCardContextMenu?.(e, item.card_id)}
                                            className={clsx(
                                                "flex w-full items-center gap-1 p-3 bg-white rounded-xl border border-slate-100 hover:shadow-sm transition-all cursor-pointer group/item",
                                                item.bkey === 'a' ? "hover:border-orange-200" : "hover:border-emerald-200"
                                            )}
                                        >
                                            <div className="flex items-center gap-2 min-w-[110px]">
                                                <div className={clsx(
                                                    "w-2.5 h-2.5 rounded-full shrink-0",
                                                    item.bkey === 'a' ? "bg-orange-400" : "bg-emerald-400"
                                                )} />
                                            </div>
                                            <div className="flex-1 flex items-center gap-1 min-w-0">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onToggleCheck(item.card_id, !item.checked);
                                                    }}
                                                    className="shrink-0"
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
                                                    "font-medium text-sm transition-colors truncate pt-[2px]",
                                                    item.checked ? "text-slate-400 line-through" : "text-slate-700"
                                                )}>
                                                    {item.title || 'Untitled'}
                                                </div>
                                            </div>
                                            {(item.duration) ? (
                                                <div className="text-[10px] font-bold text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded lowercase">
                                                    {formatDuration(item.duration)}
                                                </div>
                                            ) : null}
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
