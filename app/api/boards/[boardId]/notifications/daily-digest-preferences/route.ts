import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import type { DailyDigestPreferences } from '@/lib/supabase';
import { createServerSupabaseClient } from '@/lib/supabase';
import {
  getBoardMembership,
  requireAuthenticatedUser,
  validateMutationRequestOrigin,
} from '@/lib/server/api-security';
import { withErrorHandling } from '@/lib/server/with-error-handling';

const TimePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

const PreferencesSchema = z.object({
  enabled: z.boolean().optional(),
  delivery_time: z.string().regex(TimePattern, 'Invalid delivery time').optional(),
  timezone: z.string().min(1, 'Timezone is required').optional(),
});

function buildDefaultPreferences(profileId: string, boardId: string): DailyDigestPreferences {
  return {
    profile_id: profileId,
    board_id: boardId,
    enabled: false,
    delivery_time: '09:00',
    timezone: 'Asia/Tokyo',
    include_overdue: true,
    notify_when_empty: true,
    last_sent_local_date: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

const getHandler = async (
  _request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) => {
  const { boardId } = await params;
  const supabase = await createServerSupabaseClient();
  const { user, errorResponse } = await requireAuthenticatedUser(supabase);

  if (errorResponse || !user) {
    return errorResponse ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const membership = await getBoardMembership(supabase, boardId, user.id);
  if (!membership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data, error } = await supabase
    .from('daily_digest_preferences')
    .select('*')
    .eq('profile_id', user.id)
    .eq('board_id', boardId)
    .maybeSingle();

  if (error) {
    console.error('Failed to fetch daily digest preferences:', error);
    return NextResponse.json({ error: 'Failed to load preferences' }, { status: 500 });
  }

  return NextResponse.json(data ?? buildDefaultPreferences(user.id, boardId), { status: 200 });
};

const putHandler = async (
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) => {
  const originError = validateMutationRequestOrigin(request);
  if (originError) {
    return originError;
  }

  const { boardId } = await params;
  const supabase = await createServerSupabaseClient();
  const body = await request.json().catch(() => null);
  const parsed = PreferencesSchema.safeParse(body ?? {});

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const { user, errorResponse } = await requireAuthenticatedUser(supabase);
  if (errorResponse || !user) {
    return errorResponse ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const membership = await getBoardMembership(supabase, boardId, user.id);
  if (!membership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: existing, error: existingError } = await supabase
    .from('daily_digest_preferences')
    .select('*')
    .eq('profile_id', user.id)
    .eq('board_id', boardId)
    .maybeSingle();

  if (existingError) {
    console.error('Failed to fetch current daily digest preferences:', existingError);
    return NextResponse.json({ error: 'Failed to load preferences' }, { status: 500 });
  }

  const current = existing ?? buildDefaultPreferences(user.id, boardId);
  const payload = parsed.data;

  const nextPreferences = {
    profile_id: user.id,
    board_id: boardId,
    enabled: payload.enabled ?? current.enabled,
    delivery_time: payload.delivery_time ?? current.delivery_time,
    timezone: payload.timezone ?? current.timezone,
    include_overdue: current.include_overdue,
    notify_when_empty: current.notify_when_empty,
    last_sent_local_date: current.last_sent_local_date,
  };

  const { data: updated, error } = await supabase
    .from('daily_digest_preferences')
    .upsert(nextPreferences, { onConflict: 'profile_id,board_id' })
    .select('*')
    .single();

  if (error) {
    console.error('Failed to update daily digest preferences:', error);
    return NextResponse.json(
      { error: 'Failed to update preferences', details: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json(updated, { status: 200 });
};

export const GET = withErrorHandling(getHandler, 'board-daily-digest-preferences-get');
export const PUT = withErrorHandling(putHandler, 'board-daily-digest-preferences-put');
