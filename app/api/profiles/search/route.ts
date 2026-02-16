import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { normalizeUsername } from '@/lib/usernames';
import { checkRateLimit } from '@/lib/server/rate-limit';
import { getClientIp } from '@/lib/server/api-security';

/**
 * GET /api/profiles/search?board_id={boardId}&query={query}
 *
 * Search user profiles for board sharing.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const boardId = searchParams.get('board_id');
    const emailParam = searchParams.get('email');
    const queryParam = searchParams.get('query') ?? searchParams.get('q');

    if (!boardId) {
      return NextResponse.json({
        error: { code: 'INVALID_PARAM', message: 'board_id parameter is required' },
      }, { status: 400 });
    }

    const { data: membership } = await supabase
      .from('board_members')
      .select('role')
      .eq('board_id', boardId)
      .eq('profile_id', user.id)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({
        error: { code: 'FORBIDDEN', message: 'Not a board member' },
      }, { status: 403 });
    }

    const ip = getClientIp(request);
    const rate = await checkRateLimit({
      key: `profiles_search:${user.id}:${boardId}:${ip}`,
      limit: 60,
      windowMs: 60_000,
    });
    if (!rate.ok) {
      return NextResponse.json({
        error: { code: 'RATE_LIMITED', message: 'Too many requests' },
      }, {
        status: 429,
        headers: {
          'Retry-After': Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000)).toString(),
        },
      });
    }

    if (!emailParam && !queryParam) {
      return NextResponse.json({
        error: { code: 'INVALID_PARAM', message: 'query or email parameter is required' },
      }, { status: 400 });
    }

    // Email mode: exact match only (no partial email search)
    if (emailParam && !queryParam) {
      const email = emailParam.trim().toLowerCase();
      if (!email) {
        return NextResponse.json({
          error: { code: 'INVALID_PARAM', message: 'Email parameter is required' },
        }, { status: 400 });
      }

      const { data: profile, error } = await supabase
        .from('profiles')
        .select('id, username, display_name, full_name, avatar_url')
        .eq('email', email)
        .maybeSingle();

      if (error) {
        console.error('Error searching profile:', error);
        return NextResponse.json({
          error: { code: 'DB_ERROR', message: 'Failed to search profile' },
        }, { status: 500 });
      }

      if (!profile) {
        return NextResponse.json({
          error: { code: 'NOT_FOUND', message: 'User not found' },
        }, { status: 404 });
      }

      return NextResponse.json({ profile, profiles: [profile] }, { status: 200 });
    }

    const query = (queryParam || emailParam || '').trim();
    if (!query) {
      return NextResponse.json({ profiles: [], profile: null }, { status: 200 });
    }

    if (query.length < 2) {
      return NextResponse.json({ profiles: [], profile: null }, { status: 200 });
    }

    const normalizedUsername = normalizeUsername(query);
    const escapedLikeValue = query
      .replace(/[%_\\]/g, (match) => `\\${match}`)
      .replace(/,/g, '\\,')
      .replace(/\./g, '\\.');

    const { data: matches, error } = await supabase
      .from('profiles')
      .select('id, username, display_name, full_name, avatar_url')
      .or(
        [
          `username.eq.${normalizedUsername}`,
          `username.ilike.${normalizedUsername}%`,
          `display_name.ilike.%${escapedLikeValue}%`,
          `full_name.ilike.%${escapedLikeValue}%`,
        ].join(',')
      )
      .limit(20);

    if (error) {
      console.error('Error searching profile:', error);
      return NextResponse.json({
        error: { code: 'DB_ERROR', message: 'Failed to search profile' },
      }, { status: 500 });
    }

    const results = (matches ?? []).sort((a, b) => {
      const aUsername = a.username ?? '';
      const bUsername = b.username ?? '';

      if (aUsername === normalizedUsername && bUsername !== normalizedUsername) return -1;
      if (bUsername === normalizedUsername && aUsername !== normalizedUsername) return 1;

      if (aUsername.startsWith(normalizedUsername) && !bUsername.startsWith(normalizedUsername)) return -1;
      if (bUsername.startsWith(normalizedUsername) && !aUsername.startsWith(normalizedUsername)) return 1;

      const aDisplay = a.display_name ?? a.full_name ?? a.username ?? '';
      const bDisplay = b.display_name ?? b.full_name ?? b.username ?? '';
      return aDisplay.localeCompare(bDisplay);
    });

    return NextResponse.json({ profiles: results, profile: results[0] ?? null }, { status: 200 });
  } catch (error) {
    console.error('Unexpected error in GET /api/profiles/search:', error);
    return NextResponse.json({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    }, { status: 500 });
  }
}
