import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { clampChecklist, EMPTY_CHECKLIST } from '@/lib/checklist';
import { normalizeContent, deriveExcerptFromContent } from '@/lib/tiptap';
import { withErrorHandling } from '@/lib/server/with-error-handling';
import { authorizeBoardMutation } from '@/lib/server/board-request';
import { createServiceRoleSupabaseClient } from '@/lib/server/supabaseAdmin';
import {
  isMissingColumnError,
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
import { CARD_IMAGE_BUCKET, buildCardImageStoragePrefix } from '@/lib/tiptap-images';

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

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
  started_at: z.string().datetime().nullable().optional(),
  checked: z.boolean().optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  assigned_to: z.string().nullable().optional(),
  assignee_ids: z.array(z.string().uuid()).nullable().optional(),
  slug: z.string().max(255).optional(),
  duration: z.number().int().min(0).nullable().optional(),
});

const STORAGE_LIST_PAGE_SIZE = 100;
type CurrentCardState = {
  due_date: string | null;
  checked: boolean;
  started_at: string | null;
};

const formatDateJst = (base: Date, offsetDays = 0): string => {
  const utcMs = base.getTime();
  const jstMs = utcMs + JST_OFFSET_MS + offsetDays * MS_PER_DAY;
  const jstDate = new Date(jstMs);
  const year = jstDate.getUTCFullYear();
  const month = `${jstDate.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${jstDate.getUTCDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const toJstDate = (value: string | null | undefined) => {
  if (!value) return null;
  return formatDateJst(new Date(value));
};

const isOverdueState = (state: { due_date: string | null; checked: boolean }, todayIso: string) => {
  const localDay = toJstDate(state.due_date);
  return Boolean(localDay && localDay < todayIso && !state.checked);
};

const deleteCardImagesBestEffort = async (boardId: string, cardId: string) => {
  const admin = createServiceRoleSupabaseClient();
  const prefix = buildCardImageStoragePrefix(boardId, cardId);
  const targetPaths: string[] = [];
  let offset = 0;

  try {
    while (true) {
      const { data, error } = await admin.storage.from(CARD_IMAGE_BUCKET).list(prefix, {
        limit: STORAGE_LIST_PAGE_SIZE,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      });

      if (error) {
        console.warn('[cards DELETE] failed to list card images', { boardId, cardId, error });
        return;
      }

      if (!data || data.length === 0) break;

      for (const item of data) {
        if (!item?.name) continue;
        targetPaths.push(`${prefix}${item.name}`);
      }

      if (data.length < STORAGE_LIST_PAGE_SIZE) break;
      offset += data.length;
    }

    if (targetPaths.length === 0) return;

    for (let i = 0; i < targetPaths.length; i += STORAGE_LIST_PAGE_SIZE) {
      const chunk = targetPaths.slice(i, i + STORAGE_LIST_PAGE_SIZE);
      const { error } = await admin.storage.from(CARD_IMAGE_BUCKET).remove(chunk);
      if (error) {
        console.warn('[cards DELETE] failed to remove card images', {
          boardId,
          cardId,
          count: chunk.length,
          error,
        });
      }
    }
  } catch (error) {
    console.warn('[cards DELETE] unexpected storage cleanup failure', { boardId, cardId, error });
  }
};

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

  const currentCardStateQuery = async (selectClause: string) =>
    supabase
      .from('cards')
      .select(selectClause)
      .eq('id', cardId)
      .eq('board_id', boardId)
      .maybeSingle();

  const initialCardState = await currentCardStateQuery('due_date, checked, started_at');
  const fallbackCardState =
    isMissingColumnError(initialCardState.error, 'started_at')
      ? await currentCardStateQuery('due_date, checked')
      : null;
  const fallbackCardStateData =
    fallbackCardState?.data && typeof fallbackCardState.data === 'object'
      ? (fallbackCardState.data as { due_date: string | null; checked: boolean })
      : null;

  const currentCardState: CurrentCardState | null = fallbackCardStateData
    ? { ...fallbackCardStateData, started_at: null }
    : (initialCardState.data as CurrentCardState | null);
  const currentCardStateError = fallbackCardState?.error ?? initialCardState.error;

  if (currentCardStateError) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: currentCardStateError.message } },
      { status: 500 }
    );
  }

  if (!currentCardState) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Card not found' } },
      { status: 404 }
    );
  }

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
    normalizedPayload.excerpt = deriveExcerptFromContent(normalizedPayload.content as Record<string, unknown>);
  }

  const todayIso = formatDateJst(new Date(), 0);
  const nextDueDate =
    Object.prototype.hasOwnProperty.call(normalizedPayload, 'due_date')
      ? (normalizedPayload.due_date as string | null)
      : currentCardState.due_date;
  const nextChecked =
    Object.prototype.hasOwnProperty.call(normalizedPayload, 'checked')
      ? Boolean(normalizedPayload.checked)
      : Boolean(currentCardState.checked);
  const wasOverdue = isOverdueState(
    { due_date: currentCardState.due_date, checked: Boolean(currentCardState.checked) },
    todayIso
  );
  const isOverdueNext = isOverdueState(
    { due_date: nextDueDate, checked: nextChecked },
    todayIso
  );

  if (
    !Object.prototype.hasOwnProperty.call(normalizedPayload, 'started_at') &&
    !currentCardState.started_at &&
    wasOverdue &&
    !isOverdueNext &&
    nextChecked === false
  ) {
    normalizedPayload.started_at = new Date().toISOString();
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

  await deleteCardImagesBestEffort(boardId, cardId);

  return new NextResponse(null, { status: 204 });
};

export const PATCH = withErrorHandling(patchHandler, 'cards-patch');
export const DELETE = withErrorHandling(deleteHandler, 'cards-delete');
