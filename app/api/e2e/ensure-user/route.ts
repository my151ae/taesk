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
    const userExists = existingUsers.users?.some((u) => u.email === email);

    if (userExists) {
      console.log(`[E2E] User ${email} already exists, skipping creation`);
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
