import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertE2EEnabled } from '../guards';

/**
 * E2E Test User Creation Endpoint
 *
 * Creates a test user if it doesn't exist.
 * Requires E2E_ENABLED=true and correct x-e2e-secret header.
 * Uses SUPABASE_SERVICE_ROLE_KEY (never exposed to client).
 */
export async function POST(req: NextRequest) {
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
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    // Check if user already exists
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
    const existingUser = existingUsers.users?.find((u) => u.email === email);

    const MAIN_TEST_BOARD_ID = '00000000-0000-0000-0000-000000000001';

    if (existingUser) {
      console.log(`[E2E] User ${email} already exists, ensuring board membership`);

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
          console.error('[E2E] Failed to add existing user to test board:', memberError);
        } else {
          console.log(`[E2E] Added existing user ${email} as owner of test board`);
        }
      }

      return NextResponse.json({ created: false, exists: true }, { status: 200 });
    }

    // Create user with email confirmation pre-approved
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Skip email verification for test users
    });

    if (error) {
      console.error('[E2E] Failed to create user:', error);
      throw error;
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
      console.error('[E2E] Failed to add user to test board:', memberError);
      // Continue anyway - user was created successfully
    } else {
      console.log(`[E2E] Added user ${email} as owner of test board ${MAIN_TEST_BOARD_ID}`);
    }

    console.log(`[E2E] Created test user: ${email}`);
    return NextResponse.json(
      { created: true, user: { id: data.user.id, email: data.user.email } },
      { status: 201 }
    );
  } catch (e: any) {
    console.error('[E2E] ensure-user error:', e);
    return NextResponse.json(
      { error: String(e?.message || e) },
      { status: 401 }
    );
  }
}
