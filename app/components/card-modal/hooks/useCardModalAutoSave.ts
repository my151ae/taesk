"use client";

import { useCallback, useRef } from "react";
import type { JSONContent } from "@tiptap/react";

type UseCardModalAutoSaveArgs = {
  isHistoryPreviewing: boolean;
  onAutoSave: (contentOverride?: JSONContent, options?: { forceHistorySnapshot?: boolean }) => void;
};

export function useCardModalAutoSave({
  isHistoryPreviewing,
  onAutoSave,
}: UseCardModalAutoSaveArgs) {
  const hasPendingChangesRef = useRef(false);
  const hasAutoSavedEditsRef = useRef(false);
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const autoSaveMaxTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingAutoSaveContentRef = useRef<JSONContent | null>(null);

  const clearAutoSaveTimers = useCallback(() => {
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
      autoSaveTimeoutRef.current = null;
    }
    if (autoSaveMaxTimeoutRef.current) {
      clearTimeout(autoSaveMaxTimeoutRef.current);
      autoSaveMaxTimeoutRef.current = null;
    }
  }, []);

  const resetAutoSaveState = useCallback(() => {
    clearAutoSaveTimers();
    hasPendingChangesRef.current = false;
    hasAutoSavedEditsRef.current = false;
    pendingAutoSaveContentRef.current = null;
  }, [clearAutoSaveTimers]);

  const triggerAutoSave = useCallback((contentOverride?: JSONContent) => {
    if (isHistoryPreviewing) return;
    hasPendingChangesRef.current = true;
    hasAutoSavedEditsRef.current = true;
    if (contentOverride) {
      pendingAutoSaveContentRef.current = contentOverride;
    }
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }
    autoSaveTimeoutRef.current = setTimeout(() => {
      if (autoSaveMaxTimeoutRef.current) {
        clearTimeout(autoSaveMaxTimeoutRef.current);
        autoSaveMaxTimeoutRef.current = null;
      }
      const latestContent = pendingAutoSaveContentRef.current ?? undefined;
      pendingAutoSaveContentRef.current = null;
      onAutoSave(latestContent);
    }, 2000);
    if (!autoSaveMaxTimeoutRef.current) {
      autoSaveMaxTimeoutRef.current = setTimeout(() => {
        if (autoSaveTimeoutRef.current) {
          clearTimeout(autoSaveTimeoutRef.current);
          autoSaveTimeoutRef.current = null;
        }
        autoSaveMaxTimeoutRef.current = null;
        const latestContent = pendingAutoSaveContentRef.current ?? undefined;
        pendingAutoSaveContentRef.current = null;
        onAutoSave(latestContent);
      }, 15000);
    }
  }, [isHistoryPreviewing, onAutoSave]);

  const flushPendingAutoSave = useCallback((options?: { forceHistorySnapshot?: boolean }) => {
    clearAutoSaveTimers();
    const latestContent = pendingAutoSaveContentRef.current ?? undefined;
    pendingAutoSaveContentRef.current = null;
    const hadPending = hasPendingChangesRef.current || hasAutoSavedEditsRef.current;
    hasAutoSavedEditsRef.current = false;
    if (hadPending) {
      onAutoSave(latestContent, options);
    }
    return hadPending;
  }, [clearAutoSaveTimers, onAutoSave]);

  return {
    hasPendingChangesRef,
    hasAutoSavedEditsRef,
    pendingAutoSaveContentRef,
    autoSaveTimeoutRef,
    autoSaveMaxTimeoutRef,
    triggerAutoSave,
    clearAutoSaveTimers,
    resetAutoSaveState,
    flushPendingAutoSave,
  };
}
