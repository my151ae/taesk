import { useState } from 'react';
import { Board } from '@/lib/supabase';
import clsx from 'clsx';
import BoardAccessSettings from '@/app/(board)/_components/BoardAccessSettings';

type BoardSettingsProps = {
    board: Board;
    onUpdate: (updates: Partial<Board>) => Promise<void>;
    onAccessUpdated?: () => Promise<void> | void;
};

export default function BoardSettings({ board, onUpdate, onAccessUpdated }: BoardSettingsProps) {
    const [boardName, setBoardName] = useState(board.name ?? '');
    const [dayRange, setDayRange] = useState(board.day_range ?? 2);
    const [isSaving, setIsSaving] = useState(false);
    const canManageAccess = board.membership_role === 'owner';

    const trimmedName = boardName.trim();
    const hasNameChanged = trimmedName !== (board.name ?? '').trim();
    const hasChanges = hasNameChanged || dayRange !== (board.day_range ?? 2);
    const canSave = hasChanges && trimmedName.length > 0;

    const handleSave = async () => {
        if (!canSave) return;
        setIsSaving(true);
        try {
            const updates: Partial<Board> = {};
            if (hasNameChanged) {
                updates.name = trimmedName;
            }
            if (dayRange !== (board.day_range ?? 2)) {
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

    return (
        <div className="space-y-6">
            <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
                <div>
                    <h3 className="text-sm font-medium text-slate-900">Board Name</h3>
                    <p className="text-xs text-slate-500">Rename this board.</p>
                    <input
                        type="text"
                        value={boardName}
                        onChange={(event) => setBoardName(event.target.value)}
                        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                        placeholder="Board name"
                        maxLength={255}
                    />
                </div>
                <div>
                    <h3 className="text-sm font-medium text-slate-900">Timeline View Range</h3>
                    <p className="text-xs text-slate-500">Configure how many days are visible on the timeline.</p>
                    <div className="mt-3 flex items-center gap-4">
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setDayRange(Math.max(1, dayRange - 1))}
                                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                                disabled={dayRange <= 1}
                            >
                                -
                            </button>
                            <span className="w-16 text-center text-sm font-medium text-slate-900">{dayRange} days</span>
                            <button
                                onClick={() => setDayRange(Math.min(7, dayRange + 1))}
                                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                                disabled={dayRange >= 7}
                            >
                                +
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <BoardAccessSettings
                boardId={board.id}
                canManage={canManageAccess}
                onUpdated={onAccessUpdated}
            />

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
