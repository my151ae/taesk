import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import { startCalendarWatch, stopCalendarWatch } from "@/lib/googleCalendarServer";

export const runtime = "nodejs";

function resolveWebhookAddress(origin: string) {
  if (process.env.GOOGLE_CALENDAR_WEBHOOK_URL) return process.env.GOOGLE_CALENDAR_WEBHOOK_URL;
  return `${origin}/api/integrations/google-calendar/webhook`;
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 });
  }

  const calendarId = request.nextUrl.searchParams.get("calendarId") ?? "primary";
  const origin = request.nextUrl.origin;
  const address = resolveWebhookAddress(origin);

  try {
    const watch = await startCalendarWatch(user.id, calendarId, address, { supabase });
    return NextResponse.json({ success: true, watch });
  } catch (error) {
    console.error("[calendar/watch] start failed", error);
    return NextResponse.json({ error: { code: "WATCH_START_FAILED", message: "Failed to start watch" } }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 });
  }

  const calendarId = request.nextUrl.searchParams.get("calendarId") ?? "primary";

  try {
    const result = await stopCalendarWatch(user.id, calendarId, { supabase });
    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error("[calendar/watch] stop failed", error);
    return NextResponse.json({ error: { code: "WATCH_STOP_FAILED", message: "Failed to stop watch" } }, { status: 500 });
  }
}
