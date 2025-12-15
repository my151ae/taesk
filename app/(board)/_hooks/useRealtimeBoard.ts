import { useState, useEffect, useRef } from 'react';
import { supabase, List, Card, CommentWithAuthor } from '@/lib/supabase';
import { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { normalizeChecklist, EMPTY_CHECKLIST } from '@/lib/checklist';

type BoardData = {
    lists: List[];
    cards: Card[];
};

type BoardComment = CommentWithAuthor & {
    optimistic?: boolean;
    errorMessage?: string;
    idempotencyKey?: string | null;
};

type UseRealtimeBoardOptions = {
    setBoardData?: React.Dispatch<React.SetStateAction<BoardData>>;
    upsertComment?: (cardId: string, comment: BoardComment) => void;
    removeComment?: (cardId: string, commentId: string) => void;
    onCardChange?: (payload: RealtimePostgresChangesPayload<Card>) => void;
};

export function useRealtimeBoard(
    currentBoardId: string | null,
    options: UseRealtimeBoardOptions
) {
    const { setBoardData, upsertComment, removeComment, onCardChange } = options;
    const [realtimeStatus, setRealtimeStatus] = useState<'connected' | 'connecting' | 'disconnected'>('connecting');
    const realtimeChannelRef = useRef<{ channel: RealtimeChannel | null; token: number }>({ channel: null, token: 0 });

    useEffect(() => {
        if (!currentBoardId) return;

        // Disable Realtime in test environment if flag is set
        if (process.env.NEXT_PUBLIC_DISABLE_REALTIME === 'true') {
            console.log('[Realtime] Disabled via NEXT_PUBLIC_DISABLE_REALTIME flag');
            setRealtimeStatus('disconnected');
            return;
        }

        console.log('[Realtime] Setting up subscription for board:', currentBoardId);
        const realtimeState = realtimeChannelRef.current;
        const token = (realtimeState.token ?? 0) + 1;
        realtimeState.token = token;
        console.log('[Realtime] New token:', token);

        const previousChannel = realtimeState.channel;
        if (previousChannel) {
            console.log('[Realtime] Unsubscribing from previous channel');
            previousChannel.unsubscribe();
            supabase.removeChannel(previousChannel).catch((error) => {
                console.warn('[Realtime] Failed to remove previous channel:', error);
            });
        }

        setRealtimeStatus('connecting');

        const channel = supabase.channel(`board:${currentBoardId}`);

        const listHandler = (payload: any) => {
            if (realtimeState.token !== token) return;
            console.log('List change detected:', payload);

            if (setBoardData) {
                if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
                    setBoardData((prev) => {
                        const newList = payload.new as List;
                        const idx = prev.lists.findIndex(list => list.id === newList.id);

                        if (idx >= 0) {
                            const updatedLists = [...prev.lists];
                            updatedLists[idx] = newList;
                            return { ...prev, lists: updatedLists };
                        }

                        return { ...prev, lists: [...prev.lists, newList] };
                    });
                } else if (payload.eventType === 'DELETE') {
                    setBoardData((prev) => ({
                        ...prev,
                        lists: prev.lists.filter((list) => list.id !== payload.old.id),
                        cards: prev.cards.filter((card) => card.list_id !== payload.old.id),
                    }));
                }
            }
        };

        const cardHandler = (payload: any) => {
            if (realtimeState.token !== token) return;
            console.log('[Realtime] Card change detected:', {
                eventType: payload.eventType,
                new: payload.new,
                old: payload.old,
                errors: payload.errors
            });

            if (onCardChange) {
                onCardChange(payload as RealtimePostgresChangesPayload<Card>);
            }

            if (setBoardData) {
                if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
                    setBoardData((prev) => {
                        const newCard = {
                            ...(payload.new as Card),
                            checklist: normalizeChecklist((payload.new as any).checklist ?? EMPTY_CHECKLIST),
                        } as Card;
                        const idx = prev.cards.findIndex(card => card.id === newCard.id);

                        if (idx >= 0) {
                            const updatedCards = [...prev.cards];
                            updatedCards[idx] = newCard;
                            return { ...prev, cards: updatedCards };
                        }

                        return { ...prev, cards: [...prev.cards, newCard] };
                    });
                } else if (payload.eventType === 'DELETE') {
                    setBoardData((prev) => ({
                        ...prev,
                        cards: prev.cards.filter((card) => card.id !== payload.old.id),
                    }));
                }
            }
        };

        const commentHandler = async (payload: any) => {
            if (realtimeState.token !== token) return;

            if (payload.eventType === 'DELETE') {
                const oldRow = payload.old as { id: string; card_id: string };
                if (oldRow?.card_id && oldRow?.id && removeComment) {
                    removeComment(oldRow.card_id, oldRow.id);
                }
                return;
            }

            const newRow = payload.new as { id?: string };
            if (!newRow?.id) return;

            if (upsertComment) {
                const { data, error } = await supabase
                    .from('comments')
                    .select(`*, author:profiles!comments_author_id_fkey(id, full_name, avatar_url, email)`)
                    .eq('id', newRow.id)
                    .single();

                if (error || !data) {
                    console.warn('[Realtime] Failed to fetch comment for update', error);
                    return;
                }

                const commentData = data as CommentWithAuthor;
                upsertComment(commentData.card_id, {
                    ...commentData,
                    idempotencyKey: commentData.idempotency_key ?? null,
                });
            }
        };

        const listFilter = `board_id=eq.${currentBoardId}`;
        const cardFilter = `board_id=eq.${currentBoardId}`;
        const commentFilter = `board_id=eq.${currentBoardId}`;

        // Register explicitly per event to satisfy RealtimeChannel.on overloads.
        channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lists', filter: listFilter }, listHandler);
        channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'lists', filter: listFilter }, listHandler);
        channel.on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'lists', filter: listFilter }, listHandler);

        channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'cards', filter: cardFilter }, cardHandler);
        channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'cards', filter: cardFilter }, cardHandler);
        channel.on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'cards', filter: cardFilter }, cardHandler);

        channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments', filter: commentFilter }, commentHandler);
        channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'comments', filter: commentFilter }, commentHandler);
        channel.on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'comments', filter: commentFilter }, commentHandler);

        if (process.env.NEXT_PUBLIC_DEBUG_REALTIME === 'true') {
            const bindings = (channel as any).bindings?.postgres_changes;
            console.log('[Realtime][debug] postgres_changes bindings registered:', {
                boardId: currentBoardId,
                count: Array.isArray(bindings) ? bindings.length : 0,
                bindings,
            });
        }

        realtimeState.channel = channel;

        channel.subscribe((status) => {
            if (realtimeState.token !== token) return;
            console.log(`[Realtime] Subscription status: ${status}`);

            if (status === 'SUBSCRIBED') {
                setRealtimeStatus('connected');
            } else if (status === 'CLOSED') {
                setRealtimeStatus('disconnected');
                console.warn('[Realtime] Subscription CLOSED');
            } else if (status === 'CHANNEL_ERROR') {
                setRealtimeStatus('disconnected');
                console.error('[Realtime] Subscription CHANNEL_ERROR');
            } else if (status === 'TIMED_OUT') {
                setRealtimeStatus('disconnected');
                console.warn('[Realtime] Subscription TIMED_OUT');
            }
        });

        return () => {
            if (realtimeState.channel === channel) {
                realtimeState.channel = null;
            }

            channel.unsubscribe();
            supabase.removeChannel(channel).catch((error) => {
                console.warn('[Realtime] Failed to remove channel:', error);
            });
        };
    }, [currentBoardId, setBoardData, upsertComment, removeComment, onCardChange]);

    return { realtimeStatus };
}
