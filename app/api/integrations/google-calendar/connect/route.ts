import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import {
  createGoogleOAuthClient,
  GOOGLE_CALENDAR_SCOPE,
  GOOGLE_CALENDAR_READONLY_SCOPE,
  resolveGoogleRedirectUri,
} from "@/lib/googleCalendarServer";
import { withErrorHandling } from "@/lib/server/with-error-handling";

export const runtime = "nodejs";

const STATE_COOKIE_NAME = "gc_oauth_state";

const getHandler = async (request: NextRequest) => {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Login required" } },
      { status: 401 }
    );
  }

  try {
    const redirectParam = request.nextUrl.searchParams.get("redirect");
    const redirectPath = redirectParam && redirectParam.startsWith("/") ? redirectParam : "/board";
    const redirectUri = resolveGoogleRedirectUri(request.nextUrl.origin);

    const statePayload = {
      userId: user.id,
      nonce: crypto.randomUUID(),
      redirect: redirectPath,
    };
    const state = Buffer.from(JSON.stringify(statePayload)).toString("base64url");

    const oauth2Client = createGoogleOAuthClient(redirectUri);
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: true,
      scope: [GOOGLE_CALENDAR_SCOPE, GOOGLE_CALENDAR_READONLY_SCOPE],
      state,
      redirect_uri: redirectUri,
    });

    const wantsJson = request.headers.get("accept")?.includes("application/json")
      || request.nextUrl.searchParams.get("format") === "json";

    const response = wantsJson ? NextResponse.json({ authUrl }) : NextResponse.redirect(authUrl);
    response.cookies.set(STATE_COOKIE_NAME, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      maxAge: 60 * 10,
      path: "/api/integrations/google-calendar/callback",
    });

    return response;
  } catch (error) {
    console.error("[googleCalendar/connect] failed to build auth url", error);
    return NextResponse.json(
      { error: { code: "GOOGLE_OAUTH_CONFIG_ERROR", message: "Failed to start Google OAuth" } },
      { status: 500 }
    );
  }
};

export const GET = withErrorHandling(getHandler, "google-calendar-connect-get");
