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

export type MobileMonthViewProps = {
  days: TimelineDay[];
  eventsByDay: Record<string, TimelineEvent[]>;
  abBuckets: Record<string, TimelineBucketItem[]>;
  monthAnchorDate: string;
  openCardModal: (shortId: string | null, source: string) => void;
  onToggleCheck: (cardId: string, checked: boolean) => void;
  onCardContextMenu?: (e: React.MouseEvent, cardId: string) => void;
  onOpenDayTimeline: (isoDate: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onToday: () => void;
  status?: string;
};

const WEEKDAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"] as const;

const renderMobileMonthCard = (
  entry: MonthCardEntry,
  props: Pick<MobileMonthViewProps, "openCardModal" | "onToggleCheck" | "onCardContextMenu">,
) => {
  if (entry.kind === "event") {
    return (
      <TimelineListCard
        key={`event:${entry.item.card_id}`}
        item={entry.item}
        kind="event"
        variant="mobile"
        openSource="month-view-mobile"
        shortcutView="month"
        openCardModal={props.openCardModal}
        onToggleCheck={props.onToggleCheck}
        onCardContextMenu={props.onCardContextMenu}
      />
    );
  }

  return (
    <TimelineListCard
      key={`bucket:${entry.bucket}:${entry.item.card_id}`}
      item={entry.item}
      kind="bucket"
      variant="mobile"
      openSource="month-view-mobile"
      shortcutView="month"
      bucketLabel={entry.bucket.toUpperCase()}
      openCardModal={props.openCardModal}
      onToggleCheck={props.onToggleCheck}
      onCardContextMenu={props.onCardContextMenu}
    />
  );
};

export default function MobileMonthView(props: MobileMonthViewProps) {
  const todayIso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const cells = buildMonthCells({
    days: props.days,
    eventsByDay: props.eventsByDay,
    abBuckets: props.abBuckets,
    anchorIsoDate: props.monthAnchorDate,
  });

  return (
    <div className="flex h-full flex-col overflow-hidden bg-slate-50/70">
      <div className="border-b border-slate-200 bg-white px-3 py-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <button type="button" onClick={props.onPrevMonth} className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-sm text-slate-600">
            {"<"}
          </button>
          <div className="text-sm font-semibold text-slate-800">{formatMonthTitle(props.monthAnchorDate)}</div>
          <button type="button" onClick={props.onNextMonth} className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-sm text-slate-600">
            {">"}
          </button>
          <button type="button" onClick={props.onToday} className="rounded-full bg-sky-200 px-3 py-1 text-xs font-medium text-sky-800 ring-1 ring-sky-300">
            Today
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
          {WEEKDAY_LABELS.map((label, index) => <div key={`${label}-${index}`}>{label}</div>)}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {props.status === "loading" ? (
          <div className="flex min-h-[320px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white text-sm text-slate-400">
            読み込み中...
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-1">
            {cells.map((cell) => (
              <button
                key={cell.day.isoDate}
                type="button"
                onClick={() => props.onOpenDayTimeline(cell.day.isoDate)}
                className={clsx(
                  "min-h-[3.25rem] rounded-xl border p-1.5 text-left",
                  cell.inCurrentMonth ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-100 text-slate-400",
                )}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={clsx(
                      "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-sm font-semibold",
                      cell.day.isoDate === todayIso && "bg-sky-200 text-sky-800 ring-1 ring-sky-300",
                    )}
                  >
                    {formatMonthDayNumber(cell.day.isoDate)}
                  </span>
                  {cell.activeCount > 0 || cell.completedCount > 0 ? (
                    <span className="text-[10px] text-slate-400">
                      {cell.activeCount}{cell.completedCount > 0 ? ` 完${cell.completedCount}` : ""}
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 text-[10px] leading-4 text-slate-500">
                  {cell.visibleEntries.length > 0 ? `${cell.visibleEntries.length}件表示` : ""}
                  {cell.hiddenTotalCount > 0 ? ` +${cell.hiddenTotalCount}` : ""}
                </div>
              </button>
            ))}
          </div>
        )}

        <div className="mt-4 space-y-4">
          {cells
            .filter((cell) => cell.activeCount > 0)
            .map((cell) => (
              <section key={`mobile-list:${cell.day.isoDate}`} className="rounded-2xl border border-slate-200 bg-white p-3">
                <button type="button" className="mb-3 flex w-full items-center justify-between text-left" onClick={() => props.onOpenDayTimeline(cell.day.isoDate)}>
                  <span className="text-sm font-semibold text-slate-900">{cell.day.label}</span>
                  <span className="text-xs text-slate-400">Timelineへ</span>
                </button>
                <div className="space-y-2">
                  {cell.sections.map((section) =>
                    section.items.length > 0 ? (
                      <div key={`${cell.day.isoDate}:${section.key}`} className="space-y-1">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                          {section.label}
                        </div>
                        {section.visibleItems.slice(0, 2).map((entry) => renderMobileMonthCard(entry, props))}
                        {section.items.length - Math.min(section.visibleItems.length, 2) > 0 ? (
                          <button
                            type="button"
                            className="w-full rounded-lg border border-dashed border-slate-200 px-2 py-1 text-left text-[11px] text-slate-500"
                            onClick={() => props.onOpenDayTimeline(cell.day.isoDate)}
                          >
                            +{section.items.length - Math.min(section.visibleItems.length, 2)}件
                          </button>
                        ) : null}
                      </div>
                    ) : null,
                  )}
                </div>
              </section>
            ))}
        </div>
      </div>
    </div>
  );
}
