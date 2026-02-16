import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { createServiceRoleSupabaseClient } from '@/lib/server/supabaseAdmin';
import { isAdminUser } from '@/lib/admins';
import { z } from 'zod';
import { createUniqueBoardShortId, getNextBoardIdShort, slugifyBoardName } from '@/lib/board-utils';

const CreateBoardSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  is_test_board: z.boolean().optional(),
});

/**
 * GET /api/boards
 *
 * Get all boards the user has access to.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: { code: 'UNAUTHENTICATED', message: 'Login required' } },
        { status: 401, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    if (isAdminUser({ id: user.id, email: user.email })) {
      const adminSupabase = createServiceRoleSupabaseClient();
      const { data: boards, error } = await adminSupabase
        .from('boards')
        .select('id, name, description, short_id, id_short, slug, is_test_board, day_range, created_at, updated_at')
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error fetching boards for admin:', error);
        return NextResponse.json(
          { error: { code: 'DB_ERROR', message: error.message } },
          { status: 500 }
        );
      }

      return NextResponse.json(
        { boards: boards || [] },
        { status: 200, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    // Get boards where user is a member
    const { data: memberships } = await supabase
      .from('board_members')
      .select('board_id')
      .eq('profile_id', user.id);

    if (!memberships || memberships.length === 0) {
      return NextResponse.json({ boards: [] }, { status: 200 });
    }

    const boardIds = memberships.map(m => m.board_id);

    const { data: boards, error } = await supabase
      .from('boards')
      .select('id, name, description, short_id, id_short, slug, is_test_board, day_range, created_at, updated_at')
      .in('id', boardIds)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching boards:', error);
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: error.message } },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { boards: boards || [] },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('Unexpected error in GET /api/boards:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}

/**
 * POST /api/boards
 *
 * Create a new board and automatically add the creator as owner.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: { code: 'UNAUTHENTICATED', message: 'Login required' } },
        { status: 401 }
      );
    }

    const body = await request.json();
    const parsed = CreateBoardSchema.safeParse(body);

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

    // Generate short_id, id_short, and slug
    const short_id = await createUniqueBoardShortId();
    const id_short = await getNextBoardIdShort();
    const slug = slugifyBoardName(parsed.data.name);

    // Create board
    const { data: board, error: boardError } = await supabase
      .from('boards')
      .insert({
        ...parsed.data,
        short_id,
        id_short,
        slug,
      })
      .select()
      .single();

    if (boardError) {
      console.error('Error creating board:', boardError);
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: boardError.message } },
        { status: 500 }
      );
    }

    // Add creator as owner
    const { error: memberError } = await supabase
      .from('board_members')
      .insert({
        board_id: board.id,
        profile_id: user.id,
        role: 'owner',
      });

    if (memberError) {
      console.error('Error adding board owner:', memberError);
      // Rollback board creation (best effort)
      await supabase.from('boards').delete().eq('id', board.id);
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: 'Failed to add board owner' } },
        { status: 500 }
      );
    }

    return NextResponse.json({ board }, { status: 201 });
  } catch (error) {
    console.error('Unexpected error in POST /api/boards:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
