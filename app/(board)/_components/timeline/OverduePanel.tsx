import clsx from "clsx";

import { DraggableCard } from "@/app/(board)/_components/timeline/TimelineDraggableCard";
import {
  TimelineCard,
  TIMELINE_LIST_CARD_NOTE_CLAMP_CLASS,
} from "@/app/(board)/_components/timeline/TimelineCard";
import { buildTimelineCardTimeText } from "@/app/(board)/_components/timeline/timeline-card-meta";
import type { TimelineOverdueItem } from "@/app/(board)/_utils/timeline-helpers";

type OverduePanelProps = {
  items: readonly TimelineOverdueItem[];
  variant: "desktop" | "mobile";
  openCardModal: (shortId: string | null, source: string) => void;
  onToggleCheck: (cardId: string, checked: boolean) => void;
  onCardContextMenu: (e: React.MouseEvent, cardId: string) => void;
  onCardContextMenuByKeyboard: (cardId: string, rect: DOMRect) => void;
  contextMenuCardId: string | null;
  className?: string;
  contentClassName?: string;
  hideHeader?: boolean;
  compactEmptyState?: boolean;
  emptyStateMessage?: string;
};

function buildTimeText(item: TimelineOverdueItem) {
  return buildTimelineCardTimeText(item, {
    includeDate: true,
    includeDuration: true,
  });
}

function OverdueCardRow({
  item,
  openCardModal,
  onToggleCheck,
  onCardContextMenu,
  onCardContextMenuByKeyboard,
  isContextMenuOpen,
}: {
  item: TimelineOverdueItem;
  openCardModal: (shortId: string | null, source: string) => void;
  onToggleCheck: (cardId: string, checked: boolean) => void;
  onCardContextMenu: (e: React.MouseEvent, cardId: string) => void;
  onCardContextMenuByKeyboard: (cardId: string, rect: DOMRect) => void;
  isContextMenuOpen: boolean;
}) {
  return (
    <DraggableCard
      id={`overdue:${item.card_id}`}
      data={{ kind: "overdue", cardId: item.card_id, item }}
      disabled={isContextMenuOpen}
    >
      <div
        className="min-w-0"
        data-testid={`overdue-card-${item.card_id}`}
        onContextMenu={(e) => onCardContextMenu(e, item.card_id)}
      >
        <TimelineCard
          title={item.title || ""}
          checked={item.checked}
          checklist={item.checklist}
          content={item.content ?? null}
          onToggleCheck={(next) => onToggleCheck(item.card_id, next)}
          cardId={item.card_id}
          badgeLabel={item.due_bucket?.toUpperCase() ?? "O"}
          timeText={buildTimeText(item)}
          timePlacement="out-top"
          note={item.excerpt ?? undefined}
          noteClampClass={TIMELINE_LIST_CARD_NOTE_CLAMP_CLASS}
          notePreviewLines={3}
          onOpen={() => openCardModal(item.short_id, "overdue")}
          openButtonTestId={`cardOpenButton-overdue-${item.card_id}`}
          showOpenButton
          paddingClass="py-1"
          className="min-h-0 border-rose-200 bg-rose-50/80"
          onOpenContextMenu={(rect) => onCardContextMenuByKeyboard(item.card_id, rect)}
          focusGroup="bucket"
        />
      </div>
    </DraggableCard>
  );
}

export function OverduePanel({
  items,
  variant,
  openCardModal,
  onToggleCheck,
  onCardContextMenu,
  onCardContextMenuByKeyboard,
  contextMenuCardId,
  className,
  contentClassName,
  hideHeader = false,
  compactEmptyState = false,
  emptyStateMessage,
}: OverduePanelProps) {
  const countLabel = `${items.length}`;
  const resolvedEmptyStateMessage = emptyStateMessage ?? "Overdue card はありません";

  return (
    <section
      className={clsx(
        "flex min-h-0 min-w-0 flex-col border border-rose-200 bg-rose-50/60",
        variant === "desktop" ? "h-full" : "",
        className
      )}
    >
      {!hideHeader ? (
        <div className="flex items-center justify-between border-b border-rose-200 px-3 py-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-800">Overdue</p>
            <p className="text-[10px] text-rose-700/80">Past due and incomplete</p>
          </div>
          <span className="rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-rose-800 shadow-sm ring-1 ring-rose-200">
            {countLabel}
          </span>
        </div>
      ) : null}

      <div
        className={clsx(
          "min-h-0 flex-1 space-y-5 overflow-y-auto px-2 pb-2 pt-4 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-rose-200",
          contentClassName
        )}
      >
        {items.length === 0 ? (
          <p
            className={clsx(
              "rounded-md border border-dashed border-rose-200 bg-white/70 text-rose-700/80",
              compactEmptyState ? "px-3 py-2 text-[10px]" : "px-3 py-4 text-[11px]"
            )}
          >
            {resolvedEmptyStateMessage}
          </p>
        ) : (
          items.map((item) => (
            <OverdueCardRow
              key={item.card_id}
              item={item}
              openCardModal={openCardModal}
              onToggleCheck={onToggleCheck}
              onCardContextMenu={onCardContextMenu}
              onCardContextMenuByKeyboard={onCardContextMenuByKeyboard}
              isContextMenuOpen={contextMenuCardId === item.card_id}
            />
          ))
        )}
      </div>
    </section>
  );
}
