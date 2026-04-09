import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  buildBoardTail,
  buildDigestItems,
  getDateTimeParts,
  getJstDate,
  type DailyDigestBoard,
  type DailyDigestSourceCard,
} from '../../../lib/shared/daily-digest.ts';
import { formatDailyDigestPushCopy } from '../../../lib/shared/notification-push.ts';

type DailyDigestPreferenceRow = {
  profile_id: string;
  board_id: string;
  enabled: boolean;
  delivery_time: string;
  timezone: string;
  include_overdue: boolean;
  notify_when_empty: boolean;
  last_sent_local_date: string | null;
};

type QuietHoursPreference = {
  start: string;
  end: string;
  timezone: string;
};

type CardRow = DailyDigestSourceCard & {
  updated_at: string;
};

type BoardRow = DailyDigestBoard;

function parseIntEnv(name: string, fallback: number): number {
  const value = Deno.env.get(name);
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getMinutesFromHHMM(value: string): number | null {
  const [hours, minutes] = value.split(':').map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function isWithinQuietHours(quietHours: QuietHoursPreference, referenceDate: Date = new Date()): boolean {
  try {
    if (!quietHours.start || !quietHours.end || !quietHours.timezone) {
      return false;
    }

    const currentMinutes = getMinutesFromHHMM(getDateTimeParts(referenceDate, quietHours.timezone).hhmm);
    const startTotal = getMinutesFromHHMM(quietHours.start);
    const endTotal = getMinutesFromHHMM(quietHours.end);

    if (currentMinutes === null || startTotal === null || endTotal === null) {
      return false;
    }

    if (startTotal > endTotal) {
      return currentMinutes >= startTotal || currentMinutes < endTotal;
    }

    return currentMinutes >= startTotal && currentMinutes < endTotal;
  } catch (error) {
    console.error('[dispatch-daily-digests] quiet hours evaluation error', error);
    return false;
  }
}

function shouldDispatchNow(deliveryTime: string, timezone: string, now: Date, windowMinutes: number): {
  matches: boolean;
  localDate: string;
} {
  const local = getDateTimeParts(now, timezone);
  const currentMinutes = getMinutesFromHHMM(local.hhmm);
  const targetMinutes = getMinutesFromHHMM(deliveryTime);

  if (currentMinutes === null || targetMinutes === null) {
    return { matches: false, localDate: local.date };
  }

  return {
    matches: currentMinutes >= targetMinutes && currentMinutes < targetMinutes + windowMinutes,
    localDate: local.date,
  };
}

async function markPreferenceProcessed(
  supabase: ReturnType<typeof createClient>,
  preference: DailyDigestPreferenceRow,
  localDate: string
) {
  const { error } = await supabase
    .from('daily_digest_preferences')
    .update({
      last_sent_local_date: localDate,
      updated_at: new Date().toISOString(),
    })
    .eq('profile_id', preference.profile_id)
    .eq('board_id', preference.board_id);

  if (error) {
    console.error('[dispatch-daily-digests] failed to update last_sent_local_date', error);
  }
}

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization');
    const cronSecretHeader = req.headers.get('X-Cron-Secret');
    const expectedCronSecretFromEnv = Deno.env.get('CRON_SECRET') || '';

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: 'Missing Supabase env' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let expectedCronSecret = expectedCronSecretFromEnv;
    if (!expectedCronSecret) {
      const { data: secretFromVault, error: secretError } = await supabase.rpc('get_cron_secret');
      if (secretError) {
        return new Response(JSON.stringify({ error: 'Failed to resolve CRON secret' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      expectedCronSecret = (secretFromVault as string | null) ?? '';
    }

    if (!expectedCronSecret || cronSecretHeader !== expectedCronSecret) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const now = new Date();
    const windowMinutes = parseIntEnv('DAILY_DIGEST_WINDOW_MINUTES', 5);
    const summaryDate = getJstDate(now);

    const { data: preferences, error: preferencesError } = await supabase
      .from('daily_digest_preferences')
      .select('*')
      .eq('enabled', true);

    if (preferencesError) {
      console.error('[dispatch-daily-digests] failed to load preferences', preferencesError);
      return new Response(JSON.stringify({ error: preferencesError.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const counters = {
      scanned: preferences?.length ?? 0,
      processed: 0,
      skipped: 0,
      quietHoursSkipped: 0,
      duplicates: 0,
    };

    for (const preference of (preferences ?? []) as DailyDigestPreferenceRow[]) {
      const dispatchWindow = shouldDispatchNow(preference.delivery_time, preference.timezone, now, windowMinutes);
      if (!dispatchWindow.matches) {
        continue;
      }

      if (preference.last_sent_local_date === dispatchWindow.localDate) {
        counters.skipped += 1;
        continue;
      }

      const { data: membership } = await supabase
        .from('board_members')
        .select('role')
        .eq('board_id', preference.board_id)
        .eq('profile_id', preference.profile_id)
        .maybeSingle();

      if (!membership) {
        counters.skipped += 1;
        continue;
      }

      const { data: notificationPreferences, error: notificationPreferencesError } = await supabase
        .from('notification_preferences')
        .select('in_app_enabled, quiet_hours')
        .eq('profile_id', preference.profile_id)
        .maybeSingle();

      if (notificationPreferencesError) {
        console.error('[dispatch-daily-digests] failed to load notification preferences', notificationPreferencesError);
        counters.skipped += 1;
        continue;
      }

      if (notificationPreferences?.in_app_enabled === false) {
        await markPreferenceProcessed(supabase, preference, dispatchWindow.localDate);
        counters.skipped += 1;
        continue;
      }

      if (
        notificationPreferences?.quiet_hours &&
        isWithinQuietHours(notificationPreferences.quiet_hours as QuietHoursPreference, now)
      ) {
        await markPreferenceProcessed(supabase, preference, dispatchWindow.localDate);
        counters.quietHoursSkipped += 1;
        continue;
      }

      const { data: board, error: boardError } = await supabase
        .from('boards')
        .select('id, name, short_id, id_short, slug')
        .eq('id', preference.board_id)
        .maybeSingle();

      if (boardError || !board) {
        console.error('[dispatch-daily-digests] failed to load board', boardError);
        counters.skipped += 1;
        continue;
      }

      const { data: cards, error: cardsError } = await supabase
        .from('cards')
        .select('id, title, due_date, due_start, due_end, updated_at, short_id, slug')
        .eq('board_id', preference.board_id)
        .is('deleted_at', null)
        .eq('checked', false)
        .not('due_date', 'is', null);

      if (cardsError) {
        console.error('[dispatch-daily-digests] failed to load cards', cardsError);
        counters.skipped += 1;
        continue;
      }

      const digestItems = buildDigestItems({
        cards: (cards ?? []) as CardRow[],
        summaryDate,
        includeOverdue: preference.include_overdue,
      });
      const todayCount = digestItems.filter((item) => item.kind === 'today').length;
      const overdueCount = digestItems.filter((item) => item.kind === 'overdue').length;
      const totalCount = digestItems.length;
      const boardInfo = board as BoardRow;
      const pushCopy = formatDailyDigestPushCopy({
        boardName: boardInfo.name,
        todayCount,
        overdueCount,
        topItemTitle: digestItems[0]?.title ?? '',
      });

      if (!preference.notify_when_empty && totalCount === 0) {
        await markPreferenceProcessed(supabase, preference, dispatchWindow.localDate);
        counters.skipped += 1;
        continue;
      }

      const payload = {
        message: pushCopy.body,
        board_id: boardInfo.id,
        board_name: boardInfo.name,
        board_short_id: boardInfo.short_id,
        board_slug: buildBoardTail(boardInfo),
        summary_date: summaryDate,
        today_count: todayCount,
        overdue_count: overdueCount,
        total_count: totalCount,
        top_items: digestItems.slice(0, 3),
      };

      const dedupeKey = `daily_digest:${preference.profile_id}:${preference.board_id}:${summaryDate}`;
      const { error: insertError } = await supabase
        .from('notifications')
        .insert({
          recipient_id: preference.profile_id,
          type: 'daily_digest',
          payload,
          dedupe_key: dedupeKey,
        });

      if (insertError && insertError.code !== '23505') {
        console.error('[dispatch-daily-digests] failed to insert notification', insertError);
        counters.skipped += 1;
        continue;
      }

      await markPreferenceProcessed(supabase, preference, dispatchWindow.localDate);
      if (insertError?.code === '23505') {
        counters.duplicates += 1;
      } else {
        counters.processed += 1;
      }
    }

    return new Response(JSON.stringify({ success: true, summaryDate, ...counters }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[dispatch-daily-digests] unexpected error', error);
    return new Response(JSON.stringify({ error: 'unexpected_error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
