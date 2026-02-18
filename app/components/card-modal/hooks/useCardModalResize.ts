"use client";

import { useCallback, useEffect, useState } from "react";
import type { RefObject, MouseEvent as ReactMouseEvent } from "react";

type UseCardModalResizeArgs = {
  resizeRef: RefObject<HTMLDivElement>;
  initialWidth?: number;
  minWidth?: number;
  maxWidth?: number;
};

export function useCardModalResize({
  resizeRef,
  initialWidth = 384,
  minWidth = 250,
  maxWidth = 600,
}: UseCardModalResizeArgs) {
  const [sidebarWidth, setSidebarWidth] = useState(initialWidth);
  const [isResizing, setIsResizing] = useState(false);

  const startResizing = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const stopResizing = useCallback(() => {
    setIsResizing(false);
  }, []);

  const resize = useCallback(
    (e: MouseEvent) => {
      if (!isResizing || !resizeRef.current) return;
      const containerRect = resizeRef.current.getBoundingClientRect();
      const newWidth = containerRect.right - e.clientX;
      if (newWidth >= minWidth && newWidth <= maxWidth) {
        setSidebarWidth(newWidth);
      }
    },
    [isResizing, maxWidth, minWidth, resizeRef]
  );

  useEffect(() => {
    if (isResizing) {
      window.addEventListener("mousemove", resize);
      window.addEventListener("mouseup", stopResizing);
    } else {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
    }

    return () => {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
    };
  }, [isResizing, resize, stopResizing]);

  return {
    sidebarWidth,
    startResizing,
  };
}
