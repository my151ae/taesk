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

/**
 * PATCH /api/boards/[boardId]
 *
 * Update a board.
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ boardId: string }> }
) {
    try {
        const { boardId } = await params;
        const supabase = await createServerSupabaseClient();
        const payload = await request.json();

        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json(
                { error: { code: 'UNAUTHENTICATED', message: 'Login required' } },
                { status: 401 }
            );
        }

        // Check if user is member of the board
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

        // Only owner or editor can update settings (for now let's say owner/editor)
        if (!['owner', 'editor'].includes(membership.role)) {
            return NextResponse.json(
                { error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } },
                { status: 403 }
            );
        }

        const updates: Record<string, any> = {};
        if (typeof payload.day_range === 'number') {
            updates.day_range = Math.max(1, Math.min(7, payload.day_range)); // Limit 1-7 days
        }
        if (typeof payload.name === 'string' && payload.name.trim()) {
            updates.name = payload.name.trim();
        }

        if (Object.keys(updates).length === 0) {
            return NextResponse.json({ success: true }); // Nothing to update
        }

        const { data: updatedBoard, error: updateError } = await supabase
            .from('boards')
            .update(updates)
            .eq('id', boardId)
            .select()
            .single();

        if (updateError) {
            console.error('Error updating board:', updateError);
            return NextResponse.json(
                { error: { code: 'DB_ERROR', message: updateError.message } },
                { status: 500 }
            );
        }

        return NextResponse.json({ board: updatedBoard }, { status: 200 });
    } catch (error) {
        console.error('Unexpected error in PATCH /api/boards/[boardId]:', error);
        return NextResponse.json(
            { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
            { status: 500 }
        );
    }
}
