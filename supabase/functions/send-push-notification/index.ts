/**
 * Supabase Edge Function: send-push-notification
 * Sends Web Push notifications to subscribed users
 *
 * This function is triggered by the notifications table insert
 * and sends push notifications to all subscribed devices.
 *
 * Prerequisites:
 * 1. Generate VAPID keys: npx web-push generate-vapid-keys
 * 2. Set environment variables in Supabase:
 *    - VAPID_PUBLIC_KEY
 *    - VAPID_PRIVATE_KEY
 *    - VAPID_SUBJECT (mailto:your-email@example.com or https://your-domain.com)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webPush from 'npm:web-push@3.6.7';
import { formatPushNotificationCopy } from '../../../lib/shared/notification-push.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface NotificationPayload {
  notification_id: string;
  recipient_id: string;
  type: string;
  payload: {
    message: string;
    card_id?: string;
    card_short_id?: string;
    card_slug?: string;
    board_id?: string;
    board_short_id?: string;
    board_slug?: string;
    board_name?: string;
    today_count?: number;
    overdue_count?: number;
    top_items?: Array<{ title?: string }>;
    manual_test?: boolean;
  };
}

interface QuietHoursPreference {
  start: string;
  end: string;
  timezone: string;
}

type SubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  failure_count?: number | null;
};

function dedupeSubscriptionsByUserAgent(subscriptions: SubscriptionRow[]): SubscriptionRow[] {
  const toMillis = (value: string | null | undefined) => {
    if (!value) return 0;
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : 0;
  };

  const sorted = [...subscriptions].sort((left, right) => {
    const leftTs = Math.max(toMillis(left.updated_at), toMillis(left.created_at));
    const rightTs = Math.max(toMillis(right.updated_at), toMillis(right.created_at));
    return rightTs - leftTs;
  });

  const seenKeys = new Set<string>();
  const deduped: SubscriptionRow[] = [];

  for (const subscription of sorted) {
    const normalizedUa = (subscription.user_agent ?? '').trim();
    const key = normalizedUa.length > 0 ? `ua:${normalizedUa}` : `endpoint:${subscription.endpoint}`;
    if (seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);
    deduped.push(subscription);
  }

  return deduped;
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
    console.error('Error evaluating quiet hours:', error);
    return false;
  }
}

/**
 * Send Web Push notification using web-push compatible API
 */
interface WebPushResult {
  success: boolean;
  statusCode?: number;
  error?: string;
}

