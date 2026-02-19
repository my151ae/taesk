#!/usr/bin/env node
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

function normalizeSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '') || 'team';
}

async function ensureTeam(admin, payload) {
  const { data: existing, error: lookupError } = await admin
    .from('teams')
    .select('id')
    .eq('slug', payload.slug)
    .maybeSingle();

  if (lookupError) throw lookupError;
  if (existing?.id) return existing.id;

  const { data: created, error: createError } = await admin
    .from('teams')
    .insert(payload)
    .select('id')
    .single();

  if (createError || !created) {
    throw createError ?? new Error(`Failed to create team: ${payload.slug}`);
  }

  return created.id;
}

async function ensureTeamMember(admin, teamId, profileId, role) {
  const rank = { guest: 1, member: 2, admin: 3, owner: 4 };
  const { data: existing, error: lookupError } = await admin
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('profile_id', profileId)
    .maybeSingle();

  if (lookupError) {
    throw lookupError;
  }

  const nextRole = existing?.role && rank[existing.role] > rank[role]
    ? existing.role
    : role;

  const { error } = await admin
    .from('team_members')
    .upsert(
      {
        team_id: teamId,
        profile_id: profileId,
        role: nextRole,
      },
      { onConflict: 'team_id,profile_id', ignoreDuplicates: false }
    );

  if (error) {
    throw error;
  }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const opsOwnerId = process.env.OPS_OWNER_USER_ID;

  if (!url || !serviceRoleKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  if (!opsOwnerId) {
    throw new Error('OPS_OWNER_USER_ID is required');
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const opsTeamId = await ensureTeam(admin, {
    name: 'Ops Team',
    slug: 'ops-team',
    team_type: 'ops',
    allow_member_create_board: true,
    created_by: opsOwnerId,
  });
  await ensureTeamMember(admin, opsTeamId, opsOwnerId, 'owner');

  const { data: profiles, error: profilesError } = await admin
    .from('profiles')
    .select('id, username, display_name, full_name, email');
  if (profilesError) throw profilesError;

  for (const profile of profiles ?? []) {
    const baseName =
      profile.display_name ||
      profile.full_name ||
      (profile.email ? profile.email.split('@')[0] : null) ||
      profile.username ||
      `user-${profile.id.slice(0, 8)}`;

    const personalTeamId = await ensureTeam(admin, {
      name: `${baseName} Personal Team`,
      slug: `personal-${normalizeSlug(baseName)}-${profile.id.slice(0, 6)}`,
      team_type: 'personal',
      allow_member_create_board: true,
      personal_for_profile_id: profile.id,
      created_by: profile.id,
    });

    await ensureTeamMember(admin, personalTeamId, profile.id, 'owner');
  }

  const { error: boardsUpdateError } = await admin
    .from('boards')
    .update({ team_id: opsTeamId })
    .is('team_id', null);
  if (boardsUpdateError) throw boardsUpdateError;

  const { data: boardMembers, error: boardMembersError } = await admin
    .from('board_members')
    .select('board_id, profile_id');
  if (boardMembersError) throw boardMembersError;

  const boardIds = Array.from(new Set((boardMembers ?? []).map((bm) => bm.board_id)));
  if (boardIds.length > 0) {
    const { data: boards, error: boardsError } = await admin
      .from('boards')
      .select('id, team_id')
      .in('id', boardIds);
    if (boardsError) throw boardsError;

    const boardTeamMap = new Map((boards ?? []).map((b) => [b.id, b.team_id || opsTeamId]));

    for (const member of boardMembers ?? []) {
      const teamId = boardTeamMap.get(member.board_id) || opsTeamId;
      await ensureTeamMember(admin, teamId, member.profile_id, 'member');
    }
  }

  if (process.env.E2E_ENABLED === 'true') {
    const testTeamId = await ensureTeam(admin, {
      name: 'Test Team',
      slug: 'e2e-test-team',
      team_type: 'test',
      allow_member_create_board: true,
      created_by: opsOwnerId,
    });

    await ensureTeamMember(admin, testTeamId, opsOwnerId, 'admin');

    const mainTestBoardId = '00000000-0000-0000-0000-000000000001';
    await admin
      .from('boards')
      .update({ team_id: testTeamId })
      .eq('id', mainTestBoardId);
  }

  console.log('[setup-teams] complete');
}

main().catch((error) => {
  console.error('[setup-teams] failed', error);
  process.exit(1);
});
