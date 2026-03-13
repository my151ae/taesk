import { createServerSupabaseClient } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';
import { MemberRole, ProfileSummary } from '@/lib/supabase';
import {
  getBoardMembership,
  requireAuthenticatedUser,
  validateMutationRequestOrigin,
} from '@/lib/server/api-security';
import { withErrorHandling } from '@/lib/server/with-error-handling';

type BoardMemberRow = {
  board_id: string;
  profile_id: string;
  role: MemberRole;
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
    return errorResponse ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

    const actorMembership = await getActorMembership(supabase, boardId, user.id);
    if (!actorMembership) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
      return NextResponse.json({ error: error.message }, { status: 500 });
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

  return NextResponse.json({ members: transformedMembers });
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
    return errorResponse ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

    const actorMembership = await getActorMembership(supabase, boardId, user.id);
    if (!actorMembership || actorMembership.role !== 'owner') {
      return NextResponse.json({ error: 'Only owner can add members' }, { status: 403 });
    }

    const body = await request.json();
    const { profile_id, role = 'editor' } = body as { profile_id: string; role?: MemberRole };

    if (!profile_id) {
      return NextResponse.json({ error: 'profile_id is required' }, { status: 400 });
    }

    if (role === 'owner' && actorMembership.role !== 'owner') {
      return NextResponse.json({ error: 'Only owner can assign owner role' }, { status: 403 });
    }

    // Insert new member
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
        return NextResponse.json({ error: 'Member already exists' }, { status: 409 });
      }
      console.error('Error adding board member:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Team sync fallback (DB trigger is source of truth; keep API fallback for compatibility).
    const { data: board } = await supabase
      .from('boards')
      .select('team_id')
      .eq('id', boardId)
      .maybeSingle();
    if (board?.team_id) {
      await supabase
        .from('team_members')
        .upsert(
          {
            team_id: board.team_id,
            profile_id,
            role: 'guest',
          },
          { onConflict: 'team_id,profile_id', ignoreDuplicates: true }
        );
    }

  return NextResponse.json({ member: newMember }, { status: 201 });
};

export const GET = withErrorHandling(getHandler, 'board-members-get');
export const POST = withErrorHandling(postHandler, 'board-members-post');
