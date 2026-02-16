"use client";

import { useCallback, useRef, useState } from "react";

type ContextMenuState = {
  open: boolean;
  cardId: string | null;
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
    x: 0,
    y: 0,
  });
  const lastContextMenuCardIdRef = useRef<string | null>(null);

  const openContextMenuAt = useCallback((cardId: string, x: number, y: number) => {
    lastContextMenuCardIdRef.current = cardId;
    setContextMenu({
      open: true,
      cardId,
      x,
      y,
    });
  }, []);

  const handleCardContextMenu = useCallback((e: React.MouseEvent, cardId: string) => {
    e.preventDefault();
    e.stopPropagation();
    openContextMenuAt(cardId, e.clientX, e.clientY);
  }, [openContextMenuAt]);

  const handleCardContextMenuByKeyboard = useCallback((cardId: string, rect: DOMRect) => {
    const x = rect.right + 8;
    const y = rect.top;
    openContextMenuAt(cardId, x, y);
  }, [openContextMenuAt]);

  const closeContextMenu = useCallback((reason: "action" | "dismiss") => {
    setContextMenu((prev) => ({ ...prev, open: false, cardId: null }));
    if (reason === "action") {
      requestAnimationFrame(() => {
        focusCardById(lastContextMenuCardIdRef.current);
      });
    }
  }, [focusCardById]);

  return {
    contextMenu,
    handleCardContextMenu,
    handleCardContextMenuByKeyboard,
    closeContextMenu,
  };
}
