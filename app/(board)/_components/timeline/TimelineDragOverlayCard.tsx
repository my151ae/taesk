"use client";

import clsx from "clsx";

import {
  TimelineCard,
  TIMELINE_LIST_CARD_NOTE_CLAMP_CLASS,
} from "@/app/(board)/_components/timeline/TimelineCard";
import { buildTimelineCardStatusItems } from "@/app/(board)/_components/timeline/timeline-card-meta";
import type { TimelineBucketItem, TimelineEvent, TimelineOverdueItem } from "@/app/(board)/_utils/timeline-helpers";
import { minuteToPixels } from "@/app/(board)/_utils/timeline-helpers";
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
    const eventStatusItems = overlayTimelineEvent
      ? buildTimelineCardStatusItems(overlayTimelineEvent, {
          includeTags: false,
          includeDate: false,
          includeTime: true,
          includeDuration: true,
          includeProgress: false,
          bucketLabel: overlayCardData.badge.toUpperCase(),
        })
      : [];
    return (
      <div
        className="pointer-events-none w-[220px] max-w-[260px] rounded-lg bg-transparent shadow-lg"
        data-testid={`timeline-drag-overlay-${variant}`}
        data-overlay-kind={overlayKind}
      >
        <TimelineCard
          title={overlayCardData.title}
          statusItems={eventStatusItems}
          note={overlayCardData.note ?? undefined}
          noteClampClass="line-clamp-2"
          notePreviewLines={2}
          checked={overlayTimelineEvent?.checked ?? false}
          checklist={overlayTimelineEvent?.checklist ?? null}
          content={overlayTimelineEvent?.content ?? null}
          onToggleCheck={() => {}}
          onOpen={() => {}}
          timeText={null}
          timePlacement="inline"
          densityMode={overlayTimelineEvent ? "compact" : "minimal"}
          className="w-full border-none shadow-none"
        />
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
          statusItems={listOverlayCard ? buildTimelineCardStatusItems(listOverlayCard, {
            includeTags: true,
            includeDate: true,
            includeTime: isOverdueListOverlay,
            includeDuration: true,
            bucketLabel: overlayCardData.badge?.toUpperCase(),
          }) : []}
          timeText={null}
          note={overlayCardData.note ?? undefined}
          noteClampClass={TIMELINE_LIST_CARD_NOTE_CLAMP_CLASS}
          notePreviewLines={2}
          rightMeta={undefined}
          checked={listOverlayCard?.checked ?? false}
          checklist={listOverlayCard?.checklist ?? null}
          content={listOverlayCard?.content ?? null}
          onToggleCheck={() => {}}
          onOpen={() => {}}
          timePlacement="inline"
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
        statusItems={overlayTimelineEvent ? buildTimelineCardStatusItems(overlayTimelineEvent, {
          includeTags: false,
          includeDate: false,
          includeTime: true,
          includeDuration: true,
          includeProgress: false,
          bucketLabel: overlayCardData.badge?.toUpperCase(),
        }) : []}
        timeText={null}
        note={overlayCardData.note ?? undefined}
        noteClampClass="line-clamp-2"
        notePreviewLines={2}
        rightMeta={undefined}
        checked={overlayTimelineEvent?.checked ?? overlayBucketCard?.checked ?? overlayOverdueCard?.checked ?? false}
        checklist={overlayTimelineEvent?.checklist ?? overlayBucketCard?.checklist ?? overlayOverdueCard?.checklist ?? null}
        content={overlayTimelineEvent?.content ?? overlayBucketCard?.content ?? overlayOverdueCard?.content ?? null}
        onToggleCheck={() => {}}
        onOpen={() => {}}
        timePlacement="inline"
        densityMode={overlayTimelineEvent ? "compact" : "default"}
        className="w-full h-full border-none shadow-none"
        paddingClass="py-2"
      />
    </div>
  );
}
