import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

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
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

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

async function refreshSupabaseSession(req: NextRequest) {
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.next({ request: req });
  }

  let response = NextResponse.next({ request: req });
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          req.cookies.set(name, value);
        });
        response = NextResponse.next({ request: req });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  await supabase.auth.getUser();
  return response;
}

function copyCookies(source: NextResponse, target: NextResponse) {
  source.cookies.getAll().forEach((cookie) => {
    target.cookies.set(cookie);
  });
  return target;
}

export async function middleware(req: NextRequest) {
  const refreshedResponse = await refreshSupabaseSession(req);
  const url = new URL(req.url);
  if (url.pathname !== "/") {
    return refreshedResponse;
  }

  const uuid = url.searchParams.get("board");

  if (!uuid || !UUID_V4_REGEX.test(uuid)) {
    return refreshedResponse;
  }

  const safeRedirect = (path: string) => {
    if (!path.startsWith("/b/")) {
      const fallbackUrl = new URL("/", url.origin);
      return copyCookies(refreshedResponse, NextResponse.redirect(fallbackUrl, 308));
    }
    const redirected = new URL(path, url.origin);
    return copyCookies(refreshedResponse, NextResponse.redirect(redirected, 308));
  };

  const cacheKey = `board:uuid:${KV_NAMESPACE}:${uuid}`;
  const cached = await getFromCache(cacheKey);

  if (cached?.canonical_path) {
    return safeRedirect(cached.canonical_path);
  }

  const meta = await getBoardMeta(uuid, url.origin);

  if (!meta?.canonical_path) {
    const fallbackUrl = new URL("/", url.origin);
    return copyCookies(refreshedResponse, NextResponse.redirect(fallbackUrl, 308));
  }

  await setCache(cacheKey, meta);

  return safeRedirect(meta.canonical_path);
}

export const config = {
  matcher: ["/", "/board", "/b/:path*", "/login", "/auth/callback"],
};
