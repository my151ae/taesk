import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { kv } from "@vercel/kv";

import { getBoardMeta } from "@/lib/edge/get-board-meta";

type BoardMeta = {
  short_id: string;
  id_short: number;
  slug: string;
};

const CACHE_TTL_SECONDS = 60 * 60;
const KV_ENABLED = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

async function getFromCache(key: string): Promise<BoardMeta | null> {
  if (!KV_ENABLED) return null;
  try {
    return (await kv.get<BoardMeta>(key)) ?? null;
  } catch (error) {
    console.warn("[middleware] KV get failed, skip cache:", error);
    return null;
  }
}

async function setCache(key: string, meta: BoardMeta) {
  if (!KV_ENABLED) return;
  try {
    await kv.set(key, meta, { ex: CACHE_TTL_SECONDS });
  } catch (error) {
    console.warn("[middleware] KV set failed, continuing without cache:", error);
  }
}

export async function middleware(req: NextRequest) {
  const url = new URL(req.url);
  const uuid = url.searchParams.get("board");

  if (url.pathname === "/" && uuid) {
    const cacheKey = `board:uuid:${uuid}`;
    const cached = await getFromCache(cacheKey);

    if (cached?.short_id && typeof cached.id_short === "number" && cached.slug) {
      const redirected = new URL(`/b/${cached.short_id}/${cached.id_short}-${cached.slug}`, url.origin);
      return NextResponse.redirect(redirected, 308);
    }

    const meta = await getBoardMeta(uuid, url.origin);

    if (!meta) {
      const notFoundUrl = new URL("/404", url.origin);
      return NextResponse.redirect(notFoundUrl, 308);
    }

    await setCache(cacheKey, meta);

    const redirected = new URL(`/b/${meta.short_id}/${meta.id_short}-${meta.slug}`, url.origin);
    return NextResponse.redirect(redirected, 308);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/"],
};

