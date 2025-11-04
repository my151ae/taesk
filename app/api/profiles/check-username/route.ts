import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import {
  normalizeUsername,
  isUsernameFormatValid,
  isNormalizedUsernameValid,
  isReservedUsername,
  type UsernameAvailabilityReason,
} from '@/lib/usernames';
import { checkRateLimit } from '@/lib/server/rate-limit';

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_COUNT = 20;

function getClientIdentifier(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const firstIp = forwardedFor.split(',')[0]?.trim();
    if (firstIp) {
      return firstIp;
    }
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }
  return 'unknown';
}

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rateKey = `check-username:${getClientIdentifier(request)}`;
  const rateLimit = checkRateLimit({
    key: rateKey,
    limit: RATE_LIMIT_COUNT,
    windowMs: RATE_LIMIT_WINDOW_MS,
  });

  if (!rateLimit.ok) {
    return NextResponse.json(
      { available: false, reason: 'rate_limited' as UsernameAvailabilityReason },
      {
        status: 429,
        headers: {
          'Retry-After': Math.ceil((rateLimit.resetAt - Date.now()) / 1000).toString(),
        },
      }
    );
  }

  const usernameParam = request.nextUrl.searchParams.get('username');

  if (!usernameParam || usernameParam.trim().length === 0) {
    return NextResponse.json({ available: false, reason: 'invalid_format' as UsernameAvailabilityReason }, { status: 200 });
  }

  if (!isUsernameFormatValid(usernameParam)) {
    return NextResponse.json({ available: false, reason: 'invalid_format' as UsernameAvailabilityReason }, { status: 200 });
  }

  const normalized = normalizeUsername(usernameParam);

  if (!isNormalizedUsernameValid(normalized)) {
    return NextResponse.json({ available: false, reason: 'invalid_format' as UsernameAvailabilityReason }, { status: 200 });
  }

  if (isReservedUsername(normalized)) {
    return NextResponse.json({ available: false, reason: 'reserved' as UsernameAvailabilityReason }, { status: 200 });
  }

  const { data: existing, error: lookupError } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', normalized)
    .neq('id', user.id)
    .maybeSingle();

  if (lookupError) {
    console.error('Failed to check username availability:', lookupError);
    return NextResponse.json({ error: 'Failed to check username' }, { status: 500 });
  }

  const available = !existing;
  const response = NextResponse.json({
    available,
    reason: available ? null : ('taken' as UsernameAvailabilityReason),
    username: normalized,
  });

  response.headers.set('X-RateLimit-Remaining', rateLimit.remaining.toString());
  response.headers.set('X-RateLimit-Reset', rateLimit.resetAt.toString());

  return response;
}
