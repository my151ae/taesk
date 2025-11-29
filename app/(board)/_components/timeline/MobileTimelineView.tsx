"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, useAnimationControls, type PanInfo } from "framer-motion";
import {
  HOUR_HEIGHT,
  HOURS,
  TIMELINE_HEIGHT,
  calculateEventLayout,
  minuteToPixels,
  timeLabel,
  TimelineBucketItem,
  TimelineDay,
  TimelineEvent,
  buildAbMeta,
  getMinutesFromTime,
} from "@/app/(board)/_utils/timeline-helpers";
import { bucketKeyToDueBucket } from "@/lib/bucket-normalization";
import { ChecklistEditor, ChecklistSaveTrigger } from "@/app/(board)/_components/checklist/ChecklistEditor";
import { ChecklistPreview } from "@/app/(board)/_components/checklist/ChecklistPreview";
import { Checklist, normalizeChecklist, EMPTY_CHECKLIST, countNonEmptyLines } from "@/lib/checklist";

function MobileInlineChecklist({
  cardId,
  checklist,
  editingCardId,
  onChecklistEditingChange,
  onChecklistCommit,
  showCount = false,
}: {
  cardId: string;
  checklist: Checklist | null;
  editingCardId: string | null;
  onChecklistEditingChange: (cardId: string, editing: boolean) => void;
  onChecklistCommit: (cardId: string, checklist: Checklist, trigger: ChecklistSaveTrigger) => void;
  showCount?: boolean;
}) {
  const [draft, setDraft] = useState<Checklist>(normalizeChecklist(checklist ?? EMPTY_CHECKLIST));

  useEffect(() => {
    if (editingCardId === cardId) return;
    setDraft(normalizeChecklist(checklist ?? EMPTY_CHECKLIST));
  }, [checklist, cardId, editingCardId]);

  const isEditing = editingCardId === cardId;
  const lineCount = countNonEmptyLines(draft);

  return (
    <div className="mt-2 space-y-1">
      {showCount ? <div className="text-[10px] text-slate-500">☑︎ {lineCount}</div> : null}
      {isEditing ? (
        <ChecklistEditor
          value={draft}
          onChange={(next) => setDraft(next)}
          onCommit={async (next, trigger) => {
            const normalized = normalizeChecklist(next);
            await onChecklistCommit(cardId, normalized, trigger);
          }}
          onEditingChange={(editing) => onChecklistEditingChange(cardId, editing)}
          autoSaveDelayMs={1500}
          placeholder="- [ ] タスクを書く"
        />
      ) : (
        <ChecklistPreview
          checklist={draft}
          maxLines={3}
          onClick={(e) => {
            e.stopPropagation();
            onChecklistEditingChange(cardId, true);
          }}
        />
      )}
    </div>
  );
}

type MobileTimelineViewProps = {
  days: TimelineDay[];
  activeDayIndex: number;
  onPrevDay: () => void;
  onNextDay: () => void;
  eventsByDay: Record<string, TimelineEvent[]>;
  abBuckets: Record<string, TimelineBucketItem[]>;
  indicatorTop: number | null;
  indicatorDayIso: string | null;
  timelineViewportHeight: number;
  openCardModal: (shortId: string | null, source: string) => void;
  onToggleCheck: (cardId: string, checked: boolean) => void;
  onChecklistCommit: (cardId: string, checklist: Checklist, trigger: ChecklistSaveTrigger) => void;
  onChecklistEditingChange: (cardId: string, editing: boolean) => void;
  editingCardId: string | null;
  status: string;
};

