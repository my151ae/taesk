import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import { GoogleCalendarNotConnectedError, listCachedEventsForRange } from "@/lib/googleCalendarServer";

// Lightweight Jaro-Winkler implementation (ASCII only)
function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  const s1 = a.toLowerCase();
  const s2 = b.toLowerCase();
  const len1 = s1.length;
  const len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0;

  const matchDistance = Math.floor(Math.max(len1, len2) / 2) - 1;
  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);

  let matches = 0;
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, len2);
    for (let j = start; j < end; j++) {
      if (s2Matches[j]) continue;
      if (s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  let t = 0;
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) t++;
    k++;
  }
  t = t / 2;

  const m = matches;
  const jaro = (m / len1 + m / len2 + (m - t) / m) / 3;

  // prefix length up to 4
  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(len1, len2)); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}

export const runtime = "nodejs";

/**
 * GET /api/calendar/resync-candidates?title=...&start=...&end=...
 * - title: string (必須)
 * - start/end: ISO（日付範囲）省略時は過去4週〜未来12週のデフォルトを利用
 * レスポンス: 類似度0.75以上の Googleキャッシュイベントを返す（最大50件）
 */
export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 });
  }

  const title = request.nextUrl.searchParams.get("title")?.trim();
  if (!title) {
    return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "title is required" } }, { status: 400 });
  }

  const startParam = request.nextUrl.searchParams.get("start");
  const endParam = request.nextUrl.searchParams.get("end");

  const now = new Date();
  const defaultStart = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
  const defaultEnd = new Date(now.getTime() + 84 * 24 * 60 * 60 * 1000);

  const start = startParam ? new Date(startParam) : defaultStart;
  const end = endParam ? new Date(endParam) : defaultEnd;

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    return NextResponse.json({ error: { code: "INVALID_RANGE", message: "Invalid start/end" } }, { status: 400 });
  }

  try {
    const { events } = await listCachedEventsForRange(user.id, start, end, { supabase });

    const scored = events
      .map((event) => ({
        event,
        score: jaroWinkler(title, event.title || ""),
      }))
      .filter((item) => item.score >= 0.75)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50)
      .map(({ event, score }) => ({ ...event, score }));

    return NextResponse.json({ candidates: scored }, { status: 200 });
  } catch (error: unknown) {
    if (error instanceof GoogleCalendarNotConnectedError) {
      return NextResponse.json({ error: { code: "NOT_CONNECTED" } }, { status: 200 });
    }
    console.error("[resync-candidates] error", error);
    return NextResponse.json({ error: { code: "INTERNAL_ERROR" } }, { status: 500 });
  }
}
