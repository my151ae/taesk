import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

type CardRow = {
  id: string;
  title: string;
  due_date: string | null;
  due_start: string | null;
  due_end: string | null;
  updated_at: string;
  short_id: string | null;
  slug: string | null;
};

type BoardRow = {
  id: string;
  name: string;
  short_id: string | null;
  id_short: number | null;
  slug: string | null;
};

type DigestItem = {
  card_id: string;
  card_short_id: string | null;
  card_slug: string | null;
  title: string;
  due_date: string | null;
  due_start: string | null;
  due_end: string | null;
  kind: 'today' | 'overdue';
};

function parseIntEnv(name: string, fallback: number): number {
  const value = Deno.env.get(name);
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getDateTimeParts(value: Date | string, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(typeof value === 'string' ? new Date(value) : value);
  const lookup = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';

  return {
    year: lookup('year'),
    month: lookup('month'),
    day: lookup('day'),
    hour: lookup('hour'),
    minute: lookup('minute'),
    date: `${lookup('year')}-${lookup('month')}-${lookup('day')}`,
    hhmm: `${lookup('hour')}:${lookup('minute')}`,
  };
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

function getJstDate(value: string | Date): string {
  return getDateTimeParts(value instanceof Date ? value : new Date(value), 'Asia/Tokyo').date;
}

function buildBoardTail(board: BoardRow): string {
  const slug = typeof board.slug === 'string' ? board.slug.trim() : '';
  if (!slug) return '';
  return typeof board.id_short === 'number' ? `${board.id_short}-${slug}` : slug;
}

function buildItemSortKey(item: DigestItem): number {
  const kindPriority = item.kind === 'today' ? 0 : 2;
  const hasTime = item.due_start ? 0 : 1;
  return kindPriority + hasTime;
}

function compareDigestItems(a: DigestItem, b: DigestItem): number {
  const priorityDiff = buildItemSortKey(a) - buildItemSortKey(b);
  if (priorityDiff !== 0) return priorityDiff;

  const dueDateDiff = (a.due_date ?? '').localeCompare(b.due_date ?? '');
  if (dueDateDiff !== 0) return dueDateDiff;

  const startDiff = (a.due_start ?? '').localeCompare(b.due_start ?? '');
  if (startDiff !== 0) return startDiff;

  return a.card_id.localeCompare(b.card_id);
}

function buildMessage(todayCount: number, overdueCount: number, topItems: DigestItem[]): string {
  const summary = `今日 ${todayCount}件 / overdue ${overdueCount}件`;
  const firstItem = topItems[0];
  if (!firstItem || !firstItem.title.trim()) {
    return summary;
  }
  return `${summary} - ${firstItem.title.trim()}`;
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

      const digestItems = ((cards ?? []) as CardRow[])
        .map((card): DigestItem | null => {
          if (!card.due_date) return null;
          const dueDateJst = getJstDate(card.due_date);
          if (dueDateJst !== summaryDate && (!preference.include_overdue || dueDateJst >= summaryDate)) {
            return null;
          }

          if (dueDateJst > summaryDate) {
            return null;
          }

          return {
            card_id: card.id,
            card_short_id: card.short_id,
            card_slug: card.slug,
            title: card.title,
            due_date: dueDateJst,
            due_start: card.due_start,
            due_end: card.due_end,
            kind: dueDateJst === summaryDate ? 'today' : 'overdue',
          };
        })
        .filter((item): item is DigestItem => item !== null)
        .sort(compareDigestItems);

      const todayCount = digestItems.filter((item) => item.kind === 'today').length;
      const overdueCount = digestItems.filter((item) => item.kind === 'overdue').length;
      const totalCount = digestItems.length;

      if (!preference.notify_when_empty && totalCount === 0) {
        await markPreferenceProcessed(supabase, preference, dispatchWindow.localDate);
        counters.skipped += 1;
        continue;
      }

      const boardInfo = board as BoardRow;
      const payload = {
        message: buildMessage(todayCount, overdueCount, digestItems),
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
