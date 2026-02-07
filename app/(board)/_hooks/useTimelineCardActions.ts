"use client";

import { useCallback, useRef, useState } from "react";
import type { Card, DueBucket, Priority } from "@/lib/supabase";
import { normalizeContent, buildContentFromTitle, deriveExcerptFromContent, ensureTitleTask, setTitleTask } from "@/lib/tiptap";
import { slugify } from "@/lib/card-utils";
import { applyCardUpdate } from "@/app/(board)/_utils/card-updates";
import { minutesToTime } from "@/app/(board)/_utils/timeline-helpers";
import { withJstMidnight } from "@/app/(board)/_utils/timeline-helpers";
import { getIsoDateJst, toLocalDay } from "@/app/(board)/_utils/timeline-helpers";
import { bucketKeyToDueBucket } from "@/lib/bucket-normalization";
import type { TimelineBucketItem, TimelineEvent, TimelineDay } from "@/app/(board)/_utils/timeline-helpers";

interface UseTimelineCardActionsProps {
    initialBoardId: string;
    dataMode: string;
    setData: React.Dispatch<React.SetStateAction<any>>;
    fetchTimeline: (offset?: number) => Promise<any>;
    openCardModal: (shortId: string, source?: string) => void;
    closeCardModal: () => void;
    modalCard: Card | null;
    setModalCardOverride: (card: Card | null) => void;
    setCardModalError: (error: string | null) => void;
    setErrorMessage: (error: string | null) => void;
    bucketDayMap: Record<string, string | null>;
    googleCalendarEvents: any[];
    refreshGoogleCalendar: () => Promise<void> | void;
    data: any;
    onCardCreated?: (cardId: string) => void;
}

