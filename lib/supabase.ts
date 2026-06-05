import { createBrowserClient } from '@supabase/ssr';
import { createServerClient } from '@supabase/ssr';
import { type PostgrestError } from '@supabase/supabase-js';
import type { JSONContent } from '@tiptap/react';
import type { Checklist } from './checklist';
import { normalizeChecklist } from './checklist';
import { normalizeContent } from './tiptap';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. Please check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY'
  );
}

// Legacy client for backwards compatibility (client-side only)
// NOTE: In browser runtimes, @supabase/ssr will use `document.cookie` automatically
// (including chunked cookies). Avoid overriding cookies here, or the session may not
// be readable and Realtime will behave as anonymous.
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
  team_id?: string | null;
  membership_role?: MemberRole;
  name: string;
  description?: string;
  is_personal?: boolean;
  is_test_board: boolean;
  user_id: string | null;
  short_id?: string | null;
  id_short?: number | null;
  slug?: string | null;
  day_range?: number;
  list_range?: number;
  list_window_before_days?: number;
  list_window_after_days?: number;
  created_at: string;
  updated_at: string;
}

export type DueBucket = 'a' | 'b';

export interface Card {
  id: string;
  title: string;
  parent_card_id?: string | null;
  parent_card?: {
    id: string;
    title: string;
    short_id: string | null;
    slug?: string | null;
  } | null;
  is_parent?: boolean;
  child_count?: number;
  checklist: Checklist | null;
  content: JSONContent;
  excerpt?: string | null;
  list_id: string;
  board_id: string;
  position: number;
  user_id: string | null;
  tags: string[];
  due_date: string | null;
  due_start: string | null;
  due_end: string | null;
  start_reminder_enabled: boolean;
  start_reminder_minutes: 0 | 5 | 10 | 15 | 30 | 60;
  end_reminder_enabled: boolean;
  end_reminder_minutes: 0 | 5 | 10 | 15 | 30 | 60;
  due_bucket: DueBucket | null;
  due_bucket_position: number | null;
  duration: number;
  checked: boolean;
  checked_at: string | null;
  /** @deprecated legacy text-based assignee field */
  assigned_to: string | null;
  assignee_id: string | null;
  assignee_ids: string[] | null;
  short_id: string | null;
  id_short: number | null;
  slug: string | null;
  deleted_at: string | null;
  purge_after_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CardContentHistory {
  id: string;
  card_id: string;
  board_id: string;
  content: JSONContent;
  excerpt: string;
  saved_by: string;
  created_at: string;
  saved_by_profile?: ProfileSummary | null;
}

export type CardContentHistoryMeta = Omit<CardContentHistory, 'content'>;

export interface CalendarSync {
  id: string;
  card_id: string;
  google_account_id: string;
  google_event_id: string | null;
  last_google_event_id: string | null;
  calendar_id: string;
  etag: string | null;
  status: "active" | "unlinked" | "deleted";
  last_synced_at: string | null;
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
    checklist: normalizeChecklist(card.checklist ?? null),
    assigned_to: card.assigned_to ?? null,
  };

  if (card.content !== undefined) {
    payload.content = normalizeContent(card.content);
  }

  if (card.excerpt !== undefined) {
    payload.excerpt = card.excerpt ?? null;
  }

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
  username: string | null;
  display_name: string | null;
  full_name: string | null;
  avatar_url: string | null;
  email: string | null;
  timeline_start_hour?: number;
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
  action: 'created' | 'updated' | 'deleted' | 'moved' | 'restored';
  entity_type: 'card' | 'list';
  entity_id: string | null;
  entity_title: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

// Phase 3: Collaboration types

export type MemberRole = 'owner' | 'editor' | 'commenter' | 'viewer';
export type TeamRole = 'owner' | 'admin' | 'member' | 'guest';
export type TeamType = 'personal' | 'ops' | 'test' | 'custom';

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
  email_normalized?: string | null;
  role: MemberRole;
  token_hash?: string | null;
  expires_at: string;
  accepted_at: string | null;
  revoked_at?: string | null;
  created_at: string;
}

export interface PendingBoardAccessInvite {
  id: string;
  team_id: string;
  board_id: string;
  team_invite_id: string | null;
  email: string;
  normalized_email: string;
  board_role: Exclude<MemberRole, 'owner'>;
  status: 'pending' | 'accepted' | 'revoked';
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
  expires_at?: string | null;
}

