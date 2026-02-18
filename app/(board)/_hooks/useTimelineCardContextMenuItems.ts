"use client";

import { useMemo } from "react";

import type { ContextMenuItem } from "@/app/(board)/_components/timeline/CardContextMenu";
import { findTimelineCardById } from "@/app/(board)/_utils/timeline-card-lookup";
import type { TimelineResponse } from "@/app/(board)/_utils/timeline-helpers";

type UseTimelineCardContextMenuItemsArgs = {
  contextMenuCardId: string | null;
  data: TimelineResponse | null;
  openCardModal: (shortId: string | null, source: string) => void;
  handleToggleCardChecked: (cardId: string, checked: boolean) => void;
  moveCardByDayOffset: (cardId: string, offset: number) => void;
  handleCardModalDelete: (cardId: string) => void;
};

export function useTimelineCardContextMenuItems({
  contextMenuCardId,
  data,
  openCardModal,
  handleToggleCardChecked,
  moveCardByDayOffset,
  handleCardModalDelete,
}: UseTimelineCardContextMenuItemsArgs) {
  const selectedCard = useMemo(() => {
    if (!contextMenuCardId) return null;
    const match = findTimelineCardById(data, contextMenuCardId);
    return match.event ?? match.bucketItem ?? null;
  }, [contextMenuCardId, data]);

  const items = useMemo<ContextMenuItem[]>(() => {
    if (!contextMenuCardId) return [];
    const isChecked = Boolean(selectedCard?.checked);
    return [
      {
        label: "カードを開く",
        onClick: () => {
          if (!selectedCard?.short_id) return;
          openCardModal(selectedCard.short_id, "context-menu");
        },
      },
      {
        label: isChecked ? "未完了に戻す" : "完了にする",
        onClick: () => {
          handleToggleCardChecked(contextMenuCardId, !isChecked);
        },
      },
      {
        label: "Todayへ",
        onClick: () => {
          moveCardByDayOffset(contextMenuCardId, 0);
        },
      },
      {
        label: "翌日へ",
        onClick: () => {
          moveCardByDayOffset(contextMenuCardId, 1);
        },
      },
      {
        label: "翌週へ",
        onClick: () => {
          moveCardByDayOffset(contextMenuCardId, 7);
        },
      },
      {
        label: "削除",
        variant: "danger",
        onClick: () => {
          if (confirm("カードを削除しますか？")) {
            handleCardModalDelete(contextMenuCardId);
          }
        },
      },
    ];
  }, [
    contextMenuCardId,
    handleCardModalDelete,
    handleToggleCardChecked,
    moveCardByDayOffset,
    openCardModal,
    selectedCard,
  ]);

  return { selectedCard, items };
}
