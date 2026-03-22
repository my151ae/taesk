"use client";

import { useMemo } from "react";
import clsx from "clsx";

import {
  type TimelineDay,
  type TimelineEvent,
  type TimelineBucketItem,
  formatDayLabel,
  minutesToTime,
  type ExternalCalendarEntry,
} from "@/app/(board)/_utils/timeline-helpers";
import { getPresetLabel } from "@/app/(board)/_hooks/useTimelineBoardController";
import type { ListWindowPresetKey } from "@/app/(board)/_hooks/useTimelineUrlState";
import { TimelineListCard } from "@/app/(board)/_components/timeline/TimelineListCard";

export type DesktopListToolbarProps = {
  onPrevDay?: () => void;
  onNextDay?: () => void;
  onPrevWeek?: () => void;
  onNextWeek?: () => void;
  onToday?: () => void;
  draftBaseDate: string;
  baseDateValue: string;
  onDraftBaseDateChange: (value: string) => void;
  onCommitBaseDate: () => void;
  listWindowPresetKey?: ListWindowPresetKey;
  onListWindowPresetChange?: (preset: ListWindowPresetKey) => void;
  showUnchecked: boolean;
  onShowUncheckedChange: (checked: boolean) => void;
  showChecked: boolean;
  onShowCheckedChange: (checked: boolean) => void;
  showGoogle: boolean;
  onShowGoogleChange: (checked: boolean) => void;
};

export function DesktopListToolbar({
  onPrevDay,
  onNextDay,
  onPrevWeek,
  onNextWeek,
  onToday,
  draftBaseDate,
  baseDateValue,
  onDraftBaseDateChange,
  onCommitBaseDate,
  listWindowPresetKey = "zero",
  onListWindowPresetChange,
  showUnchecked,
  onShowUncheckedChange,
  showChecked,
  onShowCheckedChange,
  showGoogle,
  onShowGoogleChange,
}: DesktopListToolbarProps) {
  const todayButtonClassName =
    "h-8 rounded-full border border-sky-300 bg-sky-200 px-2 text-xs font-medium text-sky-800 hover:bg-sky-300";

  return (
    <div className="border-b border-slate-100 bg-white px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => onPrevWeek?.()}
          className="h-8 w-8 rounded-full border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
          aria-label="7日前へ"
        >
          {"<<"}
        </button>
        <button
          onClick={() => onPrevDay?.()}
          className="h-8 w-8 rounded-full border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
          aria-label="前日へ"
        >
          {"<"}
        </button>
        <button
          onClick={() => onToday?.()}
          className={todayButtonClassName}
          aria-label="Today"
        >
          Today
        </button>
        <input
          type="date"
          value={draftBaseDate}
          onChange={(e) => onDraftBaseDateChange(e.target.value)}
          onBlur={onCommitBaseDate}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
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
          {">"}
        </button>
        <button
          onClick={() => onNextWeek?.()}
          className="h-8 w-8 rounded-full border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
          aria-label="7日後へ"
        >
          {">>"}
        </button>
        <label className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700">
          <input type="checkbox" checked={showUnchecked} onChange={(e) => onShowUncheckedChange(e.target.checked)} />
          Unchecked
        </label>
        <label className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700">
          <input type="checkbox" checked={showChecked} onChange={(e) => onShowCheckedChange(e.target.checked)} />
          Checked
        </label>
        <label className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700">
          <input type="checkbox" checked={showGoogle} onChange={(e) => onShowGoogleChange(e.target.checked)} />
          Google
        </label>
      </div>
    </div>
  );
}

