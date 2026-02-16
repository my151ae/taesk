import { NextRequest, NextResponse } from 'next/server';

import { createServerSupabaseClient, type MemberRole } from '@/lib/supabase';

type ServerSupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function getClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const firstIp = forwardedFor.split(',')[0]?.trim();
    if (firstIp) return firstIp;
  }
  return request.headers.get('x-real-ip') ?? 'unknown';
}

export function validateMutationRequestOrigin(request: NextRequest): NextResponse | null {
  if (!MUTATION_METHODS.has(request.method.toUpperCase())) {
    return null;
  }

  const secFetchSite = request.headers.get('sec-fetch-site');
  if (secFetchSite && !['same-origin', 'same-site', 'none'].includes(secFetchSite)) {
    return NextResponse.json(
      { error: { code: 'INVALID_ORIGIN', message: 'Cross-site request rejected' } },
      { status: 403 }
    );
  }

  const origin = request.headers.get('origin');
  if (!origin) {
    // Non-browser or same-origin server-side clients may omit Origin.
    return null;
  }

  let requestOrigin: URL;
  let incomingOrigin: URL;

  try {
    requestOrigin = new URL(request.nextUrl.origin);
    incomingOrigin = new URL(origin);
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_ORIGIN', message: 'Malformed origin' } },
      { status: 403 }
    );
  }

  if (requestOrigin.protocol !== incomingOrigin.protocol || requestOrigin.host !== incomingOrigin.host) {
    return NextResponse.json(
      { error: { code: 'INVALID_ORIGIN', message: 'Origin mismatch' } },
      { status: 403 }
    );
  }

  return null;
}

export async function requireAuthenticatedUser(supabase: ServerSupabaseClient) {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      user: null,
      errorResponse: NextResponse.json(
        { error: { code: 'UNAUTHENTICATED', message: 'Login required' } },
        { status: 401 }
      ),
    };
  }

  return {
    user,
    errorResponse: null,
  };
}

export async function getBoardMembership(
  supabase: ServerSupabaseClient,
  boardId: string,
  userId: string
): Promise<{ role: MemberRole } | null> {
  const { data } = await supabase
    .from('board_members')
    .select('role')
    .eq('board_id', boardId)
    .eq('profile_id', userId)
    .maybeSingle();

  return (data as { role: MemberRole } | null) ?? null;
}

export function hasAnyRole(role: MemberRole | undefined, allowed: MemberRole[]): boolean {
  if (!role) return false;
  return allowed.includes(role);
}
