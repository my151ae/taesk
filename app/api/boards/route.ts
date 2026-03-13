import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { requireAuthenticatedUser, validateMutationRequestOrigin } from '@/lib/server/api-security';
import { z } from 'zod';
import { createUniqueBoardShortId, getNextBoardIdShort, slugifyBoardName } from '@/lib/board-utils';
import { withErrorHandling } from '@/lib/server/with-error-handling';
import { canCreateBoardInTeam } from '@/lib/server/team-security';

const CreateBoardSchema = z.object({
  team_id: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  is_test_board: z.boolean().optional(),
});

/**
 * GET /api/boards
 *
 * Get all boards the user has access to.
 */
const getHandler = async (request: NextRequest) => {
  try {
    const supabase = await createServerSupabaseClient();

    const { user, errorResponse } = await requireAuthenticatedUser(supabase);
    if (errorResponse || !user) {
      return errorResponse ?? NextResponse.json(
        { error: { code: 'UNAUTHENTICATED', message: 'Login required' } },
        { status: 401, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const teamIdFilter = request.nextUrl.searchParams.get('team_id');

    // Get boards where user is a member
    const { data: memberships } = await supabase
      .from('board_members')
      .select('board_id, role')
      .eq('profile_id', user.id);

    if (!memberships || memberships.length === 0) {
      return NextResponse.json({ boards: [] }, { status: 200 });
    }

    const boardIds = memberships.map(m => m.board_id);
    const roleByBoardId = new Map(memberships.map((membership) => [membership.board_id, membership.role]));

    let boardsQuery = supabase
      .from('boards')
      .select('id, team_id, name, description, is_personal, short_id, id_short, slug, is_test_board, day_range, list_range, list_window_before_days, list_window_after_days, created_at, updated_at')
      .in('id', boardIds);

    if (teamIdFilter) {
      boardsQuery = boardsQuery.eq('team_id', teamIdFilter);
    }

    const { data: boards, error } = await boardsQuery.order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching boards:', error);
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: error.message } },
        { status: 500 }
      );
    }

    const normalizedBoards = (boards || []).map((board) => ({
      ...board,
      membership_role: roleByBoardId.get(board.id) ?? undefined,
    }));

    return NextResponse.json(
      { boards: normalizedBoards },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('Unexpected error in GET /api/boards:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
};

/**
 * POST /api/boards
 *
 * Create a new board and automatically add the creator as owner.
 */
const postHandler = async (request: NextRequest) => {
  try {
    const originError = validateMutationRequestOrigin(request);
    if (originError) {
      return originError;
    }

    const supabase = await createServerSupabaseClient();

    const { user, errorResponse } = await requireAuthenticatedUser(supabase);
    if (errorResponse || !user) {
      return errorResponse ?? NextResponse.json(
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

    const createPermission = await canCreateBoardInTeam(supabase, parsed.data.team_id, user.id);
    if (!createPermission.ok) {
      return createPermission.response;
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
        user_id: user.id,
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
};

export const GET = withErrorHandling(getHandler, 'boards-get');
export const POST = withErrorHandling(postHandler, 'boards-post');
