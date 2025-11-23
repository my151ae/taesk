import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';

/**
 * DELETE /api/boards/[boardId]
 *
 * Delete a board. Only the owner can delete a board.
 */
export async function DELETE(
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

        // Check if user is owner of the board
        const { data: membership, error: membershipError } = await supabase
            .from('board_members')
            .select('role')
            .eq('board_id', boardId)
            .eq('profile_id', user.id)
            .single();

        if (membershipError || !membership) {
            return NextResponse.json(
                { error: { code: 'NOT_FOUND', message: 'Board not found or access denied' } },
                { status: 404 }
            );
        }

        if (membership.role !== 'owner') {
            return NextResponse.json(
                { error: { code: 'FORBIDDEN', message: 'Only the board owner can delete the board' } },
                { status: 403 }
            );
        }

        // Delete the board
        const { error: deleteError } = await supabase
            .from('boards')
            .delete()
            .eq('id', boardId);

        if (deleteError) {
            console.error('Error deleting board:', deleteError);
            return NextResponse.json(
                { error: { code: 'DB_ERROR', message: deleteError.message } },
                { status: 500 }
            );
        }

        return NextResponse.json({ success: true }, { status: 200 });
    } catch (error) {
        console.error('Unexpected error in DELETE /api/boards/[boardId]:', error);
        return NextResponse.json(
            { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
            { status: 500 }
        );
    }
}
