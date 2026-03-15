import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { normalizeUsername } from '@/lib/usernames';
import { checkRateLimit } from '@/lib/server/rate-limit';
import { getClientIp } from '@/lib/server/api-security';
import { withErrorHandling } from '@/lib/server/with-error-handling';

/**
 * GET /api/profiles/search?board_id={boardId}&query={query}
 *
 * Search team member profiles for board access management.
 */
const getHandler = async (request: NextRequest) => {
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

    const { data: board, error: boardError } = await supabase
      .from('boards')
      .select('team_id')
      .eq('id', boardId)
      .maybeSingle();

    if (boardError) {
      console.error('Error loading board team:', boardError);
      return NextResponse.json({
        error: { code: 'DB_ERROR', message: 'Failed to load board team' },
      }, { status: 500 });
    }

    if (!board?.team_id) {
      return NextResponse.json({
        error: { code: 'CONFLICT', message: 'Board must belong to a team before searching members' },
      }, { status: 409 });
    }

    const { data: teamMembers, error: teamMembersError } = await supabase
      .from('team_members')
      .select(`
        profile_id,
        profiles:profile_id (
          id,
          username,
          display_name,
          full_name,
          avatar_url,
          email
        )
      `)
      .eq('team_id', board.team_id);

    if (teamMembersError) {
      console.error('Error loading team members for search:', teamMembersError);
      return NextResponse.json({
        error: { code: 'DB_ERROR', message: 'Failed to load team members' },
      }, { status: 500 });
    }

    const teamProfiles = (teamMembers ?? [])
      .map((row) => Array.isArray(row.profiles) ? row.profiles[0] : row.profiles)
      .filter((profile): profile is NonNullable<typeof profile> => Boolean(profile));

    // Email mode: exact match only among team members
    if (emailParam && !queryParam) {
      const email = emailParam.trim().toLowerCase();
      if (!email) {
        return NextResponse.json({
          error: { code: 'INVALID_PARAM', message: 'Email parameter is required' },
        }, { status: 400 });
      }

      const exactProfile = teamProfiles.find((profile) => profile.email?.toLowerCase() === email) ?? null;

      if (!exactProfile) {
        return NextResponse.json({
          error: { code: 'NOT_FOUND', message: 'Team member not found' },
        }, { status: 404 });
      }

      return NextResponse.json({ profile: exactProfile, profiles: [exactProfile] }, { status: 200 });
    }

    const query = (queryParam || emailParam || '').trim();
    if (!query) {
      return NextResponse.json({ profiles: [], profile: null }, { status: 200 });
    }

    if (query.length < 2) {
      return NextResponse.json({ profiles: [], profile: null }, { status: 200 });
    }

    const normalizedUsername = normalizeUsername(query);
    const normalizedQuery = query.toLowerCase();

    const results = teamProfiles
      .filter((profile) => {
        const username = profile.username?.toLowerCase() ?? '';
        const displayName = profile.display_name?.toLowerCase() ?? '';
        const fullName = profile.full_name?.toLowerCase() ?? '';
        return (
          username === normalizedUsername ||
          username.startsWith(normalizedUsername) ||
          displayName.includes(normalizedQuery) ||
          fullName.includes(normalizedQuery)
        );
      })
      .sort((a, b) => {
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
};

export const GET = withErrorHandling(getHandler, 'profiles-search-get');
