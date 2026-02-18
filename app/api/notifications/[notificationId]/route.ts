import { createServerSupabaseClient } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/server/with-error-handling';

// PATCH /api/notifications/[notificationId] - Mark notification as read
const patchHandler = async (
  request: NextRequest,
  { params }: { params: Promise<{ notificationId: string }> }
) => {
  const supabase = await createServerSupabaseClient();
  const { notificationId } = await params;
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
};

export const PATCH = withErrorHandling(patchHandler, 'notifications-by-id-patch');
