import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createServerSupabaseClient } from '@/lib/supabase';
import type { NotificationPreferences, QuietHoursPreference } from '@/lib/supabase';
import { withErrorHandling } from '@/lib/server/with-error-handling';

const TimePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

const QuietHoursSchema = z.object({
  start: z.string().regex(TimePattern, 'Invalid start time'),
  end: z.string().regex(TimePattern, 'Invalid end time'),
  timezone: z.string().min(1, 'Timezone is required'),
});

const PreferencesSchema = z.object({
  in_app_enabled: z.boolean().optional(),
  web_push_enabled: z.boolean().optional(),
  quiet_hours: QuietHoursSchema.nullable().optional(),
});

function buildDefaultPreferences(profileId: string): NotificationPreferences {
  return {
    profile_id: profileId,
    in_app_enabled: true,
    web_push_enabled: false,
    quiet_hours: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

const getHandler = async () => {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('notification_preferences')
    .select('*')
    .eq('profile_id', user.id)
    .maybeSingle();

  if (error) {
    console.error('Failed to fetch notification preferences:', error);
    return NextResponse.json({ error: 'Failed to load preferences' }, { status: 500 });
  }

  const preferences = data ?? buildDefaultPreferences(user.id);

  return NextResponse.json(preferences, { status: 200 });
};

const putHandler = async (request: Request) => {
  const supabase = await createServerSupabaseClient();
  const body = await request.json().catch(() => null);

  const parsed = PreferencesSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: existing } = await supabase
    .from('notification_preferences')
    .select('*')
    .eq('profile_id', user.id)
    .maybeSingle();

  const current = existing ?? buildDefaultPreferences(user.id);
  const payload = parsed.data;

  const nextPreferences = {
    profile_id: user.id,
    in_app_enabled:
      payload.in_app_enabled !== undefined ? payload.in_app_enabled : current.in_app_enabled,
    web_push_enabled:
      payload.web_push_enabled !== undefined ? payload.web_push_enabled : current.web_push_enabled,
    quiet_hours:
      payload.quiet_hours !== undefined
        ? (payload.quiet_hours as QuietHoursPreference | null)
        : (current.quiet_hours as QuietHoursPreference | null),
  };

  const { data: updated, error } = await supabase
    .from('notification_preferences')
    .upsert(nextPreferences, { onConflict: 'profile_id' })
    .select('*')
    .single();

  if (error) {
    console.error('Failed to update notification preferences:', error);
    return NextResponse.json(
      { error: 'Failed to update preferences', details: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json(updated, { status: 200 });
};

export const GET = withErrorHandling(getHandler, 'notifications-preferences-get');
export const PUT = withErrorHandling(putHandler, 'notifications-preferences-put');
