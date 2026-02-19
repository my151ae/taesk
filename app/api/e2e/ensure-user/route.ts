import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertE2EEnabled } from '../guards';
import { errorResponse, ApiErrorCode } from '@/lib/server/api-error';
import { withErrorHandling } from '@/lib/server/with-error-handling';

type AdminUser = { id: string; email?: string | null };
type ListUsersResult = { users?: AdminUser[] };
type CreateUserResult = { user?: AdminUser | null };
type TeamRow = { id: string };

function isRetryableAuthError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const name = error.name.toLowerCase();
  const message = error.message.toLowerCase();
  return name.includes('retryable') || message.includes('fetch failed');
}

async function withAuthRetry<T>(operation: () => Promise<T>, retries = 2): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryableAuthError(error) || attempt === retries) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function findUserByEmail(
  supabaseAdmin: unknown,
  email: string
) {
  const adminApi = supabaseAdmin as {
    auth: {
      admin: {
        listUsers: (params: { page: number; perPage: number }) => Promise<{ data: ListUsersResult; error: unknown }>;
      };
    };
  };
  const normalizedEmail = email.trim().toLowerCase();
  const perPage = 200;
  const maxPages = 25;

  for (let page = 1; page <= maxPages; page += 1) {
    const { data, error } = await withAuthRetry<{ data: ListUsersResult; error: unknown }>(() =>
      adminApi.auth.admin.listUsers({
        page,
        perPage,
      })
    );

    if (error) {
      throw error;
    }

    const found = data.users?.find((u) => (u.email ?? '').toLowerCase() === normalizedEmail);
    if (found) {
      return found;
    }

    if (!data.users || data.users.length < perPage) {
      break;
    }
  }

  return null;
}

function getErrorDetails(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  if (error && typeof error === 'object') {
    const source = error as { code?: unknown; status?: unknown };
    return {
      code: typeof source.code === 'string' ? source.code : undefined,
      status: typeof source.status === 'number' ? source.status : undefined,
    };
  }
  return undefined;
}

function getOpsAdminUserId(): string | null {
  const ids = (process.env.ADMIN_USER_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return ids[0] ?? null;
}

async function ensureTestTeam(
  supabaseAdmin: any,
  ownerUserId: string
): Promise<string | null> {
  const admin = supabaseAdmin as any;
  const teamSlug = 'e2e-test-team';
  const { data: existing, error: existingError } = await admin
    .from('teams')
    .select('id')
    .eq('slug', teamSlug)
    .maybeSingle();

  if (existingError) {
    console.error('[E2E] failed to lookup Test Team', existingError);
    return null;
  }

  const teamId = (existing as TeamRow | null)?.id;
  if (teamId) {
    return teamId;
  }

  const { data: created, error: createError } = await admin
    .from('teams')
    .insert({
      name: 'Test Team',
      slug: teamSlug,
      team_type: 'test',
      allow_member_create_board: true,
      created_by: ownerUserId,
    })
    .select('id')
    .single();

  if (createError || !created) {
    console.error('[E2E] failed to create Test Team', createError);
    return null;
  }

  return (created as TeamRow).id;
}

async function ensureTeamMember(
  supabaseAdmin: any,
  teamId: string,
  profileId: string,
  role: 'owner' | 'admin' | 'member' | 'guest'
) {
  const admin = supabaseAdmin as any;
  const rank = { guest: 1, member: 2, admin: 3, owner: 4 } as const;
  const { data: existing, error: lookupError } = await admin
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('profile_id', profileId)
    .maybeSingle();

  if (lookupError) {
    console.error('[E2E] failed to lookup team member role', { teamId, profileId, role, error: lookupError });
    return;
  }

  const existingRole = existing?.role as keyof typeof rank | undefined;
  const nextRole = existingRole && rank[existingRole] > rank[role]
    ? existingRole
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
    console.error('[E2E] failed to ensure team member', { teamId, profileId, role, error });
  }
}

async function ensureBoardTeam(
  supabaseAdmin: any,
  boardId: string,
  teamId: string
) {
  const admin = supabaseAdmin as any;
  const { error } = await admin
    .from('boards')
    .update({ team_id: teamId })
    .eq('id', boardId);

  if (error) {
    console.error('[E2E] failed to set team_id for test board', { boardId, teamId, error });
  }
}

/**
 * E2E Test User Creation Endpoint
 *
 * Creates a test user if it doesn't exist.
 * Requires E2E_ENABLED=true and correct x-e2e-secret header.
 * Uses SUPABASE_SERVICE_ROLE_KEY (never exposed to client).
 */
