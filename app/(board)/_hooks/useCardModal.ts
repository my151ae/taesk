import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { Card, Board, ProfileSummary } from '@/lib/supabase';
import { useRouter, useSearchParams } from 'next/navigation';
import { buildBoardUrl } from '@/lib/board-url';
import { TimelineResponse } from '@/app/(board)/_utils/timeline-helpers';
import { useBoardMembersStore } from '@/app/(board)/_stores/board-members-store';
import { useCommentsStore } from '@/app/(board)/_stores/comments-store';
import { bucketKeyToDueBucket } from "@/lib/bucket-normalization";

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

    const openCardModal = useCallback((shortId: string | null, debugSource?: string) => {
        if (dataMode !== 'api') return;
        if (!shortId) return;

        console.log('[timeline] openCardModal', { shortId, source: debugSource });

        // Instant open via local state
        setActiveCardId(shortId);

        const baseUrl = buildBoardUrl(initialBoard);
        const url = `${baseUrl}?card=${shortId}`;
        router.push(url, { scroll: false });
    }, [dataMode, initialBoard, router]);

    const closeCardModal = useCallback(() => {
        setIsModalClosing(true);
        setActiveCardId(null);
        cardModalShortIdRef.current = null;
        setModalCardOverride(null);
        setCardModalStatus('idle');
        const baseUrl = buildBoardUrl(initialBoard);
        router.push(baseUrl, { scroll: false });
    }, [initialBoard, router]);



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
                description: '',
                tags: eventCard.tags,
                priority: eventCard.priority,
                checked: eventCard.checked,
                short_id: eventCard.short_id,
                slug: eventCard.slug,
                due_date: eventCard.due_date,
                due_start: eventCard.due_start,
                due_end: eventCard.due_end,
                due_channel: 'timeline',
                due_bucket: eventCard.due_bucket ?? null,
                due_bucket_position: eventCard.due_bucket_position ?? null,
                board_id: initialBoard.id,
                created_at: '',
                updated_at: '',
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
                    description: '',
                    tags: bucketItem.tags,
                    priority: 'medium',
                    checked: bucketItem.checked,
                    short_id: bucketItem.short_id,
                    slug: bucketItem.slug,
                    due_date: bucketItem.due_date,
                    due_start: bucketItem.due_start,
                    due_end: bucketItem.due_end,
                    due_channel: 'ab-list',
                    due_bucket: bucketKeyToDueBucket(key),
                    due_bucket_position: bucketItem.bucketPosition,
                    board_id: initialBoard.id,
                    created_at: '',
                    updated_at: '',
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

    // Load Card Data
    useEffect(() => {
        const targetShortId = activeCardId || cardIdFromUrl;

        if (!targetShortId) {
            if (isModalClosing) {
                setIsModalClosing(false);
            }
            cardModalShortIdRef.current = null;
            setModalProfiles([]);
            setCardModalStatus('idle');
            setCardModalError(null);
            return;
        }

        if (isModalClosing) {
            if (activeCardId) {
                setIsModalClosing(false);
            } else {
                return;
            }
        }

        if (cardModalShortIdRef.current === targetShortId && (cardModalStatus === 'ready' || cardModalStatus === 'loading')) {
            return;
        }
        cardModalShortIdRef.current = targetShortId;

        let cancelled = false;
        const loadCard = async () => {
            setCardModalStatus('loading');
            setCardModalError(null);
            setModalCardOverride(null);
            try {
                const response = await fetch(`/api/cards/${targetShortId}`);
                if (!response.ok) {
                    const body = await response.json().catch(() => null);
                    throw new Error(body?.error?.message || 'Failed to load card');
                }
                const body = await response.json();
                if (cancelled) return;
                setModalCardOverride(body.card ?? null);
                if (Array.isArray(body.profiles) && body.profiles.length > 0) {
                    setModalProfiles(body.profiles);
                }
                setCardModalStatus(body.card ? 'ready' : 'error');
                if (body.card) {
                    // Prefetch comments
                    loadComments(body.card.id);
                } else {
                    setCardModalError('Card not found');
                }
            } catch (error) {
                if (cancelled) return;
                console.error('[timeline] failed to load card', error);
                setCardModalError(error instanceof Error ? error.message : 'Failed to load card');
                setCardModalStatus('error');
            }
        };

        loadCard();

        return () => {
            cancelled = true;
        };
    }, [activeCardId, cardIdFromUrl, cardModalStatus, isModalClosing]);

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
