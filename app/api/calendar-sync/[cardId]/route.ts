import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import {
    syncCardToCalendar,
    deleteCardFromCalendar,
    createCalendarSyncRecord,
    getCalendarSyncRecord,
    GooglePermissionError,
    GoogleRateLimitError,
    buildGoogleEventDescription,
    buildGoogleDateTimeRange,
    resolveAppOrigin,
} from "@/lib/calendarSyncService";
import { getGoogleCalendarClientForUser, GoogleCalendarNotConnectedError } from "@/lib/googleCalendarServer";

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

        const description = buildGoogleEventDescription({
            id: card.id,
            short_id: card.short_id,
            slug: (card as any).slug ?? null,
            id_short: (card as any).id_short ?? null,
            title: card.title,
            description: card.description ?? "",
        }, resolveAppOrigin());

        const result = await syncCardToCalendar(supabase, user.id, card.id, {
            summary: card.title,
            description,
            start: { dateTime: startDateTime, timeZone: "Asia/Tokyo" },
            end: { dateTime: endDateTime, timeZone: "Asia/Tokyo" },
            // location: ...
        });

        return NextResponse.json({ success: true, result });
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

            // Update DB status to deleted (or remove record?)
            // Plan said: "status = 'deleted'"
            await supabase
                .from("calendar_sync")
                .update({ status: "deleted", google_event_id: null, etag: null })
                .eq("card_id", card.id);

        } else {
            // Unlink
            await supabase
                .from("calendar_sync")
                .update({ status: "unlinked" })
                .eq("card_id", card.id);
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error("[delete-sync] error", error);
        return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: error.message } }, { status: 500 });
    }
}
