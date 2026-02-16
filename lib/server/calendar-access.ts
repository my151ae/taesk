import 'server-only';

import type { DueBucket, Priority } from '@/lib/supabase';
import { getBoardMembership, hasAnyRole } from '@/lib/server/api-security';
import { createServerSupabaseClient } from '@/lib/supabase';

export type ServerSupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

export type CalendarCardRecord = {
  id: string;
  board_id: string;
  due_date: string | null;
  due_start: string | null;
  due_end: string | null;
  title: string;
  excerpt: string | null;
  short_id: string | null;
  id_short: number | null;
  slug: string | null;
  due_bucket: DueBucket | null;
  due_bucket_position: number | null;
  priority: Priority | null;
  checked: boolean;
  duration: number | null;
};

async function findCardByIdOrShortId(
  supabase: ServerSupabaseClient,
  cardIdentifier: string
): Promise<CalendarCardRecord | null> {
  const { data, error } = await supabase
    .from('cards')
    .select('id, board_id, due_date, due_start, due_end, title, excerpt, short_id, id_short, slug, due_bucket, due_bucket_position, priority, checked, duration')
    .or(`id.eq.${cardIdentifier},short_id.eq.${cardIdentifier}`)
    .maybeSingle();

  if (error) throw error;
  return (data as CalendarCardRecord | null) ?? null;
}

export async function getAccessibleCardByIdOrShortId(
  supabase: ServerSupabaseClient,
  cardIdentifier: string,
  userId: string
): Promise<CalendarCardRecord | null> {
  const card = await findCardByIdOrShortId(supabase, cardIdentifier);
  if (!card) return null;

  const membership = await getBoardMembership(supabase, card.board_id, userId);
  if (!membership) return null;

  return card;
}

export async function requireBoardEditorRole(
  supabase: ServerSupabaseClient,
  boardId: string,
  userId: string
): Promise<boolean> {
  const membership = await getBoardMembership(supabase, boardId, userId);
  return Boolean(membership && hasAnyRole(membership.role, ['owner', 'editor']));
}
