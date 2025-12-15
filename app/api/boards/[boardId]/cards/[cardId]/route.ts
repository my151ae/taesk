import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { z } from 'zod';
import { clampChecklist, EMPTY_CHECKLIST } from '@/lib/checklist';
import { syncCardToCalendar, deleteCardFromCalendar, buildGoogleDateTimeRange, buildGoogleEventDescription, resolveAppOrigin } from '@/lib/calendarSyncService';

const UpdateCardSchema = z.object({
  title: z.string().max(255).optional(),
  checklist: z.any().optional(),
  list_id: z.string().uuid().optional(),
  position: z.number().int().min(0).optional(),
  tags: z.array(z.string()).optional(),
  due_date: z.string().datetime().nullable().optional(),
  due_start: z.string().nullable().optional(),
  due_end: z.string().nullable().optional(),
  due_bucket: z.enum(['a', 'b']).nullable().optional(),
  due_bucket_position: z.number().nullable().optional(),
  priority: z.enum(['low', 'medium', 'high']).nullable().optional(),
  checked: z.boolean().optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  assigned_to: z.string().nullable().optional(),
  assignee_ids: z.array(z.string().uuid()).nullable().optional(),
  slug: z.string().max(255).optional(),
});

/**
 * PATCH /api/boards/[boardId]/cards/[cardId]
 *
 * Update a single card (partial update).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string; cardId: string }> }
) {
  try {
    const { boardId, cardId } = await params;
    const supabase = await createServerSupabaseClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: { code: 'UNAUTHENTICATED', message: 'Login required' } },
        { status: 401 }
      );
    }

    const { data: membership } = await supabase
      .from('board_members')
      .select('role')
      .eq('board_id', boardId)
      .eq('profile_id', user.id)
      .maybeSingle();

    if (!membership || (membership.role !== 'owner' && membership.role !== 'editor')) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } },
        { status: 403 }
      );
    }

    const body = await request.json();
    const parsed = UpdateCardSchema.safeParse(body);

    if (!parsed.success) {
      console.error('[API] Validation failed:', {
        body,
        errors: parsed.error.flatten(),
      });
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

    const performUpdate = async (body: Record<string, unknown>) =>
      await supabase
        .from('cards')
        .update(body)
        .eq('id', cardId)
        .eq('board_id', boardId)
        .select()
        .limit(1)
        .maybeSingle();

    const normalizedPayload = { ...parsed.data };
    if (
      normalizedPayload.due_bucket_position != null &&
      typeof normalizedPayload.due_bucket_position !== 'number'
    ) {
      normalizedPayload.due_bucket_position = Number(normalizedPayload.due_bucket_position);
    }

    if ('checklist' in normalizedPayload) {
      normalizedPayload.checklist = clampChecklist(normalizedPayload.checklist ?? EMPTY_CHECKLIST);
    }

    let { data: updatedCard, error } = await performUpdate(normalizedPayload);

    const missingDueBucketColumn =
      !!error &&
      (error.code === '42703' ||
        (typeof error.message === 'string' && error.message.includes('due_bucket_position')));

    const missingChecklistColumn =
      !!error &&
      (error.code === '42703' ||
        (typeof error.message === 'string' && error.message.includes('checklist')));

    if (missingDueBucketColumn && 'due_bucket_position' in normalizedPayload) {
      const fallbackPayload = { ...normalizedPayload };
      delete fallbackPayload.due_bucket_position;
      ({ data: updatedCard, error } = await performUpdate(fallbackPayload));
    }

    const missingAssigneeIdsColumn =
      !!error &&
      (error.code === '42703' ||
        (typeof error.message === 'string' && error.message.includes('assignee_ids')));

    if (missingAssigneeIdsColumn && 'assignee_ids' in normalizedPayload) {
      const fallbackPayload = { ...normalizedPayload };
      delete fallbackPayload.assignee_ids;
      ({ data: updatedCard, error } = await performUpdate(fallbackPayload));
    }

    if (missingChecklistColumn && 'checklist' in normalizedPayload) {
      console.error('[cards PATCH] checklist column missing. Please apply migration 20251129090000_add_checklist_to_cards.sql');
      return NextResponse.json(
        { error: { code: 'MISSING_CHECKLIST_COLUMN', message: 'Checklist column is missing. Apply migration 20251129090000_add_checklist_to_cards.sql' } },
        { status: 500 }
      );
    }

    if (error) {
      console.error('Error updating card:', error);
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

      // Google Calendar Sync Trigger (Fire and forget or await without blocking response error?)
      // We await it to ensure consistency, but catch errors to avoid failing the UI update.
      if (ensuredCard.due_start && ensuredCard.due_end) {
        const { startDateTime, endDateTime } = buildGoogleDateTimeRange({
          due_date: ensuredCard.due_date,
          due_start: ensuredCard.due_start,
          due_end: ensuredCard.due_end,
        });

        const origin = request.nextUrl?.origin ?? resolveAppOrigin();
        const description = buildGoogleEventDescription({
          id: ensuredCard.id,
          short_id: ensuredCard.short_id,
          slug: (ensuredCard as any).slug ?? null,
          id_short: (ensuredCard as any).id_short ?? null,
          title: ensuredCard.title,
          description: ensuredCard.description ?? "",
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
  } catch (error) {
    console.error('Unexpected error in PATCH /api/boards/[boardId]/cards/[cardId]:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/boards/[boardId]/cards/[cardId]
 *
 * Delete a card.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string; cardId: string }> }
) {
  try {
    const { boardId, cardId } = await params;
    const supabase = await createServerSupabaseClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: { code: 'UNAUTHENTICATED', message: 'Login required' } },
        { status: 401 }
      );
    }

    const { data: membership } = await supabase
      .from('board_members')
      .select('role')
      .eq('board_id', boardId)
      .eq('profile_id', user.id)
      .maybeSingle();

    if (!membership || (membership.role !== 'owner' && membership.role !== 'editor')) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } },
        { status: 403 }
      );
    }

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
      console.error('Error deleting card:', error);
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
  } catch (error) {
    console.error('Unexpected error in DELETE /api/boards/[boardId]/cards/[cardId]:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
