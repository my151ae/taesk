import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import {
    syncCardToCalendar,
    deleteCardFromCalendar,
    unlinkCardFromCalendar,
    createCalendarSyncRecord,
    getCalendarSyncRecord,
    GooglePermissionError,
    GoogleRateLimitError,
    buildGoogleEventDescription,
    buildGoogleDateTimeRange,
    resolveAppOrigin,
} from "@/lib/calendarSyncService";
import { GoogleCalendarNotConnectedError, syncGoogleCalendarToTaesk } from "@/lib/googleCalendarServer";

export const runtime = "nodejs";

// Helper to validate card ownership/access
async function getCardAndVerifyAccess(supabase: any, cardId: string, userId: string) {
    const { data: card, error } = await supabase
        .from("cards")
        .select("*, boards(id, name)")
        .eq("id", cardId) // Assuming UUID is passed, or resolve from short_id if needed?
        // The route is [cardId], usually Taesk uses short_id in URLs but internal APIs might use UUID.
        // Let's assume UUID for now as per `calendar_sync` schema (card_id UUID).
        // If the frontend passes short_id, we need to resolve it.
        // BUT: The file structure is `app/api/calendar-sync/[cardId]/route.ts`.
        // Let's support both or check how other APIs do it.
        // Looking at `app/api/cards/[cardId]/route.ts`, it uses `short_id`.
        // However, `calendar_sync` stores UUID.
        // Let's try to resolve by ID first, then short_id.
        .maybeSingle();

    if (error) throw error;
    if (!card) {
        // Try short_id
        const { data: cardByShort, error: errorShort } = await supabase
            .from("cards")
            .select("*, boards(id, name)")
            .eq("short_id", cardId)
            .maybeSingle();

        if (errorShort || !cardByShort) return null;
        return cardByShort;
    }

    // Check board membership
    const { data: member } = await supabase
        .from("board_members")
        .select("role")
        .eq("board_id", card.board_id)
        .eq("profile_id", userId)
        .maybeSingle();

    if (!member) return null; // Not authorized

    return card;
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ cardId: string }> }
) {
    const supabase = await createServerSupabaseClient();
    const { cardId } = await params;

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 });
    }

    try {
        const card = await getCardAndVerifyAccess(supabase, cardId, user.id);
        if (!card) {
            return NextResponse.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
        }

        // Parse body for sync options if any (e.g. specific calendar choice)
        // For now, auto-sync based on card data.
        if (!card.due_start || !card.due_end) {
            return NextResponse.json(
                { error: { code: "INVALID_REQUEST", message: "Card must have start and end dates" } },
                { status: 400 }
            );
        }

        // Convert stored date/time into RFC3339 with JST offset for Google Calendar
        const { startDateTime, endDateTime } = buildGoogleDateTimeRange({
            due_date: card.due_date,
            due_start: card.due_start,
            due_end: card.due_end,
        });

        if (!startDateTime || !endDateTime) {
            return NextResponse.json(
                { error: { code: "INVALID_REQUEST", message: "Invalid date/time for Google Calendar sync" } },
                { status: 400 }
            );
        }

        // Always pull latest from Google before pushing Taesk → Google to avoid overwriting newer edits.
        const { data: existingSync } = await supabase
            .from("calendar_sync")
            .select("calendar_id")
            .eq("card_id", card.id)
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        let pullStats: { matched: number; updated: number } | null = null;
        try {
            pullStats = await syncGoogleCalendarToTaesk(user.id, existingSync?.calendar_id ?? "primary", { supabase, reason: "manual_sync" });
            
            // If we pulled updates, we must refresh our local card data before pushing back,
            // otherwise we'll overwrite Google's new state with our stale state.
            if (pullStats && pullStats.updated > 0) {
                const refreshedCard = await getCardAndVerifyAccess(supabase, cardId, user.id);
                if (refreshedCard) {
                    // Update the card reference
                    Object.assign(card, refreshedCard);
                }
            }
        } catch (pullError) {
            console.error("[calendar-sync][manual] pull failed, proceeding to push", pullError);
        }

        const origin = request.nextUrl?.origin ?? resolveAppOrigin();
        const description = buildGoogleEventDescription({
            id: card.id,
            short_id: card.short_id,
            slug: (card as any).slug ?? null,
            id_short: (card as any).id_short ?? null,
            title: card.title,
            description: card.excerpt ?? "",
        }, origin);

        const googleEventIdOverride = request.nextUrl.searchParams.get("google_event_id");

        const result = await syncCardToCalendar(supabase, user.id, card.id, {
            summary: card.title,
            description,
            start: { dateTime: startDateTime, timeZone: "Asia/Tokyo" },
            end: { dateTime: endDateTime, timeZone: "Asia/Tokyo" },
            // location: ...
        }, googleEventIdOverride ? { googleEventId: googleEventIdOverride } : {});

        if (result?.eventId) {
            // Update last_google_event_id for resync candidates
            await supabase
                .from("calendar_sync")
                .update({ last_google_event_id: result.eventId })
                .eq("card_id", card.id);
        }

        return NextResponse.json({ success: true, pullStats, result });
    } catch (error: any) {
        if (error instanceof GoogleCalendarNotConnectedError) {
            return NextResponse.json({ error: { code: error.code, message: "Google Calendar is not connected" } }, { status: 401 });
        }
        if (error instanceof GooglePermissionError) {
            return NextResponse.json({ error: { code: error.code, message: error.message, retryable: false } }, { status: 403 });
        }
        if (error instanceof GoogleRateLimitError) {
            return NextResponse.json({ error: { code: error.code, message: error.message, retryable: true } }, { status: 429 });
        }
        console.error("[post-sync] error", error);
        return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: error?.message || "Internal error" } }, { status: 500 });
    }
}

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ cardId: string }> }
) {
    // Delegate to POST logic for create-or-update (idempotent)
    return POST(request, { params });
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ cardId: string }> }
) {
    const supabase = await createServerSupabaseClient();
    const { cardId } = await params;

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 });
    }

    const card = await getCardAndVerifyAccess(supabase, cardId, user.id);
    if (!card) {
        return NextResponse.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
    }

    const { data: account } = await supabase
        .from("google_calendar_accounts")
        .select("id")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (!account?.id) {
        return NextResponse.json({ status: "unlinked" }, { status: 200 });
    }

    const { data: syncRow, error } = await supabase
        .from("calendar_sync")
        .select("status, google_event_id, last_google_event_id, etag, last_synced_at")
        .eq("card_id", card.id)
        .eq("google_account_id", account.id)
        .maybeSingle();

    if (error) {
        console.error("[calendar-sync][GET] failed", error);
        return NextResponse.json({ error: { code: "DB_ERROR" } }, { status: 500 });
    }

    if (!syncRow) {
        return NextResponse.json({ status: "unlinked" }, { status: 200 });
    }

    return NextResponse.json(syncRow, { status: 200 });
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ cardId: string }> }
) {
    const supabase = await createServerSupabaseClient();
    const { cardId } = await params;

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 });
    }

    const mode = request.nextUrl.searchParams.get("mode") ?? "delete"; // 'unlink' or 'delete'

    try {
        const card = await getCardAndVerifyAccess(supabase, cardId, user.id);
        // If card is deleted (404), we might still want to try deleting the sync record/event if we can find it by UUID?
        // But we need the UUID. 'cardId' param might be short_id.
        // If card is gone from DB, calendar_sync might be gone too due to CASCADE.
        // But if we are calling DELETE explicitly while card exists (turning off sync):

        if (!card) {
            // Check if cardId is a UUID and exists in calendar_sync independently?
            // Likely sync record handles CASCADE, so nothing to do if card missing.
            return NextResponse.json({ success: true, message: "Card not found, assumed handled" });
        }

        if (mode === "delete") {
            await deleteCardFromCalendar(supabase, user.id, card.id);

            const existingSync = await getCalendarSyncRecord(supabase, card.id).catch(() => null);
            const lastGoogleEventId = existingSync?.last_google_event_id ?? existingSync?.google_event_id ?? null;

            // Update DB status to deleted (or remove record?)
            // Plan said: "status = 'deleted'"
            await supabase
                .from("calendar_sync")
                .update({
                    status: "deleted",
                    google_event_id: null,
                    etag: null,
                    ...(lastGoogleEventId ? { last_google_event_id: lastGoogleEventId } : {}),
                })
                .eq("card_id", card.id);

        } else {
            const existingSync = await getCalendarSyncRecord(supabase, card.id).catch(() => null);
            const lastGoogleEventId = existingSync?.last_google_event_id ?? existingSync?.google_event_id ?? null;

            // Unlink
            await unlinkCardFromCalendar(supabase, user.id, card.id);

            await supabase
                .from("calendar_sync")
                .update({
                    status: "unlinked",
                    google_event_id: null,
                    etag: null,
                    ...(lastGoogleEventId ? { last_google_event_id: lastGoogleEventId } : {}),
                })
                .eq("card_id", card.id);
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error("[delete-sync] error", error);
        return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: error.message } }, { status: 500 });
    }
}
