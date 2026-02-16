import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertE2EEnabled } from '../guards';
import { withErrorHandling } from '@/lib/server/with-error-handling';
import { errorResponse, ApiErrorCode } from '@/lib/server/api-error';

/**
 * E2E Programmatic Sign-In Endpoint
 *
 * Signs in a user and returns session data.
 * Playwright will use this session in storageState.
 * Requires E2E_ENABLED=true and correct x-e2e-secret header.
 */
async function postLoginAs(req: NextRequest) {
  // Guard: Only allow in E2E mode with correct secret
  assertE2EEnabled(req);

  const { email, password } = await req.json();

  if (!email || !password) {
    return errorResponse(ApiErrorCode.INVALID_BODY, 'Email and password required', 400);
  }

    // Create Supabase client (same as app client, not admin)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          detectSessionInUrl: false,
          persistSession: false, // We'll handle session persistence in Playwright
        },
      }
    );

    // Sign in with password
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

  if (error) {
    console.error('[E2E] sign-in failed');
    throw error;
  }

  if (!data.session) {
    throw new Error('No session returned from sign-in');
  }

    console.log('[E2E] sign-in succeeded');

    // Return session data for Playwright to store
  return NextResponse.json(
    {
      success: true,
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at,
        user: {
          id: data.user.id,
          email: data.user.email,
        },
      },
    },
    { status: 200 }
  );
}

export const POST = withErrorHandling(async (req: NextRequest) => {
  try {
    return await postLoginAs(req);
  } catch (e: any) {
    if (e instanceof Error && e.message === 'E2E_NOT_FOUND') {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Not found' } },
        { status: 404 }
      );
    }

    console.error('[E2E] login-as request failed');
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
      { status: 401 }
    );
  }
}, 'api/e2e/login-as');
