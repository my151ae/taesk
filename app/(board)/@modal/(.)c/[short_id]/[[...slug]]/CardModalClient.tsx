'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { CardModal } from '@/app/components/CardModal';
import { track } from '@/lib/analytics';
import type { CardDetail } from '@/lib/cards';
import { createClient, type Board, type Card } from '@/lib/supabase';
import { toSlugBase } from '@/lib/slug';

type Props = {
  card: CardDetail | null;
  canonicalPath: string | null;
  boards: Board[];
};

function toClientCard(detail: CardDetail): Card {
  return {
    id: detail.id,
    title: detail.title,
    description: detail.description ?? '',
    list_id: detail.listId,
    board_id: detail.boardId,
    position: 0,
    user_id: null,
    tags: detail.tags ?? [],
    due_date: detail.dueDate,
    priority: detail.priority,
    assigned_to: detail.assignedTo,
    short_id: detail.shortId,
    id_short: detail.idShort ?? null,
    slug: detail.slug,
    created_at: detail.createdAt,
    updated_at: detail.updatedAt,
  };
}

export default function CardModalClient({ card, canonicalPath, boards }: Props) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [currentCard, setCurrentCard] = useState<Card | null>(card ? toClientCard(card) : null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!card) {
      router.back();
      return;
    }

    setCurrentCard(toClientCard(card));
  }, [card, router]);

  useEffect(() => {
    if (!card) return;

    track('card_modal_open', { shortId: card.shortId, boardId: card.boardId });
    return () => {
      track('card_modal_close', { shortId: card.shortId });
    };
  }, [card]);

  useEffect(() => {
    if (!canonicalPath || typeof window === 'undefined') return;
    if (window.location.pathname !== canonicalPath) {
      window.history.replaceState({ ...window.history.state }, '', canonicalPath);
    }
  }, [canonicalPath]);

  const handleSave = async (
    id: string,
    title: string,
    description: string,
    tags?: string[],
    due_date?: string | null,
    priority?: Card['priority'],
    assigned_to?: string | null,
  ) => {
    try {
      const slug = toSlugBase(title);
      const { data, error } = await supabase
        .from('cards')
        .update({
          title,
          description,
          tags: tags ?? [],
          due_date: due_date ?? null,
          priority: priority ?? 'medium',
          assigned_to: assigned_to ?? null,
          slug,
        })
        .eq('id', id)
        .select()
        .single();

      if (error) {
        console.error('[CardModalClient] Failed to save card', error);
        return;
      }

      if (data) {
        setCurrentCard(data as Card);
      }

      router.back();
    } catch (error) {
      console.error('[CardModalClient] Unexpected error while saving card', error);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase.from('cards').delete().eq('id', id);
      if (error) {
        console.error('[CardModalClient] Failed to delete card', error);
        return;
      }
      router.back();
    } catch (error) {
      console.error('[CardModalClient] Unexpected error while deleting card', error);
    }
  };

  const handleMoveToBoard = async (cardId: string, targetBoardId: string) => {
    try {
      const { data: targetLists, error: listsError } = await supabase
        .from('lists')
        .select('*')
        .eq('board_id', targetBoardId)
        .order('position', { ascending: true })
        .limit(1);

      if (listsError) {
        console.error('[CardModalClient] Failed to fetch target lists', listsError);
        return;
      }

      const targetListId = targetLists?.[0]?.id ?? null;
      const { error } = await supabase
        .from('cards')
        .update({
          board_id: targetBoardId,
          list_id: targetListId,
        })
        .eq('id', cardId);

      if (error) {
        console.error('[CardModalClient] Failed to move card', error);
        return;
      }

      router.back();
    } catch (error) {
      console.error('[CardModalClient] Unexpected error while moving card', error);
    }
  };

  const handleClose = () => {
    router.back();
  };

  if (!card || !currentCard || isLoading) {
    return null;
  }

  return (
    <CardModal
      card={currentCard}
      boards={boards}
      onSave={handleSave}
      onDelete={handleDelete}
      onMoveToBoard={handleMoveToBoard}
      onClose={handleClose}
    />
  );
}
