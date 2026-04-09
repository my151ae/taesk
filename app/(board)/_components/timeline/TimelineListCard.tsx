import clsx from "clsx";

import {
  TimelineCard,
  TIMELINE_LIST_CARD_NOTE_CLAMP_CLASS,
} from "@/app/(board)/_components/timeline/TimelineCard";
import { buildTimelineCardStatusItems, buildTimelineCardTimeText } from "@/app/(board)/_components/timeline/timeline-card-meta";
import type { TimelineBucketItem, TimelineEvent, TimelineOverdueItem } from "@/app/(board)/_utils/timeline-helpers";

type TimelineListCardProps = {
  item: TimelineEvent | TimelineBucketItem | TimelineOverdueItem;
  kind: "event" | "bucket" | "overdue";
  variant: "desktop" | "mobile";
  openSource: string;
  shortcutView?: "timeline" | "list" | "month";
  bucketLabel?: string | null;
  openCardModal: (shortId: string | null, source: string) => void;
  onToggleCheck: (cardId: string, checked: boolean) => void;
  onRenameCardTitle?: (cardId: string, nextTitle: string) => Promise<boolean>;
  onCardContextMenu?: (e: React.MouseEvent, cardId: string) => void;
};

export function TimelineListCard({
  item,
  kind,
  variant,
  openSource,
  shortcutView = "list",
  bucketLabel,
  openCardModal,
  onToggleCheck,
  onRenameCardTitle,
  onCardContextMenu,
}: TimelineListCardProps) {
  const isEvent = kind === "event";
  const isOverdue = kind === "overdue";
  const shouldShowTimeAboveCard = true;
  return (
    <div
      className={clsx(
        "min-w-0",
        shouldShowTimeAboveCard ? "pt-4" : "",
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
        statusItems={buildTimelineCardStatusItems(item, {
          includeTags: true,
          includeDate: isOverdue || !isEvent,
          includeTime: false,
          includeDuration: true,
          bucketLabel: bucketLabel ?? item.due_bucket?.toUpperCase() ?? (isEvent ? "A" : isOverdue ? "O" : null),
          includeReminder: true,
        })}
        timeText={buildTimelineCardTimeText(item, {
          includeDate: isOverdue || !isEvent,
          includeTime: isEvent || isOverdue,
          includeDuration: true,
        })}
        timePlacement="out-top"
        note={item.excerpt ?? undefined}
        noteClampClass={TIMELINE_LIST_CARD_NOTE_CLAMP_CLASS}
        notePreviewLines={2}
        rightMeta={null}
        onOpen={() => openCardModal(item.short_id, openSource)}
        openButtonTestId={`cardOpenButton-${openSource}-${item.card_id}`}
        showOpenButton
        paddingClass="py-1"
        className={clsx(
          "min-h-0",
          variant === "mobile" ? "shadow-sm" : ""
        )}
        shortcutContext={{
          scope: "board",
          region: "main-panel",
          view: shortcutView,
          part: "card",
        }}
        focusGroup="bucket"
        inlineTitleEdit={variant === "desktop"}
        onRenameTitle={
          variant === "desktop" && onRenameCardTitle
            ? (nextTitle) => onRenameCardTitle(item.card_id, nextTitle).then(() => undefined)
            : undefined
        }
      />
    </div>
  );
}
