import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertE2EEnabled } from '../guards';
import { withErrorHandling } from '@/lib/server/with-error-handling';
import { errorResponse, ApiErrorCode } from '@/lib/server/api-error';

function isRetryableAuthError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const name = error.name.toLowerCase();
  const message = error.message.toLowerCase();
  return name.includes('retryable') || message.includes('fetch failed');
}

async function withAuthRetry<T>(operation: () => Promise<T>, retries = 2): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryableAuthError(error) || attempt === retries) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  throw lastError;
}

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

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }

  // Create Supabase client (same as app client, not admin)
  const supabase = createClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      auth: {
        detectSessionInUrl: false,
        persistSession: false, // We'll handle session persistence in Playwright
      },
    }
  );

  // Sign in with password
  const { data, error } = await withAuthRetry(() =>
    supabase.auth.signInWithPassword({
      email,
      password,
    })
  );

  if (error) {
    console.error('[E2E] sign-in failed');
    throw error;
  }

  if (!data.session) {
    throw new Error('No session returned from sign-in');
  }
  if (!data.user) {
    throw new Error('No user returned from sign-in');
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

function getErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const candidate = (error as { status?: unknown }).status;
  return typeof candidate === 'number' ? candidate : null;
}

function getErrorDetails(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  if (error && typeof error === 'object') {
    const source = error as { code?: unknown; status?: unknown };
    return {
      code: typeof source.code === 'string' ? source.code : undefined,
      status: typeof source.status === 'number' ? source.status : undefined,
    };
  }
  return undefined;
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

    const status = getErrorStatus(e);
    if (status === 400 || status === 401 || status === 403) {
      console.error('[E2E] login-as authentication failed');
      return errorResponse(ApiErrorCode.UNAUTHENTICATED, 'Unauthorized', 401);
    }

    console.error('[E2E] login-as request failed', e);
    return errorResponse(
      ApiErrorCode.INTERNAL_ERROR,
      'Internal server error',
      500,
      getErrorDetails(e)
    );
  }
}, 'api/e2e/login-as');
