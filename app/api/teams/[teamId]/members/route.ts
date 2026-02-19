import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { createServerSupabaseClient, type TeamRole, type ProfileSummary } from '@/lib/supabase';
import { requireAuthenticatedUser, validateMutationRequestOrigin } from '@/lib/server/api-security';
import { hasAnyTeamRole } from '@/lib/server/team-security';
import { withErrorHandling } from '@/lib/server/with-error-handling';

const CreateTeamMemberSchema = z.object({
  profile_id: z.string().uuid(),
  role: z.enum(['owner', 'admin', 'member', 'guest']).optional(),
});

type TeamMemberRow = {
  team_id: string;
  profile_id: string;
  role: TeamRole;
  created_at: string;
  profiles: ProfileSummary | ProfileSummary[] | null;
};

const getHandler = async (
  _request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) => {
  const { teamId } = await params;
  const supabase = await createServerSupabaseClient();
  const { user, errorResponse } = await requireAuthenticatedUser(supabase);
  if (errorResponse || !user) {
    return errorResponse ?? NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Login required' } },
      { status: 401 }
    );
  }

  const { data: actor } = await supabase
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('profile_id', user.id)
    .maybeSingle();

  if (!actor) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Team not found' } },
      { status: 404 }
    );
  }

  if (actor.role === 'guest') {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Guests cannot view team members' } },
      { status: 403 }
    );
  }

  const { data: members, error } = await supabase
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

  if (error) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: error.message } },
      { status: 500 }
    );
  }

  const normalized = ((members as TeamMemberRow[] | null) ?? [])
    .map((member) => {
      const profile = Array.isArray(member.profiles) ? member.profiles[0] : member.profiles;
      return {
        team_id: member.team_id,
        profile_id: member.profile_id,
        role: member.role,
        created_at: member.created_at,
        profile: profile ?? null,
      };
    })
    .filter((item) => Boolean(item.profile));

  return NextResponse.json({ members: normalized }, { status: 200 });
};

const postHandler = async (
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) => {
  const originError = validateMutationRequestOrigin(request);
  if (originError) {
    return originError;
  }

  const { teamId } = await params;
  const supabase = await createServerSupabaseClient();
  const { user, errorResponse } = await requireAuthenticatedUser(supabase);
  if (errorResponse || !user) {
    return errorResponse ?? NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Login required' } },
      { status: 401 }
    );
  }

  const { data: actor } = await supabase
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('profile_id', user.id)
    .maybeSingle();

  if (!actor || !hasAnyTeamRole(actor.role, ['owner', 'admin'])) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } },
      { status: 403 }
    );
  }

  const body = await request.json();
  const parsed = CreateTeamMemberSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'INVALID_BODY',
          message: 'Validation failed',
          details: parsed.error.flatten(),
        },
      },
      { status: 422 }
    );
  }

  const role = parsed.data.role ?? 'member';
  if (role === 'owner' && actor.role !== 'owner') {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Only owner can assign owner role' } },
      { status: 403 }
    );
  }

  const { data: created, error } = await supabase
    .from('team_members')
    .insert({
      team_id: teamId,
      profile_id: parsed.data.profile_id,
      role,
    })
    .select('team_id, profile_id, role, created_at')
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: { code: 'CONFLICT', message: 'Member already exists' } },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: error.message } },
      { status: 500 }
    );
  }

  return NextResponse.json({ member: created }, { status: 201 });
};

export const GET = withErrorHandling(getHandler, 'team-members-get');
export const POST = withErrorHandling(postHandler, 'team-members-post');