const addDays = (isoDate: string, offsetDays: number) => {
    const [y, m, d] = isoDate.split('-').map((v) => Number(v));
    if (!y || !m || !d || Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return isoDate;
    const baseUtc = Date.UTC(y, m - 1, d);
    const nextUtc = baseUtc + offsetDays * 24 * 60 * 60 * 1000;
    return new Date(nextUtc).toISOString().split('T')[0];
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
    const [googleToast, setGoogleToast] = useState<string | null>(null);

    const syncCardNowWithToast = useCallback(async (card: Card | null) => {
        if (!card?.due_date || !card?.due_start || !card?.due_end) return;
        try {
            const statusRes = await fetch(`/api/calendar-sync/${card.id}`);
            const statusBody = await statusRes.json().catch(() => null);
            if (!statusRes.ok || statusBody?.status !== 'active') return;
            setGoogleToast('Google同期中...');
            const syncRes = await fetch(`/api/calendar-sync/${card.id}`, { method: 'POST' });
            const syncBody = await syncRes.json().catch(() => null);
            if (!syncRes.ok) {
                setGoogleToast(syncBody?.error?.message ? `同期失敗: ${syncBody.error.message}` : 'Google同期に失敗しました');
                window.setTimeout(() => setGoogleToast(null), 3500);
                return;
            }
            setGoogleToast('Google同期が完了しました');
        } catch (error) {
            console.error('[timeline] immediate sync failed', error);
            setGoogleToast('Google同期に失敗しました');
        } finally {
            window.setTimeout(() => setGoogleToast(null), 3500);
        }
    }, []);

    const applyPatch = useCallback(
        async (cardId: string, payload: Record<string, unknown>) => {
            if (dataMode !== 'api') return;
            try {
                const response = await fetch(`/api/boards/${initialBoardId}/cards/${cardId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                if (!response.ok) throw new Error('Patch failed');
            } catch (error) {
                console.error('[timeline] update error', error);
                setErrorMessage(error instanceof Error ? error.message : 'Failed to update card');
            }
        },
        [dataMode, initialBoardId, setErrorMessage]
    );

    const handleCardModalSave = useCallback(
        async (savePayload: any) => {
            const targetCard = modalCard && modalCard.id === savePayload.id ? modalCard : null;
            if (!targetCard) return;
            let requestId = 0;
            try {
                const nextAssignee = savePayload.assigneeIds?.[0] || null;
                let normalizedDueDate: string | null = null;
                if (savePayload.due_date) {
                    const parsed = new Date(savePayload.due_date);
                    if (!Number.isNaN(parsed.getTime())) normalizedDueDate = parsed.toISOString();
                }
                const payload: any = {
                    title: savePayload.title,
                    content: normalizeContent(savePayload.content),
                    excerpt: savePayload.excerpt ?? "",
                    tags: savePayload.tags,
                    due_date: normalizedDueDate,
                    due_start: savePayload.due_start,
                    due_end: savePayload.due_end,
                    due_bucket: savePayload.due_bucket,
                    due_bucket_position: savePayload.due_bucket_position,
                    priority: savePayload.priority,
                    duration: savePayload.duration,
                    slug: slugify(savePayload.title),
                };
                if (savePayload.assigneeTouched) {
                    payload.assignee_id = nextAssignee;
                    payload.assignee_ids = savePayload.assigneeIds?.length ? savePayload.assigneeIds : null;
                    payload.assigned_to = null;
                }

                if (saveAbortRef.current) saveAbortRef.current.abort();
                requestId = ++saveRequestIdRef.current;
                const controller = new AbortController();
                saveAbortRef.current = controller;

                const response = await fetch(`/api/boards/${targetCard.board_id}/cards/${targetCard.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    signal: controller.signal,
                });
                const body = await response.json().catch(() => null);
                if (requestId !== saveRequestIdRef.current) return;
                if (!response.ok) throw new Error(body?.error?.message || 'Failed to update card');

                if (body?.card) {
                    const updatedCard = body.card as Card;
                    setModalCardOverride(updatedCard);
                    setData((prev: any) => prev ? applyCardUpdate(prev, updatedCard, 'UPDATE') : prev);
                }

                if (!savePayload.isAutoSave) {
                    const titleChanged = targetCard.title !== savePayload.title;
                    const dateChanged = targetCard.due_date !== normalizedDueDate;
                    const startChanged = (targetCard.due_start?.slice(0, 5)) !== (savePayload.due_start?.slice(0, 5));
                    const endChanged = (targetCard.due_end?.slice(0, 5)) !== (savePayload.due_end?.slice(0, 5));

                    if (titleChanged || dateChanged || startChanged || endChanged) {
                        void syncCardNowWithToast(body?.card as Card);
                    }
                    closeCardModal();
                }
            } catch (error: any) {
                if (error.name === 'AbortError') return;
                setCardModalError(error.message || 'Failed to save card');
            } finally {
                if (requestId === saveRequestIdRef.current) saveAbortRef.current = null;
            }
        },
        [modalCard, closeCardModal, setCardModalError, setModalCardOverride, setData, syncCardNowWithToast]
    );

    const handleCardModalDelete = useCallback(
        async (cardId: string) => {
            // 1. Try to find the card in the modal
            let targetCard = modalCard && modalCard.id === cardId ? modalCard : null;

            // 2. If not in modal, try to find in timeline data
            if (!targetCard && data) {
                const foundEvent = data.events?.find((e: any) => e.card_id === cardId);
                if (foundEvent) {
                    targetCard = { ...foundEvent, id: foundEvent.card_id, board_id: initialBoardId } as Card;
                } else {
                    const foundBucketItem = Object.values(data.abBuckets || {})
                        .flat()
                        .find((i: any) => (i as any).card_id === cardId);
                    if (foundBucketItem) {
                        targetCard = { ...foundBucketItem, id: (foundBucketItem as any).card_id, board_id: initialBoardId } as Card;
                    }
                }
            }

            if (!targetCard) {
                // Fallback: assume it exists on the current board if we have an ID, 
                // though it's safer to have found it. 
                // For now, let's trust the ID and initialBoardId if we couldn't find the object but was triggered.
                targetCard = { id: cardId, board_id: initialBoardId } as Card;
            }

            try {
                const response = await fetch(`/api/boards/${targetCard.board_id}/cards/${targetCard.id}`, { method: 'DELETE' });
                if (!response.ok) throw new Error('Failed to delete card');
                setData((prev: any) => prev ? applyCardUpdate(prev, { id: cardId } as Card, 'DELETE') : prev);
            } catch (error: any) {
                setCardModalError(error.message || 'Failed to delete card');
            } finally {
                // Only close if the deleted card was the one open
                if (modalCard?.id === cardId) {
                    closeCardModal();
                }
            }
        },
        [modalCard, closeCardModal, setData, setCardModalError, data, initialBoardId]
    );

    const createCard = useCallback(async (payload: Partial<Card>, options?: { openModal?: boolean }) => {
        if (dataMode !== 'api') return;

        const optimisticId = payload.id ?? crypto.randomUUID();
        const nowIso = new Date().toISOString();
        const optimisticContent = payload.content ?? buildContentFromTitle(payload.title ?? '');
        const optimisticExcerpt = payload.excerpt ?? deriveExcerptFromContent(optimisticContent);

        const optimisticCard: Card = {
            id: optimisticId,
            title: payload.title ?? '',
            checklist: payload.checklist ?? null,
            content: optimisticContent,
            excerpt: optimisticExcerpt,
            list_id: payload.list_id ?? 'optimistic',
            board_id: initialBoardId,
            position: payload.position ?? 0,
            user_id: payload.user_id ?? null,
            tags: payload.tags ?? [],
            due_date: payload.due_date ?? null,
            due_start: payload.due_start ?? null,
            due_end: payload.due_end ?? null,
            due_bucket: payload.due_bucket ?? null,
            due_bucket_position: payload.due_bucket_position ?? null,
            duration: payload.duration ?? 60,
            priority: payload.priority ?? 'medium',
            checked: payload.checked ?? false,
            assigned_to: payload.assigned_to ?? null,
            assignee_id: payload.assignee_id ?? null,
            assignee_ids: payload.assignee_ids ?? null,
            short_id: payload.short_id ?? null,
            id_short: payload.id_short ?? null,
            slug: payload.slug ?? null,
            created_at: payload.created_at ?? nowIso,
            updated_at: payload.updated_at ?? nowIso,
        };

        // 楽観的更新: IDを先行生成し、サーバー確定後は同一IDでUPDATEする
        setData((prev: any) => (prev ? applyCardUpdate(prev, optimisticCard, 'INSERT') : prev));

        try {
            const response = await fetch(`/api/boards/${initialBoardId}/cards`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...payload, id: optimisticId }),
            });
            if (!response.ok) throw new Error('Failed to create card');
            const body = await response.json();
            if (body.card) {
                const newCard = body.card as Card;
                setData((prev: any) => (prev ? applyCardUpdate(prev, newCard, 'UPDATE') : prev));
                onCardCreated?.(newCard.id);
                if (options?.openModal !== false && newCard.short_id) openCardModal(newCard.short_id, 'create-card');
            }
        } catch (error) {
            setErrorMessage('Failed to create card');
            setData((prev: any) => (prev ? applyCardUpdate(prev, { id: optimisticId } as Card, 'DELETE') : prev));
        }
    }, [dataMode, initialBoardId, setData, openCardModal, setErrorMessage, onCardCreated]);

    const handleColumnClick = useCallback((day: TimelineDay, minutes: number) => {
        const title = "";
        const content = buildContentFromTitle(''); // Default unchecked task
        const excerpt = deriveExcerptFromContent(content);
        const payload: Partial<Card> = {
            title, content, excerpt, tags: [],
            due_date: withJstMidnight(day.isoDate),
            due_start: minutesToTime(minutes),
            due_end: minutesToTime(minutes + 60),
            priority: 'medium',
        };
        // 楽観的更新: IDを先行生成し、サーバー確定後は同一IDで更新
        createCard(payload, { openModal: false });
    }, [createCard]);

    const handleBucketClick = useCallback((bucketKey: string, afterCardId?: string) => {
        const isoDate = bucketDayMap[bucketKey];
        if (!isoDate) return;
        const now = Date.now();
        const title = "";
        const content = buildContentFromTitle(''); // Default unchecked task
        const excerpt = deriveExcerptFromContent(content);
        const dueBucket = bucketKeyToDueBucket(bucketKey);

        const currentItems = (data?.abBuckets?.[bucketKey] ?? []) as TimelineBucketItem[];
        let position = now;

        if (afterCardId) {
            // position is descending (larger is upper)
            // Sort items to ensure order
            const sortedItems = [...currentItems].sort((a, b) => (b.bucketPosition ?? 0) - (a.bucketPosition ?? 0));
            const targetIndex = sortedItems.findIndex(i => i.card_id === afterCardId);

            if (targetIndex !== -1) {
                const targetItem = sortedItems[targetIndex];
                const nextItem = sortedItems[targetIndex + 1];

                if (nextItem) {
                    // Insert between target and next
                    const p1 = targetItem.bucketPosition ?? 0;
                    const p2 = nextItem.bucketPosition ?? 0;
                    position = (p1 + p2) / 2;
                } else {
                    // Target is the last item, insert below it
                    position = (targetItem.bucketPosition ?? 0) - 1000;
                }
            } else {
                // Fallback: Add to bottom if target not found
                const minPos = currentItems.length > 0
                    ? Math.min(...currentItems.map(i => i.bucketPosition ?? 0))
                    : now;
                position = minPos - 1000;
            }
        }

        const payload: Partial<Card> = {
            title, content, excerpt, tags: [],
            due_date: withJstMidnight(isoDate),
            due_bucket: dueBucket,
            due_bucket_position: position,
            priority: 'medium',
        };

        // 楽観的更新: IDを先行生成し、サーバー確定後は同一IDで更新
        createCard(payload, { openModal: false });
    }, [bucketDayMap, createCard, data?.abBuckets]);

    const handleToggleCardChecked = useCallback(async (cardId: string, nextChecked: boolean) => {
        if (dataMode !== 'api') return;
        try {
            const event = data?.events?.find((e: any) => e.card_id === cardId) ?? null;
            let bucketItem: any = null;
            if (!event) {
                for (const items of Object.values(data?.abBuckets || {})) {
                    const found = (items as any[]).find((i) => i.card_id === cardId);
                    if (found) {
                        bucketItem = found;
                        break;
                    }
                }
            }

            const source = event ?? bucketItem;
            const fallbackTitle = source?.title ?? "";
            const baseContent = normalizeContent(source?.content ?? buildContentFromTitle(fallbackTitle));
            const ensured = ensureTitleTask(baseContent, fallbackTitle, nextChecked);
            const { content: nextContent } = setTitleTask(ensured.content, { checked: nextChecked });
            const nextExcerpt = deriveExcerptFromContent(nextContent);

            setData((prev: any) => prev ? {
                ...prev,
                events: prev.events.map((e: any) => e.card_id === cardId
                    ? { ...e, checked: nextChecked, content: nextContent, excerpt: nextExcerpt }
                    : e
                ),
                abBuckets: Object.fromEntries(Object.entries(prev.abBuckets).map(([k, v]: [string, any]) => [k, v.map((i: any) => i.card_id === cardId
                    ? { ...i, checked: nextChecked, content: nextContent, excerpt: nextExcerpt }
                    : i
                )])),
            } : prev);

            const payload = source ? { content: nextContent } : { checked: nextChecked };
            const res = await fetch(`/api/boards/${initialBoardId}/cards/${cardId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok) throw new Error();
        } catch (e) {
            fetchTimeline();
        }
    }, [dataMode, initialBoardId, setData, fetchTimeline, data]);

    const handleExternalEventClick = useCallback(async (entry: any) => {
        try {
            const googleEventId = entry.eventId ?? entry.id;
            const res = await fetch('/api/calendar/convert', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ google_event_id: googleEventId }),
            });
            if (!res.ok) throw new Error();
            const body = await res.json();
            await fetchTimeline(0);
            await refreshGoogleCalendar();
            setGoogleToast('Googleイベント変換完了');
            if (body?.card?.short_id) openCardModal(body.card.short_id, 'gcard-convert');
        } catch (e) {
            alert('変換失敗');
        }
    }, [fetchTimeline, refreshGoogleCalendar, openCardModal]);

    const moveCardByDayOffset = useCallback((cardId: string, offsetDays: number) => {
        if (!data) return;
        const todayIso = getIsoDateJst(data?.serverNow ?? new Date().toISOString());
        const targetDay = addDays(todayIso, offsetDays);

        const event = data.events?.find((e: any) => e.card_id === cardId) ?? null;
        let bucketItem: any = null;
        let bucketKey: string | null = null;
        if (!event) {
            for (const [key, items] of Object.entries(data.abBuckets || {})) {
                const found = (items as any[]).find((i) => i.card_id === cardId);
                if (found) {
                    bucketItem = found;
                    bucketKey = key;
                    break;
                }
            }
        }
        if (!event && !bucketItem) return;

        const currentDueDate = event?.due_date ?? bucketItem?.due_date ?? null;
        const currentLocalDay = toLocalDay(currentDueDate);
        if (currentLocalDay === targetDay) return;

        const dueBucketFromKey = bucketKey ? (bucketKey.split('_')[1] as DueBucket) : null;
        const updatedCard = {
            id: cardId,
            title: event?.title ?? bucketItem?.title ?? "Untitled card",
            content: event?.content ?? bucketItem?.content ?? null,
            excerpt: event?.excerpt ?? bucketItem?.excerpt ?? null,
            checklist: event?.checklist ?? bucketItem?.checklist ?? null,
            tags: event?.tags ?? bucketItem?.tags ?? [],
            priority: event?.priority ?? bucketItem?.priority ?? null,
            checked: event?.checked ?? bucketItem?.checked ?? false,
            assignee_id: event?.assignee_id ?? bucketItem?.assignee_id ?? null,
            assignee_ids: event?.assignee_ids ?? bucketItem?.assignee_ids ?? null,
            assigned_to: event?.assigned_to ?? bucketItem?.assigned_to ?? null,
            duration: event?.duration ?? bucketItem?.duration ?? event?.durationMinutes ?? 60,
            short_id: event?.short_id ?? bucketItem?.short_id ?? null,
            slug: event?.slug ?? bucketItem?.slug ?? null,
            due_date: withJstMidnight(targetDay),
            due_start: event?.due_start ?? bucketItem?.due_start ?? null,
            due_end: event?.due_end ?? bucketItem?.due_end ?? null,
            due_bucket: (event?.due_bucket as DueBucket | null) ?? dueBucketFromKey,
            due_bucket_position: event?.due_bucket_position ?? bucketItem?.bucketPosition ?? null,
        } as Card;

        setData((prev: any) => (prev ? applyCardUpdate(prev, updatedCard, 'UPDATE') : prev));

        if (dataMode === 'api') {
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
    };
}