export type DesktopListViewProps = {
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
  listReverse?: boolean;
  showUnchecked: boolean;
  showChecked: boolean;
  showGoogle: boolean;
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
  listReverse = false,
  showUnchecked,
  showChecked,
  showGoogle,
}: DesktopListViewProps) {
  const daysWithEvents = useMemo(() => {
    return days.filter((day) => {
      const timelineEvents = eventsByDay[day.isoDate] ?? [];
      const bucketItems = [...(abBuckets[`${day.key}_a`] ?? []), ...(abBuckets[`${day.key}_b`] ?? [])];
      const googleEvents = [
        ...(calendarEventsByDay[day.isoDate] ?? []),
        ...(calendarAllDayEventsByDay[day.isoDate] ?? []),
      ];

      const hasUncheckedItems =
        showUnchecked &&
        (timelineEvents.some((event) => !event.checked) || bucketItems.some((item) => !item.checked));
      const hasCheckedItems =
        showChecked &&
        (timelineEvents.some((event) => event.checked) || bucketItems.some((item) => item.checked));
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
    showChecked,
    showGoogle,
  ]);

  const displayDays = listReverse ? [...daysWithEvents].reverse() : daysWithEvents;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-20">
      {status === "loading" ? (
        <div className="mt-4 flex min-h-[400px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white py-20">
          <div className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-sky-500" />
          <p className="text-sm font-medium text-slate-400">読み込み中...</p>
        </div>
      ) : displayDays.length === 0 ? (
        <div className="mt-4 flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white py-20">
          <p className="text-sm font-medium text-slate-400">予定が入っている日はありません</p>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-6">
          {displayDays.map((day) => {
            const timelineEvents = eventsByDay[day.isoDate] || [];
            const bucketA = abBuckets[`${day.key}_a`] || [];
            const bucketB = abBuckets[`${day.key}_b`] || [];
            const allGoogleEvents = [...(calendarAllDayEventsByDay[day.isoDate] || []), ...(calendarEventsByDay[day.isoDate] || [])];

            const allDayEvents = [...timelineEvents].sort((a, b) => {
              const aStart = a.due_start || "00:00";
              const bStart = b.due_start || "00:00";
              return aStart.localeCompare(bStart);
            });
            const filteredTimelineEvents = allDayEvents.filter((event) => (event.checked ? showChecked : showUnchecked));
            const filteredGoogleEvents = showGoogle ? allGoogleEvents : [];
            const filteredBucketItems = [
              ...bucketA.map((i) => ({ ...i, bkey: "a" as const })),
              ...bucketB.map((i) => ({ ...i, bkey: "b" as const })),
            ].filter((item) => (item.checked ? showChecked : showUnchecked));
            const isToday = day.label.startsWith("Today");

            return (
              <div key={day.isoDate} className="flex gap-6 group">
                <div className="w-32 shrink-0 pt-2">
                  <div className="sticky top-6">
                    <div
                      className={clsx(
                        "inline-flex min-w-[2.75rem] items-center justify-center rounded-full px-3 py-1 text-2xl font-bold transition-colors",
                        isToday ? "bg-sky-200 text-sky-800 ring-1 ring-sky-300" : "text-slate-900"
                      )}
                    >
                      {day.isoDate.split("-")[2]}
                    </div>
                    <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      {formatDayLabel(day.isoDate)}
                    </div>
                  </div>
                </div>

                <div className="flex-1 space-y-1">
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

                  {filteredGoogleEvents.map((gEvent) => (
                    <div
                      key={gEvent.id}
                      onClick={() => onExternalEventClick?.(gEvent)}
                      className="group/item flex w-full cursor-pointer items-center gap-1 rounded-xl border border-slate-100 bg-white p-3 transition-all hover:border-emerald-200 hover:shadow-sm"
                    >
                      <div className="flex min-w-[110px] items-center gap-2">
                        <div className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />
                        <div className="whitespace-nowrap text-xs font-medium text-slate-500">
                          {gEvent.isAllDay
                            ? "All Day"
                            : `${minutesToTime(gEvent.startMinutes).slice(0, 5)} 〜 ${minutesToTime(gEvent.startMinutes + gEvent.durationMinutes).slice(0, 5)}`}
                        </div>
                      </div>
                      <div className="ml-6 flex-1 truncate text-sm font-medium text-slate-700">{gEvent.title}</div>
                      <div className="rounded bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-600">
                        Google
                      </div>
                    </div>
                  ))}

                  {filteredBucketItems.length > 0 ? (
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
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
