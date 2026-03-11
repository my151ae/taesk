"use client";

import { useCallback, useRef, useState } from "react";
import type { Card, DueBucket } from "@/lib/supabase";
import {
  normalizeContent,
  buildDefaultBodyContent,
  deriveExcerptFromContent,
} from "@/lib/tiptap";
import { slugify } from "@/lib/card-utils";
import { applyCardUpdate } from "@/app/(board)/_utils/card-updates";
import {
  minutesToTime,
  withJstMidnight,
  getIsoDateJst,
  toLocalDay,
  type ExternalCalendarEntry,
  type TimelineBucketItem,
  type TimelineDay,
  type TimelineResponse,
} from "@/app/(board)/_utils/timeline-helpers";
import { bucketKeyToDueBucket } from "@/lib/bucket-normalization";
import { findTimelineCardById } from "@/app/(board)/_utils/timeline-card-lookup";
import { buildOptimisticCard, calculateBucketInsertPosition } from "@/app/(board)/_hooks/timeline-card-actions-helpers";
import type { CardModalSavePayload } from "@/app/components/card-modal/types";

interface UseTimelineCardActionsProps {
  initialBoardId: string;
  dataMode: string;
  setData: React.Dispatch<React.SetStateAction<TimelineResponse | null>>;
  fetchTimeline: (offset?: number) => Promise<TimelineResponse | null>;
  openCardModal: (shortId: string, source?: string) => void;
  closeCardModal: () => void;
  modalCard: Card | null;
  setModalCardOverride: (card: Card | null) => void;
  setCardModalError: (error: string | null) => void;
  setErrorMessage: (error: string | null) => void;
  bucketDayMap: Record<string, string | null>;
  refreshGoogleCalendar: () => Promise<void> | void;
  data: TimelineResponse | null;
  onCardCreated?: (cardId: string) => void;
}

