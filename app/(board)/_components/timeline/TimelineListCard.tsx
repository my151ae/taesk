import clsx from "clsx";

import {
  TimelineCard,
  TIMELINE_LIST_CARD_NOTE_CLAMP_CLASS,
} from "@/app/(board)/_components/timeline/TimelineCard";
import { buildTimelineCardTimeText } from "@/app/(board)/_components/timeline/timeline-card-meta";
import type { TimelineBucketItem, TimelineEvent } from "@/app/(board)/_utils/timeline-helpers";

type TimelineListCardProps = {
  item: TimelineEvent | TimelineBucketItem;
  kind: "event" | "bucket";
  variant: "desktop" | "mobile";
  openSource: string;
  bucketLabel?: string | null;
  openCardModal: (shortId: string | null, source: string) => void;
  onToggleCheck: (cardId: string, checked: boolean) => void;
  onCardContextMenu?: (e: React.MouseEvent, cardId: string) => void;
};

export function TimelineListCard({
  item,
  kind,
  variant,
  openSource,
  bucketLabel,
  openCardModal,
  onToggleCheck,
  onCardContextMenu,
}: TimelineListCardProps) {
  const isEvent = kind === "event";
  const timeText = isEvent
    ? buildTimelineCardTimeText(item, { includeDuration: true })
    : buildTimelineCardTimeText(item, {
        includeDate: true,
        includeTime: false,
        includeDuration: true,
      });

  return (
    <div
      className={clsx(
        "min-w-0",
        timeText ? "pt-4" : "",
        variant === "mobile" ? "active:scale-[0.98] transition-transform" : ""
      )}
      onContextMenu={(e) => onCardContextMenu?.(e, item.card_id)}
    >
      <TimelineCard
        title={item.title || ""}
        checked={item.checked}
        checklist={item.checklist}
        content={item.content ?? null}
        onToggleCheck={(next) => onToggleCheck(item.card_id, next)}
        cardId={item.card_id}
        badgeLabel={bucketLabel ?? item.due_bucket?.toUpperCase() ?? (isEvent ? "A" : null)}
        timeText={timeText}
        timePlacement={timeText ? "out-top" : "inline"}
        note={item.excerpt ?? undefined}
        noteClampClass={TIMELINE_LIST_CARD_NOTE_CLAMP_CLASS}
        notePreviewLines={3}
        rightMeta={null}
        onOpen={() => openCardModal(item.short_id, openSource)}
        paddingClass="py-1"
        className={clsx(
          "min-h-0",
          variant === "mobile" ? "shadow-sm" : ""
        )}
        focusGroup="bucket"
      />
    </div>
  );
}
