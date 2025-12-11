import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client for server-side-only operations (bypasses RLS).
 * Do not import this from client components.
 */
export function createServiceRoleSupabaseClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is required');
  }

  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
