import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { MAIN_BOARD_ID } from '@/lib/board-defaults';
import { createServiceRoleSupabaseClient } from '@/lib/server/supabaseAdmin';
import {
    getBoardMembership,
    hasAnyRole,
    requireAuthenticatedUser,
    validateMutationRequestOrigin,
} from '@/lib/server/api-security';
import { withErrorHandling } from '@/lib/server/with-error-handling';

/**
 * DELETE /api/boards/[boardId]
 *
 * Delete a board. Only the owner can delete a board.
 */
const deleteHandler = async (
    request: NextRequest,
    { params }: { params: Promise<{ boardId: string }> }
) => {
    try {
        const originError = validateMutationRequestOrigin(request);
        if (originError) {
            return originError;
        }

        const { boardId } = await params;

        if (boardId === MAIN_BOARD_ID) {
            return NextResponse.json(
                { error: { code: 'CONFLICT', message: 'E2E core board cannot be deleted' } },
                { status: 409 }
            );
        }

        const supabase = await createServerSupabaseClient();

        const { user, errorResponse } = await requireAuthenticatedUser(supabase);
        if (errorResponse || !user) {
            return errorResponse ?? NextResponse.json(
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
};

/**
 * PATCH /api/boards/[boardId]
 *
 * Update a board.
 */
const patchHandler = async (
    request: NextRequest,
    { params }: { params: Promise<{ boardId: string }> }
) => {
    try {
        const originError = validateMutationRequestOrigin(request);
        if (originError) {
            return originError;
        }

        const { boardId } = await params;
        const supabase = await createServerSupabaseClient();
        const payload = await request.json();

        const { user, errorResponse } = await requireAuthenticatedUser(supabase);
        if (errorResponse || !user) {
            return errorResponse ?? NextResponse.json(
                { error: { code: 'UNAUTHENTICATED', message: 'Login required' } },
                { status: 401 }
            );
        }

        // Check if user is member of the board
        const membership = await getBoardMembership(supabase, boardId, user.id);

        if (!membership) {
            return NextResponse.json(
                { error: { code: 'NOT_FOUND', message: 'Board not found or access denied' } },
                { status: 404 }
            );
        }

        // Only owner or editor can update settings
        if (!hasAnyRole(membership.role, ['owner', 'editor'])) {
            return NextResponse.json(
                { error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } },
                { status: 403 }
            );
        }

        const updates: Record<string, unknown> = {};
        if (typeof payload.day_range === 'number') {
            updates.day_range = Math.max(1, Math.min(7, payload.day_range)); // Limit 1-7 days
        }
        if (typeof payload.list_range === 'number') {
            updates.list_range = Math.max(1, Math.min(120, payload.list_range)); // Limit 1-120 days
        }
        if (typeof payload.name === 'string' && payload.name.trim()) {
            updates.name = payload.name.trim();
        }
        if (payload.team_id !== undefined) {
            return NextResponse.json(
                { error: { code: 'INVALID_BODY', message: 'team_id is immutable' } },
                { status: 422 }
            );
        }

        if (Object.keys(updates).length === 0) {
            return NextResponse.json({ success: true }); // Nothing to update
        }

        const admin = createServiceRoleSupabaseClient();
        const { data: updatedBoard, error: updateError } = await admin
            .from('boards')
            .update(updates)
            .eq('id', boardId)
            .select()
            .maybeSingle();

        if (updateError || !updatedBoard) {
            console.error('Error updating board:', updateError);
            return NextResponse.json(
                { error: { code: 'DB_ERROR', message: updateError?.message ?? 'Failed to update board' } },
                { status: updateError ? 500 : 404 }
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
};

export const DELETE = withErrorHandling(deleteHandler, 'board-by-id-delete');
export const PATCH = withErrorHandling(patchHandler, 'board-by-id-patch');
