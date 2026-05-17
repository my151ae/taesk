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
  syncExternalMetadata: (card: Card) => void;
  resetHistoryState: () => void;
  setShowSidebar: (value: boolean) => void;
  setActiveSidebarTab: (value: "comments" | "history" | null) => void;
  setShowCompletedLines: (value: boolean) => void;
  setContent: (value: JSONContent) => void;
  setTitle: (value: string) => void;
  setChecked: (value: boolean) => void;
  setEditorError: (message: string | null) => void;
  clearExpandedHiddenRuns: () => void;
  hasPendingChangesRef: React.MutableRefObject<boolean>;
  hasAutoSavedEditsRef: React.MutableRefObject<boolean>;
  clearAutoSaveTimers: () => void;
  trapFocus?: boolean;
};

export function useCardModalLifecycle({
  card,
  isLoading,
  onRequestClose,
  resetDraft,
  syncExternalMetadata,
  resetHistoryState,
  setShowSidebar,
  setActiveSidebarTab,
  setShowCompletedLines,
  setContent,
  setTitle,
  setChecked,
  setEditorError,
  clearExpandedHiddenRuns,
  hasPendingChangesRef,
  hasAutoSavedEditsRef,
  clearAutoSaveTimers,
  trapFocus = true,
}: UseCardModalLifecycleArgs) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cardIdRef = useRef(card.id);
  const hasAppliedInitialLoadRef = useRef(false);
  const lastSyncedMetadataKeyRef = useRef<string | null>(null);
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
      setActiveSidebarTab(null);
    }
  }, [setActiveSidebarTab, setShowSidebar]);

  useEffect(() => {
    if (card.id !== cardIdRef.current) {
      clearExpandedHiddenRuns();
      cardIdRef.current = card.id;
      hasAppliedInitialLoadRef.current = false;
      lastSyncedMetadataKeyRef.current = null;
      previousLoadingRef.current = null;
      resetDraft(card);
      hasPendingChangesRef.current = false;
      hasAutoSavedEditsRef.current = false;
      resetHistoryState();
      setShowCompletedLines(true);
    }
  }, [card, clearExpandedHiddenRuns, resetDraft, resetHistoryState, hasPendingChangesRef, hasAutoSavedEditsRef, setShowCompletedLines]);

  useEffect(() => {
    if (card.id !== cardIdRef.current) return;
    if (hasPendingChangesRef.current) return;
    if (isLoading) return;

    const metadataKey = JSON.stringify({
      id: card.id,
      due_date: card.due_date ?? null,
      due_start: card.due_start ?? null,
      due_end: card.due_end ?? null,
      due_bucket: card.due_bucket ?? null,
      due_bucket_position: card.due_bucket_position ?? null,
      duration: card.duration ?? null,
      checked: card.checked ?? false,
      checked_at: card.checked_at ?? null,
      start_reminder_enabled: card.start_reminder_enabled ?? false,
      start_reminder_minutes: card.start_reminder_minutes ?? 0,
      end_reminder_enabled: card.end_reminder_enabled ?? false,
      end_reminder_minutes: card.end_reminder_minutes ?? 0,
      tags: card.tags ?? [],
      assignee_id: card.assignee_id ?? null,
      assignee_ids: card.assignee_ids ?? null,
      assigned_to: card.assigned_to ?? null,
      board_id: card.board_id,
    });

    if (metadataKey === lastSyncedMetadataKeyRef.current) return;
    lastSyncedMetadataKeyRef.current = metadataKey;
    syncExternalMetadata(card);
  }, [
    card,
    card.id,
    card.due_date,
    card.due_start,
    card.due_end,
    card.due_bucket,
    card.due_bucket_position,
    card.duration,
    card.checked,
    card.checked_at,
    card.start_reminder_enabled,
    card.start_reminder_minutes,
    card.end_reminder_enabled,
    card.end_reminder_minutes,
    card.tags,
    card.assignee_id,
    card.assignee_ids,
    card.assigned_to,
    card.board_id,
    isLoading,
    hasPendingChangesRef,
    syncExternalMetadata,
  ]);

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

    const handleKeyDown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (!trapFocus && !dialog.contains(document.activeElement)) return;

      if (event.key === "Escape") {
        event.preventDefault();
        requestCloseRef.current();
        return;
      }

      if (!trapFocus) return;
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

    document.addEventListener("keydown", handleKeyDown);
    if (trapFocus) {
      focusFirstElement();
    }

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      clearExpandedHiddenRuns();
      clearAutoSaveTimers();
      if (trapFocus && previousActiveElement && document.body.contains(previousActiveElement)) {
        previousActiveElement.focus();
      }
    };
  }, [clearAutoSaveTimers, clearExpandedHiddenRuns, trapFocus]);

  return {
    dialogRef,
  };
}
