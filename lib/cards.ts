import 'server-only';

import { createClient } from '@supabase/supabase-js';

import { buildReadableTail, toSlugBase } from './slug';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL is required');
}

if (!serviceRoleKey) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for server-side card lookups');
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

type CardRow = {
  id: string;
  short_id: string;
  id_short: number | null;
  title: string;
  slug: string | null;
  board_id: string;
  list_id: string;
  description: string | null;
  tags: string[] | null;
  due_date: string | null;
  priority: CardDetail['priority'] | null;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
};

export type CardDetail = {
  id: string;
  shortId: string;
  idShort?: number;
  title: string;
  slug: string;
  boardId: string;
  listId: string;
  description: string | null;
  tags: string[];
  dueDate: string | null;
  priority: 'low' | 'medium' | 'high';
  assignedTo: string | null;
  createdAt: string;
  updatedAt: string;
  permitted: boolean;
};

export const CARD_TAG_PREFIX = 'card:';

export async function getCardByShortId(shortId: string): Promise<CardDetail | null> {
  if (!shortId) return null;

  const { data, error } = await supabaseAdmin
    .from('cards')
    .select(
      [
        'id',
        'short_id',
        'id_short',
        'title',
        'slug',
        'board_id',
        'list_id',
        'description',
        'tags',
        'due_date',
        'priority',
        'assigned_to',
        'created_at',
        'updated_at',
      ].join(','),
    )
    .eq('short_id', shortId)
    .maybeSingle<CardRow>();

  if (error) {
    console.error('[cards] getCardByShortId failed', error);
    return null;
  }

  if (!data) {
    return null;
  }

  // Ensure slug exists even if legacy rows are missing it.
  const normalizedSlug = data.slug ?? toSlugBase(data.title);

  return {
    id: data.id,
    shortId: data.short_id,
    idShort: data.id_short ?? undefined,
    title: data.title,
    slug: normalizedSlug,
    boardId: data.board_id,
    listId: data.list_id,
    description: data.description ?? null,
    tags: Array.isArray(data.tags) ? data.tags : [],
    dueDate: data.due_date ?? null,
    priority: (data.priority ?? 'medium') as CardDetail['priority'],
    assignedTo: data.assigned_to ?? null,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    permitted: true,
  };
}

export function buildCanonicalTail(card: Pick<CardDetail, 'idShort' | 'slug'>): string {
  return buildReadableTail(card.idShort, card.slug);
}
