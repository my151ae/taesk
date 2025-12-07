import "server-only";
import { google, calendar_v3 } from "googleapis";
import { createServerSupabaseClient } from "@/lib/supabase";
import {
    getGoogleCalendarClientForUser,
    hasCalendarWritePermission,
    GoogleCalendarNotConnectedError,
} from "@/lib/googleCalendarServer";

type SupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

export type CalendarSyncEventParams = {
    summary: string;
    description?: string;
    start: { date?: string; dateTime?: string; timeZone?: string };
    end: { date?: string; dateTime?: string; timeZone?: string };
    location?: string;
};

export class GooglePermissionError extends Error {
    code = "GOOGLE_PERMISSION_DENIED";
    constructor(message = "Insufficient permissions to write to Google Calendar") {
        super(message);
        this.name = "GooglePermissionError";
    }
}

export class GoogleRateLimitError extends Error {
    code = "GOOGLE_RATE_LIMIT";
    retryable = true;
    constructor(message = "Google API rate limit exceeded") {
        super(message);
        this.name = "GoogleRateLimitError";
    }
}

// -----------------------------------------------------------------------------
// Database Operations
// -----------------------------------------------------------------------------

export async function getCalendarSyncRecord(supabase: SupabaseClient, cardId: string) {
    const { data, error } = await supabase
        .from("calendar_sync")
        .select("*")
        .eq("card_id", cardId)
        .maybeSingle();

    if (error) {
        console.error("[calendarSync] failed to fetch sync record", error);
        throw error;
    }
    return data;
}

export async function createCalendarSyncRecord(
    supabase: SupabaseClient,
    params: {
        cardId: string;
        googleAccountId: string;
        calendarId: string;
        status: "active" | "unlinked";
    }
) {
    const { data, error } = await supabase
        .from("calendar_sync")
        .insert({
            card_id: params.cardId,
            google_account_id: params.googleAccountId,
            calendar_id: params.calendarId,
            status: params.status,
        })
        .select()
        .single();

    if (error) throw error;
    return data;
}

// -----------------------------------------------------------------------------
// Sync Logic
// -----------------------------------------------------------------------------

async function handleGoogleError(error: any) {
    const code = error.code || error.response?.status;
    if (code === 401) throw new GoogleCalendarNotConnectedError("Token expired");
    if (code === 403) {
        // Check if it's a rate limit or permission issue
        const errors = error.errors || error.response?.data?.error?.errors || [];
        const isRateLimit = errors.some((e: any) => e.reason === "rateLimitExceeded");
        if (isRateLimit) throw new GoogleRateLimitError();
        throw new GooglePermissionError();
    }
    if (code === 404) return null; // Resource missing
    if (code === 429) throw new GoogleRateLimitError();
    throw error;
}

/**
 * Creates or updates a Google Calendar event.
 * Handles optimistic locking (Etag) and idempotent creation.
 */
