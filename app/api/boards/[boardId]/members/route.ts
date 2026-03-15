import { createServerSupabaseClient } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';
import { MemberRole, ProfileSummary } from '@/lib/supabase';
import {
  getBoardMembership,
  requireAuthenticatedUser,
  validateMutationRequestOrigin,
} from '@/lib/server/api-security';
import { errorResponse as apiErrorResponse, ApiErrorCode } from '@/lib/server/api-error';
import { withErrorHandling } from '@/lib/server/with-error-handling';

type BoardMemberRow = {
  board_id: string;
  profile_id: string;
  role: MemberRole;
  created_at: string;
  profiles: ProfileSummary | ProfileSummary[] | null;
};

type TeamMemberRow = {
  team_id: string;
  profile_id: string;
  role: string;
  created_at: string;
  profiles: ProfileSummary | ProfileSummary[] | null;
};

async function getActorMembership(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  boardId: string,
  userId: string
) {
  return getBoardMembership(supabase, boardId, userId);
}

async function getBoardTeamId(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  boardId: string
) {
  const { data, error } = await supabase
    .from('boards')
    .select('team_id')
    .eq('id', boardId)
    .maybeSingle();

  if (error) {
    return { teamId: null, error };
  }

  return { teamId: data?.team_id ?? null, error: null };
}

// GET /api/boards/[boardId]/members - List members with optional search
const getHandler = async (
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) => {
  const supabase = await createServerSupabaseClient();
  const { boardId } = await params;
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('query');
  // Get current user
  const { user, errorResponse } = await requireAuthenticatedUser(supabase);
  if (errorResponse || !user) {
    return errorResponse ?? apiErrorResponse(ApiErrorCode.UNAUTHENTICATED, 'Login required', 401);
  }

  const actorMembership = await getActorMembership(supabase, boardId, user.id);
  if (!actorMembership) {
    return apiErrorResponse(ApiErrorCode.FORBIDDEN, 'Not a board member', 403);
  }

    // Build query
    let membersQuery = supabase
      .from('board_members')
      .select(`
        board_id,
        profile_id,
        role,
        created_at,
        profiles:profile_id (
          id,
          username,
          display_name,
          full_name,
          avatar_url,
          email
        )
      `)
      .eq('board_id', boardId);

    const { data: members, error } = await membersQuery;

  if (error) {
    console.error('Error fetching board members:', error);
    return apiErrorResponse(ApiErrorCode.DB_ERROR, error.message, 500);
  }

    // Filter by search query if provided
    let results: BoardMemberRow[] = (members as BoardMemberRow[] | null) ?? [];
    if (query && query.trim()) {
      const lowerQuery = query.toLowerCase();
      results = results.filter((member) => {
        const profile = Array.isArray(member.profiles) ? member.profiles[0] : member.profiles;
        if (!profile) return false;
        const username = profile.username?.toLowerCase() ?? '';
        const displayName = profile.display_name?.toLowerCase() ?? '';
        const fullName = profile.full_name?.toLowerCase() ?? '';
        const email = profile.email?.toLowerCase() ?? '';
        return (
          username.includes(lowerQuery) ||
          displayName.includes(lowerQuery) ||
          fullName.includes(lowerQuery) ||
          email.includes(lowerQuery)
        );
      });
    }

    // Transform to include profile data
    const transformedMembers = results
      .map((member) => {
        const profile = Array.isArray(member.profiles) ? member.profiles[0] : member.profiles;
        return {
      board_id: member.board_id,
      profile_id: member.profile_id,
      role: member.role,
      created_at: member.created_at,
      profile: profile ?? null,
    };
      })
      .filter((member): member is { board_id: string; profile_id: string; role: MemberRole; created_at: string; profile: ProfileSummary } => Boolean(member.profile));

  let availableMembers: Array<{
    profile_id: string;
    role: string;
    created_at: string;
    profile: ProfileSummary;
  }> = [];

  const { teamId, error: teamLookupError } = await getBoardTeamId(supabase, boardId);
  if (teamLookupError) {
    return apiErrorResponse(ApiErrorCode.DB_ERROR, teamLookupError.message, 500);
  }

  if (teamId) {
    const { data: actorTeamMembership, error: actorTeamMembershipError } = await supabase
      .from('team_members')
      .select('role')
      .eq('team_id', teamId)
      .eq('profile_id', user.id)
      .maybeSingle();

    if (actorTeamMembershipError) {
      return apiErrorResponse(ApiErrorCode.DB_ERROR, actorTeamMembershipError.message, 500);
    }

    if (actorTeamMembership && actorTeamMembership.role !== 'guest') {
      const { data: teamMembers, error: teamMembersError } = await supabase
        .from('team_members')
        .select(`
          team_id,
          profile_id,
          role,
          created_at,
          profiles:profile_id (
            id,
            username,
            display_name,
            full_name,
            avatar_url,
            email
          )
        `)
        .eq('team_id', teamId)
        .order('created_at', { ascending: true });

      if (teamMembersError) {
        return apiErrorResponse(ApiErrorCode.DB_ERROR, teamMembersError.message, 500);
      }

      const memberIds = new Set(transformedMembers.map((member) => member.profile_id));
      availableMembers = ((teamMembers as TeamMemberRow[] | null) ?? [])
        .map((member) => {
          const profile = Array.isArray(member.profiles) ? member.profiles[0] : member.profiles;
          return {
            profile_id: member.profile_id,
            role: member.role,
            created_at: member.created_at,
            profile: profile ?? null,
          };
        })
        .filter((member): member is { profile_id: string; role: string; created_at: string; profile: ProfileSummary } => {
          return Boolean(member.profile) && !memberIds.has(member.profile_id);
        });
    }
  }

  return NextResponse.json({ members: transformedMembers, available_members: availableMembers }, { status: 200 });
};

