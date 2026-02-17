"use client";

import { useEffect, useMemo, useState } from 'react';
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
}: MobileListViewProps) {
    const [showUnchecked, setShowUnchecked] = useState(true);
    const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
    const [showGoogle, setShowGoogle] = useState(true);
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
        <div className="flex flex-col pb-20 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-3 py-2 backdrop-blur-sm">
                <div className="flex items-center gap-2 overflow-x-auto">
                    <button
                        onClick={() => onPrevWeek?.()}
                        className="h-8 w-8 shrink-0 rounded-full border border-slate-200 text-xs font-medium text-slate-600"
                        aria-label="7日前へ"
                    >
                        {'<<'}
                    </button>
                    <button
                        onClick={() => onPrevDay?.()}
                        className="h-8 w-8 shrink-0 rounded-full border border-slate-200 text-xs font-medium text-slate-600"
                        aria-label="前日へ"
                    >
                        {'<'}
                    </button>
                    <button
                        onClick={() => onToday?.()}
                        className="h-8 shrink-0 rounded-full border border-slate-200 px-2 text-xs font-medium text-slate-600"
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
                        className="h-8 shrink-0 rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700"
                        aria-label="基準日"
                    />
                    <div className="relative shrink-0">
                        <select
                            value={String(listMonthDirection)}
                            onChange={(e) => onListMonthDirectionChange?.(Number(e.target.value) as 1 | 2 | 3 | -1 | -2 | -3)}
                            className="h-8 appearance-none rounded-full border border-slate-200 bg-white pl-2 pr-6 text-xs font-medium text-slate-700"
                            aria-label="表示期間"
                        >
                            <option value="3">+3 month</option>
                            <option value="2">+2 month</option>
                            <option value="1">+1 month</option>
                            <option value="-1">-1 month</option>
                            <option value="-2">-2 month</option>
                            <option value="-3">-3 month</option>
                        </select>
                        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-500">▼</span>
                    </div>
                    <button
                        onClick={() => onNextDay?.()}
                        className="h-8 w-8 shrink-0 rounded-full border border-slate-200 text-xs font-medium text-slate-600"
                        aria-label="翌日へ"
                    >
                        {'>'}
                    </button>
                    <button
                        onClick={() => onNextWeek?.()}
                        className="h-8 w-8 shrink-0 rounded-full border border-slate-200 text-xs font-medium text-slate-600"
                        aria-label="7日後へ"
                    >
                        {'>>'}
                    </button>
                    <label className="inline-flex shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700">
                        <input type="checkbox" checked={showUnchecked} onChange={(e) => setShowUnchecked(e.target.checked)} />
                        Unchecked
                    </label>
                    <label className="inline-flex shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700">
                        <input type="checkbox" checked={showChecked} onChange={(e) => setShowChecked(e.target.checked)} />
                        Checked
                    </label>
                    <label className="inline-flex shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700">
                        <input type="checkbox" checked={showGoogle} onChange={(e) => setShowGoogle(e.target.checked)} />
                        Google
                    </label>
                </div>
            </div>
            {status === 'loading' ? (
                <div className="flex flex-col items-center justify-center py-12 px-6 text-center min-h-[400px]">
                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-sky-500 mb-4" />
                    <p className="text-slate-500 font-medium">読み込み中...</p>
                </div>
            ) : displayDays.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
                    <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4 text-2xl">📅</div>
                    <p className="text-slate-500 font-medium">予定が入っている日はありません</p>
                </div>
            ) : displayDays.map((day) => {
                const timelineEvents = eventsByDay[day.isoDate] || [];
                const bucketA = abBuckets[`${day.key}_a`] || [];
                const bucketB = abBuckets[`${day.key}_b`] || [];
                const allGoogleEvents = [...(calendarAllDayEventsByDay[day.isoDate] || []), ...(calendarEventsByDay[day.isoDate] || [])];

                const allTimelineEvents = [...timelineEvents].sort((a, b) => {
                    const aStart = a.due_start || '00:00';
                    const bStart = b.due_start || '00:00';
                    return aStart.localeCompare(bStart);
                });
                const filteredTimelineEvents = allTimelineEvents.filter((event) => (event.checked ? showChecked : showUnchecked));
                const filteredGoogleEvents = showGoogle ? allGoogleEvents : [];
                const filteredBucketA = bucketA.filter((item) => (item.checked ? showChecked : showUnchecked));
                const filteredBucketB = bucketB.filter((item) => (item.checked ? showChecked : showUnchecked));

                return (
                    <div key={day.isoDate} className="mb-8 last:mb-0">
                        {/* Day Header */}
                        <div className="sticky top-0 z-10 bg-[#f4f5f7]/95 backdrop-blur-sm px-4 py-2 border-b border-slate-100 flex items-baseline gap-2">
                            <span className="text-lg font-bold text-slate-900">{day.isoDate.split('-')[2]}</span>
                            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{formatDayLabel(day.isoDate)}</span>
                        </div>

                        <div className="px-4 mt-3 space-y-2">
                            {/* Timeline Events */}
                            {filteredTimelineEvents.map((event) => (
                                <div
                                    key={event.card_id}
                                    onClick={() => setSelectedCardId(event.card_id)}
                                    onDoubleClick={() => openCardModal(event.short_id, 'mobile-list-view')}
                                    className={clsx(
                                        "flex flex-col gap-1 p-3 bg-white rounded-xl shadow-sm border ring-1 active:scale-[0.98] transition-all",
                                        selectedCardId === event.card_id
                                            ? "border-sky-300 ring-sky-300/60"
                                            : "border-slate-50 ring-black/5"
                                    )}
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
                                            {(event.duration != null || event.durationMinutes != null) && (
                                                <span className="text-[10px] font-bold text-slate-700 bg-white px-2 h-4 rounded ring-1 ring-slate-200 shadow-sm lowercase leading-none min-w-[32px] text-center">
                                                    &gt; {formatDuration((event.duration || event.durationMinutes)!)}
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
                            {filteredGoogleEvents.map((gEvent) => (
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
                            {(filteredBucketA.length > 0 || filteredBucketB.length > 0) && (
                                <div className="space-y-2 pt-1">
                                    {/* Bucket A */}
                                    {filteredBucketA.map(item => (
                                        <div
                                            key={item.card_id}
                                            onClick={() => setSelectedCardId(item.card_id)}
                                            onDoubleClick={() => openCardModal(item.short_id, 'mobile-list-view')}
                                            className={clsx(
                                                "flex flex-col gap-1 p-3 bg-white rounded-xl shadow-sm border ring-1 active:scale-[0.98] transition-all",
                                                selectedCardId === item.card_id
                                                    ? "border-sky-300 ring-sky-300/60"
                                                    : "border-slate-50 ring-black/5"
                                            )}
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
                                                    {item.duration != null && (
                                                        <span className="text-[10px] font-bold text-slate-700 bg-white px-2 h-4 rounded ring-1 ring-slate-200 shadow-sm lowercase leading-none min-w-[32px] text-center">
                                                            &gt; {formatDuration(item.duration)}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                    {/* Bucket B */}
                                    {filteredBucketB.map(item => (
                                        <div
                                            key={item.card_id}
                                            onClick={() => setSelectedCardId(item.card_id)}
                                            onDoubleClick={() => openCardModal(item.short_id, 'mobile-list-view')}
                                            className={clsx(
                                                "flex flex-col gap-1 p-3 bg-white rounded-xl shadow-sm border ring-1 active:scale-[0.98] transition-all",
                                                selectedCardId === item.card_id
                                                    ? "border-sky-300 ring-sky-300/60"
                                                    : "border-slate-50 ring-black/5"
                                            )}
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
                                                    {item.duration != null && (
                                                        <span className="text-[10px] font-bold text-slate-700 bg-white px-2 h-4 rounded ring-1 ring-slate-200 shadow-sm lowercase leading-none min-w-[32px] text-center">
                                                            &gt; {formatDuration(item.duration)}
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
