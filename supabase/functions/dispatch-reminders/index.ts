import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type ReminderRow = {
  id: string;
  card_id: string;
  board_id: string;
  recipient_id: string;
  reminder_kind: 'start' | 'end';
  remind_minutes: 0 | 5 | 10 | 15 | 30 | 60;
  due_at: string;
  target_at: string;
  attempts: number;
  config_version: string;
  dedupe_key: string;
  payload: Record<string, unknown> | null;
};

type QuietHoursPreference = {
  start: string;
  end: string;
  timezone: string;
};

function parseIntEnv(name: string, fallback: number): number {
  const value = Deno.env.get(name);
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toMillis(value: string | null | undefined): number {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function isWithinQuietHours(quietHours: QuietHoursPreference, referenceDate: Date = new Date()): boolean {
  try {
    if (!quietHours.start || !quietHours.end || !quietHours.timezone) {
      return false;
    }

    const formatter = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: quietHours.timezone,
    });

    const userTime = formatter.format(referenceDate);
    const [hours, minutes] = userTime.split(':').map(Number);
    const currentMinutes = hours * 60 + minutes;

    const [startHours, startMinutes] = quietHours.start.split(':').map(Number);
    const [endHours, endMinutes] = quietHours.end.split(':').map(Number);
    const startTotal = startHours * 60 + startMinutes;
    const endTotal = endHours * 60 + endMinutes;

    if (Number.isNaN(startTotal) || Number.isNaN(endTotal)) {
      return false;
    }

    if (startTotal > endTotal) {
      return currentMinutes >= startTotal || currentMinutes < endTotal;
    }

    return currentMinutes >= startTotal && currentMinutes < endTotal;
  } catch (error) {
    console.error('[dispatch-reminders] quiet hours evaluation error', error);
    return false;
  }
}

