"use client";

import clsx from "clsx";

import { TimelineListCard } from "@/app/(board)/_components/timeline/TimelineListCard";
import {
  buildMonthCells,
  formatMonthDayNumber,
  formatMonthTitle,
  type MonthCardEntry,
} from "@/app/(board)/_components/timeline/month-view-helpers";
import type { TimelineBucketItem, TimelineDay, TimelineEvent } from "@/app/(board)/_utils/timeline-helpers";

export type DesktopMonthToolbarProps = {
  monthAnchorDate: string;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onToday: () => void;
};

export function DesktopMonthToolbar({
  monthAnchorDate,
  onPrevMonth,
  onNextMonth,
  onToday,
}: DesktopMonthToolbarProps) {
  return (
    <div className="border-b border-slate-100 bg-white px-3">
      <div className="flex h-8 items-center gap-2 overflow-x-auto">
        <button
          type="button"
          onClick={onPrevMonth}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-200 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
          aria-label="前月へ"
        >
          {"<"}
        </button>
        <div className="inline-flex h-6 shrink-0 items-center rounded-full border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-700">
          {formatMonthTitle(monthAnchorDate)}
        </div>
        <button
          type="button"
          onClick={onNextMonth}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-200 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
          aria-label="翌月へ"
        >
          {">"}
        </button>
        <button
          type="button"
          onClick={onToday}
          className="inline-flex h-6 shrink-0 items-center rounded-full border border-sky-300 bg-sky-200 px-2.5 text-[11px] font-medium text-sky-800 hover:bg-sky-300"
          aria-label="今月へ"
        >
          Today
        </button>
      </div>
    </div>
  );
}

export type DesktopMonthViewProps = {
  days: TimelineDay[];
  eventsByDay: Record<string, TimelineEvent[]>;
  abBuckets: Record<string, TimelineBucketItem[]>;
  monthAnchorDate: string;
  openCardModal: (shortId: string | null, source: string) => void;
  onToggleCheck: (cardId: string, checked: boolean) => void;
  onRenameCardTitle?: (cardId: string, nextTitle: string) => Promise<boolean>;
  onCardContextMenu?: (e: React.MouseEvent, cardId: string) => void;
  onOpenDayTimeline: (isoDate: string) => void;
  status?: string;
};

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const renderMonthCard = (
  entry: MonthCardEntry,
  props: Pick<
    DesktopMonthViewProps,
    "openCardModal" | "onToggleCheck" | "onRenameCardTitle" | "onCardContextMenu"
  >,
) => {
  if (entry.kind === "event") {
    return (
      <TimelineListCard
        key={`event:${entry.item.card_id}`}
        item={entry.item}
        kind="event"
        variant="desktop"
        openSource="month-view"
        shortcutView="month"
        openCardModal={props.openCardModal}
        onToggleCheck={props.onToggleCheck}
        onRenameCardTitle={props.onRenameCardTitle}
        onCardContextMenu={props.onCardContextMenu}
      />
    );
  }

  return (
    <TimelineListCard
      key={`bucket:${entry.bucket}:${entry.item.card_id}`}
      item={entry.item}
      kind="bucket"
      variant="desktop"
      openSource="month-view"
      shortcutView="month"
      bucketLabel={entry.bucket.toUpperCase()}
      openCardModal={props.openCardModal}
      onToggleCheck={props.onToggleCheck}
      onRenameCardTitle={props.onRenameCardTitle}
      onCardContextMenu={props.onCardContextMenu}
    />
  );
};

export function DesktopMonthView(props: DesktopMonthViewProps) {
  const { days, eventsByDay, abBuckets, monthAnchorDate, status, onOpenDayTimeline } = props;
  const todayIso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const cells = buildMonthCells({
    days,
    eventsByDay,
    abBuckets,
    anchorIsoDate: monthAnchorDate,
  });

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/60 px-3 pb-4">
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="bg-slate-100 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            {label}
          </div>
        ))}
        {status === "loading" ? (
          <div className="col-span-7 flex min-h-[480px] items-center justify-center bg-white text-sm font-medium text-slate-400">
            読み込み中...
          </div>
        ) : (
          cells.map((cell) => (
            <div
              key={cell.day.isoDate}
              className={clsx(
                "flex min-h-[124px] min-w-0 flex-col bg-white p-1.5",
                !cell.inCurrentMonth && "bg-slate-50 text-slate-400",
              )}
            >
              <button
                type="button"
                className="mb-1 flex items-center justify-between rounded-lg px-1.5 py-1 text-left hover:bg-slate-100"
                onClick={() => onOpenDayTimeline(cell.day.isoDate)}
              >
                <span
                  className={clsx(
                    "inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-sm font-semibold",
                    cell.day.isoDate === todayIso
                      ? "bg-sky-200 text-sky-800 ring-1 ring-sky-300"
                      : cell.inCurrentMonth
                        ? "text-slate-900"
                        : "text-slate-500",
                  )}
                >
                  {formatMonthDayNumber(cell.day.isoDate)}
                </span>
                <span className="text-[10px] font-medium text-slate-400">
                  {cell.activeCount}件{cell.completedCount > 0 ? ` 完${cell.completedCount}` : ""}
                </span>
              </button>

              <div className="min-h-0 flex-1 space-y-1 overflow-hidden">
                {cell.visibleEntries.map((entry) => renderMonthCard(entry, props))}
                {cell.hiddenTotalCount > 0 ? (
                  <button
                    type="button"
                    className="w-full rounded-lg border border-dashed border-slate-200 px-2 py-1 text-left text-[11px] font-medium text-slate-500 hover:bg-slate-50"
                    onClick={() => onOpenDayTimeline(cell.day.isoDate)}
                  >
                    +{cell.hiddenTotalCount}件
                  </button>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
