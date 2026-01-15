"use client";

import { useCallback, useRef, useState } from "react";
import type { JSONContent } from "@tiptap/react";
import type { Card, DueBucket, Priority } from "@/lib/supabase";
import { normalizeContent, buildContentFromTitle, deriveExcerptFromContent } from "@/lib/tiptap";
import { slugify } from "@/lib/card-utils";
import { applyCardUpdate } from "@/app/(board)/_utils/card-updates";
import { minutesToTime } from "@/app/(board)/_utils/timeline-helpers";
import { withJstMidnight } from "@/app/(board)/_utils/timeline-helpers";
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

    // ... (rest of code) ...

    // Inside handleBucketClick (around line 314 in original)
    // I need to be careful with replace_file_content scope.
    // I will use multiple ReplaceChunks or just target the function part if I can encompass it.
    // The previous view_file was lines 1-434.
    // I will replace the Props definition and destructuring first.
    // Then handleBucketClick.


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

    const createCard = useCallback(async (payload: Partial<Card>, tempId?: string, options?: { openModal?: boolean }) => {
        if (dataMode !== 'api') return;
        try {
            const response = await fetch(`/api/boards/${initialBoardId}/cards`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!response.ok) throw new Error('Failed to create card');
            const body = await response.json();
            if (body.card) {
                const newCard = body.card as Card;
                setData((prev: any) => {
                    if (!prev) return prev;
                    let next = prev;
                    if (tempId) next = applyCardUpdate(next, { id: tempId } as Card, 'DELETE');
                    return applyCardUpdate(next, newCard, 'INSERT');
                });
                onCardCreated?.(newCard.id);
                if (options?.openModal !== false && newCard.short_id) openCardModal(newCard.short_id, 'create-card');
            }
        } catch (error) {
            setErrorMessage('Failed to create card');
            if (tempId) {
                setData((prev: any) => prev ? {
                    ...prev,
                    events: prev.events.filter((e: any) => e.card_id !== tempId),
                    abBuckets: Object.fromEntries(Object.entries(prev.abBuckets).map(([k, v]: [string, any]) => [k, v.filter((i: any) => i.card_id !== tempId)])),
                } : prev);
            }
        }
    }, [dataMode, initialBoardId, setData, openCardModal, setErrorMessage, onCardCreated]);

    const handleColumnClick = useCallback((day: TimelineDay, minutes: number) => {
        const title = "";
        const content = buildContentFromTitle(title);
        const excerpt = deriveExcerptFromContent(content);
        const payload: Partial<Card> = {
            title, content, excerpt, tags: [],
            due_date: withJstMidnight(day.isoDate),
            due_start: minutesToTime(minutes),
            due_end: minutesToTime(minutes + 60),
            priority: 'medium',
        };
        // 楽観的更新を無効化（auto-focus時のIDのスワップ問題回避のため）
        createCard(payload, undefined, { openModal: false });
    }, [createCard]);

    const handleBucketClick = useCallback((bucketKey: string, afterCardId?: string) => {
        const isoDate = bucketDayMap[bucketKey];
        if (!isoDate) return;
        const now = Date.now();
        const title = "";
        const content = buildContentFromTitle(title);
        const excerpt = deriveExcerptFromContent(content);
        const dueBucket = bucketKeyToDueBucket(bucketKey);

        const currentItems = (data?.abBuckets?.[bucketKey] ?? []) as TimelineBucketItem[];
        let position = now;

        if (afterCardId) {
            // Add to bottom: find current min position
            const minPos = currentItems.length > 0
                ? Math.min(...currentItems.map(i => i.bucketPosition ?? 0))
                : now;
            position = minPos - 1000; // Smaller position means lower in list due to descending sort
        }

        const payload: Partial<Card> = {
            title, content, excerpt, tags: [],
            due_date: withJstMidnight(isoDate),
            due_bucket: dueBucket,
            due_bucket_position: position,
            priority: 'medium',
        };

        // 楽観的更新を無効化（auto-focus時のIDのスワップ問題回避のため）
        createCard(payload, undefined, { openModal: false });
    }, [bucketDayMap, createCard, data?.abBuckets]);

    const handleToggleCardChecked = useCallback(async (cardId: string, nextChecked: boolean) => {
        if (dataMode !== 'api') return;
        try {
            setData((prev: any) => prev ? {
                ...prev,
                events: prev.events.map((e: any) => e.card_id === cardId ? { ...e, checked: nextChecked } : e),
                abBuckets: Object.fromEntries(Object.entries(prev.abBuckets).map(([k, v]: [string, any]) => [k, v.map((i: any) => i.card_id === cardId ? { ...i, checked: nextChecked } : i)])),
            } : prev);
            const res = await fetch(`/api/boards/${initialBoardId}/cards/${cardId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ checked: nextChecked }),
            });
            if (!res.ok) throw new Error();
        } catch (e) {
            fetchTimeline();
        }
    }, [dataMode, initialBoardId, setData, fetchTimeline]);

    // タイトルのインライン更新用 requestId
    const titleUpdateRequestIdRef = useRef(0);

    const handleUpdateCardTitle = useCallback(async (cardId: string, newTitle: string, previousTitle: string) => {
        if (dataMode !== 'api') return;

        const requestId = ++titleUpdateRequestIdRef.current;

        // 1. Find current card to get existing content
        let currentCard: any = null;
        if (data) {
            currentCard = data.events?.find((e: any) => e.card_id === cardId);
            if (!currentCard) {
                const buckets = Object.values(data.abBuckets || {}).flat() as any[];
                currentCard = buckets.find((i: any) => i.card_id === cardId);
            }
        }

        // 2. Parse input: Split title and body
        // Split by any newline sequence including unicode line separators
        const lines = newTitle.split(/\r\n|\r|\n|\u2028|\u2029/);
        const nextTitle = lines[0].trim();
        // Keep all lines for body to preserve empty lines (paragraphs)
        const pastedBodyLines = lines.slice(1).map(line => line.trim());

        // Debug output for user
        console.log('[timeline] split result:', {
            count: lines.length,
            title: nextTitle,
            firstBody: pastedBodyLines[0]
        });

        // 開発用：分割に失敗している場合はその旨を伝える（本番では削除）
        if (newTitle.length > 50 && lines.length === 1 && newTitle.includes(' ')) {
            // 新しい行がないが長いテキストの場合、スペースでの分割も検討すべきか？
            // いったんログのみ
            console.warn('[timeline] long text but no newlines detected');
        }

        // 3. Construct new content
        // Start with existing content or empty doc
        let baseContent: JSONContent = currentCard?.content ? normalizeContent(currentCard.content) : buildContentFromTitle("");

        // Ensure structure is Tiptap JSON
        if (!baseContent.content) {
            baseContent = buildContentFromTitle("");
        }

        // Clone to avoid mutating state directly
        const newContent = JSON.parse(JSON.stringify(baseContent));

        // Update first block (Title)
        if (!newContent.content) newContent.content = [];

        if (newContent.content.length > 0) {
            newContent.content[0] = {
                type: 'paragraph',
                content: nextTitle ? [{ type: 'text', text: nextTitle }] : []
            };
        } else {
            newContent.content = [{
                type: 'paragraph',
                content: nextTitle ? [{ type: 'text', text: nextTitle }] : []
            }];
        }

        // Insert pasted body lines as new paragraphs after the title
        if (pastedBodyLines.length > 0) {
            const newParagraphs = pastedBodyLines.map(line => {
                if (!line) {
                    return { type: 'paragraph' }; // Empty paragraph
                }
                return {
                    type: 'paragraph',
                    content: [{ type: 'text', text: line }]
                };
            });
            // Insert after index 0 (Title)
            newContent.content.splice(1, 0, ...newParagraphs);
        }

        const newExcerpt = deriveExcerptFromContent(newContent);

        // 楽観的UI更新
        setData((prev: any) => {
            return {
                ...prev,
                events: prev.events.map((e: any) => e.card_id === cardId ? { ...e, title: nextTitle, content: newContent, excerpt: newExcerpt } : e),
                abBuckets: Object.fromEntries(
                    Object.entries(prev.abBuckets).map(([k, v]: [string, any]) => [
                        k,
                        v.map((i: any) => i.card_id === cardId ? { ...i, title: nextTitle, content: newContent, excerpt: newExcerpt } : i)
                    ])
                ),
            };
        });

        try {
            const res = await fetch(`/api/boards/${initialBoardId}/cards/${cardId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: nextTitle,
                    content: newContent,
                    excerpt: newExcerpt,
                    slug: slugify(nextTitle),
                }),
            });

            if (!res.ok) throw new Error('Failed to update title');

            // requestIdが最新でない場合は無視（レースコンディション対策）
            if (requestId !== titleUpdateRequestIdRef.current) return;

        } catch (error) {
            // requestIdが最新の場合のみロールバック
            if (requestId === titleUpdateRequestIdRef.current) {
                console.error('[timeline] title update failed, rolling back', error);
                setData((prev: any) => {
                    if (!prev) return prev;
                    return {
                        ...prev,
                        events: prev.events.map((e: any) => e.card_id === cardId ? { ...e, title: previousTitle, content: currentCard?.content, excerpt: currentCard?.excerpt } : e),
                        abBuckets: Object.fromEntries(
                            Object.entries(prev.abBuckets).map(([k, v]: [string, any]) => [
                                k,
                                v.map((i: any) => i.card_id === cardId ? { ...i, title: previousTitle, content: currentCard?.content, excerpt: currentCard?.excerpt } : i)
                            ])
                        ),
                    };
                });
                setErrorMessage('タイトルの更新に失敗しました');
            }
        }
    }, [dataMode, initialBoardId, setData, setErrorMessage, data]);

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

    return {
        applyPatch,
        handleCardModalSave,
        handleCardModalDelete,
        handleToggleCardChecked,
        handleUpdateCardTitle,
        handleColumnClick,
        handleBucketClick,
        handleExternalEventClick,
        googleToast,
        setGoogleToast,
    };
}
