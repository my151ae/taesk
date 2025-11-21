import { clsx } from 'clsx';
import { Board } from '@/lib/supabase';
import NotificationsBell from '@/app/(board)/_components/NotificationsBell';
import { User } from '@supabase/supabase-js';
import { SortOption } from '@/app/(board)/_hooks/useBoardFilters';

type Profile = {
    id: string;
    username: string | null;
    display_name: string | null;
    full_name: string | null;
    avatar_url: string | null;
    email: string | null;
};

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
    profile: Profile | null;
    user: User | null;
    signOut: () => Promise<void>;
    // Filter props
    showFilters: boolean;
    setShowFilters: (show: boolean | ((prev: boolean) => boolean)) => void;
    hasActiveFilters: boolean;
    searchQuery: string;
    setSearchQuery: (query: string) => void;
    selectedTags: string[];
    toggleTag: (tag: string) => void;
    selectedPriority: 'all' | 'high' | 'medium' | 'low';
    setSelectedPriority: (priority: 'all' | 'high' | 'medium' | 'low') => void;
    sortBy: SortOption;
    setSortBy: (sort: SortOption) => void;
    allTags: string[];
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
    toggleTag,
    selectedPriority,
    setSelectedPriority,
    sortBy,
    setSortBy,
    allTags,
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
                        {profile?.display_name || user?.email || 'Profile'}
                    </button>
                    <button
                        onClick={async () => {
                            try {
                                await signOut();
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
                                    placeholder="Search cards..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                                />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                                    Priority
                                </label>
                                <select
                                    value={selectedPriority}
                                    onChange={(e) => setSelectedPriority(e.target.value as any)}
                                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                                >
                                    <option value="all">All Priorities</option>
                                    <option value="high">High</option>
                                    <option value="medium">Medium</option>
                                    <option value="low">Low</option>
                                </select>
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                                    Sort
                                </label>
                                <select
                                    value={sortBy}
                                    onChange={(e) => setSortBy(e.target.value as SortOption)}
                                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                                >
                                    <option value="due_date_asc">Due Date (Earliest)</option>
                                    <option value="created_desc">Created (Newest)</option>
                                </select>
                            </div>
                        </div>
                        <div>
                            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                                Tags
                            </label>
                            <div className="flex flex-wrap gap-2">
                                {allTags.map((tag) => (
                                    <button
                                        key={tag}
                                        onClick={() => toggleTag(tag)}
                                        className={clsx(
                                            'rounded-full px-3 py-1 text-xs font-medium transition',
                                            selectedTags.includes(tag)
                                                ? 'bg-sky-500 text-white shadow-sm'
                                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                        )}
                                    >
                                        {tag}
                                    </button>
                                ))}
                                {allTags.length === 0 && <span className="text-slate-400 italic">No tags found</span>}
                            </div>
                        </div>
                    </div>
                )}
            </section>
        </>
    );
}

