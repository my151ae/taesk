import "server-only";

import { createServerSupabaseClient, type Board, type BoardData, type Card, type List } from "@/lib/supabase";

const TABLE_BOARDS = "boards";
const TABLE_LISTS = "lists";
const TABLE_CARDS = "cards";

type BoardRecord = Board;
type BoardQueryError = {
  name?: string;
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
  status?: number;
  raw?: string;
};

const MAX_BOARD_FETCH_RETRIES = 3;

async function attachMembershipRole(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  board: BoardRecord | null
): Promise<BoardRecord | null> {
  if (!board) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return board;
  }

  const { data: membership } = await supabase
    .from("board_members")
    .select("role")
    .eq("board_id", board.id)
    .eq("profile_id", user.id)
    .maybeSingle();

  return {
    ...board,
    membership_role: membership?.role ?? board.membership_role,
  };
}

function toBoardQueryError(error: unknown): BoardQueryError {
  if (!error || typeof error !== "object") {
    if (typeof error === "string") return { message: error, raw: error };
    return { raw: String(error) };
  }
  const value = error as Record<string, unknown>;
  const ownKeys = Reflect.ownKeys(value).map((key) => String(key));
  const status = typeof value.status === "number"
    ? value.status
    : typeof (value.response as { status?: unknown } | undefined)?.status === "number"
      ? ((value.response as { status?: unknown }).status as number)
      : undefined;
  let raw: string | undefined;
  if (error instanceof Error) {
    raw = `${error.name}: ${error.message}`;
  } else {
    try {
      const json = JSON.stringify(value);
      raw = json && json !== "{}"
        ? json
        : `${Object.prototype.toString.call(error)} keys=[${ownKeys.join(", ")}]`;
    } catch {
      raw = `${Object.prototype.toString.call(error)} keys=[${ownKeys.join(", ")}]`;
    }
  }
  return {
    name: typeof value.name === "string" ? value.name : undefined,
    message: typeof value.message === "string" ? value.message : undefined,
    code: typeof value.code === "string" ? value.code : undefined,
    details: typeof value.details === "string" ? value.details : undefined,
    hint: typeof value.hint === "string" ? value.hint : undefined,
    status,
    raw,
  };
}

function isRetryableBoardQueryError(error: BoardQueryError): boolean {
  if (error.status != null) {
    if (error.status === 408 || error.status === 429) return true;
    if (error.status >= 500) return true;
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return (
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("fetch") ||
    message.includes("connection")
  );
}

export async function getBoardByShortId(shortId: string): Promise<BoardRecord | null> {
  if (!shortId) return null;

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from(TABLE_BOARDS)
    .select("*")
    .eq("short_id", shortId)
    .maybeSingle();

  if (error) {
    const normalizedError = toBoardQueryError(error);
    console.warn("[boards] getBoardByShortId failed:", {
      shortId,
      error: normalizedError,
    });
    return null;
  }

  return attachMembershipRole(supabase, data ?? null);
}

export async function getBoardById(boardId: string): Promise<BoardRecord | null> {
  if (!boardId) return null;

  const supabase = await createServerSupabaseClient();

  for (let i = 0; i < MAX_BOARD_FETCH_RETRIES; i++) {
    const { data, error } = await supabase
      .from(TABLE_BOARDS)
      .select("*")
      .eq("id", boardId)
      .maybeSingle();

    if (!error) {
      return attachMembershipRole(supabase, data ?? null);
    }

    const normalizedError = toBoardQueryError(error);
    const shouldRetry = isRetryableBoardQueryError(normalizedError);

    if (!shouldRetry) {
      console.warn("[boards] getBoardById non-retryable:", {
        boardId,
        attempt: i + 1,
        error: normalizedError,
      });
      return null;
    }

    if (i === MAX_BOARD_FETCH_RETRIES - 1) {
      console.warn("[boards] getBoardById retry exhausted:", {
        boardId,
        attempt: i + 1,
        error: normalizedError,
      });
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
