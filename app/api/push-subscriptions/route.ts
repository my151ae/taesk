import { createServerSupabaseClient } from '@/lib/supabase';
import { createServiceRoleSupabaseClient } from '@/lib/server/supabaseAdmin';
import { NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/server/with-error-handling';

/**
 * POST /api/push-subscriptions
 * Save or update a push subscription for the authenticated user
 */
const postHandler = async (request: Request) => {
  const supabase = await createServerSupabaseClient();
  const admin = createServiceRoleSupabaseClient();

  // Get authenticated user
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { subscription } = await request.json();

  if (!subscription || !subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
    return NextResponse.json({ error: 'Invalid subscription data' }, { status: 400 });
  }

  // Extract keys from subscription
  const { endpoint, keys } = subscription;
  const { p256dh, auth } = keys;

  // Get user agent
  const userAgent = request.headers.get('user-agent') || 'Unknown';
  const updatedAt = new Date().toISOString();

  const { data: existing, error: existingError } = await admin
    .from('push_subscriptions')
    .select('id, profile_id, p256dh, auth')
    .eq('endpoint', endpoint)
    .maybeSingle();

  if (existingError) {
    console.error('Error checking existing push subscription:', existingError);
    return NextResponse.json(
      { error: 'Failed to save push subscription' },
      { status: 500 }
    );
  }

  if (existing && existing.profile_id !== user.id) {
    const sameKeys = existing.p256dh === p256dh && existing.auth === auth;
    if (!sameKeys) {
      console.warn('Push endpoint conflict with mismatched keys:', {
        endpoint,
        currentProfileId: user.id,
        existingProfileId: existing.profile_id,
      });
      return NextResponse.json(
        { error: 'Push endpoint conflict' },
        { status: 409 }
      );
    }
  }

  // Save using service-role to allow endpoint ownership transfer across account switch on same device.
  const { data, error } = await admin
    .from('push_subscriptions')
    .upsert(
      {
        profile_id: user.id,
        endpoint,
        p256dh,
        auth,
        user_agent: userAgent,
        updated_at: updatedAt,
      },
      {
        onConflict: 'endpoint',
      }
    )
    .select()
    .single();

  if (error) {
    console.error('Error saving push subscription:', error);
    return NextResponse.json(
      { error: 'Failed to save push subscription' },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, data });
};

/**
 * DELETE /api/push-subscriptions
 * Delete a push subscription by endpoint
 */
const deleteHandler = async (request: Request) => {
  const supabase = await createServerSupabaseClient();

  // Get authenticated user
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { endpoint } = await request.json();

  if (!endpoint) {
    return NextResponse.json({ error: 'Endpoint is required' }, { status: 400 });
  }

  // Delete subscription
  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('profile_id', user.id)
    .eq('endpoint', endpoint);

  if (error) {
    console.error('Error deleting push subscription:', error);
    return NextResponse.json(
      { error: 'Failed to delete push subscription' },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
};

/**
 * GET /api/push-subscriptions
 * Get all push subscriptions for the authenticated user
 */
const getHandler = async () => {
  const supabase = await createServerSupabaseClient();

  // Get authenticated user
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get all subscriptions for this user
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('profile_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching push subscriptions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch push subscriptions' },
      { status: 500 }
    );
  }

  return NextResponse.json({ subscriptions: data });
};

export const POST = withErrorHandling(postHandler, 'push-subscriptions-post');
export const DELETE = withErrorHandling(deleteHandler, 'push-subscriptions-delete');
export const GET = withErrorHandling(getHandler, 'push-subscriptions-get');