const addDays = (isoDate: string, offsetDays: number) => {
  const [y, m, d] = isoDate.split("-").map((v) => Number(v));
  if (!y || !m || !d || Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return isoDate;
  const baseUtc = Date.UTC(y, m - 1, d);
  const nextUtc = baseUtc + offsetDays * 24 * 60 * 60 * 1000;
  return new Date(nextUtc).toISOString().split("T")[0];
};

export function useTimelineCardActions({
  initialBoardId,
  dataMode,
  setData,
  fetchTimeline,
  openCardModal,
  closeCardModal,
  modalCard,
  setModalCardOverride,
  setCardModalError,
  setErrorMessage,
  bucketDayMap,
  refreshGoogleCalendar,
  data,
  onCardCreated,
}: UseTimelineCardActionsProps) {
  const saveAbortRef = useRef<AbortController | null>(null);
  const saveRequestIdRef = useRef(0);
  const historyRetryContextRef = useRef<{ boardId: string; cardId: string; content: unknown } | null>(null);
  const [googleToast, setGoogleToast] = useState<string | null>(null);
  const [historySaveWarning, setHistorySaveWarning] = useState<string | null>(null);

  const postHistorySnapshot = useCallback(
    async (params: { boardId: string; cardId: string; content: unknown; signal?: AbortSignal }) => {
      const response = await fetch(`/api/boards/${params.boardId}/cards/${params.cardId}/history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: params.content }),
        signal: params.signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message || "履歴の保存に失敗しました");
      }
    },
    []
  );

  const syncCardNowWithToast = useCallback(async (card: Card | null) => {
    if (!card?.due_date || !card?.due_start || !card?.due_end) return;
    try {
      const statusRes = await fetch(`/api/calendar-sync/${card.id}`);
      const statusBody = await statusRes.json().catch(() => null) as { status?: string } | null;
      if (!statusRes.ok || statusBody?.status !== "active") return;
      setGoogleToast("Google同期中...");
      const syncRes = await fetch(`/api/calendar-sync/${card.id}`, { method: "POST" });
      const syncBody = await syncRes.json().catch(() => null) as { error?: { message?: string } } | null;
      if (!syncRes.ok) {
        setGoogleToast(syncBody?.error?.message ? `同期失敗: ${syncBody.error.message}` : "Google同期に失敗しました");
        window.setTimeout(() => setGoogleToast(null), 3500);
        return;
      }
      setGoogleToast("Google同期が完了しました");
    } catch (error) {
      console.error("[timeline] immediate sync failed", error);
      setGoogleToast("Google同期に失敗しました");
    } finally {
      window.setTimeout(() => setGoogleToast(null), 3500);
    }
  }, []);

  const applyPatch = useCallback(
    async (cardId: string, payload: Record<string, unknown>) => {
      if (dataMode !== "api") return;
      try {
        const response = await fetch(`/api/boards/${initialBoardId}/cards/${cardId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
          throw new Error(body?.error?.message || "Patch failed");
        }
      } catch (error) {
        console.error("[timeline] update error", error);
        setErrorMessage(error instanceof Error ? error.message : "Failed to update card");
      }
    },
    [dataMode, initialBoardId, setErrorMessage]
  );

  const handleCardModalSave = useCallback(
    async (savePayload: CardModalSavePayload) => {
      const targetCard = modalCard && modalCard.id === savePayload.id ? modalCard : null;
      if (!targetCard) return;
      let requestId = 0;
      try {
        setHistorySaveWarning(null);
        historyRetryContextRef.current = null;
        const isRestoreFromHistory = Boolean(savePayload.restoreFromHistory);
        const nextAssignee = savePayload.assigneeIds?.[0] || null;
        let normalizedDueDate: string | null = null;
        if (savePayload.due_date) {
          const parsed = new Date(savePayload.due_date);
          if (!Number.isNaN(parsed.getTime())) normalizedDueDate = parsed.toISOString();
        }
        const normalizedContent = normalizeContent(savePayload.content);
        const optimisticCard: Card = {
          ...targetCard,
          title: savePayload.title,
          checked: Boolean(savePayload.checked),
          content: normalizedContent,
          excerpt: savePayload.excerpt ?? deriveExcerptFromContent(normalizedContent),
          tags: savePayload.tags ?? targetCard.tags ?? [],
          due_date: normalizedDueDate,
          due_start: savePayload.due_start ?? null,
          due_end: savePayload.due_end ?? null,
          start_reminder_enabled: Boolean(savePayload.start_reminder_enabled),
          start_reminder_minutes: savePayload.start_reminder_minutes ?? 0,
          end_reminder_enabled: Boolean(savePayload.end_reminder_enabled),
          end_reminder_minutes: savePayload.end_reminder_minutes ?? 0,
          due_bucket: savePayload.due_bucket ?? null,
          due_bucket_position: savePayload.due_bucket_position ?? null,
          duration: savePayload.duration ?? targetCard.duration ?? null,
          slug: slugify(savePayload.title),
        };

        if (!isRestoreFromHistory && savePayload.assigneeTouched) {
          optimisticCard.assignee_id = nextAssignee;
          optimisticCard.assignee_ids = savePayload.assigneeIds?.length ? savePayload.assigneeIds : null;
          optimisticCard.assigned_to = null;
        }

        const payload: Record<string, unknown> = isRestoreFromHistory
          ? {
            content: normalizedContent,
          }
          : {
            title: savePayload.title,
            checked: savePayload.checked,
            content: normalizedContent,
            excerpt: savePayload.excerpt ?? "",
            tags: savePayload.tags,
            due_date: normalizedDueDate,
            due_start: savePayload.due_start,
            due_end: savePayload.due_end,
            start_reminder_enabled: Boolean(savePayload.start_reminder_enabled),
            start_reminder_minutes: savePayload.start_reminder_minutes ?? 0,
            end_reminder_enabled: Boolean(savePayload.end_reminder_enabled),
            end_reminder_minutes: savePayload.end_reminder_minutes ?? 0,
            due_bucket: savePayload.due_bucket,
            due_bucket_position: savePayload.due_bucket_position,
            duration: savePayload.duration,
            slug: slugify(savePayload.title),
          };
        if (!isRestoreFromHistory && savePayload.assigneeTouched) {
          payload.assignee_id = nextAssignee;
          payload.assignee_ids = savePayload.assigneeIds?.length ? savePayload.assigneeIds : null;
          payload.assigned_to = null;
        }

        if (saveAbortRef.current) saveAbortRef.current.abort();
        requestId = ++saveRequestIdRef.current;
        const controller = new AbortController();
        saveAbortRef.current = controller;

        // モーダルを閉じる前にカード表面へ先行反映し、体感遅延を抑える
        setModalCardOverride(optimisticCard);
        setData((prev) => (prev ? applyCardUpdate(prev, optimisticCard, "UPDATE") : prev));

        const response = await fetch(`/api/boards/${targetCard.board_id}/cards/${targetCard.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        const body = await response.json().catch(() => null) as { card?: Card; error?: { message?: string } } | null;
        if (requestId !== saveRequestIdRef.current) return;
        if (!response.ok) throw new Error(body?.error?.message || "Failed to update card");

        if (body?.card) {
          const updatedCard = body.card;
          setModalCardOverride(updatedCard);
          setData((prev) => (prev ? applyCardUpdate(prev, updatedCard, "UPDATE") : prev));
        }

        const shouldCreateHistorySnapshot = !savePayload.isAutoSave || Boolean(savePayload.forceHistorySnapshot);

        if (shouldCreateHistorySnapshot) {
          const historyContent = body?.card?.content ?? normalizedContent;
          try {
            await postHistorySnapshot({
              boardId: targetCard.board_id,
              cardId: targetCard.id,
              content: historyContent,
              signal: controller.signal,
            });
          } catch (historyError) {
            if (historyError instanceof Error && historyError.name === "AbortError") return;
            historyRetryContextRef.current = {
              boardId: targetCard.board_id,
              cardId: targetCard.id,
              content: historyContent,
            };
            setHistorySaveWarning("本文の保存は完了。履歴の作成に失敗しました。");
            return;
          }

          if (requestId !== saveRequestIdRef.current) return;
          historyRetryContextRef.current = null;
          setHistorySaveWarning(null);

          if (!isRestoreFromHistory && !savePayload.isAutoSave) {
            const titleChanged = targetCard.title !== savePayload.title;
            const dateChanged = targetCard.due_date !== normalizedDueDate;
            const startChanged = (targetCard.due_start?.slice(0, 5)) !== (savePayload.due_start?.slice(0, 5));
            const endChanged = (targetCard.due_end?.slice(0, 5)) !== (savePayload.due_end?.slice(0, 5));

            if (titleChanged || dateChanged || startChanged || endChanged) {
              void syncCardNowWithToast(body?.card ?? null);
            }
          }
          closeCardModal();
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        setCardModalError(error instanceof Error ? error.message : "Failed to save card");
        // 楽観更新失敗時はサーバー状態へ戻す
        void fetchTimeline(data?.startOffset);
      } finally {
        if (requestId === saveRequestIdRef.current) saveAbortRef.current = null;
      }
    },
    [modalCard, closeCardModal, setCardModalError, setModalCardOverride, setData, syncCardNowWithToast, postHistorySnapshot, fetchTimeline, data?.startOffset]
  );

  const retryHistorySave = useCallback(async () => {
    const context = historyRetryContextRef.current;
    if (!context) return;
    try {
      await postHistorySnapshot(context);
      historyRetryContextRef.current = null;
      setHistorySaveWarning(null);
      closeCardModal();
    } catch (error) {
      setHistorySaveWarning(error instanceof Error ? error.message : "履歴の再保存に失敗しました。");
    }
  }, [closeCardModal, postHistorySnapshot]);

  const closeModalWithoutHistory = useCallback(() => {
    historyRetryContextRef.current = null;
    setHistorySaveWarning(null);
    closeCardModal();
  }, [closeCardModal]);

  const handleCardModalDelete = useCallback(
    async (cardId: string) => {
      let targetCardRef: { id: string; board_id: string } | null = modalCard && modalCard.id === cardId
        ? { id: modalCard.id, board_id: modalCard.board_id }
        : null;

      if (!targetCardRef) {
        const match = findTimelineCardById(data, cardId);
        if (match.event) {
          targetCardRef = { id: match.event.card_id, board_id: initialBoardId };
        } else if (match.bucketItem) {
          targetCardRef = { id: match.bucketItem.card_id, board_id: initialBoardId };
        } else if (match.overdueItem) {
          targetCardRef = { id: match.overdueItem.card_id, board_id: initialBoardId };
        }
      }

      if (!targetCardRef) {
        targetCardRef = { id: cardId, board_id: initialBoardId };
      }

      try {
        const response = await fetch(`/api/boards/${targetCardRef.board_id}/cards/${targetCardRef.id}`, { method: "DELETE" });
        if (!response.ok) throw new Error("Failed to delete card");
        setData((prev) => (prev ? applyCardUpdate(prev, { id: cardId } as Card, "DELETE") : prev));
      } catch (error) {
        setCardModalError(error instanceof Error ? error.message : "Failed to delete card");
      } finally {
        if (modalCard?.id === cardId) {
          closeCardModal();
        }
      }
    },
    [modalCard, closeCardModal, setData, setCardModalError, data, initialBoardId]
  );

  const createCard = useCallback(async (payload: Partial<Card>, options?: { openModal?: boolean }) => {
    if (dataMode !== "api") return;

    const optimisticId = payload.id ?? crypto.randomUUID();
    const optimisticCard = buildOptimisticCard(payload, initialBoardId, optimisticId);

    setData((prev) => (prev ? applyCardUpdate(prev, optimisticCard, "INSERT") : prev));

    try {
      const response = await fetch(`/api/boards/${initialBoardId}/cards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, id: optimisticId }),
      });
      if (!response.ok) throw new Error("Failed to create card");
      const body = await response.json() as { card?: Card };
      if (body.card) {
        const newCard = body.card;
        setData((prev) => (prev ? applyCardUpdate(prev, newCard, "UPDATE") : prev));
        onCardCreated?.(newCard.id);
        if (options?.openModal !== false && newCard.short_id) openCardModal(newCard.short_id, "create-card");
      }
    } catch {
      setErrorMessage("Failed to create card");
      setData((prev) => (prev ? applyCardUpdate(prev, { id: optimisticId } as Card, "DELETE") : prev));
    }
  }, [dataMode, initialBoardId, setData, openCardModal, setErrorMessage, onCardCreated]);

  const handleColumnClick = useCallback((day: TimelineDay, minutes: number) => {
    const title = "";
    const content = buildDefaultBodyContent();
    const excerpt = deriveExcerptFromContent(content);
    const payload: Partial<Card> = {
      title,
      content,
      excerpt,
      tags: [],
      due_date: withJstMidnight(day.isoDate),
      due_start: minutesToTime(minutes),
      due_end: minutesToTime(minutes + 60),
    };
    createCard(payload, { openModal: false });
  }, [createCard]);

  const handleBucketClick = useCallback((bucketKey: string, afterCardId?: string) => {
    const isoDate = bucketDayMap[bucketKey];
    if (!isoDate) return;

    const title = "";
    const content = buildDefaultBodyContent();
    const excerpt = deriveExcerptFromContent(content);
    const dueBucket = bucketKeyToDueBucket(bucketKey);
    const currentItems = (data?.abBuckets?.[bucketKey] ?? []) as TimelineBucketItem[];
    const position = calculateBucketInsertPosition(currentItems, afterCardId);

    const payload: Partial<Card> = {
      title,
      content,
      excerpt,
      tags: [],
      due_date: withJstMidnight(isoDate),
      due_bucket: dueBucket,
      due_bucket_position: position,
    };

    createCard(payload, { openModal: false });
  }, [bucketDayMap, createCard, data?.abBuckets]);

  const handleToggleCardChecked = useCallback(async (cardId: string, nextChecked: boolean) => {
    if (dataMode !== "api") return;
    try {
      const match = findTimelineCardById(data, cardId);
      const sourceEvent = match.event;
      const sourceBucketItem = match.bucketItem;
      const sourceOverdueItem = match.overdueItem;
      const dueBucketFromKey = match.bucketKey ? (match.bucketKey.split("_")[1] as DueBucket) : null;

      const updatedCard = {
        id: cardId,
        title: sourceEvent?.title ?? sourceBucketItem?.title ?? sourceOverdueItem?.title ?? "Untitled card",
        content: sourceEvent?.content ?? sourceBucketItem?.content ?? sourceOverdueItem?.content ?? null,
        excerpt: sourceEvent?.excerpt ?? sourceBucketItem?.excerpt ?? sourceOverdueItem?.excerpt ?? null,
        checklist: sourceEvent?.checklist ?? sourceBucketItem?.checklist ?? sourceOverdueItem?.checklist ?? null,
        tags: sourceEvent?.tags ?? sourceBucketItem?.tags ?? sourceOverdueItem?.tags ?? [],
        checked: nextChecked,
        assignee_id: sourceEvent?.assignee_id ?? sourceBucketItem?.assignee_id ?? sourceOverdueItem?.assignee_id ?? null,
        assignee_ids: sourceEvent?.assignee_ids ?? sourceBucketItem?.assignee_ids ?? sourceOverdueItem?.assignee_ids ?? null,
        assigned_to: sourceEvent?.assigned_to ?? sourceBucketItem?.assigned_to ?? sourceOverdueItem?.assigned_to ?? null,
        duration: sourceEvent?.duration ?? sourceBucketItem?.duration ?? sourceOverdueItem?.duration ?? sourceEvent?.durationMinutes ?? 60,
        short_id: sourceEvent?.short_id ?? sourceBucketItem?.short_id ?? sourceOverdueItem?.short_id ?? null,
        slug: sourceEvent?.slug ?? sourceBucketItem?.slug ?? sourceOverdueItem?.slug ?? null,
        due_date: sourceEvent?.due_date ?? sourceBucketItem?.due_date ?? sourceOverdueItem?.due_date ?? null,
        due_start: sourceEvent?.due_start ?? sourceBucketItem?.due_start ?? sourceOverdueItem?.due_start ?? null,
        due_end: sourceEvent?.due_end ?? sourceBucketItem?.due_end ?? sourceOverdueItem?.due_end ?? null,
        start_reminder_enabled: sourceEvent?.start_reminder_enabled ?? sourceBucketItem?.start_reminder_enabled ?? sourceOverdueItem?.start_reminder_enabled ?? false,
        start_reminder_minutes: sourceEvent?.start_reminder_minutes ?? sourceBucketItem?.start_reminder_minutes ?? sourceOverdueItem?.start_reminder_minutes ?? 0,
        end_reminder_enabled: sourceEvent?.end_reminder_enabled ?? sourceBucketItem?.end_reminder_enabled ?? sourceOverdueItem?.end_reminder_enabled ?? false,
        end_reminder_minutes: sourceEvent?.end_reminder_minutes ?? sourceBucketItem?.end_reminder_minutes ?? sourceOverdueItem?.end_reminder_minutes ?? 0,
        due_bucket: sourceEvent?.due_bucket ?? sourceBucketItem?.due_bucket ?? sourceOverdueItem?.due_bucket ?? dueBucketFromKey,
        due_bucket_position: sourceEvent?.due_bucket_position ?? sourceOverdueItem?.due_bucket_position ?? sourceBucketItem?.bucketPosition ?? null,
      } as Card;

      setData((prev) => (prev ? applyCardUpdate(prev, updatedCard, "UPDATE") : prev));

      const res = await fetch(`/api/boards/${initialBoardId}/cards/${cardId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checked: nextChecked }),
      });
      if (!res.ok) throw new Error();
    } catch {
      fetchTimeline();
    }
  }, [data, dataMode, initialBoardId, setData, fetchTimeline]);

  const handleExternalEventClick = useCallback(async (entry: ExternalCalendarEntry) => {
    // 変換機能を一時的に停止
    return;
    /*
    try {
      const googleEventId = entry.eventId ?? entry.id;
      const res = await fetch("/api/calendar/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ google_event_id: googleEventId }),
      });
      if (!res.ok) throw new Error();
      const body = await res.json() as { card?: Card };
      await fetchTimeline(0);
      await refreshGoogleCalendar();
      setGoogleToast("Googleイベント変換完了");
      if (body?.card?.short_id) openCardModal(body.card.short_id, "gcard-convert");
    } catch {
      alert("変換失敗");
    }
    */
  }, [setGoogleToast]);

  const moveCardByDayOffset = useCallback((cardId: string, offsetDays: number) => {
    if (!data) return;
    const todayIso = getIsoDateJst(data.serverNow ?? new Date().toISOString());
    const targetDay = addDays(todayIso, offsetDays);

    const match = findTimelineCardById(data, cardId);
    const event = match.event;
    const bucketItem = match.bucketItem;
    const overdueItem = match.overdueItem;
    const bucketKey = match.bucketKey;

    if (!event && !bucketItem && !overdueItem) return;

    const currentDueDate = event?.due_date ?? bucketItem?.due_date ?? overdueItem?.due_date ?? null;
    const currentLocalDay = toLocalDay(currentDueDate);
    if (currentLocalDay === targetDay) return;

    const dueBucketFromKey = bucketKey ? (bucketKey.split("_")[1] as DueBucket) : null;
    const updatedCard = {
      id: cardId,
      title: event?.title ?? bucketItem?.title ?? overdueItem?.title ?? "Untitled card",
      content: event?.content ?? bucketItem?.content ?? overdueItem?.content ?? null,
      excerpt: event?.excerpt ?? bucketItem?.excerpt ?? overdueItem?.excerpt ?? null,
      checklist: event?.checklist ?? bucketItem?.checklist ?? overdueItem?.checklist ?? null,
      tags: event?.tags ?? bucketItem?.tags ?? overdueItem?.tags ?? [],
      checked: event?.checked ?? bucketItem?.checked ?? overdueItem?.checked ?? false,
      assignee_id: event?.assignee_id ?? bucketItem?.assignee_id ?? overdueItem?.assignee_id ?? null,
      assignee_ids: event?.assignee_ids ?? bucketItem?.assignee_ids ?? overdueItem?.assignee_ids ?? null,
      assigned_to: event?.assigned_to ?? bucketItem?.assigned_to ?? overdueItem?.assigned_to ?? null,
      duration: event?.duration ?? bucketItem?.duration ?? overdueItem?.duration ?? event?.durationMinutes ?? 60,
      short_id: event?.short_id ?? bucketItem?.short_id ?? overdueItem?.short_id ?? null,
      slug: event?.slug ?? bucketItem?.slug ?? overdueItem?.slug ?? null,
      due_date: withJstMidnight(targetDay),
      due_start: event?.due_start ?? bucketItem?.due_start ?? overdueItem?.due_start ?? null,
      due_end: event?.due_end ?? bucketItem?.due_end ?? overdueItem?.due_end ?? null,
      start_reminder_enabled: event?.start_reminder_enabled ?? bucketItem?.start_reminder_enabled ?? overdueItem?.start_reminder_enabled ?? false,
      start_reminder_minutes: event?.start_reminder_minutes ?? bucketItem?.start_reminder_minutes ?? overdueItem?.start_reminder_minutes ?? 0,
      end_reminder_enabled: event?.end_reminder_enabled ?? bucketItem?.end_reminder_enabled ?? overdueItem?.end_reminder_enabled ?? false,
      end_reminder_minutes: event?.end_reminder_minutes ?? bucketItem?.end_reminder_minutes ?? overdueItem?.end_reminder_minutes ?? 0,
      due_bucket: event?.due_bucket ?? bucketItem?.due_bucket ?? overdueItem?.due_bucket ?? dueBucketFromKey,
      due_bucket_position: event?.due_bucket_position ?? overdueItem?.due_bucket_position ?? bucketItem?.bucketPosition ?? null,
    } as Card;

    setData((prev) => (prev ? applyCardUpdate(prev, updatedCard, "UPDATE") : prev));

    if (dataMode === "api") {
      applyPatch(cardId, { due_date: withJstMidnight(targetDay) });
    }
  }, [data, dataMode, applyPatch, setData]);

  return {
    applyPatch,
    handleCardModalSave,
    handleCardModalDelete,
    handleToggleCardChecked,
    handleColumnClick,
    handleBucketClick,
    handleExternalEventClick,
    moveCardByDayOffset,
    googleToast,
    setGoogleToast,
    historySaveWarning,
    retryHistorySave,
    closeModalWithoutHistory,
  };
}