// POST /api/boards/[boardId]/members - Add member
const postHandler = async (
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) => {
  const originError = validateMutationRequestOrigin(request);
  if (originError) {
    return originError;
  }

  const supabase = await createServerSupabaseClient();
  const { boardId } = await params;
  const { user, errorResponse } = await requireAuthenticatedUser(supabase);
  if (errorResponse || !user) {
    return errorResponse ?? apiErrorResponse(ApiErrorCode.UNAUTHENTICATED, 'Login required', 401);
  }

  const actorMembership = await getActorMembership(supabase, boardId, user.id);
  if (!actorMembership || actorMembership.role !== 'owner') {
    return apiErrorResponse(ApiErrorCode.FORBIDDEN, 'Only board owners can grant board access', 403);
  }

  const body = await request.json();
  const { profile_id, role = 'editor' } = body as { profile_id: string; role?: MemberRole };

  if (!profile_id) {
    return apiErrorResponse(ApiErrorCode.INVALID_BODY, 'profile_id is required', 400);
  }

  if (role === 'owner' && actorMembership.role !== 'owner') {
    return apiErrorResponse(ApiErrorCode.FORBIDDEN, 'Only owner can assign owner role', 403);
  }

  const { teamId, error: boardLookupError } = await getBoardTeamId(supabase, boardId);
  if (boardLookupError) {
    return apiErrorResponse(ApiErrorCode.DB_ERROR, boardLookupError.message, 500);
  }
  if (!teamId) {
    return apiErrorResponse(ApiErrorCode.CONFLICT, 'Board must belong to a team before board access can be granted', 409);
  }

  const { data: teamMembership, error: membershipLookupError } = await supabase
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('profile_id', profile_id)
    .maybeSingle();

  if (membershipLookupError) {
    return apiErrorResponse(ApiErrorCode.DB_ERROR, membershipLookupError.message, 500);
  }
  if (!teamMembership) {
    return apiErrorResponse(
      ApiErrorCode.TEAM_MEMBERSHIP_REQUIRED,
      'User must join the team before board access can be granted.',
      409
    );
  }

  const { data: newMember, error } = await supabase
    .from('board_members')
    .insert({
      board_id: boardId,
      profile_id,
      role,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return apiErrorResponse(ApiErrorCode.CONFLICT, 'Member already exists', 409);
    }
    if (error.message.includes('TEAM_MEMBERSHIP_REQUIRED')) {
      return apiErrorResponse(
        ApiErrorCode.TEAM_MEMBERSHIP_REQUIRED,
        'User must join the team before board access can be granted.',
        409
      );
    }
    console.error('Error adding board member:', error);
    return apiErrorResponse(ApiErrorCode.DB_ERROR, error.message, 500);
  }

  return NextResponse.json({ member: newMember }, { status: 201 });
};

export const GET = withErrorHandling(getHandler, 'board-members-get');
export const POST = withErrorHandling(postHandler, 'board-members-post');
