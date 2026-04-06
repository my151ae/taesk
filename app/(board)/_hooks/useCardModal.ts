import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { Card, Board, ProfileSummary } from '@/lib/supabase';
import { useSearchParams } from 'next/navigation';
import { TimelineResponse } from '@/app/(board)/_utils/timeline-helpers';
import { useBoardMembersStore } from '@/app/(board)/_stores/board-members-store';
import { bucketKeyToDueBucket } from "@/lib/bucket-normalization";
import { normalizeChecklist, EMPTY_CHECKLIST } from '@/lib/checklist';
import { normalizeContent } from '@/lib/tiptap';
import type { UrlUpdateMethod } from '@/app/(board)/_hooks/useTimelineUrlState';

type CardModalStatus = 'idle' | 'loading' | 'ready' | 'error';

type UseCardModalProps = {
    initialBoard: Board;
    dataMode: 'api' | 'mock';
    data: TimelineResponse | null;
    setCardInUrl: (card: string | null, options?: { method?: UrlUpdateMethod }) => void;
    onResolveTrashedCard?: () => void;
};

export function useCardModal({ initialBoard, dataMode, data, setCardInUrl, onResolveTrashedCard }: UseCardModalProps) {
    const searchParams = useSearchParams();
    const cardIdFromUrl = searchParams?.get('card');

    const [modalCardOverride, setModalCardOverride] = useState<Card | null>(null);
    const [cardModalStatus, setCardModalStatus] = useState<CardModalStatus>('idle');
    const [cardModalError, setCardModalError] = useState<string | null>(null);
    const [isModalClosing, setIsModalClosing] = useState(false);
    const [activeCardId, setActiveCardId] = useState<string | null>(null);
    const [modalProfiles, setModalProfiles] = useState<ProfileSummary[]>([]);

    const cardModalShortIdRef = useRef<string | null>(null);
    const cardModalStatusRef = useRef<CardModalStatus>('idle');
    const hasFallbackCardRef = useRef(false);
    const { getMembers: getStoredMembers, setMembers: setStoredMembers } = useBoardMembersStore();

    // Derived target ID to avoid multiple Effect triggers
    const targetShortId = useMemo(() => activeCardId || cardIdFromUrl, [activeCardId, cardIdFromUrl]);

    const openCardModal = useCallback((shortId: string | null, debugSource?: string) => {
        if (dataMode !== 'api') return;
        if (!shortId) return;

        console.log('[timeline] openCardModal', { shortId, source: debugSource });

        // Instant open via local state
        setActiveCardId(shortId);
        setCardInUrl(shortId, { method: 'push' });
    }, [dataMode, setCardInUrl]);

    const closeCardModal = useCallback(() => {
        setIsModalClosing(true);
        setActiveCardId(null);
        cardModalShortIdRef.current = null;
        setModalCardOverride(null);
        setCardModalStatus('idle');
        setCardInUrl(null, { method: 'push' });
    }, [setCardInUrl]);



    const modalCardFromData = useMemo(() => {
        if (isModalClosing) return null;
        const targetShortId = activeCardId || cardIdFromUrl;
        if (!targetShortId || !data) return null;

        // Find in events
        const eventCard = data.events.find(e => e.short_id === targetShortId);
        if (eventCard) {
            return {
                id: eventCard.card_id,
                title: eventCard.title,
                content: normalizeContent(eventCard.content),
                excerpt: eventCard.excerpt ?? null,
                checklist: normalizeChecklist(eventCard.checklist ?? EMPTY_CHECKLIST),
                tags: eventCard.tags,
                checked: eventCard.checked,
                short_id: eventCard.short_id,
                slug: eventCard.slug,
                deleted_at: null,
                purge_after_at: null,
                due_date: eventCard.due_date,
                due_start: eventCard.due_start,
                due_end: eventCard.due_end,
                start_reminder_enabled: Boolean(eventCard.start_reminder_enabled),
                start_reminder_minutes: eventCard.start_reminder_minutes ?? 0,
                end_reminder_enabled: Boolean(eventCard.end_reminder_enabled),
                end_reminder_minutes: eventCard.end_reminder_minutes ?? 0,
                due_bucket: eventCard.due_bucket ?? null,
                due_bucket_position: eventCard.due_bucket_position ?? null,
                board_id: initialBoard.id,
                created_at: '',
                updated_at: '',
                duration: eventCard.duration ?? 60,
                assignee_id: eventCard.assignee_id ?? null,
                assignee_ids: eventCard.assignee_ids ?? null,
                assigned_to: eventCard.assigned_to ?? null,
                list_id: '',
                position: 0,
                user_id: null,
                id_short: null,
            } as Card;
        }

        // Find in buckets
        for (const key in data.abBuckets) {
            const bucketItem = data.abBuckets[key].find(b => b.short_id === targetShortId);
            if (bucketItem) {
                return {
                    id: bucketItem.card_id,
                    title: bucketItem.title,
                    content: normalizeContent(bucketItem.content),
                    excerpt: bucketItem.excerpt ?? null,
                    checklist: normalizeChecklist(bucketItem.checklist ?? EMPTY_CHECKLIST),
                    tags: bucketItem.tags,
                    checked: bucketItem.checked,
                    short_id: bucketItem.short_id,
                    slug: bucketItem.slug,
                    deleted_at: null,
                    purge_after_at: null,
                    due_date: bucketItem.due_date,
                    due_start: bucketItem.due_start,
                    due_end: bucketItem.due_end,
                    start_reminder_enabled: Boolean(bucketItem.start_reminder_enabled),
                    start_reminder_minutes: bucketItem.start_reminder_minutes ?? 0,
                    end_reminder_enabled: Boolean(bucketItem.end_reminder_enabled),
                    end_reminder_minutes: bucketItem.end_reminder_minutes ?? 0,
                    due_bucket: bucketKeyToDueBucket(key),
                    due_bucket_position: bucketItem.bucketPosition,
                    board_id: initialBoard.id,
                    created_at: '',
                    updated_at: '',
                    duration: bucketItem.duration ?? 60,
                    assignee_id: bucketItem.assignee_id ?? null,
                    assignee_ids: bucketItem.assignee_ids ?? null,
                    assigned_to: bucketItem.assigned_to ?? null,
                    list_id: '',
                    position: 0,
                    user_id: null,
                    id_short: null,
                } as Card;
            }
        }

        const overdueItem = data.overdue.find((item) => item.short_id === targetShortId);
        if (overdueItem) {
            return {
                id: overdueItem.card_id,
                title: overdueItem.title,
                content: normalizeContent(overdueItem.content),
                excerpt: overdueItem.excerpt ?? null,
                checklist: normalizeChecklist(overdueItem.checklist ?? EMPTY_CHECKLIST),
                tags: overdueItem.tags,
                checked: overdueItem.checked,
                short_id: overdueItem.short_id,
                slug: overdueItem.slug,
                deleted_at: null,
                purge_after_at: null,
                due_date: overdueItem.due_date,
                due_start: overdueItem.due_start,
                due_end: overdueItem.due_end,
                start_reminder_enabled: Boolean(overdueItem.start_reminder_enabled),
                start_reminder_minutes: overdueItem.start_reminder_minutes ?? 0,
                end_reminder_enabled: Boolean(overdueItem.end_reminder_enabled),
                end_reminder_minutes: overdueItem.end_reminder_minutes ?? 0,
                due_bucket: overdueItem.due_bucket ?? null,
                due_bucket_position: overdueItem.due_bucket_position ?? null,
                board_id: initialBoard.id,
                created_at: '',
                updated_at: '',
                duration: overdueItem.duration ?? 60,
                assignee_id: overdueItem.assignee_id ?? null,
                assignee_ids: overdueItem.assignee_ids ?? null,
                assigned_to: overdueItem.assigned_to ?? null,
                list_id: '',
                position: 0,
                user_id: null,
                id_short: null,
            } as Card;
        }

        return null;
    }, [data, activeCardId, cardIdFromUrl, initialBoard.id, isModalClosing]);

    const modalCard = useMemo(
        () => modalCardOverride ?? modalCardFromData,
        [modalCardOverride, modalCardFromData]
    );

    useEffect(() => {
        hasFallbackCardRef.current = Boolean(modalCardOverride ?? modalCardFromData);
    }, [modalCardOverride, modalCardFromData]);

    useEffect(() => {
        cardModalStatusRef.current = cardModalStatus;
    }, [cardModalStatus]);

    // 1. Initial Data Sync: Keep local state in sync with timeline data if available
    useEffect(() => {
        if (targetShortId && modalCardFromData) {
            setModalCardOverride(modalCardFromData);
        }
    }, [targetShortId, modalCardFromData]);

    // 2. Load Full Card Data: Fetch only when ID changes or modal opens
    useEffect(() => {
        if (!targetShortId) {
            if (isModalClosing) setIsModalClosing(false);
            cardModalShortIdRef.current = null;
            setModalProfiles((prev) => (prev.length ? [] : prev));
            setCardModalStatus((prev) => (prev === 'idle' ? prev : 'idle'));
            setCardModalError((prev) => (prev === null ? prev : null));
            return;
        }

        if (isModalClosing) {
            if (activeCardId) setIsModalClosing(false);
            else return;
        }

        // 同一カードで既に full data が取れている場合は再取得しない
        // (保存後の timeline setData による不要な loading 再表示を防ぐ)
        if (cardModalShortIdRef.current === targetShortId && cardModalStatusRef.current === 'ready') {
            return;
        }

        cardModalShortIdRef.current = targetShortId;

        const abortController = new AbortController();

        const loadCard = async () => {
            console.log('[useCardModal] fetching full data', targetShortId);
            setCardModalStatus(hasFallbackCardRef.current ? 'ready' : 'loading');
            setCardModalError(null);

            try {
                const response = await fetch(`/api/cards/${targetShortId}`, {
                    signal: abortController.signal
                });
                const body = await response.json().catch(() => null);

                if (abortController.signal.aborted) return;

                if (response.status === 404) {
                    setCardModalError('Card not found');
                    if (hasFallbackCardRef.current) {
                        setCardModalStatus('ready');
                    } else {
                        setCardModalStatus('error');
                    }
                    return;
                }

                if (!response.ok) {
                    throw new Error(body?.error?.message || `Failed to load card (status ${response.status})`);
                }

                const nextCard = body?.card ?? null;
                setModalCardOverride(nextCard);
                if (nextCard?.deleted_at) {
                    onResolveTrashedCard?.();
                }

                if (Array.isArray(body?.profiles) && body.profiles.length > 0) {
                    setModalProfiles(body.profiles);
                }

                if (nextCard) {
                    setCardModalStatus('ready');
                } else {
                    setCardModalError('Card not found');
                    if (hasFallbackCardRef.current) {
                        setCardModalStatus('ready');
                    } else {
                        setCardModalStatus('error');
                    }
                }
            } catch (error) {
                if (error instanceof Error && error.name === 'AbortError') {
                    // Ignore abort errors
                    return;
                }

                console.error('[useCardModal] fetch failed', error);
                const message = error instanceof Error ? error.message : 'Failed to load card';
                setCardModalError(message);
                if (hasFallbackCardRef.current) {
                    setCardModalStatus('ready');
                } else {
                    setCardModalStatus('error');
                }
            }
        };

        loadCard();

        return () => {
            abortController.abort();
        };
    }, [targetShortId, isModalClosing, activeCardId, onResolveTrashedCard]);

    // Load Board Members
    useEffect(() => {
        let cancelled = false;
        const boardId = modalCard?.board_id ?? initialBoard.id;

        const loadBoardMembers = async () => {
            const cached = getStoredMembers(boardId);
            if (cached) {
                if (!cancelled) {
                    setModalProfiles(cached.map(member => member.profile));
                }
                return;
            }

            try {
                const response = await fetch(`/api/boards/${boardId}/members`);
                if (!response.ok) {
                    console.warn('[timeline] failed to fetch board members', { status: response.status });
                    return;
                }
                const { members } = await response.json();
                if (cancelled) return;

                const normalized: Array<{ profile: ProfileSummary; role: "owner" | "editor" | "commenter" | "viewer" }> = members.map((member: { profile: ProfileSummary; role: "owner" | "editor" | "commenter" | "viewer" }) => ({
                    profile: member.profile,
                    role: member.role,
                }));

                setStoredMembers(boardId, normalized);
                setModalProfiles(normalized.map((member) => member.profile));
            } catch (error) {
                if (!cancelled) {
                    console.warn('[timeline] error loading board members', error);
                }
            }
        };

        loadBoardMembers();

        return () => {
            cancelled = true;
        };
    }, [modalCard?.board_id, initialBoard.id, getStoredMembers, setStoredMembers]);

    return {
        modalCard,
        cardModalStatus,
        cardModalError,
        setCardModalError,
        setModalCardOverride,
        isModalClosing,
        openCardModal,
        closeCardModal,
        modalProfiles,
    };
}
