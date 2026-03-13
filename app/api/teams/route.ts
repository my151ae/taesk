import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { slugifyBoardName } from '@/lib/board-utils';
import { createServerSupabaseClient, type TeamRole, type TeamView } from '@/lib/supabase';
import { requireAuthenticatedUser, validateMutationRequestOrigin } from '@/lib/server/api-security';
import { createServiceRoleSupabaseClient } from '@/lib/server/supabaseAdmin';
import { withErrorHandling } from '@/lib/server/with-error-handling';

const CreateTeamSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(255).optional(),
  allow_member_create_board: z.boolean().optional(),
});

type TeamRow = Pick<TeamView, 'id' | 'name' | 'slug' | 'allow_member_create_board' | 'created_at' | 'updated_at'>;

function toTeamView(team: TeamRow, role: TeamRole): TeamView {
  return {
    id: team.id,
    name: team.name,
    slug: team.slug,
    role,
    allow_member_create_board: team.allow_member_create_board,
    created_at: team.created_at,
    updated_at: team.updated_at,
  };
}

async function createUniqueTeamSlug(baseName: string, fallbackSlug?: string): Promise<string> {
  const admin = createServiceRoleSupabaseClient();
  const initial = (fallbackSlug && fallbackSlug.trim()) || slugifyBoardName(baseName) || 'team';
  let candidate = initial;

  for (let i = 0; i < 50; i += 1) {
    const { data, error } = await admin
      .from('teams')
      .select('id')
      .eq('slug', candidate)
      .limit(1);

    if (error) {
      throw new Error(error.message);
    }

    if (!data || data.length === 0) {
      return candidate;
    }

    candidate = `${initial}-${i + 2}`;
  }

  throw new Error('Failed to generate unique team slug');
}

const getHandler = async () => {
  const supabase = await createServerSupabaseClient();
  const { user, errorResponse } = await requireAuthenticatedUser(supabase);
  if (errorResponse || !user) {
    return errorResponse ?? NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Login required' } },
      { status: 401 }
    );
  }

  const { data: memberships, error: membershipError } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('profile_id', user.id);

  if (membershipError) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: membershipError.message } },
      { status: 500 }
    );
  }

  if (!memberships || memberships.length === 0) {
    return NextResponse.json({ teams: [] }, { status: 200 });
  }

  const teamIds = Array.from(new Set(memberships.map((m) => m.team_id)));
  const roleByTeamId = new Map(memberships.map((m) => [m.team_id, m.role]));

  const { data: teams, error: teamsError } = await supabase
    .from('teams')
    .select('id, name, slug, allow_member_create_board, created_at, updated_at')
    .in('id', teamIds)
    .order('created_at', { ascending: true });

  if (teamsError) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: teamsError.message } },
      { status: 500 }
    );
  }

  const normalized = ((teams as TeamRow[] | null) ?? []).map((team) =>
    toTeamView(team, roleByTeamId.get(team.id) ?? 'guest')
  );

  return NextResponse.json({ teams: normalized }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
};

const postHandler = async (request: NextRequest) => {
  const originError = validateMutationRequestOrigin(request);
  if (originError) {
    return originError;
  }

  const supabase = await createServerSupabaseClient();
  const { user, errorResponse } = await requireAuthenticatedUser(supabase);
  if (errorResponse || !user) {
    return errorResponse ?? NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Login required' } },
      { status: 401 }
    );
  }

  const body = await request.json();
  const parsed = CreateTeamSchema.safeParse(body);
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

  const slug = await createUniqueTeamSlug(parsed.data.name, parsed.data.slug);
  const admin = createServiceRoleSupabaseClient();

  const { data: team, error: teamError } = await admin
    .from('teams')
    .insert({
      name: parsed.data.name.trim(),
      slug,
      team_type: 'custom',
      allow_member_create_board: parsed.data.allow_member_create_board ?? false,
      created_by: user.id,
    })
    .select('id, name, slug, allow_member_create_board, created_at, updated_at')
    .single();

  if (teamError || !team) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: teamError?.message ?? 'Failed to create team' } },
      { status: 500 }
    );
  }

  const { error: ownerError } = await admin
    .from('team_members')
    .insert({
      team_id: team.id,
      profile_id: user.id,
      role: 'owner',
    });

  if (ownerError) {
    await admin.from('teams').delete().eq('id', team.id);
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: ownerError.message } },
      { status: 500 }
    );
  }

  return NextResponse.json({ team: toTeamView(team as TeamRow, 'owner') }, { status: 201 });
};

export const GET = withErrorHandling(getHandler, 'teams-get');
export const POST = withErrorHandling(postHandler, 'teams-post');