const postHandler = async (req: NextRequest) => {
  try {
    // Guard: Only allow in E2E mode with correct secret
    assertE2EEnabled(req);

    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password required' },
        { status: 400 }
      );
    }

    // Create Supabase admin client with service role key
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    }

    const supabaseAdmin = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    // Check if user already exists
    const existingUser = await findUserByEmail(supabaseAdmin, email);

    const MAIN_TEST_BOARD_ID = '00000000-0000-0000-0000-000000000001';
    const opsAdminUserId = getOpsAdminUserId();

    if (existingUser) {
      console.log('[E2E] existing user found, syncing credentials and ensuring board membership');

      const { error: updateError } = await withAuthRetry<{ data: unknown; error: unknown }>(() =>
        supabaseAdmin.auth.admin.updateUserById(existingUser.id, {
          password,
          email_confirm: true,
        })
      );
      if (updateError) {
        console.error('[E2E] failed to sync existing user password');
        throw updateError;
      }

      // Ensure user is a member of the test board
      const { data: membership } = await supabaseAdmin
        .from('board_members')
        .select('role')
        .eq('board_id', MAIN_TEST_BOARD_ID)
        .eq('profile_id', existingUser.id)
        .maybeSingle();

      if (!membership) {
        const { error: memberError } = await supabaseAdmin
          .from('board_members')
          .insert({
            board_id: MAIN_TEST_BOARD_ID,
            profile_id: existingUser.id,
            role: 'owner',
          });

        if (memberError) {
          console.error('[E2E] failed to add existing user to test board');
        } else {
          console.log('[E2E] existing user added to test board');
        }
      }

      const teamOwnerId = opsAdminUserId ?? existingUser.id;
      const testTeamId = await ensureTestTeam(supabaseAdmin, teamOwnerId);
      if (testTeamId) {
        await ensureTeamMember(supabaseAdmin, testTeamId, existingUser.id, 'owner');
        if (opsAdminUserId) {
          await ensureTeamMember(supabaseAdmin, testTeamId, opsAdminUserId, 'admin');
        }
        await ensureBoardTeam(supabaseAdmin, MAIN_TEST_BOARD_ID, testTeamId);
      }

      return NextResponse.json({ created: false, exists: true }, { status: 200 });
    }

    // Create user with email confirmation pre-approved
    const { data, error } = await withAuthRetry<{ data: CreateUserResult; error: unknown }>(() =>
      supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // Skip email verification for test users
      })
    );

    if (error) {
      console.error('[E2E] failed to create user');
      throw error;
    }
    if (!data?.user) {
      throw new Error('No user returned from createUser');
    }

    // Add user as member of main test board
    const { error: memberError } = await supabaseAdmin
      .from('board_members')
      .insert({
        board_id: MAIN_TEST_BOARD_ID,
        profile_id: data.user.id,
        role: 'owner',
      });

    if (memberError) {
      console.error('[E2E] failed to add user to test board');
      // Continue anyway - user was created successfully
    } else {
      console.log('[E2E] new user added to test board');
    }

    const teamOwnerId = opsAdminUserId ?? data.user.id;
    const testTeamId = await ensureTestTeam(supabaseAdmin, teamOwnerId);
    if (testTeamId) {
      await ensureTeamMember(supabaseAdmin, testTeamId, data.user.id, 'owner');
      if (opsAdminUserId) {
        await ensureTeamMember(supabaseAdmin, testTeamId, opsAdminUserId, 'admin');
      }
      await ensureBoardTeam(supabaseAdmin, MAIN_TEST_BOARD_ID, testTeamId);
    }

    console.log('[E2E] test user created');
    return NextResponse.json(
      { created: true, user: { id: data.user.id, email: data.user.email } },
      { status: 201 }
    );
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'E2E_NOT_FOUND') {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Not found' } },
        { status: 404 }
      );
    }

    const status = typeof e === 'object' && e !== null && 'status' in e && typeof (e as { status?: unknown }).status === 'number'
      ? (e as { status: number }).status
      : null;
    if (status === 400 || status === 401 || status === 403) {
      console.error('[E2E] ensure-user authentication failed');
      return errorResponse(ApiErrorCode.UNAUTHENTICATED, 'Unauthorized', 401);
    }

    console.error('[E2E] ensure-user request failed', e);
    return errorResponse(
      ApiErrorCode.INTERNAL_ERROR,
      'Internal server error',
      500,
      getErrorDetails(e)
    );
  }
};

export const POST = withErrorHandling(postHandler, 'e2e-ensure-user-post');
