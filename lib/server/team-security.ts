import { NextResponse } from 'next/server';

import type { TeamRole } from '@/lib/supabase';

import { createServerSupabaseClient } from '@/lib/supabase';
import { createServiceRoleSupabaseClient } from '@/lib/server/supabaseAdmin';

export type ServerSupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

export function hasAnyTeamRole(role: TeamRole | null | undefined, allowed: TeamRole[]): boolean {
  if (!role) return false;
  return allowed.includes(role);
}

export async function getTeamMembership(
  supabase: ServerSupabaseClient,
  teamId: string,
  userId: string
): Promise<{ role: TeamRole } | null> {
  const { data } = await supabase
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('profile_id', userId)
    .maybeSingle();

  return (data as { role: TeamRole } | null) ?? null;
}

export async function canCreateBoardInTeam(
  supabase: ServerSupabaseClient,
  teamId: string,
  userId: string
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const admin = createServiceRoleSupabaseClient();

  const { data: team, error: teamError } = await admin
    .from('teams')
    .select('id, allow_member_create_board')
    .eq('id', teamId)
    .maybeSingle();

  if (teamError) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: 'DB_ERROR', message: teamError.message } },
        { status: 500 }
      ),
    };
  }

  if (!team) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Team not found' } },
        { status: 404 }
      ),
    };
  }

  const { data: membership, error: membershipError } = await admin
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('profile_id', userId)
    .maybeSingle();

  if (membershipError) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: 'DB_ERROR', message: membershipError.message } },
        { status: 500 }
      ),
    };
  }

  if (!membership) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Not a team member' } },
        { status: 403 }
      ),
    };
  }

  if (membership.role === 'owner' || membership.role === 'admin') {
    return { ok: true };
  }

  if (membership.role === 'member' && Boolean(team.allow_member_create_board)) {
    return { ok: true };
  }

  return {
    ok: false,
    response: NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Insufficient team permissions' } },
      { status: 403 }
    ),
  };
}
