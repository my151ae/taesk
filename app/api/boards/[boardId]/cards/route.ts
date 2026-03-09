import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { generateShortId, slugify } from '@/lib/card-utils';
import { clampChecklist, EMPTY_CHECKLIST } from '@/lib/checklist';
import { buildDefaultBodyContent, deriveExcerptFromContent, normalizeContent } from '@/lib/tiptap';
import { withErrorHandling } from '@/lib/server/with-error-handling';
import { authorizeBoardMutation } from '@/lib/server/board-request';
import {
  runCardMutationWithFallback,
  stripUndefinedValues,
} from '@/lib/server/card-mutation';
import {
  cardInsertResultMissingResponse,
  cardMutationErrorResponse,
  getCardCreateFallbackColumns,
  validationFailedResponse,
} from '@/lib/server/cards-api-service';
import { logCardActivity } from '@/lib/server/card-side-effects';

const CreateCardSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().max(255),
  checklist: z.unknown().optional(),
  content: z.record(z.string(), z.unknown()).or(z.array(z.unknown())).optional(),
  excerpt: z.string().max(500).optional(),
  list_id: z.string().uuid().optional(),
  position: z.number().int().min(0).optional(),
  tags: z.array(z.string()).optional(),
  due_date: z.string().datetime().nullable().optional(),
  due_start: z.string().nullable().optional(),
  due_end: z.string().nullable().optional(),
  start_reminder_enabled: z.boolean().optional(),
  start_reminder_minutes: z.union([
    z.literal(0),
    z.literal(5),
    z.literal(10),
    z.literal(15),
    z.literal(30),
    z.literal(60),
  ]).optional(),
  end_reminder_enabled: z.boolean().optional(),
  end_reminder_minutes: z.union([
    z.literal(0),
    z.literal(5),
    z.literal(10),
    z.literal(15),
    z.literal(30),
    z.literal(60),
  ]).optional(),
  due_bucket: z.enum(['a', 'b']).nullable().optional(),
  due_bucket_position: z.number().nullable().optional(),
  checked: z.boolean().optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  assigned_to: z.string().nullable().optional(),
  user_id: z.string().uuid().nullable().optional(),
  short_id: z.string().nullable().optional(),
  id_short: z.number().int().min(0).nullable().optional(),
  slug: z.string().nullable().optional(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
  duration: z.number().int().min(0).nullable().optional(),
});

/**
 * POST /api/boards/[boardId]/cards
 *
 * Create a new card.
 */
const postHandler = async (
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) => {
  const { boardId } = await params;
  const auth = await authorizeBoardMutation(request, boardId);
  if (!auth.ok) {
    return auth.response;
  }
  const { supabase, user } = auth.data;

  const body = await request.json();
  const parsed = CreateCardSchema.safeParse(body);

  if (!parsed.success) {
    return validationFailedResponse(parsed.error.flatten());
  }

  let listId = parsed.data.list_id;
  let position = parsed.data.position;

  if (!listId) {
    // Fetch the first list or create one
    const { data: lists } = await supabase
      .from('lists')
      .select('id')
      .eq('board_id', boardId)
      .order('position', { ascending: true })
      .limit(1);

    if (lists && lists.length > 0) {
      listId = lists[0].id;
    } else {
      // Create a default list
      const { data: newList, error: listError } = await supabase
        .from('lists')
        .insert({ board_id: boardId, title: 'To Do', position: 0 })
        .select('id')
        .single();

      if (listError || !newList) {
        throw new Error('Failed to create default list');
      }
      listId = newList.id;
    }
  }

  if (position === undefined) {
    // Get max position in the list
    const { data: maxPosData } = await supabase
      .from('cards')
      .select('position')
      .eq('list_id', listId)
      .order('position', { ascending: false })
      .limit(1);

    const maxPos = maxPosData?.[0]?.position ?? -1;
    position = maxPos + 1000; // Add gap
  }

  let shortId = parsed.data.short_id;
  if (!shortId) {
    shortId = generateShortId();
    // Simple collision check could be added here if needed
  }

  let idShort = parsed.data.id_short;
  if (idShort === undefined || idShort === null) {
    const { data: maxIdShortData } = await supabase
      .from('cards')
      .select('id_short')
      .eq('board_id', boardId)
      .order('id_short', { ascending: false })
      .limit(1);

    idShort = (maxIdShortData?.[0]?.id_short ?? 0) + 1;
  }

  let slug = parsed.data.slug;
  if (!slug) {
    slug = slugify(parsed.data.title);
  }

  const normalizedContent =
    parsed.data.content
      ? normalizeContent(parsed.data.content)
      : buildDefaultBodyContent();

  const normalizedExcerpt =
    deriveExcerptFromContent(normalizedContent);

  const payload = stripUndefinedValues({
    board_id: boardId,
    id: parsed.data.id,
    title: parsed.data.title,
    checklist: clampChecklist((parsed.data.checklist ?? EMPTY_CHECKLIST) as Parameters<typeof clampChecklist>[0]),
    content: normalizedContent,
    excerpt: normalizedExcerpt,
    list_id: listId,
    position,
    tags: parsed.data.tags ?? [],
    due_date: parsed.data.due_date ?? null,
    due_start: parsed.data.due_start ?? null,
    due_end: parsed.data.due_end ?? null,
    start_reminder_enabled: parsed.data.start_reminder_enabled ?? false,
    start_reminder_minutes: parsed.data.start_reminder_minutes ?? 0,
    end_reminder_enabled: parsed.data.end_reminder_enabled ?? false,
    end_reminder_minutes: parsed.data.end_reminder_minutes ?? 0,
    due_bucket: parsed.data.due_bucket ?? null,
    due_bucket_position: parsed.data.due_bucket_position ?? null,
    checked: parsed.data.checked ?? false,
    assignee_id: parsed.data.assignee_id ?? null,
    assigned_to: parsed.data.assigned_to ?? null,
    user_id: parsed.data.user_id ?? user.id,
    short_id: shortId,
    id_short: idShort,
    slug,
    created_at: parsed.data.created_at,
    updated_at: parsed.data.updated_at,
    duration: parsed.data.duration ?? 60,
  });

  const performInsert = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase
      .from('cards')
      .insert(body)
      .select()
      .single();
    return { data: data ?? null, error };
  };

  const { data: createdCard, error, payload: payloadToSend } = await runCardMutationWithFallback(
    performInsert,
    payload,
    getCardCreateFallbackColumns()
  );

  const mutationError = cardMutationErrorResponse({ error, payload: payloadToSend });
  if (mutationError) {
    return mutationError;
  }

  if (!createdCard) {
    return cardInsertResultMissingResponse();
  }

  logCardActivity(supabase, {
    boardId,
    userId: user.id,
    action: 'created',
    cardId: createdCard.id,
    cardTitle: createdCard.title ?? null,
  });

  return NextResponse.json({ card: createdCard }, { status: 201 });
};

export const POST = withErrorHandling(postHandler, 'cards-post');
