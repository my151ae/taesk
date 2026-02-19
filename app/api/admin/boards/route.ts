import { NextResponse } from 'next/server';

import { isAdminUser } from '@/lib/admins';
import { createServerSupabaseClient } from '@/lib/supabase';
import { createServiceRoleSupabaseClient } from '@/lib/server/supabaseAdmin';
import { requireAuthenticatedUser } from '@/lib/server/api-security';
import { withErrorHandling } from '@/lib/server/with-error-handling';

const getHandler = async () => {
  const supabase = await createServerSupabaseClient();
  const { user, errorResponse } = await requireAuthenticatedUser(supabase);
  if (errorResponse || !user) {
    return errorResponse ?? NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Login required' } },
      { status: 401 }
    );
  }

  if (!isAdminUser({ id: user.id, email: user.email })) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Admin only' } },
      { status: 403 }
    );
  }

  const adminClient = createServiceRoleSupabaseClient();
  const { data, error } = await adminClient
    .from('boards')
    .select('id, team_id, name, description, short_id, id_short, slug, is_test_board, day_range, list_range, created_at, updated_at')
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: error.message } },
      { status: 500 }
    );
  }

  return NextResponse.json({ boards: data ?? [] }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
};

export const GET = withErrorHandling(getHandler, 'admin-boards-get');
