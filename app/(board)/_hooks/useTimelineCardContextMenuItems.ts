"use client";

import { useMemo } from "react";

import type { ContextMenuItem } from "@/app/(board)/_components/timeline/CardContextMenu";
import { findTimelineCardById } from "@/app/(board)/_utils/timeline-card-lookup";
import { getIsoDateJst, type TimelineResponse } from "@/app/(board)/_utils/timeline-helpers";

const WEEKDAYS_JA = ["日", "月", "火", "水", "木", "金", "土"];

const addDays = (isoDate: string, offsetDays: number) => {
  const [year, month, day] = isoDate.split("-").map((value) => Number(value));
  if (!year || !month || !day || Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return isoDate;
  const baseUtc = Date.UTC(year, month - 1, day);
  const nextUtc = baseUtc + offsetDays * 24 * 60 * 60 * 1000;
  return new Date(nextUtc).toISOString().split("T")[0];
};

const formatContextMenuDateLabel = (isoDate: string) => {
  const [, rawMonth, rawDay] = isoDate.split("-");
  const month = Number(rawMonth);
  const day = Number(rawDay);
  const date = new Date(`${isoDate}T00:00:00Z`);
  const weekday = WEEKDAYS_JA[date.getUTCDay()] ?? "";
  if (!month || !day || !weekday) return isoDate;
  return `${month}/${day}${weekday}`;
};

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
    const todayIso = getIsoDateJst(data?.serverNow ?? new Date().toISOString());
    const dateLabel = (offsetDays: number) => formatContextMenuDateLabel(addDays(todayIso, offsetDays));

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
        label: `Todayへ:${dateLabel(0)}`,
        onClick: async () => {
          await runForTargetCards((cardId) => moveCardByDayOffset(cardId, 0));
        },
        children: [
          {
            label: `明日へ:${dateLabel(1)}`,
            onClick: async () => {
              await runForTargetCards((cardId) => moveCardByDayOffset(cardId, 1));
            },
          },
          {
            label: `明後日へ:${dateLabel(2)}`,
            onClick: async () => {
              await runForTargetCards((cardId) => moveCardByDayOffset(cardId, 2));
            },
          },
          {
            label: `明々後日へ:${dateLabel(3)}`,
            onClick: async () => {
              await runForTargetCards((cardId) => moveCardByDayOffset(cardId, 3));
            },
          },
          {
            label: `弥明後日へ:${dateLabel(4)}`,
            onClick: async () => {
              await runForTargetCards((cardId) => moveCardByDayOffset(cardId, 4));
            },
          },
          {
            label: `五明後日へ:${dateLabel(5)}`,
            onClick: async () => {
              await runForTargetCards((cardId) => moveCardByDayOffset(cardId, 5));
            },
          },
          {
            label: `六明後日へ:${dateLabel(6)}`,
            onClick: async () => {
              await runForTargetCards((cardId) => moveCardByDayOffset(cardId, 6));
            },
          },
          {
            label: `翌週へ:${dateLabel(7)}`,
            onClick: async () => {
              await runForTargetCards((cardId) => moveCardByDayOffset(cardId, 7));
            },
          },
        ],
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