export default function MobileTimelineView({
  days,
  activeDayIndex,
  onPrevDay,
  onNextDay,
  eventsByDay,
  abBuckets,
  indicatorTop,
  indicatorDayIso,
  timelineViewportHeight,
  openCardModal,
  onToggleCheck,
  onChecklistCommit,
  onChecklistEditingChange,
  editingCardId,
  status,
}: MobileTimelineViewProps) {
  const controls = useAnimationControls();
  const activeDay = useMemo(() => days[activeDayIndex] ?? days[0] ?? null, [activeDayIndex, days]);

  const eventsForDay = useMemo(() => {
    if (!activeDay) return [] as TimelineEvent[];
    return eventsByDay[activeDay.isoDate] ?? [];
  }, [activeDay, eventsByDay]);

  const layoutMap = useMemo(() => calculateEventLayout(eventsForDay), [eventsForDay]);
  const abMeta = useMemo(() => (activeDay ? buildAbMeta(activeDay) : null), [activeDay]);

  const handleDragEnd = (_event: PointerEvent, info: PanInfo) => {
    if (info.offset.x > 80) {
      onPrevDay();
    } else if (info.offset.x < -80) {
      onNextDay();
    }

    controls.start({ x: 0, transition: { type: "spring", stiffness: 280, damping: 30 } });
  };

  const activeDayIso = activeDay?.isoDate ?? null;
  const indicatorVisible = indicatorTop != null && activeDayIso && indicatorDayIso === activeDayIso;
  const indicatorPosition = indicatorTop ?? 0;
  const activeBuckets = useMemo(() => {
    if (!activeDay) return {} as Record<string, TimelineBucketItem[]>;
    const entries = Object.entries(abBuckets || {}).filter(([key]) => key.startsWith(activeDay.key));
    return Object.fromEntries(entries);
  }, [abBuckets, activeDay]);

  if (!activeDay) return null;

  return (
    <div className="relative flex h-full flex-col bg-white">
      {(status === "loading" || !days.length) && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-white/60 backdrop-blur-sm">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-sky-500" />
        </div>
      )}

      <motion.div
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.2}
        onDragEnd={handleDragEnd}
        animate={controls}
        className="flex h-full flex-col"
      >
        <div className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-100 bg-white px-3 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <button
            type="button"
            aria-label="前の日"
            disabled={status === "loading"}
            onClick={(e) => {
              e.preventDefault();
              onPrevDay();
            }}
            className="rounded border border-slate-300 bg-white p-1.5 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <svg className="h-4 w-4 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex flex-col items-center gap-0.5 text-slate-800">
            <span>{activeDay.label}</span>
            <span className="text-[10px] text-slate-400 normal-case tracking-normal">{activeDay.isoDate} · GMT+09</span>
          </div>
          <button
            type="button"
            aria-label="次の日"
            disabled={status === "loading"}
            onClick={(e) => {
              e.preventDefault();
              onNextDay();
            }}
            className="rounded border border-slate-300 bg-white p-1.5 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <svg className="h-4 w-4 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        <div
          className="grid flex-1 overflow-y-auto"
          style={{ gridTemplateColumns: "1fr 1fr", minHeight: Math.max(timelineViewportHeight, TIMELINE_HEIGHT) }}
        >
          <div className="min-w-0 border-r border-slate-100 bg-white">
            <div className="relative grid h-full grid-cols-[60px_1fr]" style={{ minHeight: Math.max(timelineViewportHeight, TIMELINE_HEIGHT) }}>
              <div className="relative border-r border-slate-100 text-[10px] font-semibold text-slate-500">
                {HOURS.map((hour, idx) => (
                  <div key={hour} className="flex h-10 items-start justify-end pr-2">
                    {idx === 0 ? null : <span className="-mt-1 leading-none">{hour}</span>}
                  </div>
                ))}
              </div>

              <div className="relative">
                <div className="pointer-events-none absolute inset-0" style={{ height: TIMELINE_HEIGHT }}>
                  {HOURS.map((hour, idx) => (
                    <div
                      key={hour}
                      className="absolute left-0 right-0 border-b border-slate-200"
                      style={{ top: idx * HOUR_HEIGHT }}
                    />
                  ))}
                </div>

                {indicatorVisible && (
                  <div
                    className="pointer-events-none absolute z-10"
                    style={{ top: indicatorPosition, left: 0, right: 0 }}
                  >
                    <div className="relative h-px bg-red-400/80">
                      <div className="absolute top-1/2 left-0 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500" />
                    </div>
                  </div>
                )}

                <div className="relative" style={{ height: TIMELINE_HEIGHT }}>
                  {eventsForDay.map((event) => {
                    const start = getMinutesFromTime(event.due_start ?? null) ?? 0;
                    const duration = Math.max(event.durationMinutes ?? 60, 30);
                    const top = minuteToPixels(start);
                    const height = Math.max(minuteToPixels(duration), 32);
                    const layout = layoutMap[event.card_id];

                    return (
                      <div
                        key={event.card_id}
                        className="absolute flex flex-col gap-2 border border-slate-200 bg-white p-3 pt-5 text-left shadow-sm"
                        style={{
                          top,
                          height,
                          left: layout?.left ?? "0%",
                          width: layout?.width ?? "100%",
                        }}
                        onClick={(native) => {
                          native.stopPropagation();
                          openCardModal(event.short_id, "mobile-timeline");
                        }}
                      >
                        <div className="flex items-start gap-2 pr-6">
                          <button
                            type="button"
                            onClick={(native) => {
                              native.stopPropagation();
                              onToggleCheck(event.card_id, !event.checked);
                            }}
                            aria-label={event.checked ? "未完了に戻す" : "完了にする"}
                            className="mt-0.5 flex h-3.5 w-3.5 items-center justify-center border border-slate-300 text-[8px] font-bold text-transparent transition hover:border-sky-400"
                          >
                            {event.checked ? "✓" : ""}
                          </button>
                          <div className="flex min-w-0 flex-1 flex-col gap-1 text-[11px] font-semibold text-slate-800">
                            <span className="break-words leading-tight">
                              {event.title || "Untitled card"}
                            </span>
                          </div>
                        </div>

                        <div
                          className="absolute -top-px left-0 px-1 text-[10px] font-semibold text-slate-600"
                          title={timeLabel(event.due_start, event.due_end)}
                        >
                          {timeLabel(event.due_start, event.due_end)}
                        </div>

                        <div className="absolute right-2 top-2">
                          <span className="rounded-full border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-600 shadow-sm">
                            {(event.due_bucket ?? "a").toUpperCase()}
                          </span>
                        </div>

                        <MobileInlineChecklist
                          cardId={event.card_id}
                          checklist={event.checklist ?? null}
                          editingCardId={editingCardId}
                          onChecklistEditingChange={onChecklistEditingChange}
                          onChecklistCommit={onChecklistCommit}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="min-w-0 overflow-hidden border-l border-slate-100">
            <div className="px-3 py-2">
              {abMeta?.sections?.length ? (
                <>
                  <p className="text-[11px] font-semibold text-slate-700">{abMeta.sections[0]?.label}</p>
                  <p className="text-[10px] text-slate-400">{abMeta.sections[0]?.helper}</p>
                </>
              ) : null}
            </div>

            <div className="space-y-3 px-3 pb-4">
              {abMeta?.sections.map((section) => {
                const items = activeBuckets[section.bucket] ?? [];
                return (
                  <div key={section.bucket} className="rounded-xl border border-slate-200 bg-slate-50/70 shadow-inner">
                    <div className="border-b border-slate-200 px-3 py-2">
                      <p className="text-[11px] font-semibold text-slate-700">{section.label}</p>
                      <p className="text-[10px] text-slate-400">{section.helper}</p>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {items.length === 0 ? (
                        <p className="px-3 py-3 text-[11px] text-slate-400">カードがありません</p>
                      ) : (
                        items.map((item) => (
                          <div
                            key={item.card_id}
                            className="flex w-full flex-col gap-1 px-3 py-3"
                            onClick={(native) => {
                              native.stopPropagation();
                              openCardModal(item.short_id, "mobile-ab");
                            }}
                          >
                            <div className="flex items-start gap-2">
                              <input
                                type="checkbox"
                                checked={item.checked}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  onToggleCheck(item.card_id, e.target.checked);
                                }}
                                className="mt-0.5 h-3.5 w-3.5 cursor-pointer border-slate-300 text-sky-500"
                              />
                              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                <div className="flex items-start justify-between gap-2">
                                  <span className="text-[12px] font-semibold text-slate-800 line-clamp-2">{item.title || "Untitled card"}</span>
                                  <span className="self-start rounded-full border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-600 shadow-sm">
                                    {bucketKeyToDueBucket(section.bucket).toUpperCase()}
                                  </span>
                                </div>
                                {item.due_start && (
                                  <span className="text-[10px] text-slate-500">{timeLabel(item.due_start, item.due_end)}</span>
                                )}
                              </div>
                              <button
                                type="button"
                                className="rounded border border-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-50"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openCardModal(item.short_id, "mobile-ab");
                                }}
                              >
                                開く
                              </button>
                            </div>

                            <MobileInlineChecklist
                              cardId={item.card_id}
                              checklist={item.checklist ?? null}
                              editingCardId={editingCardId}
                              onChecklistEditingChange={onChecklistEditingChange}
                              onChecklistCommit={onChecklistCommit}
                              showCount
                            />
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
