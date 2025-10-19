import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { z } from 'zod';

const CardReorderUpdateSchema = z.object({
  id: z.string().uuid(),
  list_id: z.string().uuid(),
  position: z.number().int().min(0),
});

const ReorderCardsSchema = z.object({
  updates: z.array(CardReorderUpdateSchema).min(1),
});

/**
 * PATCH /api/boards/[boardId]/cards/reorder
 *
 * Bulk update card positions and list assignments (for drag & drop and sync).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  try {
    const { boardId } = await params;
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
    const parsed = ReorderCardsSchema.safeParse(body);

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

    const updates = parsed.data.updates;

    // Basic validation: duplicate IDs and duplicate (list_id, position)
    const idSet = new Set<string>();
    const positionSet = new Set<string>();

    for (const update of updates) {
      if (idSet.has(update.id)) {
        return NextResponse.json(
          { error: { code: 'INVALID_BODY', message: 'Duplicate card ID detected in updates payload.' } },
          { status: 400 }
        );
      }
      idSet.add(update.id);

      const positionKey = `${update.list_id}:${update.position}`;
      if (positionSet.has(positionKey)) {
        return NextResponse.json(
          { error: { code: 'INVALID_BODY', message: 'Duplicate position within the same list detected.' } },
          { status: 400 }
        );
      }
      positionSet.add(positionKey);
    }

    const cardIds = updates.map((u) => u.id);

    const { data: existingCards, error: fetchCardsError } = await supabase
      .from('cards')
      .select('id, board_id, list_id, position')
      .in('id', cardIds);

    if (fetchCardsError) {
      console.error('[cards/reorder] Failed to fetch current card state', fetchCardsError);
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: fetchCardsError.message } },
        { status: 500 }
      );
    }

    if (!existingCards || existingCards.length !== updates.length) {
      const foundIds = new Set(existingCards?.map((card) => card.id) ?? []);
      const missing = updates.filter((u) => !foundIds.has(u.id)).map((u) => u.id);
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_BODY',
            message: 'One or more cards do not exist or do not belong to this board.',
            details: { missing },
          },
        },
        { status: 400 }
      );
    }

    const invalidBoardCard = existingCards.find((card) => card.board_id !== boardId);
    if (invalidBoardCard) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_BODY',
            message: 'Updates contain cards from a different board.',
            details: { cardId: invalidBoardCard.id, boardId: invalidBoardCard.board_id },
          },
        },
        { status: 400 }
      );
    }

    const listIds = Array.from(new Set(updates.map((u) => u.list_id)));

    if (listIds.length > 0) {
      const { data: targetLists, error: fetchListsError } = await supabase
        .from('lists')
        .select('id, board_id')
        .in('id', listIds);

      if (fetchListsError) {
        console.error('[cards/reorder] Failed to verify list ownership', fetchListsError);
        return NextResponse.json(
          { error: { code: 'DB_ERROR', message: fetchListsError.message } },
          { status: 500 }
        );
      }

      if (!targetLists || targetLists.length !== listIds.length) {
        const foundListIds = new Set(targetLists?.map((list) => list.id) ?? []);
        const missingLists = listIds.filter((id) => !foundListIds.has(id));
        return NextResponse.json(
          {
            error: {
              code: 'INVALID_BODY',
              message: 'One or more lists do not exist.',
              details: { missingLists },
            },
          },
          { status: 400 }
        );
      }

      const invalidList = targetLists.find((list) => list.board_id !== boardId);
      if (invalidList) {
        return NextResponse.json(
          {
            error: {
              code: 'INVALID_BODY',
              message: 'Updates contain lists from a different board.',
              details: { listId: invalidList.id, boardId: invalidList.board_id },
            },
          },
          { status: 400 }
        );
      }
    }

    const originalState = new Map(existingCards.map((card) => [card.id, { list_id: card.list_id, position: card.position }]));

    for (const { id, list_id, position } of updates) {
      const { error: updateError } = await supabase
        .from('cards')
        .update({ list_id, position })
        .eq('id', id)
        .eq('board_id', boardId);

      if (updateError) {
        console.error('[cards/reorder] Update failed', {
          payload: { id, list_id, position },
          message: updateError.message,
          details: updateError.details,
          hint: updateError.hint,
          code: updateError.code,
        });

        // Attempt rollback to the original state to keep consistency
        await Promise.all(
          Array.from(originalState.entries()).map(([cardId, snapshot]) =>
            supabase
              .from('cards')
              .update({ list_id: snapshot.list_id, position: snapshot.position })
              .eq('id', cardId)
              .eq('board_id', boardId)
          )
        );

        return NextResponse.json(
          { error: { code: 'DB_ERROR', message: updateError.message } },
          { status: 500 }
        );
      }
    }

    // Log activity
    supabase.from('activity_logs').insert({
      board_id: boardId,
      user_id: user.id,
      action: 'updated',
      entity_type: 'card',
      entity_id: boardId,
      entity_title: 'Cards reordered',
      details: { count: updates.length },
    }).then(({ error: logError }) => {
      if (logError) console.error('Activity log failed:', logError);
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error('Unexpected error in PATCH /api/boards/[boardId]/cards/reorder:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