export interface Team {
  id: string;
  name: string;
  slug: string | null;
  team_type: TeamType;
  allow_member_create_board: boolean;
  personal_for_profile_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeamView {
  id: string;
  name: string;
  slug: string | null;
  role: TeamRole;
  allow_member_create_board: boolean;
  created_at: string;
  updated_at: string;
}

export interface TeamMember {
  team_id: string;
  profile_id: string;
  role: TeamRole;
  created_at: string;
}

export interface TeamInvite {
  id: string;
  team_id: string;
  email: string;
  email_normalized: string | null;
  role: Exclude<TeamRole, 'owner'>;
  token_hash: string | null;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Comment {
  id: string;
  card_id: string;
  author_id: string;
  parent_id: string | null;
  body: string;
  mentions: string[];
  idempotency_key?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CommentWithAuthor extends Comment {
  author: ProfileSummary;
}

export type NotificationType =
  | 'mention'
  | 'assignee_changed'
  | 'due_soon'
  | 'comment_reply'
  | 'comment_created'
  | 'comment_replied'
  | 'daily_digest'
  | 'test';

export interface DailyDigestTopItem {
  card_id: string;
  card_short_id: string | null;
  card_slug: string | null;
  title: string;
  due_date: string | null;
  due_start: string | null;
  due_end: string | null;
  kind: 'today' | 'overdue';
}

export interface Notification {
  id: string;
  recipient_id: string;
  type: NotificationType;
  payload: {
    card_id?: string;
    card_title?: string | null;
    comment_id?: string;
    message: string;
    comment_body?: string | null;
    card_short_id?: string | null;
    card_slug?: string | null;
    board_id?: string;
    board_name?: string | null;
    board_short_id?: string | null;
    board_slug?: string | null;
    summary_date?: string | null;
    today_count?: number;
    overdue_count?: number;
    total_count?: number;
    top_items?: DailyDigestTopItem[];
    change_summary?: string | null;
    time_change?: {
      field?: 'start' | 'end' | string;
      before?: string | null;
      after?: string | null;
    } | null;
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
  last_sent_at: string | null;
  failure_count: number | null;
}

export interface QuietHoursPreference {
  start: string; // HH:mm
  end: string;   // HH:mm
  timezone: string;
}

export interface NotificationPreferences {
  profile_id: string;
  in_app_enabled: boolean;
  web_push_enabled: boolean;
  quiet_hours: QuietHoursPreference | null;
  created_at: string;
  updated_at: string;
}

export interface DailyDigestPreferences {
  profile_id: string;
  board_id: string;
  enabled: boolean;
  delivery_time: string;
  timezone: string;
  include_overdue: boolean;
  notify_when_empty: boolean;
  last_sent_local_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface GoogleCalendarAccount {
  id: string;
  user_id: string;
  google_sub: string;
  email: string;
  access_token: string;
  refresh_token: string;
  scope: string;
  token_expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface GoogleCalendarPreference {
  id: string;
  user_id: string;
  google_account_id: string;
  selected_calendar_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface GoogleCalendarEventRecord {
  id: string;
  google_account_id: string;
  calendar_id: string;
  google_event_id: string;
  recurring_event_id: string | null;
  original_start_time: string | null;
  summary: string | null;
  description: string | null;
  location: string | null;
  status: string | null;
  is_all_day: boolean;
  display_tz: string | null;
  start_date: string | null;
  end_date: string | null;
  start_utc: string;
  end_utc: string;
  html_link: string | null;
  conference_data: Record<string, unknown> | null;
  attendees: Record<string, unknown>[] | null;
  raw: Record<string, unknown> | null;
  etag: string | null;
  updated_at_google: string | null;
  created_at: string;
  updated_at: string;
}

export interface GoogleCalendarSyncState {
  id: string;
  google_account_id: string;
  calendar_id: string;
  sync_token: string | null;
  last_full_sync_at: string | null;
  last_synced_at: string | null;
  window_start: string | null;
  window_end: string | null;
  watch_channel_id: string | null;
  watch_resource_id: string | null;
  watch_expiration: string | null;
  watch_status: string;
  polling_disabled_until: string | null;
  p95_ingest_latency_ms: number | null;
  last_watch_at: string | null;
  watch_checked_at: string | null;
  watch_ttl_seconds: number | null;
  last_poll_started_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface GoogleCalendarSyncLog {
  id: string;
  google_account_id: string;
  calendar_id: string | null;
  google_event_id: string | null;
  action: string;
  detail: Record<string, unknown> | null;
  channel_id?: string | null;
  message_number?: string | null;
  created_at: string;
}
