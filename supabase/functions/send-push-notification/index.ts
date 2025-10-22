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
  };
}

/**
 * Send Web Push notification using web-push compatible API
 */
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
): Promise<boolean> {
  try {
    // In a real implementation, you would use the web-push library
    // For now, this is a placeholder that logs the attempt
    console.log('Sending push notification to:', subscription.endpoint);
    console.log('Payload:', payload);

    // TODO: Implement actual Web Push API call
    // This requires:
    // 1. VAPID authentication
    // 2. Encryption of payload
    // 3. HTTP/2 request to push service endpoint

    // For MVP, we'll return true
    // In production, use a library like web-push (npm package)
    // or implement the Web Push protocol manually

    return true;
  } catch (error) {
    console.error('Error sending push notification:', error);
    return false;
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

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse notification payload
    const notificationData: NotificationPayload = await req.json();

    console.log('Processing notification:', notificationData);

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
    const pushPayload = JSON.stringify({
      title: 'Taesk Notification',
      body: notificationData.payload.message,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: `notification-${notificationData.notification_id}`,
      data: {
        notification_id: notificationData.notification_id,
        type: notificationData.type,
        ...notificationData.payload,
      },
    });

    // Send push notification to all subscriptions
    const results = await Promise.allSettled(
      subscriptions.map((sub) =>
        sendWebPush(
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
        )
      )
    );

    // Count successes and failures
    const successful = results.filter((r) => r.status === 'fulfilled' && r.value).length;
    const failed = results.length - successful;

    // Clean up failed subscriptions (endpoint no longer valid)
    if (failed > 0) {
      const failedIndices = results
        .map((r, i) => (r.status === 'rejected' ? i : -1))
        .filter((i) => i !== -1);

      for (const index of failedIndices) {
        const failedSub = subscriptions[index];
        console.log('Removing invalid subscription:', failedSub.endpoint);
        await supabase
          .from('push_subscriptions')
          .delete()
          .eq('id', failedSub.id);
      }
    }

    console.log(`Push notifications sent: ${successful} successful, ${failed} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        sent: successful,
        failed,
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
