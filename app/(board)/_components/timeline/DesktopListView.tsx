"use client";

import { useMemo } from "react";
import clsx from "clsx";

import {
  type TimelineDay,
  type TimelineEvent,
  type TimelineBucketItem,
  type TimelineOverdueItem,
  formatDayLabel,
  minutesToTime,
  type ExternalCalendarEntry,
} from "@/app/(board)/_utils/timeline-helpers";
import { getPresetLabel } from "@/app/(board)/_hooks/useTimelineBoardController";
import type { ListWindowPresetKey } from "@/app/(board)/_hooks/useTimelineUrlState";
import { TimelineListCard } from "@/app/(board)/_components/timeline/TimelineListCard";
import { ToolbarMenuSelect } from "@/app/(board)/_components/timeline/ToolbarMenuSelect";

export type DesktopListToolbarProps = {
  variant?: "default" | "tags" | "search" | "overdue";
  title?: string;
  summaryText?: string | null;
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
  variant = "default",
  title,
  summaryText,
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
  const presetOptions = useMemo(
    () => ([
      "plus3",
      "plus2",
      "plus1",
      "zero",
      "minus1",
      "minus2",
      "minus3",
    ] as const).map((preset) => ({
      value: preset,
      label: getPresetLabel(preset),
    })),
    []
  );
  const todayButtonClassName =
    "inline-flex h-6 shrink-0 items-center rounded-full border border-sky-300 bg-sky-200 px-2.5 text-[11px] font-medium text-sky-800 hover:bg-sky-300";

  if (variant === "tags" || variant === "search" || variant === "overdue") {
    return (
      <div className="border-b border-slate-100 bg-white px-3">
        <div className="flex h-8 items-center gap-2 overflow-x-auto">
          <div className="min-w-0 shrink-0">
            {summaryText ? (
              <span className="inline-flex h-6 max-w-full items-center truncate rounded-full bg-slate-100 px-2.5 text-[11px] font-medium text-slate-600">
                {summaryText}
              </span>
            ) : null}
          </div>
          {variant === "tags" ? (
            <>
              <label className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700">
                <input type="checkbox" checked={showUnchecked} onChange={(e) => onShowUncheckedChange(e.target.checked)} />
                Unchecked
              </label>
              <label className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700">
                <input type="checkbox" checked={showChecked} onChange={(e) => onShowCheckedChange(e.target.checked)} />
                Checked
              </label>
            </>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="border-b border-slate-100 bg-white px-3">
      <div className="flex h-8 items-center gap-2 overflow-x-auto">
        <button
          onClick={() => onPrevWeek?.()}
          data-focus-group="toolbar"
          data-focus-part="control"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-200 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
          aria-label="7日前へ"
        >
          {"<<"}
        </button>
        <button
          onClick={() => onPrevDay?.()}
          data-focus-group="toolbar"
          data-focus-part="control"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-200 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
          aria-label="前日へ"
        >
          {"<"}
        </button>
        <button
          onClick={() => onToday?.()}
          data-focus-group="toolbar"
          data-focus-part="control"
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
          data-focus-group="toolbar"
          data-focus-part="control"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
          className="h-6 shrink-0 rounded-full border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-700"
          aria-label="基準日"
        />
        <ToolbarMenuSelect
          value={listWindowPresetKey}
          options={presetOptions}
          onChange={(nextValue) => onListWindowPresetChange?.(nextValue as ListWindowPresetKey)}
          ariaLabel="表示期間"
          className="pr-2"
          menuClassName="min-w-[8rem]"
        />
        <button
          onClick={() => onNextDay?.()}
          data-focus-group="toolbar"
          data-focus-part="control"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-200 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
          aria-label="翌日へ"
        >
          {">"}
        </button>
        <button
          onClick={() => onNextWeek?.()}
          data-focus-group="toolbar"
          data-focus-part="control"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-200 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
          aria-label="7日後へ"
        >
          {">>"}
        </button>
        <label className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700">
          <input type="checkbox" checked={showUnchecked} onChange={(e) => onShowUncheckedChange(e.target.checked)} />
          Unchecked
        </label>
        <label className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700">
          <input type="checkbox" checked={showChecked} onChange={(e) => onShowCheckedChange(e.target.checked)} />
          Checked
        </label>
        <label className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700">
          <input type="checkbox" checked={showGoogle} onChange={(e) => onShowGoogleChange(e.target.checked)} />
          Google
        </label>
      </div>
    </div>
  );
}

export type DesktopListViewProps = {
  variant?: "default" | "tags" | "search" | "overdue";
  searchQuery?: string;
  searchResults?: Array<{
    kind: "event" | "bucket" | "overdue";
    item: TimelineEvent | TimelineBucketItem | TimelineOverdueItem;
    badgeLabel: string;
    timeText: string | null;
  }>;
  selectedTag?: string | null;
  days: TimelineDay[];
  eventsByDay: Record<string, TimelineEvent[]>;
  abBuckets: Record<string, TimelineBucketItem[]>;
  overdue?: TimelineOverdueItem[];
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
  variant = "default",
  searchQuery,
  searchResults = [],
  selectedTag,
  days,
  eventsByDay,
  abBuckets,
  overdue = [],
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
  const tagItems = useMemo(() => {
    if (variant !== "tags") return [];

    const allItems: Array<
      | { kind: "event"; item: TimelineEvent }
      | { kind: "bucket"; item: TimelineBucketItem; bucketLabel: string }
      | { kind: "overdue"; item: TimelineOverdueItem }
    > = [];

    Object.values(eventsByDay).forEach((items) => {
      items.forEach((item) => {
        allItems.push({ kind: "event", item });
      });
    });

    Object.entries(abBuckets).forEach(([bucketKey, items]) => {
      const bucketLabel = bucketKey.endsWith("_a") ? "A" : bucketKey.endsWith("_b") ? "B" : "L";
      items.forEach((item) => {
        allItems.push({ kind: "bucket", item, bucketLabel });
      });
    });

    overdue.forEach((item) => {
      allItems.push({ kind: "overdue", item });
    });

    const sortedItems = allItems
      .filter(({ item }) => {
        if (!selectedTag) return true;
        return (item.tags ?? []).includes(selectedTag);
      })
      .filter(({ item }) => (item.checked ? showChecked : showUnchecked))
      .sort((left, right) => {
        const leftDate = left.item.due_date ?? "9999-12-31";
        const rightDate = right.item.due_date ?? "9999-12-31";
        if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);

        const leftTime = left.item.due_start ?? left.item.due_end ?? "99:99";
        const rightTime = right.item.due_start ?? right.item.due_end ?? "99:99";
        if (leftTime !== rightTime) return leftTime.localeCompare(rightTime);

        const rank = { overdue: 0, event: 1, bucket: 2 } as const;
        if (rank[left.kind] !== rank[right.kind]) return rank[left.kind] - rank[right.kind];

        return (left.item.title ?? "").localeCompare(right.item.title ?? "");
      });

    const uniqueItems = new Map<string, (typeof sortedItems)[number]>();
    sortedItems.forEach((entry) => {
      if (!uniqueItems.has(entry.item.card_id)) {
        uniqueItems.set(entry.item.card_id, entry);
      }
    });

    return Array.from(uniqueItems.values());
  }, [variant, selectedTag, eventsByDay, abBuckets, overdue, showChecked, showUnchecked]);

  const overdueItems = useMemo(
    () =>
      overdue
        .filter((item) => (item.checked ? showChecked : showUnchecked))
        .sort((left, right) => {
          const leftDate = left.due_date ?? "9999-12-31";
          const rightDate = right.due_date ?? "9999-12-31";
          if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
          const leftTime = left.due_start ?? left.due_end ?? "99:99";
          const rightTime = right.due_start ?? right.due_end ?? "99:99";
          if (leftTime !== rightTime) return leftTime.localeCompare(rightTime);
          return (left.title ?? "").localeCompare(right.title ?? "");
        }),
    [overdue, showChecked, showUnchecked],
  );

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

  if (variant === "tags") {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-20">
        {!selectedTag ? (
          <div className="mt-4 flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white py-20">
            <p className="text-sm font-medium text-slate-400">左パネルでタグを選択してください</p>
          </div>
        ) : tagItems.length === 0 ? (
          <div className="mt-4 flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white py-20">
            <p className="text-sm font-medium text-slate-400">#{selectedTag} に一致するカードはありません</p>
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-1">
            {tagItems.map((entry) => (
              <TimelineListCard
                key={`${entry.kind}:${entry.item.card_id}`}
                item={entry.item}
                kind={entry.kind}
                variant="desktop"
                openSource="tag-list-view"
                bucketLabel={entry.kind === "bucket" ? entry.bucketLabel : undefined}
                openCardModal={openCardModal}
                onToggleCheck={onToggleCheck}
                onCardContextMenu={onCardContextMenu}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  if (variant === "search") {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-white px-4 py-3">
        {!searchQuery?.trim() ? (
          <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
            キーワードを入力すると検索結果が表示されます
          </p>
        ) : searchResults.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
            一致するカードはありません
          </p>
        ) : (
          <div className="space-y-2">
            {searchResults.map((result) => (
              <TimelineListCard
                key={`${result.kind}:${result.item.card_id}`}
                item={result.item}
                kind={result.kind}
                variant="desktop"
                bucketLabel={result.kind === "bucket" ? result.badgeLabel : undefined}
                openSource="desktop-search-list-view"
                openCardModal={openCardModal}
                onToggleCheck={onToggleCheck}
                onCardContextMenu={onCardContextMenu}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  if (variant === "overdue") {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-white px-4 py-3">
        {overdueItems.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
            未完了の期限超過カードはありません
          </p>
        ) : (
          <div className="space-y-2">
            {overdueItems.map((item) => (
              <TimelineListCard
                key={item.card_id}
                item={item}
                kind="overdue"
                variant="desktop"
                openSource="desktop-overdue-list-view"
                openCardModal={openCardModal}
                onToggleCheck={onToggleCheck}
                onCardContextMenu={onCardContextMenu}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

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
