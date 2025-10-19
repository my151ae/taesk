import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { z } from 'zod';

const CreateListSchema = z.object({
  title: z.string().min(1).max(255),
  position: z.number().int().min(0),
});

const CreateListsSchema = z.array(CreateListSchema).min(1);

/**
 * POST /api/boards/[boardId]/lists
 *
 * Create a new list (or multiple lists for default initialization).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  try {
    const { boardId } = await params;
    const supabase = await createServerSupabaseClient();

    // 1. Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: { code: 'UNAUTHENTICATED', message: 'Login required' } },
        { status: 401 }
      );
    }

    // 2. Verify board membership
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

    // 3. Parse and validate request body
    const body = await request.json();

    // Support both single list and array of lists
    const isBatch = Array.isArray(body);
    const parsed = isBatch
      ? CreateListsSchema.safeParse(body)
      : CreateListSchema.safeParse(body);

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

    // 4. Create list(s)
    const listsToCreate = isBatch
      ? parsed.data.map((list: any) => ({ ...list, board_id: boardId, user_id: user.id }))
      : [{ ...parsed.data, board_id: boardId, user_id: user.id }];

    const { data: createdLists, error } = await supabase
      .from('lists')
      .insert(listsToCreate)
      .select();

    if (error) {
      console.error('Error creating list(s):', error);
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: error.message } },
        { status: 500 }
      );
    }

    // 5. Log activity (for single list creation only)
    if (!isBatch && createdLists && createdLists.length > 0) {
      const list = createdLists[0];
      supabase.from('activity_logs').insert({
        board_id: boardId,
        user_id: user.id,
        action: 'created',
        entity_type: 'list',
        entity_id: list.id,
        entity_title: list.title,
      }).then(({ error: logError }) => {
        if (logError) console.error('Activity log failed:', logError);
      });
    }

    return NextResponse.json(
      { lists: createdLists },
      { status: 201 }
    );
  } catch (error) {
    console.error('Unexpected error in POST /api/boards/[boardId]/lists:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
