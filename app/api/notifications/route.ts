import { createServerSupabaseClient } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';
import { Notification } from '@/lib/supabase';

// GET /api/notifications - List notifications for current user
export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch notifications
    const { data: notifications, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('recipient_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('Error fetching notifications:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ notifications: notifications || [] });
  } catch (error) {
    console.error('Unexpected error in GET /api/notifications:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/notifications - Create a notification
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { recipient_id, type, payload } = body as {
      recipient_id: string;
      type: string;
      payload: Record<string, unknown>;
    };

    if (!recipient_id || !type || !payload) {
      return NextResponse.json(
        { error: 'recipient_id, type, and payload are required' },
        { status: 400 }
      );
    }

    if (recipient_id !== user.id) {
      return NextResponse.json(
        { error: 'Cannot create notifications for other users' },
        { status: 403 }
      );
    }

    // Insert notification
    const { data: notification, error } = await supabase
      .from('notifications')
      .insert({
        recipient_id,
        type,
        payload,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating notification:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ notification }, { status: 201 });
  } catch (error) {
    console.error('Unexpected error in POST /api/notifications:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
