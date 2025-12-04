import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import {
  createGoogleOAuthClient,
  GOOGLE_CALENDAR_SCOPE,
  resolveGoogleRedirectUri,
} from "@/lib/googleCalendarServer";

export const runtime = "nodejs";

const STATE_COOKIE_NAME = "gc_oauth_state";

const decodeState = (state?: string | null) => {
  if (!state) return null;
  try {
    const json = Buffer.from(state, "base64url").toString("utf-8");
    return JSON.parse(json) as { userId: string; nonce: string; redirect?: string | null };
  } catch {
    return null;
  }
};

const buildRedirect = (value?: string | null) => {
  if (value && value.startsWith("/")) return value;
  return "/board";
};

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Login required" } },
      { status: 401 }
    );
  }

  const code = request.nextUrl.searchParams.get("code");
  const stateParam = request.nextUrl.searchParams.get("state");
  const storedState = request.cookies.get(STATE_COOKIE_NAME)?.value;

  const statePayload = decodeState(stateParam);
  const safeRedirect = buildRedirect(statePayload?.redirect);

  if (!code || !stateParam || !storedState || storedState !== stateParam || !statePayload || statePayload.userId !== user.id) {
    return NextResponse.json(
      { error: { code: "INVALID_STATE", message: "State mismatch" } },
      { status: 400 }
    );
  }

  try {
    const redirectUri = resolveGoogleRedirectUri(request.nextUrl.origin);
    const oauth2Client = createGoogleOAuthClient(redirectUri);
    const { tokens } = await oauth2Client.getToken({ code, redirect_uri: redirectUri });

    oauth2Client.setCredentials(tokens);

    if (!tokens.access_token) {
      return NextResponse.json(
        { error: { code: "TOKEN_EXCHANGE_FAILED", message: "Missing access token" } },
        { status: 400 }
      );
    }

    const tokenInfo = await oauth2Client.getTokenInfo(tokens.access_token);
    const googleSub = tokenInfo.sub;
    if (!googleSub) {
      return NextResponse.json(
        { error: { code: "MISSING_SUB", message: "Google account identifier not found" } },
        { status: 400 }
      );
    }

    const { data: existing } = await supabase
      .from("google_calendar_accounts")
      .select("refresh_token")
      .eq("user_id", user.id)
      .eq("google_sub", googleSub)
      .maybeSingle();

    const refreshToken = tokens.refresh_token ?? existing?.refresh_token ?? null;
    if (!refreshToken) {
      return NextResponse.json(
        { error: { code: "MISSING_REFRESH_TOKEN", message: "Refresh token not returned; try reconnect with consent" } },
        { status: 400 }
      );
    }

    const expiresAt = tokens.expiry_date
      ? new Date(tokens.expiry_date).toISOString()
      : new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const scope = tokens.scope ?? tokenInfo.scope ?? GOOGLE_CALENDAR_SCOPE;
    const email = tokenInfo.email ?? user.email ?? "unknown";

    const { error: upsertError } = await supabase
      .from("google_calendar_accounts")
      .upsert({
        user_id: user.id,
        google_sub: googleSub,
        email,
        access_token: tokens.access_token,
        refresh_token: refreshToken,
        scope,
        token_expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: "user_id,google_sub",
      });

    if (upsertError) {
      console.error("[googleCalendar/callback] failed to store credentials", {
        code: upsertError.code,
        message: upsertError.message,
        details: upsertError.details,
        hint: upsertError.hint,
      });
      return NextResponse.json(
        {
          error: {
            code: "DB_ERROR",
            message: "Failed to store credentials",
            detail: upsertError.message,
            hint: upsertError.hint,
          },
        },
        { status: 500 }
      );
    }

    const absoluteRedirect = (() => {
      try {
        return new URL(safeRedirect, request.nextUrl.origin).toString();
      } catch {
        return request.nextUrl.origin;
      }
    })();

    const response = NextResponse.redirect(absoluteRedirect);
    response.cookies.set(STATE_COOKIE_NAME, "", {
      maxAge: 0,
      path: "/api/integrations/google-calendar/callback",
    });
    return response;
  } catch (error) {
    const err: any = error;
    console.error("[googleCalendar/callback] token exchange failed", {
      message: err?.message,
      code: err?.code,
      response: err?.response?.data,
      errors: err?.errors,
    });
    const detail =
      err?.response?.data?.error_description ||
      err?.response?.data?.error ||
      err?.message ||
      null;
    return NextResponse.json(
      { error: { code: "GOOGLE_OAUTH_ERROR", message: "Failed to connect Google Calendar", detail } },
      { status: 500 }
    );
  }
}