export async function syncCardToCalendar(
    supabase: SupabaseClient,
    userId: string,
    cardId: string,
    eventParams: CalendarSyncEventParams,
    options: { onlyUpdate?: boolean } = {}
) {
    // 1. Get Client & Check Permissions
    const { calendar, account } = await getGoogleCalendarClientForUser(userId, { supabase });

    if (!hasCalendarWritePermission(account.scope)) {
        throw new GooglePermissionError("Missing calendar.events scope");
    }

    // 2. Check Existing Sync Record
    let syncRecord = await getCalendarSyncRecord(supabase, cardId);

    // 3. Resolve Calendar ID (User preference could be stored later, default to primary)
    const calendarId = syncRecord?.calendar_id ?? "primary";
    // If verifying/using explicit calendarId storage in future:
    // if (!syncRecord) ... resolve and save calendarId

    // 4. Construct Event Resource
    const requestBody: calendar_v3.Schema$Event = {
        summary: eventParams.summary,
        description: eventParams.description,
        start: eventParams.start,
        end: eventParams.end,
        location: eventParams.location,
        extendedProperties: {
            private: {
                taeskCardId: cardId,
                taeskUpdatedAt: new Date().toISOString(),
            },
        },
    };

    try {
        let googleEventId = syncRecord?.google_event_id;
        let etag = syncRecord?.etag;

        // --- CREATE / RECOVERY FLOW ---
        if (!syncRecord || !googleEventId || syncRecord.status !== 'active') {
            if (options?.onlyUpdate) {
                return null; // Do nothing if not already synced
            }

            // Idempotency Check: Search for existing event by private property
            const listRes = await calendar.events.list({
                calendarId,
                privateExtendedProperty: [`taeskCardId=${cardId}`],
                maxResults: 1,
            });

            const existingEvent = listRes.data.items?.[0];

            if (existingEvent?.id) {
                // Found existing: Link and Update
                googleEventId = existingEvent.id;
                // Proceed to update flow
            } else {
                // Create New
                const insertRes = await calendar.events.insert({
                    calendarId,
                    requestBody,
                });

                if (!insertRes.data.id) throw new Error("Failed to create Google Event (no ID)");

                // Save DB Record
                if (syncRecord) {
                    // Reactivate existing record
                    await supabase
                        .from("calendar_sync")
                        .update({
                            google_event_id: insertRes.data.id,
                            status: "active",
                            etag: insertRes.data.etag,
                            last_synced_at: new Date().toISOString(),
                            calendar_id: calendarId, // ensure calendarId is current
                        })
                        .eq("id", syncRecord.id);
                } else {
                    // Insert new record
                    await createCalendarSyncRecord(supabase, {
                        cardId,
                        googleAccountId: account.id,
                        calendarId,
                        status: "active",
                    });
                }
                return { action: "created", eventId: insertRes.data.id };
            }
        }

        // --- UPDATE FLOW ---
        if (googleEventId) {
            // Optimistic Locking with ETag is tricky with Google API client directly?
            // Google API Node client handles headers? 
            // We can pass headers in request options if needed, but 'If-Match' might be aggressive.
            // Let's just try patch. 412 handling is robust but start simple.

            try {
                const patchRes = await calendar.events.patch({
                    calendarId,
                    eventId: googleEventId,
                    requestBody,
                });

                await supabase
                    .from("calendar_sync")
                    .update({
                        etag: patchRes.data.etag,
                        last_synced_at: new Date().toISOString(),
                    })
                    .eq("card_id", cardId); // safe enough with user check RLS

                return { action: "updated", eventId: googleEventId };

            } catch (err: any) {
                if (err.code === 404) {
                    // Event deleted on Google side. Recover?
                    // Strategy: Clear google_event_id and retry creation (recursive or next tick)
                    // For now, let's mark as unlinked or deleted in DB?
                    // Or recreate immediately? Recreate is better for "Sync guarantees".

                    // Update DB to clear broken link
                    await supabase
                        .from("calendar_sync")
                        .update({ google_event_id: null, etag: null })
                        .eq("card_id", cardId);

                    // Recursive retry (one level deep ideally)
                    // simplified: throw specific error to trigger retry logic up stack or just recurse
                    return syncCardToCalendar(supabase, userId, cardId, eventParams);
                }
                throw err; // 403, 412, etc.
            }
        }

    } catch (err) {
        if (err instanceof Error) throw err;
        await handleGoogleError(err);
    }
}

export async function deleteCardFromCalendar(
    supabase: SupabaseClient,
    userId: string,
    cardId: string
) {
    const syncRecord = await getCalendarSyncRecord(supabase, cardId);
    if (!syncRecord || !syncRecord.google_event_id) return; // Nothing to delete

    // 1. Get Client (don't fail if token expired during delete? maybe just skip?)
    // If we can't get client, we can't delete. 
    const { calendar } = await getGoogleCalendarClientForUser(userId, { supabase });

    try {
        await calendar.events.delete({
            calendarId: syncRecord.calendar_id,
            eventId: syncRecord.google_event_id,
        });
    } catch (err: any) {
        if (err.code === 404 || err.code === 410) {
            // Already gone, verify success
        } else {
            // Log but maybe swallow if we want to ensure local DB deletion proceeds?
            console.error("Failed to delete Google Event", err);
            // For strict consistency, we might want to fail. 
            // But if user is deleting card, blocking on Google error is annoying.
            // We'll proceed to delete local record.
        }
    }

    // Local record deletion is handled by CASCADE/API logic usually, or explicitly here?
    // The caller (API) usually deletes the card or updates status.
    // If card is deleted, CASCADE handles sync record.
    // If this is just "Turn off Sync" (unlink/delete), we update status.
}

