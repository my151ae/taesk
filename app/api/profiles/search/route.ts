import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';

/**
 * GET /api/profiles/search?email={email}
 *
 * Search for a user profile by email address.
 * Returns profile if found, 404 if not.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get email from query params
    const searchParams = request.nextUrl.searchParams;
    const email = searchParams.get('email');

    if (!email) {
      return NextResponse.json({ error: 'Email parameter is required' }, { status: 400 });
    }

    // Search for profile by email
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, email, display_name, full_name, avatar_url')
      .eq('email', email.trim().toLowerCase())
      .maybeSingle();

    if (error) {
      console.error('Error searching profile:', error);
      return NextResponse.json({ error: 'Failed to search profile' }, { status: 500 });
    }

    if (!profile) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({ profile }, { status: 200 });
  } catch (error) {
    console.error('Unexpected error in GET /api/profiles/search:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
