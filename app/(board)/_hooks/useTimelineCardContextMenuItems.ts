"use client";

import { useMemo } from "react";

import type { ContextMenuItem } from "@/app/(board)/_components/timeline/CardContextMenu";
import { findTimelineCardById } from "@/app/(board)/_utils/timeline-card-lookup";
import type { TimelineResponse } from "@/app/(board)/_utils/timeline-helpers";

type UseTimelineCardContextMenuItemsArgs = {
  boardId: string;
  contextMenuCardId: string | null;
  contextMenuTargetCardIds: string[];
  data: TimelineResponse | null;
  openCardModal: (shortId: string | null, source: string) => void;
  handleToggleCardChecked: (cardId: string, checked: boolean) => Promise<boolean>;
  moveCardByDayOffset: (cardId: string, offset: number) => Promise<boolean>;
  handleCardModalDelete: (cardId: string) => Promise<boolean>;
  refreshTimeline: () => Promise<unknown>;
  onBulkActionSuccess?: () => void;
};

export function useTimelineCardContextMenuItems({
  boardId,
  contextMenuCardId,
  contextMenuTargetCardIds,
  data,
  openCardModal,
  handleToggleCardChecked,
  moveCardByDayOffset,
  handleCardModalDelete,
  refreshTimeline,
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
    const readErrorMessage = async (response: Response, fallbackMessage: string) => {
      const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      return body?.error?.message ?? fallbackMessage;
    };
    const refreshAfterMutation = async () => {
      await refreshTimeline();
      onBulkActionSuccess?.();
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
        label: "ゴミ箱へ移動",
        variant: "danger",
        onClick: async () => {
          if (!confirm("カードをゴミ箱へ移動しますか？")) return;
          await runForTargetCards((cardId) => handleCardModalDelete(cardId));
        },
      },
    );

    if (!isBulkMenu && selectedCard) {
      const cardId = selectedCard.card_id;
      if (selectedCard.is_parent) {
        nextItems.unshift({
          label: "子カードを追加",
          onClick: async () => {
            const response = await fetch(`/api/boards/${boardId}/cards/${cardId}/children`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({}),
            });
            if (!response.ok) {
              alert(await readErrorMessage(response, "子カードの追加に失敗しました"));
              return;
            }
            const body = await response.json().catch(() => null) as { card?: { short_id?: string | null } } | null;
            await refreshAfterMutation();
            if (body?.card?.short_id) {
              openCardModal(body.card.short_id, "context-menu-parent-add-child");
            }
          },
        });
        nextItems.push({
          label: "親解除",
          onClick: async () => {
            if ((selectedCard.child_count ?? 0) > 0) {
              alert("子カードが残っているため親解除できません。先に子リンクを解除してください。");
              return;
            }
            const response = await fetch(`/api/boards/${boardId}/cards/${cardId}/unparent`, {
              method: "POST",
            });
            if (!response.ok) {
              alert(await readErrorMessage(response, "親解除に失敗しました"));
              return;
            }
            await refreshAfterMutation();
          },
        });
      } else if (selectedCard.parent_card_id) {
        nextItems.push({
          label: "親リンク解除",
          onClick: async () => {
            const response = await fetch(`/api/boards/${boardId}/cards/${cardId}/unlink`, {
              method: "POST",
            });
            if (!response.ok) {
              alert(await readErrorMessage(response, "親リンク解除に失敗しました"));
              return;
            }
            await refreshAfterMutation();
          },
        });
      } else {
        nextItems.push({
          label: "親カード化",
          onClick: async () => {
            const response = await fetch(`/api/boards/${boardId}/cards/${cardId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                is_parent: true,
                parent_card_id: null,
              }),
            });
            if (!response.ok) {
              alert(await readErrorMessage(response, "親カード化に失敗しました"));
              return;
            }
            await refreshAfterMutation();
          },
        });
      }
    }

    return nextItems;
  }, [
    boardId,
    contextMenuCardId,
    contextMenuTargetCardIds,
    handleCardModalDelete,
    handleToggleCardChecked,
    isBulkMenu,
    moveCardByDayOffset,
    onBulkActionSuccess,
    openCardModal,
    refreshTimeline,
    selectedCard,
    selectedCards,
  ]);

  return { selectedCard, items };
}
