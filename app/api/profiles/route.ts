import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';

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

  const { display_name, full_name, avatar_url } = body;

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

  // Update profile
  const { data: profile, error: updateError } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', user.id)
    .select()
    .single();

  if (updateError) {
    console.error('Failed to update profile:', updateError);
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
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
    .select('*')
    .eq('id', user.id)
    .single();

  if (error) {
    console.error('Failed to fetch profile:', error);
    return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 500 });
  }

  return NextResponse.json(profile, { status: 200 });
}
