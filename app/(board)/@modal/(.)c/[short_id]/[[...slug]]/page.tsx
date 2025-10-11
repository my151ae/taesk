'use client';

import { useRouter } from 'next/navigation';
import { CardModal } from '@/app/components/CardModal';
import { useEffect, useState } from 'react';
import type { Card, Board } from '@/lib/supabase';

export default function InterceptedCardModal({
  params,
}: {
  params: { short_id: string; slug?: string[] };
}) {
  const router = useRouter();
  const [card, setCard] = useState<Card | null>(null);
  const [boards, setBoards] = useState<Board[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Load card data from localStorage
    const loadData = () => {
      try {
        const boardDataStr = localStorage.getItem('boardData');
        if (!boardDataStr) {
          router.push('/');
          return;
        }

        const boardData = JSON.parse(boardDataStr);
        setBoards(boardData.boards || []);

        // Find card by short_id
        const foundCard = boardData.boards
          ?.flatMap((b: Board) => b.cards || [])
          .find((c: Card) => c.short_id === params.short_id);

        if (!foundCard) {
          router.push('/');
          return;
        }

        setCard(foundCard);
      } catch (error) {
        console.error('Failed to load card:', error);
        router.push('/');
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [params.short_id, router]);

  const handleSave = async (id: string, updates: Partial<Card>) => {
    try {
      const boardDataStr = localStorage.getItem('boardData');
      if (!boardDataStr) return;

      const boardData = JSON.parse(boardDataStr);

      // Update card in boardData
      const updatedBoards = boardData.boards.map((board: Board) => ({
        ...board,
        cards: board.cards?.map((c: Card) =>
          c.id === id ? { ...c, ...updates } : c
        ),
      }));

      const newBoardData = { ...boardData, boards: updatedBoards };
      localStorage.setItem('boardData', JSON.stringify(newBoardData));

      // Trigger storage event for other components to update
      window.dispatchEvent(new Event('storage'));

      router.back();
    } catch (error) {
      console.error('Failed to save card:', error);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const boardDataStr = localStorage.getItem('boardData');
      if (!boardDataStr) return;

      const boardData = JSON.parse(boardDataStr);

      // Remove card from boardData
      const updatedBoards = boardData.boards.map((board: Board) => ({
        ...board,
        cards: board.cards?.filter((c: Card) => c.id !== id),
      }));

      const newBoardData = { ...boardData, boards: updatedBoards };
      localStorage.setItem('boardData', JSON.stringify(newBoardData));

      // Trigger storage event for other components to update
      window.dispatchEvent(new Event('storage'));

      router.back();
    } catch (error) {
      console.error('Failed to delete card:', error);
    }
  };

  const handleMoveToBoard = async (cardId: string, targetBoardId: string) => {
    try {
      const boardDataStr = localStorage.getItem('boardData');
      if (!boardDataStr) return;

      const boardData = JSON.parse(boardDataStr);

      // Find and move card
      let movedCard: Card | null = null;
      const updatedBoards = boardData.boards.map((board: Board) => {
        const foundCard = board.cards?.find((c: Card) => c.id === cardId);
        if (foundCard) {
          movedCard = foundCard;
          return {
            ...board,
            cards: board.cards?.filter((c: Card) => c.id !== cardId),
          };
        }
        return board;
      });

      // Add card to target board
      if (movedCard) {
        const finalBoards = updatedBoards.map((board: Board) => {
          if (board.id === targetBoardId) {
            return {
              ...board,
              cards: [...(board.cards || []), { ...movedCard, board_id: targetBoardId }],
            };
          }
          return board;
        });

        const newBoardData = { ...boardData, boards: finalBoards };
        localStorage.setItem('boardData', JSON.stringify(newBoardData));

        // Trigger storage event for other components to update
        window.dispatchEvent(new Event('storage'));
      }
    } catch (error) {
      console.error('Failed to move card:', error);
    }
  };

  const handleClose = () => {
    router.back();
  };

  if (isLoading) {
    return null;
  }

  if (!card) {
    return null;
  }

  return (
    <CardModal
      card={card}
      boards={boards}
      onSave={handleSave}
      onDelete={handleDelete}
      onMoveToBoard={handleMoveToBoard}
      onClose={handleClose}
    />
  );
}
