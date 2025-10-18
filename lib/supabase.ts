import { createBrowserClient } from '@supabase/ssr';
import { createServerClient } from '@supabase/ssr';
import { type PostgrestError } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. Please check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY'
  );
}

// Legacy client for backwards compatibility (client-side only)
export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);

// Client factory function for use in client components
export function createClient() {
  return createBrowserClient(supabaseUrl!, supabaseAnonKey!);
}

// Server-side client factory for use in API routes and server components
export async function createServerSupabaseClient() {
  // Import cookies dynamically to avoid importing next/headers in client components
  const { cookies } = await import('next/headers');
  const cookieStore = await cookies();

  return createServerClient(
    supabaseUrl!,
    supabaseAnonKey!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    }
  );
}

// Database types
export interface Board {
  id: string;
  name: string;
  description?: string;
  is_test_board: boolean;
  user_id: string | null;
  short_id?: string | null;
  id_short?: number | null;
  slug?: string | null;
  created_at: string;
  updated_at: string;
}

export type Priority = 'low' | 'medium' | 'high';

export interface Card {
  id: string;
  title: string;
  description: string;
  list_id: string;
  board_id: string;
  position: number;
  user_id: string | null;
  tags: string[];
  due_date: string | null;
  priority: Priority;
  /** @deprecated legacy text-based assignee field */
  assigned_to: string | null;
  assignee_id: string | null;
  short_id: string | null;
  id_short: number | null;
  slug: string | null;
  created_at: string;
  updated_at: string;
}

export type CardUpsertPayload = Omit<Card, 'assignee_id'> & {
  assignee_id?: string | null;
};

export function sanitizeCardForUpload(card: Card, includeAssigneeId: boolean): CardUpsertPayload {
  const { assignee_id, ...rest } = card;
  const payload: CardUpsertPayload = {
    ...rest,
    assigned_to: card.assigned_to ?? null,
  };

  if (includeAssigneeId) {
    payload.assignee_id = assignee_id ?? null;
  }

  return payload;
}

export function sanitizeCardsForUpload(cards: Card[], includeAssigneeId: boolean): CardUpsertPayload[] {
  if (!cards.length) return [];
  return cards.map((card) => sanitizeCardForUpload(card, includeAssigneeId));
}

export function isAssigneeColumnMissing(error: PostgrestError | null | undefined): boolean {
  if (!error) return false;
  if (
    error.code !== 'PGRST204' &&
    error.code !== '42703'
  ) {
    return false;
  }
  return typeof error.message === 'string' && error.message.includes('assignee_id');
}

export interface ProfileSummary {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  email: string | null;
}

export interface List {
  id: string;
  title: string;
  position: number;
  board_id: string;
  user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface BoardData {
  lists: List[];
  cards: Card[];
}

export interface ActivityLog {
  id: string;
  board_id: string;
  user_id: string | null;
  action: 'created' | 'updated' | 'deleted' | 'moved';
  entity_type: 'card' | 'list';
  entity_id: string | null;
  entity_title: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

// Phase 3: Collaboration types

export type MemberRole = 'owner' | 'editor' | 'commenter' | 'viewer';

export interface BoardMember {
  board_id: string;
  profile_id: string;
  role: MemberRole;
  created_at: string;
}

export interface BoardInvite {
  id: string;
  board_id: string;
  email: string;
  role: MemberRole;
  token: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

export interface Comment {
  id: string;
  card_id: string;
  author_id: string;
  parent_id: string | null;
  body: string;
  mentions: string[];
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CommentWithAuthor extends Comment {
  author: ProfileSummary;
}

export type NotificationType = 'mention' | 'assignee_changed' | 'due_soon' | 'comment_reply';

export interface Notification {
  id: string;
  recipient_id: string;
  type: NotificationType;
  payload: {
    card_id?: string;
    comment_id?: string;
    message: string;
    [key: string]: unknown;
  };
  read_at: string | null;
  created_at: string;
}

export interface PushSubscription {
  id: string;
  profile_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: string;
}
