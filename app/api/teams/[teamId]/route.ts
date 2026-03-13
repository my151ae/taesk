import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { slugifyBoardName } from '@/lib/board-utils';
import { createServerSupabaseClient, type TeamRole, type TeamView } from '@/lib/supabase';
import { requireAuthenticatedUser, validateMutationRequestOrigin } from '@/lib/server/api-security';
import { hasAnyTeamRole } from '@/lib/server/team-security';
import { withErrorHandling } from '@/lib/server/with-error-handling';

const UpdateTeamSchema = z.object({
  name: z.string().min(1).max(255).optional(),
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

async function ensureUniqueSlug(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  baseName: string,
  teamId: string,
  requestedSlug?: string
): Promise<string> {
  const initial = (requestedSlug && requestedSlug.trim()) || slugifyBoardName(baseName) || 'team';
  let candidate = initial;

  for (let i = 0; i < 50; i += 1) {
    const { data, error } = await supabase
      .from('teams')
      .select('id')
      .eq('slug', candidate)
      .neq('id', teamId)
      .limit(1);

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return candidate;
    candidate = `${initial}-${i + 2}`;
  }

  throw new Error('Failed to generate unique team slug');
}

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

  const { data: membership } = await supabase
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('profile_id', user.id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Team not found' } },
      { status: 404 }
    );
  }

  const { data: team, error } = await supabase
    .from('teams')
    .select('id, name, slug, allow_member_create_board, created_at, updated_at')
    .eq('id', teamId)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: error.message } },
      { status: 500 }
    );
  }

  if (!team) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Team not found' } },
      { status: 404 }
    );
  }

  return NextResponse.json({ team: toTeamView(team as TeamRow, membership.role) }, { status: 200 });
};

const patchHandler = async (
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

  const { data: membership } = await supabase
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('profile_id', user.id)
    .maybeSingle();

  if (!membership || !hasAnyTeamRole(membership.role, ['owner', 'admin'])) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } },
      { status: 403 }
    );
  }

  const body = await request.json();
  const parsed = UpdateTeamSchema.safeParse(body);
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

  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ success: true }, { status: 200 });
  }

  const { data: existing, error: existingError } = await supabase
    .from('teams')
    .select('id, name')
    .eq('id', teamId)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: existingError.message } },
      { status: 500 }
    );
  }

  if (!existing) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Team not found' } },
      { status: 404 }
    );
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.name && parsed.data.name.trim()) {
    updates.name = parsed.data.name.trim();
  }
  if (typeof parsed.data.allow_member_create_board === 'boolean') {
    updates.allow_member_create_board = parsed.data.allow_member_create_board;
  }
  if (parsed.data.slug || parsed.data.name) {
    updates.slug = await ensureUniqueSlug(
      supabase,
      parsed.data.name?.trim() || existing.name,
      teamId,
      parsed.data.slug
    );
  }

  const { data: updated, error: updateError } = await supabase
    .from('teams')
    .update(updates)
    .eq('id', teamId)
    .select('id, name, slug, allow_member_create_board, created_at, updated_at')
    .single();

  if (updateError) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: updateError.message } },
      { status: 500 }
    );
  }

  return NextResponse.json({ team: toTeamView(updated as TeamRow, membership.role) }, { status: 200 });
};

export const GET = withErrorHandling(getHandler, 'team-by-id-get');
export const PATCH = withErrorHandling(patchHandler, 'team-by-id-patch');
