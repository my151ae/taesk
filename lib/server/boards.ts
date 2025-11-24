import "server-only";

import { createServerSupabaseClient, type Board, type BoardData, type Card, type List } from "@/lib/supabase";

const TABLE_BOARDS = "boards";
const TABLE_LISTS = "lists";
const TABLE_CARDS = "cards";

type BoardRecord = Board;

export async function getBoardByShortId(shortId: string): Promise<BoardRecord | null> {
  if (!shortId) return null;

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from(TABLE_BOARDS)
    .select("*")
    .eq("short_id", shortId)
    .maybeSingle();

  if (error) {
    console.error("[boards] getBoardByShortId error:", error);
    throw error;
  }

  return data ?? null;
}

export async function getBoardById(boardId: string): Promise<BoardRecord | null> {
  if (!boardId) return null;

  const supabase = await createServerSupabaseClient();

  // Simple retry logic for transient errors
  for (let i = 0; i < 3; i++) {
    const { data, error } = await supabase
      .from(TABLE_BOARDS)
      .select("*")
      .eq("id", boardId)
      .maybeSingle();

    if (!error) {
      return data ?? null;
    }

    // If it's the last attempt, log and throw
    if (i === 2) {
      console.error("[boards] getBoardById error after retries:", error);
      // Return null instead of throwing to allow graceful handling
      return null;
    }

    // Wait a bit before retrying (100ms, 200ms)
    await new Promise(resolve => setTimeout(resolve, (i + 1) * 100));
  }

  return null;
}

export async function fetchBoardInitialData(boardId: string): Promise<BoardData> {
  if (!boardId) {
    return { lists: [], cards: [] };
  }

  const supabase = await createServerSupabaseClient();

  const [{ data: lists, error: listsError }, { data: cards, error: cardsError }] = await Promise.all([
    supabase
      .from(TABLE_LISTS)
      .select("*")
      .eq("board_id", boardId)
      .order("position", { ascending: true }),
    supabase
      .from(TABLE_CARDS)
      .select("*")
      .eq("board_id", boardId)
      .order("position", { ascending: true }),
  ]);

  if (listsError) {
    console.error("[boards] fetchBoardInitialData lists error:", listsError);
    throw listsError;
  }

  if (cardsError) {
    console.error("[boards] fetchBoardInitialData cards error:", cardsError);
    throw cardsError;
  }

  return {
    lists: (lists ?? []) as List[],
    cards: (cards ?? []) as Card[],
  };
}
