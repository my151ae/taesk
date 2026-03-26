"use client";

import { useMemo } from "react";

import type { ContextMenuItem } from "@/app/(board)/_components/timeline/CardContextMenu";
import { findTimelineCardById } from "@/app/(board)/_utils/timeline-card-lookup";
import type { TimelineResponse } from "@/app/(board)/_utils/timeline-helpers";

type UseTimelineCardContextMenuItemsArgs = {
  contextMenuCardId: string | null;
  contextMenuTargetCardIds: string[];
  data: TimelineResponse | null;
  openCardModal: (shortId: string | null, source: string) => void;
  handleToggleCardChecked: (cardId: string, checked: boolean) => Promise<boolean>;
  moveCardByDayOffset: (cardId: string, offset: number) => Promise<boolean>;
  handleCardModalDelete: (cardId: string) => Promise<boolean>;
  onBulkActionSuccess?: () => void;
};

export function useTimelineCardContextMenuItems({
  contextMenuCardId,
  contextMenuTargetCardIds,
  data,
  openCardModal,
  handleToggleCardChecked,
  moveCardByDayOffset,
  handleCardModalDelete,
  onBulkActionSuccess,
}: UseTimelineCardContextMenuItemsArgs) {
  const selectedCards = useMemo(() => {
    if (!contextMenuTargetCardIds.length) return [];
    return contextMenuTargetCardIds
      .map((cardId) => {
        const match = findTimelineCardById(data, cardId);
        return match.event ?? match.bucketItem ?? match.overdueItem ?? null;
      })
      .filter(Boolean);
  }, [contextMenuTargetCardIds, data]);

  const selectedCard = selectedCards[0] ?? null;
  const isBulkMenu = contextMenuTargetCardIds.length > 1;

  const items = useMemo<ContextMenuItem[]>(() => {
    if (!contextMenuCardId || !contextMenuTargetCardIds.length) return [];

    const hasUncheckedCard = selectedCards.some((card) => !card?.checked);
    const toggleLabel = isBulkMenu
      ? hasUncheckedCard
        ? "すべて完了にする"
        : "すべて未完了に戻す"
      : selectedCard?.checked
        ? "未完了に戻す"
        : "完了にする";

    const runForTargetCards = async (runner: (cardId: string) => Promise<boolean>) => {
      let didSucceed = true;
      for (const cardId of contextMenuTargetCardIds) {
        const success = await runner(cardId);
        if (!success) {
          didSucceed = false;
        }
      }
      if (didSucceed) {
        onBulkActionSuccess?.();
      }
    };

    const nextItems: ContextMenuItem[] = [];
    if (!isBulkMenu) {
      nextItems.push({
        label: "カードを開く",
        onClick: () => {
          if (!selectedCard?.short_id) return;
          openCardModal(selectedCard.short_id, "context-menu");
        },
      });
    }

    nextItems.push(
      {
        label: toggleLabel,
        onClick: async () => {
          await runForTargetCards((cardId) => handleToggleCardChecked(cardId, hasUncheckedCard));
        },
      },
      {
        label: "Todayへ",
        onClick: async () => {
          await runForTargetCards((cardId) => moveCardByDayOffset(cardId, 0));
        },
      },
      {
        label: "翌日へ",
        onClick: async () => {
          await runForTargetCards((cardId) => moveCardByDayOffset(cardId, 1));
        },
      },
      {
        label: "翌週へ",
        onClick: async () => {
          await runForTargetCards((cardId) => moveCardByDayOffset(cardId, 7));
        },
      },
      {
        label: "削除",
        variant: "danger",
        onClick: async () => {
          if (!confirm("カードを削除しますか？")) return;
          await runForTargetCards((cardId) => handleCardModalDelete(cardId));
        },
      },
    );

    return nextItems;
  }, [
    contextMenuCardId,
    contextMenuTargetCardIds,
    handleCardModalDelete,
    handleToggleCardChecked,
    isBulkMenu,
    moveCardByDayOffset,
    onBulkActionSuccess,
    openCardModal,
    selectedCard,
    selectedCards,
  ]);

  return { selectedCard, items };
}
