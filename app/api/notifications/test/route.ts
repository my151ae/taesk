import { NextResponse } from 'next/server';

import { createServerSupabaseClient } from '@/lib/supabase';
import { createNotification } from '@/lib/server/notifications';

export async function POST() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await createNotification({
      recipientId: user.id,
      type: 'test',
      payload: {
        message: 'This is a test notification from Taesk',
        test: true,
      },
      dedupeKey: `test:${user.id}:${Date.now()}`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to create test notification:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create notification' },
      { status: 500 }
    );
  }
}
