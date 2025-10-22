import { NextResponse } from 'next/server';

import { createServerSupabaseClient } from '@/lib/supabase';

export async function POST() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { error } = await supabase
    .from('notifications')
    .insert({
      recipient_id: user.id,
      type: 'test',
      payload: {
        message: 'This is a test notification from Taesk',
        test: true,
      },
    });

  if (error) {
    console.error('Failed to create test notification:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
