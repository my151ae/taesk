import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import {
  normalizeUsername,
  isUsernameFormatValid,
  isNormalizedUsernameValid,
  isReservedUsername,
} from '@/lib/usernames';

/**
 * PATCH /api/profiles - Update current user's profile
 */
export async function PATCH(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  // Get current user
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Parse request body
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { display_name, full_name, avatar_url, username } = body;

  let sanitizedUsername: string | null | undefined = undefined;

  if (username !== undefined) {
    if (username === null) {
      sanitizedUsername = null;
    } else if (typeof username !== 'string') {
      return NextResponse.json({ error: 'username must be a string or null' }, { status: 400 });
    } else {
      const trimmed = username.trim();

      if (trimmed.length === 0) {
        sanitizedUsername = null;
      } else if (!isUsernameFormatValid(trimmed)) {
        return NextResponse.json({ error: 'Username must be 3-20 characters (alphanumeric + underscore)' }, { status: 400 });
      } else {
        const normalized = normalizeUsername(trimmed);

        if (!isNormalizedUsernameValid(normalized)) {
          return NextResponse.json({ error: 'Username must be 3-20 characters (alphanumeric + underscore)' }, { status: 400 });
        }

        if (isReservedUsername(normalized)) {
          return NextResponse.json({ error: 'This username is reserved' }, { status: 400 });
        }

        sanitizedUsername = normalized;
      }
    }
  }

  // Validate display_name (if provided)
  if (display_name !== undefined) {
    if (typeof display_name !== 'string') {
      return NextResponse.json({ error: 'display_name must be a string' }, { status: 400 });
    }
    if (display_name.trim().length === 0) {
      return NextResponse.json({ error: 'display_name cannot be empty' }, { status: 400 });
    }
    if (display_name.length > 100) {
      return NextResponse.json({ error: 'display_name must be 100 characters or less' }, { status: 400 });
    }
  }

  // Build update object
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (display_name !== undefined) {
    updates.display_name = display_name.trim();
  }
  if (full_name !== undefined) {
    updates.full_name = full_name;
  }
  if (avatar_url !== undefined) {
    updates.avatar_url = avatar_url;
  }
  if (sanitizedUsername !== undefined) {
    updates.username = sanitizedUsername;
  }

  if (sanitizedUsername) {
    const { data: existingUsername, error: usernameCheckError } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', sanitizedUsername)
      .neq('id', user.id)
      .maybeSingle();

    if (usernameCheckError) {
      console.error('Failed to check username availability:', usernameCheckError);
      return NextResponse.json({ error: 'Failed to validate username' }, { status: 500 });
    }

    if (existingUsername) {
      return NextResponse.json({ error: 'Username already taken' }, { status: 409 });
    }
  }

  // Update profile
  const { data: profile, error: updateError } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', user.id)
    .select('id, username, display_name, full_name, avatar_url, email, created_at, updated_at')
    .single();

  if (updateError) {
    if (updateError.code === '23505') {
      return NextResponse.json({ error: 'Username already taken' }, { status: 409 });
    }
    if (updateError.code === '23514') {
      return NextResponse.json({ error: 'Username must be 3-20 characters (alphanumeric + underscore)' }, { status: 400 });
    }
    console.error('Failed to update profile:', updateError);
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
  }

  // Sync display_name to user_metadata for immediate availability in useAuth
  if (display_name !== undefined) {
    const { error: authUpdateError } = await supabase.auth.updateUser({
      data: {
        full_name: display_name.trim(),
        name: display_name.trim(), // Some providers use 'name'
        display_name: display_name.trim(), // Custom field
      }
    });

    if (authUpdateError) {
      console.warn('Failed to sync display_name to user_metadata:', authUpdateError);
      // Non-critical error, continue
    }
  }

  return NextResponse.json(profile, { status: 200 });
}

/**
 * GET /api/profiles - Get current user's profile
 */
export async function GET() {
  const supabase = await createServerSupabaseClient();

  // Get current user
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get profile
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, full_name, avatar_url, email, created_at, updated_at')
    .eq('id', user.id)
    .single();

  if (error) {
    console.error('Failed to fetch profile:', error);
    return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 500 });
  }

  return NextResponse.json(profile, { status: 200 });
}
