import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { kv } from "@vercel/kv";

import { getBoardMeta } from "@/lib/edge/get-board-meta";

type BoardMeta = {
  short_id: string;
  id_short: number;
  slug: string;
};

const CACHE_TTL_SECONDS = 60 * 60; // 1 hour

export async function middleware(req: NextRequest) {
  const url = new URL(req.url);
  const uuid = url.searchParams.get("board");

  if (url.pathname === "/" && uuid) {
    const cacheKey = `board:uuid:${uuid}`;
    let cached: BoardMeta | null = null;

    try {
      cached = (await kv.get(cacheKey)) as BoardMeta | null;
    } catch (error) {
      console.warn("[middleware] KV get failed, skipping cache hit:", error);
    }

    if (cached?.short_id && typeof cached.id_short === "number" && cached.slug) {
      const redirected = new URL(`/b/${cached.short_id}/${cached.id_short}-${cached.slug}`, url.origin);
      return NextResponse.redirect(redirected, 308);
    }

    const meta = await getBoardMeta(uuid, url.origin);

    if (!meta) {
      const notFoundUrl = new URL("/404", url.origin);
      return NextResponse.redirect(notFoundUrl, 308);
    }

    try {
      await kv.set(cacheKey, meta, { ex: CACHE_TTL_SECONDS });
    } catch (error) {
      console.warn("[middleware] KV set failed, continuing without cache:", error);
    }

    const redirected = new URL(`/b/${meta.short_id}/${meta.id_short}-${meta.slug}`, url.origin);
    return NextResponse.redirect(redirected, 308);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/"],
};
