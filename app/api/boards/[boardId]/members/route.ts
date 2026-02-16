import { createServerSupabaseClient } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';
import { MemberRole, ProfileSummary } from '@/lib/supabase';

async function getActorMembership(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  boardId: string,
  userId: string
) {
  const { data: membership } = await supabase
    .from('board_members')
    .select('role')
    .eq('board_id', boardId)
    .eq('profile_id', userId)
    .maybeSingle();
  return membership;
}

// GET /api/boards/[boardId]/members - List members with optional search
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  const supabase = await createServerSupabaseClient();
  const { boardId } = await params;
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('query');

  try {
    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
    let results = members || [];
    if (query && query.trim()) {
      const lowerQuery = query.toLowerCase();
      results = results.filter((member: any) => {
        const profile = member.profiles;
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
    const transformedMembers = results.map((member: any) => ({
      board_id: member.board_id,
      profile_id: member.profile_id,
      role: member.role,
      created_at: member.created_at,
      profile: member.profiles as ProfileSummary,
    }));

    return NextResponse.json({ members: transformedMembers });
  } catch (error) {
    console.error('Unexpected error in GET /api/boards/[boardId]/members:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/boards/[boardId]/members - Add member
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  const supabase = await createServerSupabaseClient();
  const { boardId } = await params;

  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const actorMembership = await getActorMembership(supabase, boardId, user.id);
    if (!actorMembership || !['owner', 'editor'].includes(actorMembership.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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

    return NextResponse.json({ member: newMember }, { status: 201 });
  } catch (error) {
    console.error('Unexpected error in POST /api/boards/[boardId]/members:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
