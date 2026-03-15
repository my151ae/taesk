import { NextResponse } from 'next/server';

import { createServerSupabaseClient } from '@/lib/supabase';
import { withErrorHandling } from '@/lib/server/with-error-handling';

const getHandler = async () => {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ user: null }, { status: 200 });
  }

  return NextResponse.json(
    {
      user: {
        id: user.id,
        email: user.email ?? null,
      },
    },
    { status: 200 }
  );
};

export const GET = withErrorHandling(getHandler, 'auth-session-get');
