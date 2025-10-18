import { createServerSupabaseClient } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';

// PATCH /api/notifications/[notificationId] - Mark notification as read
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ notificationId: string }> }
) {
  const supabase = await createServerSupabaseClient();
  const { notificationId } = await params;

  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Mark as read
    const { data: notification, error } = await supabase
      .from('notifications')
      .update({
        read_at: new Date().toISOString(),
      })
      .eq('id', notificationId)
      .eq('recipient_id', user.id)
      .select()
      .single();

    if (error) {
      console.error('Error marking notification as read:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ notification });
  } catch (error) {
    console.error('Unexpected error in PATCH /api/notifications/[notificationId]:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
