import { useState } from 'react';
import { Board } from '@/lib/supabase';
import clsx from 'clsx';
import BoardAccessSettings from '@/app/(board)/_components/BoardAccessSettings';
import { MAIN_BOARD_ID } from '@/lib/board-defaults';

type BoardSettingsProps = {
    board: Board;
    onUpdate: (updates: Partial<Board>) => Promise<void>;
    onAccessUpdated?: () => Promise<void> | void;
    onDelete?: () => Promise<void>;
};

export default function BoardSettings({ board, onUpdate, onAccessUpdated, onDelete }: BoardSettingsProps) {
    const [boardName, setBoardName] = useState(board.name ?? '');
    const [dayRange, setDayRange] = useState(board.day_range ?? 2);
    const [isSaving, setIsSaving] = useState(false);
    const [deleteConfirmationName, setDeleteConfirmationName] = useState('');
    const [isDeleting, setIsDeleting] = useState(false);
    const canEditName = board.membership_role === 'owner';
    const canEditDisplaySettings = !board.membership_role || board.membership_role === 'owner' || board.membership_role === 'editor';
    const canManageAccess = board.membership_role === 'owner';
    const canDeleteBoard = board.membership_role === 'owner' && board.id !== MAIN_BOARD_ID;
    const isProtectedBoard = board.id === MAIN_BOARD_ID;

    const trimmedName = boardName.trim();
    const hasNameChanged = canEditName && trimmedName !== (board.name ?? '').trim();
    const hasDayRangeChanged = canEditDisplaySettings && dayRange !== (board.day_range ?? 2);
    const hasChanges = hasNameChanged || hasDayRangeChanged;
    const canSave = hasChanges && trimmedName.length > 0;
    const canConfirmDelete = deleteConfirmationName.trim() === (board.name ?? '').trim();

    const handleSave = async () => {
        if (!canSave) return;
        setIsSaving(true);
        try {
            const updates: Partial<Board> = {};
            if (hasNameChanged) {
                updates.name = trimmedName;
            }
            if (hasDayRangeChanged) {
                updates.day_range = dayRange;
            }
            await onUpdate({
                ...updates
            });
        } catch (error) {
            console.error('Failed to update board settings', error);
            alert('Failed to update settings');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!canDeleteBoard || !canConfirmDelete || !onDelete) return;
        setIsDeleting(true);
        try {
            await onDelete();
        } catch (error) {
            console.error('Failed to delete board', error);
            alert(error instanceof Error ? error.message : 'Failed to delete board');
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <div className="space-y-6">
            <BoardAccessSettings
                boardId={board.id}
                canManage={canManageAccess}
                onUpdated={onAccessUpdated}
            />

            <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
                <div>
                    <h3 className="text-sm font-medium text-slate-900">Board Name</h3>
                    <p className="text-xs text-slate-500">
                        {canEditName ? 'Rename this board.' : 'Only board owners can rename this board.'}
                    </p>
                    <input
                        type="text"
                        value={boardName}
                        onChange={(event) => setBoardName(event.target.value)}
                        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                        placeholder="Board name"
                        maxLength={255}
                        disabled={!canEditName}
                    />
                </div>
                <div>
                    <h3 className="text-sm font-medium text-slate-900">Timeline View Range</h3>
                    <p className="text-xs text-slate-500">
                        {canEditDisplaySettings ? 'Configure how many days are visible on the timeline.' : 'You do not have permission to change display settings.'}
                    </p>
                    <div className="mt-3 flex items-center gap-4">
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setDayRange(Math.max(1, dayRange - 1))}
                                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                                disabled={!canEditDisplaySettings || dayRange <= 1}
                            >
                                -
                            </button>
                            <span className="w-16 text-center text-sm font-medium text-slate-900">{dayRange} days</span>
                            <button
                                onClick={() => setDayRange(Math.min(7, dayRange + 1))}
                                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                                disabled={!canEditDisplaySettings || dayRange >= 7}
                            >
                                +
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <details className="rounded-xl border border-red-200 bg-red-50/70 p-4">
                <summary className="cursor-pointer list-none text-sm font-semibold text-red-900">
                    Danger Zone
                </summary>
                <div className="mt-4 space-y-3">
                    <div>
                        <h3 className="text-sm font-medium text-red-900">Delete Board</h3>
                        <p className="mt-1 text-xs text-red-700">
                            {isProtectedBoard
                                ? 'This protected board cannot be deleted.'
                                : canDeleteBoard
                                    ? `Type "${board.name}" to enable deletion. This action cannot be undone.`
                                    : 'Only board owners can delete this board.'}
                        </p>
                    </div>
                    <input
                        type="text"
                        value={deleteConfirmationName}
                        onChange={(event) => setDeleteConfirmationName(event.target.value)}
                        className="w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-200"
                        placeholder={board.name ?? 'Board name'}
                        disabled={!canDeleteBoard || isDeleting}
                    />
                    <div className="flex justify-end">
                        <button
                            onClick={handleDelete}
                            disabled={!canDeleteBoard || !canConfirmDelete || isDeleting}
                            className={clsx(
                                'rounded-lg px-4 py-2 text-sm font-semibold text-white transition',
                                !canDeleteBoard || !canConfirmDelete || isDeleting
                                    ? 'cursor-not-allowed bg-red-200'
                                    : 'bg-red-600 hover:bg-red-700'
                            )}
                        >
                            {isDeleting ? 'Deleting...' : 'Delete Board'}
                        </button>
                    </div>
                </div>
            </details>

            <div className="flex justify-end pt-4 border-t border-slate-100">
                <button
                    onClick={handleSave}
                    disabled={isSaving || !canSave}
                    className={clsx(
                        "rounded-lg px-4 py-2 text-sm font-semibold text-white transition",
                        isSaving || !canSave
                            ? "bg-slate-300 cursor-not-allowed"
                            : "bg-sky-500 hover:bg-sky-600"
                    )}
                >
                    {isSaving ? 'Saving...' : 'Save Changes'}
                </button>
            </div>
        </div>
    );
}
