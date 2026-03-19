"use client";

import { useEffect, useRef } from "react";
import type { JSONContent } from "@tiptap/react";
import type { Card } from "@/lib/supabase";
import { normalizeContent } from "@/lib/tiptap";

type UseCardModalLifecycleArgs = {
  card: Card;
  isLoading?: boolean;
  onRequestClose: () => void;
  resetDraft: (card: Card) => void;
  resetHistoryState: () => void;
  setShowSidebar: (value: boolean) => void;
  setContent: (value: JSONContent) => void;
  setTitle: (value: string) => void;
  setChecked: (value: boolean) => void;
  setEditorError: (message: string | null) => void;
  hasPendingChangesRef: React.MutableRefObject<boolean>;
  hasAutoSavedEditsRef: React.MutableRefObject<boolean>;
  clearAutoSaveTimers: () => void;
};

export function useCardModalLifecycle({
  card,
  isLoading,
  onRequestClose,
  resetDraft,
  resetHistoryState,
  setShowSidebar,
  setContent,
  setTitle,
  setChecked,
  setEditorError,
  hasPendingChangesRef,
  hasAutoSavedEditsRef,
  clearAutoSaveTimers,
}: UseCardModalLifecycleArgs) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cardIdRef = useRef(card.id);
  const hasAppliedInitialLoadRef = useRef(false);
  const previousLoadingRef = useRef<boolean | null>(null);
  const requestCloseRef = useRef<() => void>(() => {});

  useEffect(() => {
    requestCloseRef.current = onRequestClose;
  }, [onRequestClose]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(min-width: 640px)");
    if (media.matches) {
      setShowSidebar(true);
    }
  }, [setShowSidebar]);

  useEffect(() => {
    if (card.id !== cardIdRef.current) {
      cardIdRef.current = card.id;
      hasAppliedInitialLoadRef.current = false;
      previousLoadingRef.current = null;
      resetDraft(card);
      hasPendingChangesRef.current = false;
      hasAutoSavedEditsRef.current = false;
      resetHistoryState();
    }
  }, [card, resetDraft, resetHistoryState, hasPendingChangesRef, hasAutoSavedEditsRef]);

  useEffect(() => {
    if (card.id !== cardIdRef.current) return;
    const loadingNow = Boolean(isLoading);
    const wasLoading = previousLoadingRef.current;
    previousLoadingRef.current = loadingNow;
    if (hasPendingChangesRef.current) return;
    if (loadingNow) return;
    if (hasAppliedInitialLoadRef.current) return;
    if (wasLoading !== true) return;

    const incomingContent = normalizeContent(card.content);
    setContent(incomingContent);
    setTitle(card.title || "");
    setChecked(card.checked || false);
    setEditorError(null);
    hasAppliedInitialLoadRef.current = true;
  }, [card, isLoading, setChecked, setContent, setEditorError, setTitle, hasPendingChangesRef]);

  useEffect(() => {
    const previousActiveElement = document.activeElement as HTMLElement | null;
    const focusableSelector =
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

    const focusFirstElement = () => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const autoFocusTarget = dialog.querySelector<HTMLElement>("[data-autofocus]");
      if (autoFocusTarget) {
        autoFocusTarget.focus();
        return;
      }
      const focusable = dialog.querySelectorAll<HTMLElement>(focusableSelector);
      (focusable[0] ?? dialog).focus();
    };

    const trapFocus = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;

      if (event.key === "Escape") {
        event.preventDefault();
        requestCloseRef.current();
        return;
      }

      if (event.key !== "Tab") return;

      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (element) => !element.hasAttribute("disabled"),
      );

      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement as HTMLElement | null;

      if (!current) {
        event.preventDefault();
        first.focus();
        return;
      }

      if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
        return;
      }

      if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
      }
    };

    document.addEventListener("keydown", trapFocus);
    focusFirstElement();

    return () => {
      document.removeEventListener("keydown", trapFocus);
      clearAutoSaveTimers();
      if (previousActiveElement && document.body.contains(previousActiveElement)) {
        previousActiveElement.focus();
      }
    };
  }, [clearAutoSaveTimers]);

  return {
    dialogRef,
  };
}
