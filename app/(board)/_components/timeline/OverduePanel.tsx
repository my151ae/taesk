import clsx from "clsx";

import { DraggableCard } from "@/app/(board)/_components/timeline/TimelineDraggableCard";
import {
  TimelineCard,
  TIMELINE_LIST_CARD_NOTE_CLAMP_CLASS,
} from "@/app/(board)/_components/timeline/TimelineCard";
import type { TimelineOverdueItem } from "@/app/(board)/_utils/timeline-helpers";
import { formatDuration, timeLabel, toLocalDay } from "@/app/(board)/_utils/timeline-helpers";

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
};

function formatOverdueLabel(value: string | null) {
  const localDay = toLocalDay(value);
  if (!localDay) return "No date";
  const [, month, day] = localDay.split("-");
  return `${Number(month)}/${Number(day)}`;
}

function buildTimeText(item: TimelineOverdueItem) {
  const parts: string[] = [];
  const dateLabel = formatOverdueLabel(item.due_date ?? null);
  parts.push(dateLabel);
  if (item.due_start) {
    parts.push(timeLabel(item.due_start, item.due_end));
  }
  if (item.duration != null) {
    parts.push(`[${formatDuration(item.duration)}]`);
  }
  return parts.join(" ");
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
          paddingClass="py-1"
          className="min-h-0 border-slate-200 bg-amber-50/80"
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
}: OverduePanelProps) {
  const countLabel = `${items.length}`;

  return (
    <section
      className={clsx(
        "flex min-h-0 min-w-0 flex-col border border-amber-200 bg-amber-50/60",
        variant === "desktop" ? "h-full" : "",
        className
      )}
    >
      <div className="flex items-center justify-between border-b border-amber-200 px-3 py-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">Overdue</p>
          <p className="text-[10px] text-amber-700/80">Past due and incomplete</p>
        </div>
        <span className="rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-amber-800 shadow-sm">
          {countLabel}
        </span>
      </div>

      <div
        className={clsx(
          "min-h-0 flex-1 space-y-5 overflow-y-auto px-2 pb-2 pt-4 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-amber-200",
          contentClassName
        )}
      >
        {items.length === 0 ? (
          <p className="rounded-md border border-dashed border-amber-200 bg-white/70 px-3 py-4 text-[11px] text-amber-700/80">
            Overdue card はありません
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
