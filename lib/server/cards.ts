import "server-only";

import { notFound } from "next/navigation";

import { createClient, type Card } from "@/lib/supabase";
import { buildCanonicalPath, toSlugBase } from "@/lib/slug";
import { getBoardById } from "./boards";
import { normalizeChecklist, EMPTY_CHECKLIST } from "@/lib/checklist";
import { normalizeContent } from "@/lib/tiptap";
import { resolveAppOrigin } from "@/lib/calendarSyncService";

const TABLE_CARDS = "cards";

export interface CardWithBoard extends Card {
  board: {
    id: string;
    short_id: string | null;
    id_short: number | null;
    slug: string | null;
    name: string;
    description?: string | null;
  } | null;
}

function ensureShortId(card: Card): string {
  if (card.short_id) return card.short_id;
  throw new Error("Card is missing short_id; cannot build canonical URL");
}

export async function getCardByShortId(shortId: string): Promise<Card | null> {
  if (!shortId) return null;

  const supabase = createClient();
  const { data, error } = await supabase
    .from(TABLE_CARDS)
    .select("*")
    .eq("short_id", shortId)
    .maybeSingle();

  if (error) {
    console.error("[cards] getCardByShortId error:", error);
    throw error;
  }

  if (!data) return null;
  const card = data as Card;
  return {
    ...card,
    checklist: normalizeChecklist(card.checklist ?? EMPTY_CHECKLIST),
    content: normalizeContent((card as any).content),
  };
}

export async function getCardWithBoard(shortId: string): Promise<CardWithBoard | null> {
  const card = await getCardByShortId(shortId);
  if (!card) return null;

  const board = await getBoardById(card.board_id);

  return {
    ...card,
    board: board
      ? {
        id: board.id,
        short_id: board.short_id ?? null,
        id_short: board.id_short ?? null,
        slug: board.slug ?? null,
        name: board.name,
        description: board.description ?? null,
      }
      : null,
  };
}

function buildCanonicalTail(card: Card): string {
  const shortId = ensureShortId(card);
  const slug = card.slug ?? toSlugBase(card.title);
  const path = buildCanonicalPath({ shortId, idShort: card.id_short ?? undefined, slug });
  return path.replace(`/c/${shortId}/`, "");
}

export async function normalizeCardSlugOrRedirect(shortId: string, slugSegments: string[] | undefined) {
  const cardWithBoard = await getCardWithBoard(shortId);
  if (!cardWithBoard) {
    notFound();
  }

  const incoming = Array.isArray(slugSegments) ? slugSegments.join("/") : "";
  const canonicalTail = buildCanonicalTail(cardWithBoard);
  // NOTE: スラッグ不一致でもリダイレクトしない。Google 等経由で非ASCIIが壊れると
  // Location ヘッダ生成が失敗しやすく、結果として 500/redirect ループを起こすため。
  // short_id でカードを特定できればそのまま返す。

  return {
    card: cardWithBoard,
    canonicalTail,
  };
}
