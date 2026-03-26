"use client";

import { useCallback, useMemo, useState } from "react";

export type TimelineSelectionMeta = {
  cardId: string;
  laneId: string;
  activeCardId: string | null;
  activeLaneId: string | null;
};

type TimelineCardSelectionState = {
  selectedCardIds: string[];
  selectionLane: string | null;
  selectionLeadCardId: string | null;
  activeCardId: string | null;
  activeLaneId: string | null;
};

const EMPTY_SELECTED_IDS: string[] = [];

export function useTimelineCardSelection() {
  const [selectionState, setSelectionState] = useState<TimelineCardSelectionState>({
    selectedCardIds: EMPTY_SELECTED_IDS,
    selectionLane: null,
    selectionLeadCardId: null,
    activeCardId: null,
    activeLaneId: null,
  });

  const clearSelection = useCallback(() => {
    setSelectionState((prev) => {
      if (!prev.selectedCardIds.length && !prev.selectionLane && !prev.selectionLeadCardId) {
        return prev;
      }
      return {
        selectedCardIds: EMPTY_SELECTED_IDS,
        selectionLane: null,
        selectionLeadCardId: null,
        activeCardId: prev.activeCardId,
        activeLaneId: prev.activeLaneId,
      };
    });
  }, []);

  const setActiveCard = useCallback((cardId: string, laneId: string) => {
    setSelectionState((prev) => {
      if (prev.activeCardId === cardId && prev.activeLaneId === laneId) {
        return prev;
      }
      return {
        ...prev,
        activeCardId: cardId,
        activeLaneId: laneId,
      };
    });
  }, []);

  const handleShiftSelect = useCallback((meta: TimelineSelectionMeta) => {
    const { cardId, laneId, activeCardId, activeLaneId } = meta;

    setSelectionState((prev) => {
      const resolvedActiveCardId = activeCardId ?? prev.activeCardId;
      const resolvedActiveLaneId = activeLaneId ?? prev.activeLaneId;

      if (!resolvedActiveCardId || !resolvedActiveLaneId) {
        return prev;
      }

      if (!prev.selectedCardIds.length) {
        if (resolvedActiveLaneId !== laneId) {
          return {
            ...prev,
            activeCardId: cardId,
            activeLaneId: laneId,
          };
        }

        if (resolvedActiveCardId === cardId) {
          return prev;
        }

        return {
          selectedCardIds: [resolvedActiveCardId, cardId],
          selectionLane: laneId,
          selectionLeadCardId: cardId,
          activeCardId: cardId,
          activeLaneId: laneId,
        };
      }

      if (prev.selectionLane !== laneId) {
        return {
          selectedCardIds: [cardId],
          selectionLane: laneId,
          selectionLeadCardId: cardId,
          activeCardId: cardId,
          activeLaneId: laneId,
        };
      }

      const alreadySelected = prev.selectedCardIds.includes(cardId);
      if (!alreadySelected) {
        return {
          selectedCardIds: [...prev.selectedCardIds, cardId],
          selectionLane: laneId,
          selectionLeadCardId: cardId,
          activeCardId: cardId,
          activeLaneId: laneId,
        };
      }

      const nextSelectedCardIds = prev.selectedCardIds.filter((id) => id !== cardId);
      if (!nextSelectedCardIds.length) {
        return {
          selectedCardIds: EMPTY_SELECTED_IDS,
          selectionLane: null,
          selectionLeadCardId: null,
          activeCardId: cardId,
          activeLaneId: laneId,
        };
      }

      return {
        selectedCardIds: nextSelectedCardIds,
        selectionLane: laneId,
        selectionLeadCardId:
          prev.selectionLeadCardId === cardId
            ? nextSelectedCardIds[nextSelectedCardIds.length - 1] ?? null
            : prev.selectionLeadCardId,
        activeCardId: cardId,
        activeLaneId: laneId,
      };
    });
  }, []);

  const selectedCardIdSet = useMemo(
    () => new Set(selectionState.selectedCardIds),
    [selectionState.selectedCardIds]
  );

  return {
    selectedCardIds: selectionState.selectedCardIds,
    selectedCardIdSet,
    selectionLane: selectionState.selectionLane,
    selectionLeadCardId: selectionState.selectionLeadCardId,
    activeCardId: selectionState.activeCardId,
    activeLaneId: selectionState.activeLaneId,
    clearSelection,
    setActiveCard,
    handleShiftSelect,
  };
}
