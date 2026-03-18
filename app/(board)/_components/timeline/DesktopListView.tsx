"use client";

import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import {
    TimelineDay,
    TimelineEvent,
    TimelineBucketItem,
    formatDayLabel,
    minutesToTime,
    ExternalCalendarEntry
} from '@/app/(board)/_utils/timeline-helpers';
import { getPresetLabel } from '@/app/(board)/_hooks/useTimelineBoardController';
import type { ListWindowPresetKey } from '@/app/(board)/_hooks/useTimelineUrlState';
import { TimelineListCard } from '@/app/(board)/_components/timeline/TimelineListCard';

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
    listWindowPresetKey?: ListWindowPresetKey;
    onListWindowPresetChange?: (preset: ListWindowPresetKey) => void;
    listReverse?: boolean;
    onListBaseDateChange?: (isoDate: string) => void;
    onSwitchToTimeline?: () => void;
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
    listWindowPresetKey = "zero",
    onListWindowPresetChange,
    listReverse = false,
    onListBaseDateChange,
    onSwitchToTimeline,
}: DesktopListViewProps) {
    const [showUnchecked, setShowUnchecked] = useState(true);
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

    const displayDays = listReverse ? [...daysWithEvents].reverse() : daysWithEvents;

    return (
        <div className="flex flex-col gap-6 px-4 pb-20">
            <div className="sticky top-0 z-20 -mx-2 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 shadow-sm backdrop-blur-sm">
                <div className="mb-2 flex items-center gap-2">
                    <button
                        onClick={() => onSwitchToTimeline?.()}
                        className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        aria-label="Timeline表示へ切り替え"
                    >
                        Timeline
                    </button>
                    <button
                        className="rounded-full bg-sky-600 px-3 py-1 text-xs font-semibold text-white shadow-sm"
                        aria-current="page"
                    >
                        List
                    </button>
                </div>
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
                            value={listWindowPresetKey}
                            onChange={(e) => onListWindowPresetChange?.(e.target.value as ListWindowPresetKey)}
                            className="h-8 appearance-none rounded-full border border-slate-200 bg-white pl-2 pr-6 text-xs font-medium text-slate-700"
                            aria-label="表示期間"
                        >
                            <option value="plus3">{getPresetLabel("plus3")}</option>
                            <option value="plus2">{getPresetLabel("plus2")}</option>
                            <option value="plus1">{getPresetLabel("plus1")}</option>
                            <option value="zero">{getPresetLabel("zero")}</option>
                            <option value="minus1">{getPresetLabel("minus1")}</option>
                            <option value="minus2">{getPresetLabel("minus2")}</option>
                            <option value="minus3">{getPresetLabel("minus3")}</option>
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
                                <TimelineListCard
                                    key={event.card_id}
                                    item={event}
                                    kind="event"
                                    variant="desktop"
                                    openSource="list-view"
                                    openCardModal={openCardModal}
                                    onToggleCheck={onToggleCheck}
                                    onCardContextMenu={onCardContextMenu}
                                />
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
                                        <TimelineListCard
                                            key={item.card_id}
                                            item={item}
                                            kind="bucket"
                                            variant="desktop"
                                            openSource="list-view"
                                            bucketLabel={item.bkey.toUpperCase()}
                                            openCardModal={openCardModal}
                                            onToggleCheck={onToggleCheck}
                                            onCardContextMenu={onCardContextMenu}
                                        />
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
