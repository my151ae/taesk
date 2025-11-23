import { clsx } from 'clsx';
import { Board } from '@/lib/supabase';
import NotificationsBell from '@/app/(board)/_components/NotificationsBell';
import { User } from '@supabase/supabase-js';
import { type UserProfile } from '@/app/(board)/_utils/timeline-helpers';
import type { Priority } from '@/lib/supabase';

type TimelineHeaderProps = {
    board: Board;
    modalBoards: Board[];
    handleBoardNavigate: (board: Board) => void;
    showBoardMenu: boolean;
    setShowBoardMenu: (show: boolean | ((prev: boolean) => boolean)) => void;
    boardMenuRef: React.RefObject<HTMLDivElement>;
    setShowShareDialog: (show: boolean) => void;
    setShowNotificationSettings: (show: boolean) => void;
    setShowProfileSettings: (show: boolean) => void;
    profile: UserProfile | null;
    user: User | null;
    signOut: () => Promise<void>;
    // Filter props
    showFilters: boolean;
    setShowFilters: (show: boolean | ((prev: boolean) => boolean)) => void;
    hasActiveFilters: boolean;
    searchQuery: string;
    setSearchQuery: (query: string) => void;
    selectedTags: string[];
    setSelectedTags: (tags: string[] | ((prev: string[]) => string[])) => void;
    selectedPriority: 'all' | Priority;
    setSelectedPriority: (priority: 'all' | Priority) => void;
    availableTags: string[];
};

export default function TimelineHeader({
    board,
    modalBoards,
    handleBoardNavigate,
    showBoardMenu,
    setShowBoardMenu,
    boardMenuRef,
    setShowShareDialog,
    setShowNotificationSettings,
    setShowProfileSettings,
    profile,
    user,
    signOut,
    showFilters,
    setShowFilters,
    hasActiveFilters,
    searchQuery,
    setSearchQuery,
    selectedTags,
    setSelectedTags,
    selectedPriority,
    setSelectedPriority,
    availableTags,
}: TimelineHeaderProps) {
    return (
        <>
            <header className="space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-emerald-600 shadow-sm ring-1 ring-black/5">
                        <span className="h-2 w-2 rounded-full bg-emerald-500" />
                        Live
                    </div>
                    <h1 className="text-2xl font-semibold text-slate-900 truncate flex-1">{board.name}</h1>

                    <div ref={boardMenuRef} className="relative">
                        <button
                            onClick={() => setShowBoardMenu((prev) => !prev)}
                            className="rounded-full bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50"
                            aria-haspopup="true"
                            aria-expanded={showBoardMenu}
                            data-testid="board-menu-button"
                        >
                            Boards ▾
                        </button>
                        {showBoardMenu && (
                            <div className="absolute right-0 z-40 mt-2 w-64 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                                <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Switch board</p>
                                <div className="max-h-64 overflow-y-auto">
                                    {modalBoards.map((b) => (
                                        <button
                                            key={b.id}
                                            onClick={() => handleBoardNavigate(b)}
                                            className={clsx(
                                                'w-full rounded-xl px-3 py-2 text-left text-sm transition hover:bg-slate-50',
                                                b.id === board.id && 'bg-slate-100 text-slate-900'
                                            )}
                                        >
                                            <div className="font-medium text-slate-800">{b.name || 'Untitled board'}</div>
                                            <p className="text-xs text-slate-500">{b.description || 'Standard board'}</p>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                    <button
                        onClick={() => setShowShareDialog(true)}
                        className="rounded-full bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50"
                        data-testid="share-button"
                    >
                        Share
                    </button>
                    <NotificationsBell />
                    <button
                        onClick={() => setShowNotificationSettings(true)}
                        className="rounded-full bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50"
                        data-testid="notify-button"
                    >
                        Notify
                    </button>
                    <button
                        onClick={() => setShowProfileSettings(true)}
                        className="rounded-full bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50"
                        data-testid="profile-button"
                    >
                        {profile?.display_name || user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email || 'Profile'}
                    </button>
                    <button
                        onClick={async () => {
                            try {
                                await signOut();
                                // Redirect to login page after successful sign out
                                window.location.href = '/login';
                            } catch (error) {
                                console.error('Failed to sign out', error);
                            }
                        }}
                        className="rounded-full bg-slate-900 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-slate-800"
                    >
                        Sign out
                    </button>
                </div>
            </header>

            <section className="rounded-3xl bg-white shadow-sm ring-1 ring-black/5">
                <button
                    onClick={() => setShowFilters((prev) => !prev)}
                    className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                    <span className="flex items-center gap-2">
                        🔍 Filters
                        {hasActiveFilters && (
                            <span className="rounded-full bg-sky-500 px-2 py-0.5 text-xs font-semibold text-white">
                                Active
                            </span>
                        )}
                    </span>
                    <span className={clsx('transform text-slate-400 transition', showFilters ? 'rotate-180' : '')}>▼</span>
                </button>
                {showFilters && (
                    <div className="space-y-4 border-t border-slate-100 px-4 py-4 text-sm text-slate-700">
                        <div className="flex flex-col gap-3 sm:flex-row">
                            <div className="flex-1">
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                                    Search
                                </label>
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(event) => setSearchQuery(event.target.value)}
                                    placeholder="カード名やタグ"
                                    className="w-full rounded-lg border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-300"
                                />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                                    Priority
                                </label>
                                <select
                                    value={selectedPriority}
                                    onChange={(event) => setSelectedPriority(event.target.value as 'all' | Priority)}
                                    className="w-full rounded-lg border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-300"
                                >
                                    <option value="all">すべて</option>
                                    <option value="low">🟢 Low</option>
                                    <option value="medium">🟡 Medium</option>
                                    <option value="high">🔴 High</option>
                                </select>
                            </div>
                        </div>
                        <div>
                            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                                Tags
                            </label>
                            <div className="flex flex-wrap gap-2">
                                {availableTags.length === 0 && (
                                    <span className="text-xs text-slate-400">タグはまだありません</span>
                                )}
                                {availableTags.map((tag) => {
                                    const active = selectedTags.includes(tag);
                                    return (
                                        <button
                                            key={tag}
                                            type="button"
                                            onClick={() => {
                                                setSelectedTags((prev) =>
                                                    prev.includes(tag) ? prev.filter((value) => value !== tag) : [...prev, tag]
                                                );
                                            }}
                                            className={clsx(
                                                'rounded-full px-3 py-1 text-xs font-semibold transition',
                                                active ? 'bg-sky-500 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                                            )}
                                        >
                                            #{tag}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                        {hasActiveFilters && (
                            <button
                                onClick={() => {
                                    setSearchQuery('');
                                    setSelectedTags([]);
                                    setSelectedPriority('all');
                                }}
                                className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200"
                            >
                                Clear filters
                            </button>
                        )}
                    </div>
                )}
            </section>
        </>
    );
}
