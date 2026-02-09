import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { Card, Board, ProfileSummary } from '@/lib/supabase';
import { useRouter, useSearchParams } from 'next/navigation';
import { buildBoardUrl } from '@/lib/board-url';
import { TimelineResponse } from '@/app/(board)/_utils/timeline-helpers';
import { useBoardMembersStore } from '@/app/(board)/_stores/board-members-store';
import { useCommentsStore } from '@/app/(board)/_stores/comments-store';
import { bucketKeyToDueBucket } from "@/lib/bucket-normalization";
import { normalizeChecklist, EMPTY_CHECKLIST } from '@/lib/checklist';
import { normalizeContent } from '@/lib/tiptap';

type CardModalStatus = 'idle' | 'loading' | 'ready' | 'error';

type UseCardModalProps = {
    initialBoard: Board;
    dataMode: 'api' | 'mock';
    data: TimelineResponse | null;
};

export function useCardModal({ initialBoard, dataMode, data }: UseCardModalProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const cardIdFromUrl = searchParams?.get('card');

    const [modalCardOverride, setModalCardOverride] = useState<Card | null>(null);
    const [cardModalStatus, setCardModalStatus] = useState<CardModalStatus>('idle');
    const [cardModalError, setCardModalError] = useState<string | null>(null);
    const [isModalClosing, setIsModalClosing] = useState(false);
    const [activeCardId, setActiveCardId] = useState<string | null>(null);
    const [modalProfiles, setModalProfiles] = useState<ProfileSummary[]>([]);

    const cardModalShortIdRef = useRef<string | null>(null);
    const { getMembers: getStoredMembers, setMembers: setStoredMembers, shouldRefetch } = useBoardMembersStore();
    const loadComments = useCommentsStore(state => state.loadComments);

    // Derived target ID to avoid multiple Effect triggers
    const targetShortId = useMemo(() => activeCardId || cardIdFromUrl, [activeCardId, cardIdFromUrl]);

    const openCardModal = useCallback((shortId: string | null, debugSource?: string) => {
        if (dataMode !== 'api') return;
        if (!shortId) return;

        console.log('[timeline] openCardModal', { shortId, source: debugSource });

        // Instant open via local state
        setActiveCardId(shortId);

        const baseUrl = buildBoardUrl(initialBoard);
        const params = new URLSearchParams(searchParams?.toString());
        params.set('card', shortId);
        const query = params.toString();
        const url = query ? `${baseUrl}?${query}` : baseUrl;
        router.push(url, { scroll: false });
    }, [dataMode, initialBoard, router, searchParams]);

    const closeCardModal = useCallback(() => {
        setIsModalClosing(true);
        setActiveCardId(null);
        cardModalShortIdRef.current = null;
        setModalCardOverride(null);
        setCardModalStatus('idle');
        const baseUrl = buildBoardUrl(initialBoard);
        const params = new URLSearchParams(searchParams?.toString());
        params.delete('card');
        const query = params.toString();
        const url = query ? `${baseUrl}?${query}` : baseUrl;
        router.push(url, { scroll: false });
    }, [initialBoard, router, searchParams]);



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
                content: normalizeContent((eventCard as any).content),
                excerpt: eventCard.excerpt ?? null,
                checklist: normalizeChecklist(eventCard.checklist ?? EMPTY_CHECKLIST),
                tags: eventCard.tags,
                priority: eventCard.priority,
                checked: eventCard.checked,
                short_id: eventCard.short_id,
                slug: eventCard.slug,
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
                    content: normalizeContent((bucketItem as any).content),
                    excerpt: bucketItem.excerpt ?? null,
                    checklist: normalizeChecklist(bucketItem.checklist ?? EMPTY_CHECKLIST),
                    tags: bucketItem.tags,
                    priority: 'medium',
                    checked: bucketItem.checked,
                    short_id: bucketItem.short_id,
                    slug: bucketItem.slug,
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

        return null;
    }, [data, activeCardId, cardIdFromUrl, initialBoard.id, isModalClosing]);

    const modalCard = useMemo(
        () => modalCardOverride ?? modalCardFromData,
        [modalCardOverride, modalCardFromData]
    );

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
            setModalProfiles([]);
            setCardModalStatus('idle');
            setCardModalError(null);
            return;
        }

        if (isModalClosing) {
            if (activeCardId) setIsModalClosing(false);
            else return;
        }

        // REMOVED: Blocking guard clause that caused the reload issue
        // The previous check (cardModalShortIdRef.current === targetShortId && status === loading/ready)
        // prevented re-fetching when React Strict Mode cancelled the first attempt but left the status as 'loading'.

        cardModalShortIdRef.current = targetShortId;

        const abortController = new AbortController();

        const loadCard = async () => {
            console.log('[useCardModal] fetching full data', targetShortId);
            setCardModalStatus('loading');
            setCardModalError(null);

            try {
                const response = await fetch(`/api/cards/${targetShortId}`, {
                    signal: abortController.signal
                });
                const body = await response.json().catch(() => null);

                if (abortController.signal.aborted) return;

                if (!response.ok) {
                    throw new Error(body?.error?.message || `Failed to load card (status ${response.status})`);
                }

                const nextCard = body?.card ?? null;
                setModalCardOverride(nextCard);

                if (Array.isArray(body?.profiles) && body.profiles.length > 0) {
                    setModalProfiles(body.profiles);
                }

                if (nextCard) {
                    setCardModalStatus('ready');
                    loadComments(nextCard.id);
                } else {
                    setCardModalError('Card not found');
                    if (modalCardFromData) {
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
                if (modalCardFromData) {
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
    }, [targetShortId, isModalClosing, loadComments]);

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
                if (!shouldRefetch(boardId)) {
                    return;
                }
            }

            try {
                const response = await fetch(`/api/boards/${boardId}/members`);
                if (!response.ok) {
                    console.warn('[timeline] failed to fetch board members', { status: response.status });
                    return;
                }
                const { members } = await response.json();
                if (cancelled) return;

                const normalized = members.map((member: { profile: ProfileSummary; role: any }) => ({
                    profile: member.profile,
                    role: member.role,
                }));

                setStoredMembers(boardId, normalized);
                setModalProfiles(normalized.map((member: { profile: ProfileSummary; role: any }) => member.profile));
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
    }, [modalCard?.board_id, initialBoard.id, getStoredMembers, setStoredMembers, shouldRefetch]);

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
