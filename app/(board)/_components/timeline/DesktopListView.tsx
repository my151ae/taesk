"use client";

import { useEffect, useMemo, useState } from 'react';
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
    status?: string;
    onPrevDay?: () => void;
    onNextDay?: () => void;
    onPrevWeek?: () => void;
    onNextWeek?: () => void;
    onToday?: () => void;
    listBaseDate?: string | null;
    listMonthDirection?: 1 | 2 | 3 | -1 | -2 | -3;
    onListMonthDirectionChange?: (direction: 1 | 2 | 3 | -1 | -2 | -3) => void;
    onListBaseDateChange?: (isoDate: string) => void;
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
    status,
    onPrevDay,
    onNextDay,
    onPrevWeek,
    onNextWeek,
    onToday,
    listBaseDate,
    listMonthDirection = 1,
    onListMonthDirectionChange,
    onListBaseDateChange,
}: DesktopListViewProps) {
    const [showUnchecked, setShowUnchecked] = useState(true);
    const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
    const [showGoogle, setShowGoogle] = useState(false);
    const [showChecked, setShowChecked] = useState(true);
    const baseDateValue = listBaseDate ?? days[0]?.isoDate ?? '';
    const [draftBaseDate, setDraftBaseDate] = useState(baseDateValue);

    useEffect(() => {
        setDraftBaseDate(baseDateValue);
    }, [baseDateValue]);

    const daysWithEvents = useMemo(() => {
        return days.filter(day => {
            const timelineEvents = eventsByDay[day.isoDate] ?? [];
            const bucketItems = [...(abBuckets[`${day.key}_a`] ?? []), ...(abBuckets[`${day.key}_b`] ?? [])];
            const googleEvents = [
                ...(calendarEventsByDay[day.isoDate] ?? []),
                ...(calendarAllDayEventsByDay[day.isoDate] ?? []),
            ];

            const hasUncheckedItems = showUnchecked && (
                timelineEvents.some((event) => !event.checked) ||
                bucketItems.some((item) => !item.checked)
            );
            const hasCheckedItems = showChecked && (
                timelineEvents.some((event) => event.checked) ||
                bucketItems.some((item) => item.checked)
            );
            const hasGoogleEvents = showGoogle && googleEvents.length > 0;

            return hasUncheckedItems || hasCheckedItems || hasGoogleEvents;
        });
    }, [
        days,
        eventsByDay,
        abBuckets,
        calendarEventsByDay,
        calendarAllDayEventsByDay,
        showUnchecked,
        showGoogle,
        showChecked,
    ]);

    const displayDays = listMonthDirection < 0 ? [...daysWithEvents].reverse() : daysWithEvents;

    return (
        <div className="flex flex-col gap-6 px-4 pb-20">
            <div className="sticky top-0 z-20 -mx-2 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 shadow-sm backdrop-blur-sm">
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        onClick={() => onPrevWeek?.()}
                        className="h-8 w-8 rounded-full border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
                        aria-label="7日前へ"
                    >
                        {'<<'}
                    </button>
                    <button
                        onClick={() => onPrevDay?.()}
                        className="h-8 w-8 rounded-full border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
                        aria-label="前日へ"
                    >
                        {'<'}
                    </button>
                    <button
                        onClick={() => onToday?.()}
                        className="h-8 rounded-full border border-slate-200 px-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
                        aria-label="Today"
                    >
                        Today
                    </button>
                    <input
                        type="date"
                        value={draftBaseDate}
                        onChange={(e) => setDraftBaseDate(e.target.value)}
                        onBlur={() => {
                            if (draftBaseDate && draftBaseDate !== baseDateValue) {
                                onListBaseDateChange?.(draftBaseDate);
                            }
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                (e.currentTarget as HTMLInputElement).blur();
                            }
                        }}
                        className="h-8 rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700"
                        aria-label="基準日"
                    />
                    <div className="relative">
                        <select
                            value={String(listMonthDirection)}
                            onChange={(e) => onListMonthDirectionChange?.(Number(e.target.value) as 1 | 2 | 3 | -1 | -2 | -3)}
                            className="h-8 appearance-none rounded-full border border-slate-200 bg-white pl-2 pr-6 text-xs font-medium text-slate-700"
                            aria-label="表示期間"
                        >
                            <option value="3">+3 mo.</option>
                            <option value="2">+2 mo.</option>
                            <option value="1">+1 mo.</option>
                            <option value="-1">-1 mo.</option>
                            <option value="-2">-2 mo.</option>
                            <option value="-3">-3 mo.</option>
                        </select>
                        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-500">▼</span>
                    </div>
                    <button
                        onClick={() => onNextDay?.()}
                        className="h-8 w-8 rounded-full border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
                        aria-label="翌日へ"
                    >
                        {'>'}
                    </button>
                    <button
                        onClick={() => onNextWeek?.()}
                        className="h-8 w-8 rounded-full border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
                        aria-label="7日後へ"
                    >
                        {'>>'}
                    </button>
                    <label className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700">
                        <input type="checkbox" checked={showUnchecked} onChange={(e) => setShowUnchecked(e.target.checked)} />
                        Unchecked
                    </label>
                    <label className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700">
                        <input type="checkbox" checked={showChecked} onChange={(e) => setShowChecked(e.target.checked)} />
                        Checked
                    </label>
                    <label className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700">
                        <input type="checkbox" checked={showGoogle} onChange={(e) => setShowGoogle(e.target.checked)} />
                        Google
                    </label>
                </div>
            </div>
            {status === 'loading' ? (
                <div className="flex flex-col items-center justify-center py-20 bg-white rounded-2xl border border-dashed border-slate-200 min-h-[400px]">
                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-sky-500 mb-4" />
                    <p className="text-slate-400 text-sm font-medium">読み込み中...</p>
                </div>
            ) : displayDays.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 bg-white rounded-2xl border border-dashed border-slate-200">
                    <p className="text-slate-400 text-sm font-medium">予定が入っている日はありません</p>
                </div>
            ) : displayDays.map((day) => {
                const timelineEvents = eventsByDay[day.isoDate] || [];
                const bucketA = abBuckets[`${day.key}_a`] || [];
                const bucketB = abBuckets[`${day.key}_b`] || [];
                const allGoogleEvents = [...(calendarAllDayEventsByDay[day.isoDate] || []), ...(calendarEventsByDay[day.isoDate] || [])];

                // Combine and sort events
                const allDayEvents = [...timelineEvents].sort((a, b) => {
                    const aStart = a.due_start || '00:00';
                    const bStart = b.due_start || '00:00';
                    return aStart.localeCompare(bStart);
                });
                const filteredTimelineEvents = allDayEvents.filter((event) => (event.checked ? showChecked : showUnchecked));
                const filteredGoogleEvents = showGoogle ? allGoogleEvents : [];
                const filteredBucketItems = [
                    ...bucketA.map(i => ({ ...i, bkey: 'a' as const })),
                    ...bucketB.map(i => ({ ...i, bkey: 'b' as const })),
                ].filter((item) => (item.checked ? showChecked : showUnchecked));

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
                            {filteredTimelineEvents.map((event) => (
                                <div
                                    key={event.card_id}
                                    tabIndex={0}
                                    onClick={() => setSelectedCardId(event.card_id)}
                                    onDoubleClick={() => openCardModal(event.short_id, 'list-view')}
                                    onContextMenu={(e) => onCardContextMenu?.(e, event.card_id)}
                                    className={clsx(
                                        "flex w-full items-center gap-1 p-3 bg-white rounded-xl border hover:border-sky-200 hover:shadow-sm transition-all outline-none focus:ring-2 focus:ring-sky-500 group/item",
                                        selectedCardId === event.card_id ? "border-sky-400 ring-2 ring-sky-300" : "border-slate-100"
                                    )}
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
                                    {(event.duration != null || event.durationMinutes != null) ? (
                                        <div className="flex items-center gap-1 shrink-0">
                                            <div className="h-6 w-px bg-slate-200" />
                                            <span className="text-[10px] font-semibold text-slate-600 leading-none">
                                                {formatDuration((event.duration || event.durationMinutes)!)}
                                            </span>
                                        </div>
                                    ) : null}
                                </div>
                            ))}

                            {/* Google Events */}
                            {filteredGoogleEvents.map((gEvent) => (
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
                            {filteredBucketItems.length > 0 && (
                                <div className="space-y-1">
                                    {filteredBucketItems.map((item) => (
                                        <div
                                            key={item.card_id}
                                            tabIndex={0}
                                            onClick={() => setSelectedCardId(item.card_id)}
                                            onDoubleClick={() => openCardModal(item.short_id, 'list-view')}
                                            onContextMenu={(e) => onCardContextMenu?.(e, item.card_id)}
                                            className={clsx(
                                                "flex w-full items-center gap-1 p-3 bg-white rounded-xl border hover:shadow-sm transition-all outline-none focus:ring-2 focus:ring-sky-500 group/item",
                                                selectedCardId === item.card_id ? "border-sky-400 ring-2 ring-sky-300" : "border-slate-100",
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
                                            {(item.duration != null) ? (
                                                <div className="flex items-center gap-1 shrink-0">
                                                    <div className="h-6 w-px bg-slate-200" />
                                                    <span className="text-[10px] font-semibold text-slate-600 leading-none">
                                                        {formatDuration(item.duration)}
                                                    </span>
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
