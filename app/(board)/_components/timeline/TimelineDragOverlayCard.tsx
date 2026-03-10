"use client";

import clsx from "clsx";

import {
  TimelineCard,
  TIMELINE_LIST_CARD_NOTE_CLAMP_CLASS,
} from "@/app/(board)/_components/timeline/TimelineCard";
import type { TimelineBucketItem, TimelineEvent, TimelineOverdueItem } from "@/app/(board)/_utils/timeline-helpers";
import { formatDuration, minuteToPixels, timeLabel } from "@/app/(board)/_utils/timeline-helpers";
import type { OverlayCardData } from "@/app/(board)/_utils/timeline-overlay";

type TimelineDragOverlayCardProps = {
  variant: "desktop" | "mobile";
  overlayCardData: OverlayCardData | null;
  overlayTimelineEvent?: TimelineEvent | null;
  overlayBucketCard?: TimelineBucketItem | null;
  overlayOverdueCard?: TimelineOverdueItem | null;
};

export function TimelineDragOverlayCard({
  variant,
  overlayCardData,
  overlayTimelineEvent = null,
  overlayBucketCard = null,
  overlayOverdueCard = null,
}: TimelineDragOverlayCardProps) {
  if (!overlayCardData) return null;
  const listOverlayCard = overlayBucketCard ?? overlayOverdueCard;
  const isListOverlay = !overlayTimelineEvent && Boolean(listOverlayCard);
  const isOverdueListOverlay = !overlayBucketCard && Boolean(overlayOverdueCard);
  const overlayKind = isOverdueListOverlay ? "overdue" : isListOverlay ? "bucket" : "timeline";

  if (variant === "mobile" && !isListOverlay) {
    return (
      <div
        className="pointer-events-none w-[220px] max-w-[260px] rounded-lg border border-slate-200 bg-white p-3 shadow-lg"
        data-testid={`timeline-drag-overlay-${variant}`}
        data-overlay-kind={overlayKind}
      >
        <div className="flex items-start gap-2">
          <span className="rounded-full border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-600 shadow-sm">
            {overlayCardData.badge.toUpperCase()}
          </span>
          <div
            className={clsx(
              "min-w-0 flex-1 text-[12px] font-semibold leading-tight line-clamp-2 break-words",
              !overlayCardData.title ? "text-slate-400" : "text-slate-800"
            )}
          >
            {overlayCardData.title || "Untitled card"}
          </div>
        </div>
        {overlayCardData.note ? (
          <div className="mt-1 text-[10px] text-slate-600 leading-tight line-clamp-2 whitespace-pre-wrap break-words">
            {overlayCardData.note}
          </div>
        ) : null}
        {overlayCardData.timeText ? (
          <div className="mt-1 text-[11px] text-slate-600">{overlayCardData.timeText}</div>
        ) : null}
      </div>
    );
  }

  if (isListOverlay) {
    return (
      <div
        className={clsx(
          "pointer-events-none w-[240px] max-w-[260px] rounded-md bg-transparent shadow-xl opacity-90",
          isOverdueListOverlay ? "overflow-visible pt-4" : "overflow-hidden"
        )}
        data-testid={`timeline-drag-overlay-${variant}`}
        data-overlay-kind={overlayKind}
      >
        <TimelineCard
          title={overlayCardData.title}
          badgeLabel={overlayCardData.badge?.toUpperCase()}
          timeText={overlayCardData.timeText}
          note={overlayCardData.note ?? undefined}
          noteClampClass={TIMELINE_LIST_CARD_NOTE_CLAMP_CLASS}
          notePreviewLines={3}
          rightMeta={
            !isOverdueListOverlay && listOverlayCard?.duration != null
              ? formatDuration(listOverlayCard.duration)
              : undefined
          }
          checked={listOverlayCard?.checked ?? false}
          checklist={listOverlayCard?.checklist ?? null}
          content={listOverlayCard?.content ?? null}
          onToggleCheck={() => {}}
          onOpen={() => {}}
          timePlacement={isOverdueListOverlay ? "out-top" : "inline"}
          className="w-full border-none shadow-none"
          paddingClass="py-1"
        />
      </div>
    );
  }

  return (
    <div
      className="shadow-xl opacity-90 rounded-md overflow-hidden bg-white"
      data-testid={`timeline-drag-overlay-${variant}`}
      data-overlay-kind={overlayKind}
      style={{
        width: 240,
        height: overlayTimelineEvent
          ? Math.max(minuteToPixels(overlayTimelineEvent.durationMinutes ?? 60, 0), 20)
          : undefined,
      }}
    >
      <TimelineCard
        title={overlayCardData.title}
        badgeLabel={overlayCardData.badge?.toUpperCase()}
        timeText={
          overlayTimelineEvent
            ? timeLabel(overlayTimelineEvent.due_start, overlayTimelineEvent.due_end)
            : overlayCardData.timeText
        }
        note={overlayCardData.note ?? undefined}
        noteClampClass="line-clamp-2"
        notePreviewLines={2}
        rightMeta={
          overlayTimelineEvent
            ? formatDuration(overlayTimelineEvent.durationMinutes ?? 60)
            : undefined
        }
        checked={overlayTimelineEvent?.checked ?? overlayBucketCard?.checked ?? overlayOverdueCard?.checked ?? false}
        checklist={overlayTimelineEvent?.checklist ?? overlayBucketCard?.checklist ?? overlayOverdueCard?.checklist ?? null}
        content={overlayTimelineEvent?.content ?? overlayBucketCard?.content ?? overlayOverdueCard?.content ?? null}
        onToggleCheck={() => {}}
        onOpen={() => {}}
        timePlacement="out-top"
        className="w-full h-full border-none shadow-none"
        paddingClass="py-2"
      />
    </div>
  );
}
