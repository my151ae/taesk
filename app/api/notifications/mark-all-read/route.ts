import { createServerSupabaseClient } from '@/lib/supabase';
import { NextResponse } from 'next/server';

/**
 * POST /api/notifications/mark-all-read
 * Marks all notifications as read for the authenticated user
 */
export async function POST() {
  try {
    const supabase = await createServerSupabaseClient();

    // Get authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Mark all unread notifications as read
    const { error: updateError } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('recipient_id', user.id)
      .is('read_at', null);

    if (updateError) {
      console.error('Error marking all notifications as read:', updateError);
      return NextResponse.json(
        { error: 'Failed to mark notifications as read' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Unexpected error in mark-all-read:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
