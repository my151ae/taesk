import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { kv } from "@vercel/kv";

import { getBoardMeta } from "@/lib/edge/get-board-meta";

type BoardMeta = {
  short_id: string;
  id_short: number;
  slug: string | null;
  canonical_path: string;
};

const CACHE_TTL_SECONDS = 60 * 60;
const KV_ENABLED = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
const KV_NAMESPACE = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "local";
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  if (url.pathname !== "/") {
    return NextResponse.next();
  }

  const uuid = url.searchParams.get("board");

  if (!uuid || !UUID_V4_REGEX.test(uuid)) {
    return NextResponse.next();
  }

  const safeRedirect = (path: string) => {
    if (!path.startsWith("/b/")) {
      const fallbackUrl = new URL("/", url.origin);
      return NextResponse.redirect(fallbackUrl, 308);
    }
    const redirected = new URL(path, url.origin);
    return NextResponse.redirect(redirected, 308);
  };

  const cacheKey = `board:uuid:${KV_NAMESPACE}:${uuid}`;
  const cached = await getFromCache(cacheKey);

  if (cached?.canonical_path) {
    return safeRedirect(cached.canonical_path);
  }

  const meta = await getBoardMeta(uuid, url.origin);

  if (!meta?.canonical_path) {
    const fallbackUrl = new URL("/", url.origin);
    return NextResponse.redirect(fallbackUrl, 308);
  }

  await setCache(cacheKey, meta);

  return safeRedirect(meta.canonical_path);
}

export const config = {
  matcher: ["/"],
};