async function sendWebPush(
  subscription: {
    endpoint: string;
    p256dh: string;
    auth: string;
  },
  payload: string,
  vapidDetails: {
    publicKey: string;
    privateKey: string;
    subject: string;
  }
): Promise<WebPushResult> {
  try {
    const response = await webPush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
      },
      payload,
      {
        vapidDetails: {
          subject: vapidDetails.subject,
          publicKey: vapidDetails.publicKey,
          privateKey: vapidDetails.privateKey,
        },
        TTL: 60,
      },
    );

    const statusCode = typeof response?.statusCode === 'number' ? response.statusCode : undefined;
    if (statusCode && statusCode >= 400) {
      return {
        success: false,
        statusCode,
        error: typeof response?.body === 'string' ? response.body : 'Push service responded with error',
      };
    }

    return { success: true, statusCode };
  } catch (error) {
    console.error('Error sending push notification:', error);
    const statusCode = typeof (error as { statusCode?: number }).statusCode === 'number'
      ? (error as { statusCode: number }).statusCode
      : undefined;
    const errorMessage = (error as { body?: string }).body
      || (error as { message?: string }).message
      || String(error);

    return {
      success: false,
      statusCode,
      error: errorMessage,
    };
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY');
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');
    const vapidSubject = Deno.env.get('VAPID_SUBJECT');

    // Check VAPID configuration
    if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
      console.warn('VAPID keys not configured. Push notifications disabled.');
      return new Response(
        JSON.stringify({
          success: false,
          error: 'VAPID keys not configured',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500,
        }
      );
    }

    webPush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse notification payload
    const notificationData: NotificationPayload = await req.json();

    console.log('Processing notification:', notificationData);

    const { data: recipientPrefs, error: prefsError } = await supabase
      .from('notification_preferences')
      .select('web_push_enabled, quiet_hours')
      .eq('profile_id', notificationData.recipient_id)
      .maybeSingle();

    if (prefsError) {
      console.error('Failed to load notification preferences:', prefsError);
    }

    if (!recipientPrefs || recipientPrefs.web_push_enabled !== true) {
      console.log('Web Push disabled for user:', notificationData.recipient_id);
      return new Response(
        JSON.stringify({ success: true, message: 'Web Push disabled' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (
      recipientPrefs.quiet_hours &&
      notificationData.payload.manual_test !== true &&
      isWithinQuietHours(recipientPrefs.quiet_hours as QuietHoursPreference)
    ) {
      console.log('Quiet hours active for user:', notificationData.recipient_id);
      return new Response(
        JSON.stringify({ success: true, message: 'Quiet hours active' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get all push subscriptions for the recipient
    const { data: subscriptions, error: subsError } = await supabase
      .from('push_subscriptions')
      .select('*')
      .eq('profile_id', notificationData.recipient_id);

    if (subsError) {
      console.error('Error fetching subscriptions:', subsError);
      throw subsError;
    }

    if (!subscriptions || subscriptions.length === 0) {
      console.log('No push subscriptions found for user:', notificationData.recipient_id);
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No subscriptions to send to',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Prepare push notification payload
    const pushCopy = formatPushNotificationCopy(notificationData.type, notificationData.payload);
    const pushPayload = JSON.stringify({
      title: pushCopy.title,
      body: pushCopy.body,
      icon: '/icon?size=192',
      badge: '/icon?size=192',
      tag: `notification-${notificationData.notification_id}`,
      data: {
        notification_id: notificationData.notification_id,
        type: notificationData.type,
        ...notificationData.payload,
      },
    });

    const targetSubscriptions = dedupeSubscriptionsByUserAgent(subscriptions as SubscriptionRow[]);
    const droppedDuplicateSubscriptions = Math.max(0, subscriptions.length - targetSubscriptions.length);
    const rateLimitPerMinute = parseInt(Deno.env.get('PUSH_RATE_LIMIT_PER_MINUTE') ?? '10', 10);
    const summary = { sent: 0, failed: 0, skipped: 0 };

    if (droppedDuplicateSubscriptions > 0) {
      console.log(
        `Deduped subscriptions for ${notificationData.recipient_id}: ${subscriptions.length} -> ${targetSubscriptions.length}`
      );
      summary.skipped += droppedDuplicateSubscriptions;
    }

    for (const sub of targetSubscriptions) {
      const subscriptionId = sub.id as string | undefined;
      if (!subscriptionId) {
        console.warn('Subscription without ID encountered, skipping');
        summary.skipped += 1;
        continue;
      }

      // Skip if this notification was already delivered to this subscription
      const { data: existingLog, error: existingLogError } = await supabase
        .from('notification_delivery_logs')
        .select('id')
        .eq('notification_id', notificationData.notification_id)
        .eq('subscription_id', subscriptionId)
        .maybeSingle();

      if (existingLogError) {
        console.error('Failed to check existing delivery log:', existingLogError);
      }

      if (existingLog) {
        console.log('Notification already delivered to subscription, skipping:', subscriptionId);
        summary.skipped += 1;
        continue;
      }

      // Rate limiting per subscription
      const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
      const { count: recentCount, error: recentError } = await supabase
        .from('notification_delivery_logs')
        .select('id', { count: 'exact', head: true })
        .eq('subscription_id', subscriptionId)
        .gte('created_at', oneMinuteAgo);

      if (recentError) {
        console.error('Failed to check rate limit:', recentError);
      }

      if ((recentCount ?? 0) >= rateLimitPerMinute) {
        console.log('Rate limit exceeded for subscription, skipping:', subscriptionId);
        summary.skipped += 1;
        await supabase.from('notification_delivery_logs').insert({
          notification_id: notificationData.notification_id,
          subscription_id: subscriptionId,
          status: 'retrying',
          error: 'rate_limit_exceeded',
        });
        continue;
      }

      const result = await sendWebPush(
        {
          endpoint: sub.endpoint,
          p256dh: sub.p256dh,
          auth: sub.auth,
        },
        pushPayload,
        {
          publicKey: vapidPublicKey,
          privateKey: vapidPrivateKey,
          subject: vapidSubject,
        }
      );

      if (result.success) {
        summary.sent += 1;
        await supabase.from('notification_delivery_logs').insert({
          notification_id: notificationData.notification_id,
          subscription_id: subscriptionId,
          status: 'success',
          error: null,
        });

        await supabase.from('push_subscriptions').update({
          last_sent_at: new Date().toISOString(),
          failure_count: 0,
        }).eq('id', subscriptionId);
      } else {
        summary.failed += 1;
        await supabase.from('notification_delivery_logs').insert({
          notification_id: notificationData.notification_id,
          subscription_id: subscriptionId,
          status: 'failure',
          error: result.error ?? null,
        });

        const currentFailureCount = typeof sub.failure_count === 'number' ? sub.failure_count : 0;
        const nextFailureCount = currentFailureCount + 1;
        const shouldRemove =
          result.statusCode === 410 ||
          result.statusCode === 404 ||
          nextFailureCount >= 5;

        if (shouldRemove) {
          console.log('Removing subscription due to repeated failures:', subscriptionId);
          await supabase
            .from('push_subscriptions')
            .delete()
            .eq('id', subscriptionId);
        } else {
          await supabase
            .from('push_subscriptions')
            .update({ failure_count: nextFailureCount })
            .eq('id', subscriptionId);
        }
      }
    }

    console.log(`Push notifications processed: ${summary.sent} sent, ${summary.failed} failed, ${summary.skipped} skipped`);

    return new Response(
      JSON.stringify({
        success: summary.failed === 0,
        ...summary,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error in send-push-notification function:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
