import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { clampChecklist, EMPTY_CHECKLIST } from '@/lib/checklist';
import { normalizeContent, extractTitleTask, deriveExcerptFromContent } from '@/lib/tiptap';
import { withErrorHandling } from '@/lib/server/with-error-handling';
import { authorizeBoardMutation } from '@/lib/server/board-request';
import {
  runCardMutationWithFallback,
  stripUndefinedValues,
} from '@/lib/server/card-mutation';
import {
  cardMutationErrorResponse,
  getCardUpdateFallbackColumns,
  validationFailedResponse,
} from '@/lib/server/cards-api-service';
import {
  deleteCardFromCalendarBestEffort,
  logCardActivity,
  syncPatchedCardToCalendar,
} from '@/lib/server/card-side-effects';

const UpdateCardSchema = z.object({
  title: z.string().max(255).optional(),
  checklist: z.unknown().optional(),
  content: z.unknown().optional(),
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
  priority: z.enum(['low', 'medium', 'high']).nullable().optional(),
  checked: z.boolean().optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  assigned_to: z.string().nullable().optional(),
  assignee_ids: z.array(z.string().uuid()).nullable().optional(),
  slug: z.string().max(255).optional(),
  duration: z.number().int().min(0).nullable().optional(),
});

/**
 * PATCH /api/boards/[boardId]/cards/[cardId]
 *
 * Update a single card (partial update).
 */
const patchHandler = async (
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string; cardId: string }> }
) => {
  const { boardId, cardId } = await params;
  const auth = await authorizeBoardMutation(request, boardId);
  if (!auth.ok) {
    return auth.response;
  }
  const { supabase, user } = auth.data;

  const body = await request.json();
  const parsed = UpdateCardSchema.safeParse(body);

  if (!parsed.success) {
    return validationFailedResponse(parsed.error.flatten());
  }

  const performUpdate = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase
      .from('cards')
      .update(body)
      .eq('id', cardId)
      .eq('board_id', boardId)
      .select()
      .limit(1)
      .maybeSingle();
    return { data: data ?? null, error };
  };

  // 元リクエストキーで判定（派生値を足す前）
  const originalKeys = Object.keys(parsed.data);
  const isContentOnlyUpdate = originalKeys.every((key) => key === 'content');
  const triggersCalendarSync = ['due_date', 'due_start', 'due_end', 'title'].some(
    (key) => originalKeys.includes(key)
  );

  const normalizedPayload: Record<string, unknown> = stripUndefinedValues({ ...parsed.data });
  if (
    normalizedPayload.due_bucket_position != null &&
    typeof normalizedPayload.due_bucket_position !== 'number'
  ) {
    normalizedPayload.due_bucket_position = Number(normalizedPayload.due_bucket_position);
  }

  if ('checklist' in normalizedPayload) {
    normalizedPayload.checklist = clampChecklist((normalizedPayload.checklist ?? EMPTY_CHECKLIST) as Parameters<typeof clampChecklist>[0]);
  }
  if ('content' in normalizedPayload) {
    normalizedPayload.content = normalizeContent(normalizedPayload.content);
    // content から title/checked/excerpt を派生（生成列化）
    const extracted = extractTitleTask(normalizedPayload.content as Record<string, unknown>);
    normalizedPayload.title = extracted.text || (parsed.data.title ?? '');
    normalizedPayload.checked = parsed.data.checked ?? extracted.checked;
    normalizedPayload.excerpt = deriveExcerptFromContent(normalizedPayload.content as Record<string, unknown>);
  }

  const { data: updatedCard, error, payload: payloadToSend } = await runCardMutationWithFallback(
    performUpdate,
    normalizedPayload,
    getCardUpdateFallbackColumns()
  );

  const mutationError = cardMutationErrorResponse({ error, payload: payloadToSend });
  if (mutationError) {
    return mutationError;
  }

  let ensuredCard = updatedCard ?? null;

  // If Supabase didn't return the row (e.g., due to returning settings), refetch once
  if (!ensuredCard) {
    const { data: refetched, error: refetchError } = await supabase
      .from('cards')
      .select('*')
      .eq('id', cardId)
      .eq('board_id', boardId)
      .maybeSingle();

    if (refetchError) {
      console.error('[cards PATCH] refetch after update failed', refetchError);
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Card not found' } },
        { status: 404 }
      );
    }

    ensuredCard = refetched ?? null;
  }

  // Log activity (only if we have a card to reference)
  if (ensuredCard) {
    const action = parsed.data.list_id ? 'moved' : 'updated';
    // isContentOnlyUpdate と triggersCalendarSync は元リクエストキーで事前判定済み

    if (!isContentOnlyUpdate) {
      logCardActivity(supabase, {
        boardId,
        userId: user.id,
        action,
        cardId,
        cardTitle: ensuredCard.title ?? parsed.data.title ?? null,
      });
    }

    if (triggersCalendarSync) {
      void syncPatchedCardToCalendar({
        supabase,
        userId: user.id,
        card: ensuredCard,
        requestOrigin: request.nextUrl?.origin,
      }).catch((syncError) => {
        console.error('[cards PATCH] google sync failed', { cardId, error: syncError });
      });
    }
  }

  return NextResponse.json({ card: ensuredCard }, { status: 200 });
};

/**
 * DELETE /api/boards/[boardId]/cards/[cardId]
 *
 * Delete a card.
 */
const deleteHandler = async (
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string; cardId: string }> }
) => {
  const { boardId, cardId } = await params;
  const auth = await authorizeBoardMutation(request, boardId);
  if (!auth.ok) {
    return auth.response;
  }
  const { supabase, user } = auth.data;

  // Get card info before deletion
  const { data: card } = await supabase
    .from('cards')
    .select('title')
    .eq('id', cardId)
    .eq('board_id', boardId)
    .single();

  if (card) {
    await deleteCardFromCalendarBestEffort(supabase, user.id, cardId);
  }

  const { error } = await supabase
    .from('cards')
    .delete()
    .eq('id', cardId)
    .eq('board_id', boardId);

  if (error) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: error.message } },
      { status: 500 }
    );
  }

  // Log activity
  if (card) {
    logCardActivity(supabase, {
      boardId,
      userId: user.id,
      action: 'deleted',
      cardId,
      cardTitle: card.title ?? null,
    });
  }

  return new NextResponse(null, { status: 204 });
};

export const PATCH = withErrorHandling(patchHandler, 'cards-patch');
export const DELETE = withErrorHandling(deleteHandler, 'cards-delete');
