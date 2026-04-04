"use client";

import { useCallback, useRef, useState } from "react";

type ContextMenuState = {
  open: boolean;
  cardId: string | null;
  targetCardIds: string[];
  x: number;
  y: number;
};

type UseTimelineContextMenuArgs = {
  focusCardById: (cardId: string | null) => void;
};

export function useTimelineContextMenu({ focusCardById }: UseTimelineContextMenuArgs) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    open: false,
    cardId: null,
    targetCardIds: [],
    x: 0,
    y: 0,
  });
  const lastContextMenuCardIdRef = useRef<string | null>(null);

  const openContextMenuAt = useCallback((cardId: string, targetCardIds: string[], x: number, y: number) => {
    lastContextMenuCardIdRef.current = cardId;
    setContextMenu({
      open: true,
      cardId,
      targetCardIds,
      x,
      y,
    });
  }, []);

  const closeContextMenu = useCallback((_reason: "action" | "dismiss") => {
    setContextMenu((prev) => ({ ...prev, open: false, cardId: null, targetCardIds: [] }));
    requestAnimationFrame(() => {
      focusCardById(lastContextMenuCardIdRef.current);
    });
  }, [focusCardById]);

  return {
    contextMenu,
    openContextMenuAt,
    closeContextMenu,
  };
}