function buildMessage(cardTitle: string, reminderKind: 'start' | 'end', minutes: number): string {
  const kindLabel = reminderKind === 'start' ? '開始' : '終了';
  if (minutes === 0) {
    return `「${cardTitle || 'Untitled'}」の${kindLabel}時刻です`;
  }
  return `「${cardTitle || 'Untitled'}」の${kindLabel}${minutes}分前です`;
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

    const batchSize = parseIntEnv('REMINDER_BATCH_SIZE', 100);
    const maxAttempts = parseIntEnv('REMINDER_MAX_ATTEMPTS', 5);
    const maxRuntimeMs = parseIntEnv('REMINDER_MAX_RUNTIME_MS', 45000);

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

    const startedAt = Date.now();

    const { data: claimed, error: claimError } = await supabase
      .rpc('claim_reminders', { p_batch_size: batchSize });

    if (claimError) {
      console.error('[dispatch-reminders] claim failed', claimError);
      return new Response(JSON.stringify({ error: 'claim_failed', details: claimError.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const reminders = (claimed ?? []) as ReminderRow[];
    if (reminders.length === 0) {
      return new Response(JSON.stringify({ success: true, claimed: 0, processed: 0 }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const counters = {
      processed: 0,
      skipped: 0,
      canceled: 0,
      failed: 0,
    };

    for (const reminder of reminders) {
      if (Date.now() - startedAt > maxRuntimeMs) {
        break;
      }

      const finalize = async (status: 'processed' | 'skipped' | 'canceled' | 'failed' | 'pending', opts?: {
        lastError?: string | null;
        nextRetryAt?: string | null;
        attempts?: number;
      }) => {
        await supabase
          .from('reminders_queue')
          .update({
            status,
            processing_started_at: null,
            last_error: opts?.lastError ?? null,
            next_retry_at: opts?.nextRetryAt ?? null,
            attempts: opts?.attempts ?? reminder.attempts,
            updated_at: new Date().toISOString(),
          })
          .eq('id', reminder.id)
          .eq('status', 'processing');
      };

      const { data: card, error: cardError } = await supabase
        .from('cards')
        .select('id, board_id, title, short_id, slug, updated_at')
        .eq('id', reminder.card_id)
        .maybeSingle();

      if (cardError) {
        const attempts = reminder.attempts + 1;
        const shouldFail = attempts >= maxAttempts;
        const retryMinutes = Math.min(30, Math.pow(2, Math.max(0, attempts - 1)));
        await finalize(shouldFail ? 'failed' : 'pending', {
          attempts,
          lastError: `card_fetch_failed:${cardError.message}`,
          nextRetryAt: shouldFail ? null : new Date(Date.now() + retryMinutes * 60_000).toISOString(),
        });
        counters.failed += shouldFail ? 1 : 0;
        continue;
      }

      if (!card) {
        await finalize('canceled', { lastError: 'card_not_found' });
        counters.canceled += 1;
        continue;
      }

      if (toMillis(card.updated_at) !== toMillis(reminder.config_version)) {
        await finalize('canceled', { lastError: 'config_version_mismatch' });
        counters.canceled += 1;
        continue;
      }

      const { data: prefs, error: prefsError } = await supabase
        .from('notification_preferences')
        .select('in_app_enabled, quiet_hours')
        .eq('profile_id', reminder.recipient_id)
        .maybeSingle();

      if (prefsError) {
        const attempts = reminder.attempts + 1;
        const shouldFail = attempts >= maxAttempts;
        const retryMinutes = Math.min(30, Math.pow(2, Math.max(0, attempts - 1)));
        await finalize(shouldFail ? 'failed' : 'pending', {
          attempts,
          lastError: `prefs_fetch_failed:${prefsError.message}`,
          nextRetryAt: shouldFail ? null : new Date(Date.now() + retryMinutes * 60_000).toISOString(),
        });
        counters.failed += shouldFail ? 1 : 0;
        continue;
      }

      if (prefs && prefs.in_app_enabled === false) {
        await finalize('skipped', { lastError: 'in_app_disabled' });
        counters.skipped += 1;
        continue;
      }

      if (
        prefs?.quiet_hours &&
        isWithinQuietHours(prefs.quiet_hours as QuietHoursPreference)
      ) {
        await finalize('skipped', { lastError: 'quiet_hours' });
        counters.skipped += 1;
        continue;
      }

      const message = buildMessage(card.title ?? 'Untitled', reminder.reminder_kind, reminder.remind_minutes);
      const payload = {
        message,
        card_id: reminder.card_id,
        card_short_id: card.short_id ?? null,
        card_slug: card.slug ?? null,
        board_id: reminder.board_id,
        reminder_kind: reminder.reminder_kind,
        remind_minutes: reminder.remind_minutes,
        due_at: reminder.due_at,
        target_at: reminder.target_at,
      };

      const { error: insertError } = await supabase
        .from('notifications')
        .insert({
          recipient_id: reminder.recipient_id,
          type: 'due_soon',
          payload,
          dedupe_key: reminder.dedupe_key,
        });

      if (!insertError || insertError.code === '23505') {
        await finalize('processed', {
          lastError: insertError?.code === '23505' ? 'duplicate' : null,
          nextRetryAt: null,
          attempts: reminder.attempts,
        });
        counters.processed += 1;
        continue;
      }

      const nextAttempts = reminder.attempts + 1;
      const shouldFail = nextAttempts >= maxAttempts;
      const retryMinutes = Math.min(30, Math.pow(2, Math.max(0, nextAttempts - 1)));
      await finalize(shouldFail ? 'failed' : 'pending', {
        attempts: nextAttempts,
        lastError: `notification_insert_failed:${insertError.message}`,
        nextRetryAt: shouldFail ? null : new Date(Date.now() + retryMinutes * 60_000).toISOString(),
      });
      counters.failed += shouldFail ? 1 : 0;
    }

    return new Response(
      JSON.stringify({
        success: true,
        claimed: reminders.length,
        ...counters,
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('[dispatch-reminders] unexpected error', error);
    return new Response(JSON.stringify({ error: 'unexpected_error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
