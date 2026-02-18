import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { clampChecklist, EMPTY_CHECKLIST } from '@/lib/checklist';
import { normalizeContent, extractTitleTask, deriveExcerptFromContent } from '@/lib/tiptap';
import { syncCardToCalendar, deleteCardFromCalendar, buildGoogleDateTimeRange, buildGoogleEventDescription, resolveAppOrigin } from '@/lib/calendarSyncService';
import { withErrorHandling } from '@/lib/server/with-error-handling';
import { authorizeBoardMutation } from '@/lib/server/board-request';
import {
  isMissingColumnError,
  missingCardColumnResponse,
  runCardMutationWithFallback,
  stripUndefinedValues,
} from '@/lib/server/card-mutation';

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
    return NextResponse.json(
      {
        error: {
          code: 'INVALID_BODY',
          message: 'Validation failed',
          details: parsed.error.flatten(),
        },
      },
      { status: 422 }
    );
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
    ['due_bucket_position', 'assignee_ids']
  );

  if (isMissingColumnError(error, 'checklist') && 'checklist' in payloadToSend) {
    const response = missingCardColumnResponse('checklist');
    if (response) return response;
  }
  if (isMissingColumnError(error, 'content') && 'content' in payloadToSend) {
    const response = missingCardColumnResponse('content');
    if (response) return response;
  }

  if (error) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: error.message } },
      { status: 500 }
    );
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
      // Independent async logging
      supabase.from('activity_logs').insert({
        board_id: boardId,
        user_id: user.id,
        action,
        entity_type: 'card',
        entity_id: cardId,
        entity_title: ensuredCard?.title ?? parsed.data.title ?? null,
      }).then(({ error: logError }) => {
        if (logError) console.error('Activity log failed:', logError);
      });
    }

    // Google Calendar Sync Trigger (Fire and forget or await without blocking response error?)
    // We await it to ensure consistency, but catch errors to avoid failing the UI update.
    if (triggersCalendarSync && ensuredCard.due_start && ensuredCard.due_end) {
      const { startDateTime, endDateTime } = buildGoogleDateTimeRange({
        due_date: ensuredCard.due_date,
        due_start: ensuredCard.due_start,
        due_end: ensuredCard.due_end,
      });

      const origin = request.nextUrl?.origin ?? resolveAppOrigin();
      const description = buildGoogleEventDescription({
        id: ensuredCard.id,
        short_id: ensuredCard.short_id,
        slug: ensuredCard.slug ?? null,
        id_short: ensuredCard.id_short ?? null,
        title: ensuredCard.title,
        description: ensuredCard.excerpt ?? "",
      }, origin);

      if (startDateTime && endDateTime) {
        syncCardToCalendar(supabase, user.id, ensuredCard.id, {
          summary: ensuredCard.title,
          description,
          start: { dateTime: startDateTime, timeZone: "Asia/Tokyo" },
          end: { dateTime: endDateTime, timeZone: "Asia/Tokyo" },
        }, { onlyUpdate: true })
          .catch(err => console.error("[card-patch] google sync failed", err));
      }
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
    // Attempt to delete from Google Calendar if synced.
    // We do this BEFORE DB delete, but we don't block on failure (best effort).
    // Actually, if we delete local card, CASCADE deletes sync record, losing the google_event_id.
    // So we MUST try to delete from Google first.
    await deleteCardFromCalendar(supabase, user.id, cardId)
      .catch(err => console.error("[card-delete] google sync delete failed", err));
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
    supabase.from('activity_logs').insert({
      board_id: boardId,
      user_id: user.id,
      action: 'deleted',
      entity_type: 'card',
      entity_id: cardId,
      entity_title: card.title,
    }).then(({ error: logError }) => {
      if (logError) console.error('Activity log failed:', logError);
    });
  }

  return new NextResponse(null, { status: 204 });
};

export const PATCH = withErrorHandling(patchHandler, 'cards-patch');
export const DELETE = withErrorHandling(deleteHandler, 'cards-delete');
