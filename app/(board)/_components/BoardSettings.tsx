import { useState } from 'react';
import { Board } from '@/lib/supabase';
import clsx from 'clsx';

type BoardSettingsProps = {
    board: Board;
    onUpdate: (updates: Partial<Board>) => Promise<void>;
};

export default function BoardSettings({ board, onUpdate }: BoardSettingsProps) {
    const [dayRange, setDayRange] = useState(board.day_range ?? 2);
    const [isSaving, setIsSaving] = useState(false);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            await onUpdate({ day_range: dayRange });
        } catch (error) {
            console.error('Failed to update board settings', error);
            alert('Failed to update settings');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-sm font-medium text-slate-900">Timeline View</h3>
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
                        <span className="w-12 text-center text-sm font-medium text-slate-900">{dayRange} days</span>
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

            <div className="flex justify-end pt-4 border-t border-slate-100">
                <button
                    onClick={handleSave}
                    disabled={isSaving || dayRange === (board.day_range ?? 2)}
                    className={clsx(
                        "rounded-lg px-4 py-2 text-sm font-semibold text-white transition",
                        isSaving || dayRange === (board.day_range ?? 2)
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
