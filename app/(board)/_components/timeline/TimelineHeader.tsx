import { clsx } from 'clsx';
import { useState } from 'react';
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
    setShowBoardSettings: (show: boolean) => void;
    onTodayClick: () => void;
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
    setShowBoardSettings,
    onTodayClick,
}: TimelineHeaderProps) {
    const [isCreatingBoard, setIsCreatingBoard] = useState(false);
    const [newBoardName, setNewBoardName] = useState('');
    const [isSubmittingBoard, setIsSubmittingBoard] = useState(false);
    const [showMobileMenu, setShowMobileMenu] = useState(false);

    const handleCreateBoard = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newBoardName.trim()) return;

        try {
            setIsSubmittingBoard(true);
            const response = await fetch('/api/boards', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newBoardName.trim() }),
            });

            if (!response.ok) throw new Error('Failed to create board');

            const { board } = await response.json();
            window.location.href = `/b/${board.short_id}`;
        } catch (error) {
            console.error('Failed to create board:', error);
            alert('Failed to create board');
        } finally {
            setIsSubmittingBoard(false);
            setIsCreatingBoard(false);
            setNewBoardName('');
        }
    };

    const handleDeleteBoard = async (boardId: string, boardName: string) => {
        if (!confirm(`Are you sure you want to delete "${boardName}"? This cannot be undone.`)) return;

        try {
            const response = await fetch(`/api/boards/${boardId}`, {
                method: 'DELETE',
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error?.message || 'Failed to delete board');
            }

            // If deleted current board, redirect to home (which will redirect to another board or show error)
            if (boardId === board.id) {
                window.location.href = '/board';
            } else {
                // Refresh page to update list
                window.location.reload();
            }
        } catch (error) {
            console.error('Failed to delete board:', error);
            alert(error instanceof Error ? error.message : 'Failed to delete board');
        }
    };

    return (
        <>
            <header className="space-y-6">
                <div className="flex flex-wrap items-center gap-3 relative">
                    {/* Burger Menu Button (Mobile Only) */}
                    <button
                        onClick={() => setShowMobileMenu(true)}
                        className="md:hidden rounded-lg p-2 text-slate-600 hover:bg-slate-100"
                    >
                        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                        </svg>
                    </button>

                    <div className="hidden md:flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-emerald-600 shadow-sm ring-1 ring-black/5">
                        <span className="h-2 w-2 rounded-full bg-emerald-500" />
                        Live
                    </div>
                    <h1 className="text-2xl font-semibold text-slate-900 truncate flex-1">{board.name}</h1>

                    {/* Today button - centered */}
                    <div className="absolute left-1/2 transform -translate-x-1/2">
                        <button
                            onClick={onTodayClick}
                            className="hidden md:block rounded-full bg-white px-4 py-1.5 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50"
                        >
                            Today
                        </button>
                    </div>

                    <div ref={boardMenuRef} className="relative hidden md:block">
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
                            <div className="absolute right-0 z-40 mt-2 w-72 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                                <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Switch board</p>
                                <div className="max-h-64 overflow-y-auto space-y-1">
                                    {modalBoards.map((b) => (
                                        <div key={b.id} className="group flex items-center gap-1 pr-2">
                                            <button
                                                onClick={() => handleBoardNavigate(b)}
                                                className={clsx(
                                                    'flex-1 rounded-xl px-3 py-2 text-left text-sm transition hover:bg-slate-50',
                                                    b.id === board.id && 'bg-slate-100 text-slate-900'
                                                )}
                                            >
                                                <div className="font-medium text-slate-800">{b.name || 'Untitled board'}</div>
                                                <p className="text-xs text-slate-500">
                                                    {b.description || 'Standard board'} • {b.day_range ?? 2} days
                                                </p>
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleDeleteBoard(b.id, b.name);
                                                }}
                                                className="hidden group-hover:flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"
                                                title="Delete board"
                                            >
                                                🗑️
                                            </button>
                                        </div>
                                    ))}
                                </div>
                                <div className="mt-2 border-t border-slate-100 pt-2 px-2">
                                    {isCreatingBoard ? (
                                        <form onSubmit={handleCreateBoard} className="space-y-2">
                                            <input
                                                type="text"
                                                value={newBoardName}
                                                onChange={(e) => setNewBoardName(e.target.value)}
                                                placeholder="New board name"
                                                className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                                                autoFocus
                                            />
                                            <div className="flex gap-2">
                                                <button
                                                    type="submit"
                                                    disabled={isSubmittingBoard || !newBoardName.trim()}
                                                    className="flex-1 rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-600 disabled:opacity-50"
                                                >
                                                    Create
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setIsCreatingBoard(false)}
                                                    className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200"
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </form>
                                    ) : (
                                        <button
                                            onClick={() => setIsCreatingBoard(true)}
                                            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:border-sky-300 hover:bg-sky-50 hover:text-sky-600"
                                        >
                                            + Create new board
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="hidden md:block">
                        <button
                            onClick={() => setShowShareDialog(true)}
                            className="rounded-full bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50"
                            data-testid="share-button"
                        >
                            Share
                        </button>
                    </div>
                    <div className="hidden md:block">
                        <button
                            onClick={() => setShowBoardSettings(true)}
                            className="rounded-full bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50"
                        >
                            Settings
                        </button>
                    </div>
                    <NotificationsBell />
                    <div className="hidden md:block">
                        <button
                            onClick={() => setShowNotificationSettings(true)}
                            className="rounded-full bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50"
                            data-testid="notify-button"
                        >
                            Notify
                        </button>
                    </div>
                    <button
                        onClick={() => setShowProfileSettings(true)}
                        className="rounded-full bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50"
                        data-testid="profile-button"
                    >
                        {profile?.display_name || 'Profile'}
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
                        className="hidden md:block rounded-full bg-slate-900 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-slate-800"
                    >
                        Sign out
                    </button>
                </div>

                {/* Mobile Menu Overlay */}
                {showMobileMenu && (
                    <div className="fixed inset-0 z-50 flex flex-col bg-white md:hidden">
                        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                            <h2 className="text-lg font-semibold text-slate-900">Menu</h2>
                            <button
                                onClick={() => setShowMobileMenu(false)}
                                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                            >
                                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 space-y-6">
                            {/* Boards Section */}
                            <div>
                                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Boards</h3>
                                <div className="space-y-1">
                                    {modalBoards.map((b) => (
                                        <button
                                            key={b.id}
                                            onClick={() => {
                                                handleBoardNavigate(b);
                                                setShowMobileMenu(false);
                                            }}
                                            className={clsx(
                                                'w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition',
                                                b.id === board.id ? 'bg-sky-50 text-sky-700' : 'text-slate-700 hover:bg-slate-50'
                                            )}
                                        >
                                            {b.name}
                                        </button>
                                    ))}
                                    <button
                                        onClick={() => {
                                            setShowBoardMenu(true); // Re-use existing logic or show simple input here
                                            // For simplicity in this menu, let's just close and open the main board menu if needed,
                                            // OR implement simple create here.
                                            // Let's just use the existing board menu logic but maybe it's hidden.
                                            // Actually, let's just show the create input here if we want full mobile support.
                                            // For now, let's just keep it simple.
                                        }}
                                        className="w-full rounded-lg border border-dashed border-slate-300 px-3 py-2 text-left text-sm font-medium text-slate-500"
                                    >
                                        + Create new board (Use PC)
                                    </button>
                                </div>
                            </div>

                            {/* Actions Section */}
                            <div>
                                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Actions</h3>
                                <div className="space-y-2">
                                    <button
                                        onClick={() => {
                                            setShowShareDialog(true);
                                            setShowMobileMenu(false);
                                        }}
                                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                                    >
                                        <span>📤</span> Share Board
                                    </button>
                                    <button
                                        onClick={() => {
                                            setShowNotificationSettings(true);
                                            setShowMobileMenu(false);
                                        }}
                                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                                    >
                                        <span>🔔</span> Notifications
                                    </button>
                                    <button
                                        onClick={() => {
                                            setShowBoardSettings(true);
                                            setShowMobileMenu(false);
                                        }}
                                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                                    >
                                        <span>⚙️</span> Board Settings
                                    </button>
                                </div>
                            </div>

                            {/* Filters Section (Embedded) */}
                            <div>
                                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Filters</h3>
                                <div className="space-y-4 rounded-xl border border-slate-100 p-4">
                                    <div>
                                        <label className="mb-1 block text-xs font-medium text-slate-500">Search</label>
                                        <input
                                            type="text"
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                                            placeholder="Search cards..."
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs font-medium text-slate-500">Priority</label>
                                        <select
                                            value={selectedPriority}
                                            onChange={(e) => setSelectedPriority(e.target.value as any)}
                                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                                        >
                                            <option value="all">All</option>
                                            <option value="low">Low</option>
                                            <option value="medium">Medium</option>
                                            <option value="high">High</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs font-medium text-slate-500">Tags</label>
                                        <div className="flex flex-wrap gap-2">
                                            {availableTags.map((tag) => (
                                                <button
                                                    key={tag}
                                                    onClick={() => setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])}
                                                    className={clsx(
                                                        'rounded-full px-2 py-1 text-xs font-medium',
                                                        selectedTags.includes(tag) ? 'bg-sky-500 text-white' : 'bg-slate-100 text-slate-600'
                                                    )}
                                                >
                                                    #{tag}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Sign Out */}
                            <div className="pt-4 border-t border-slate-100">
                                <button
                                    onClick={async () => {
                                        await signOut();
                                        window.location.href = '/login';
                                    }}
                                    className="w-full rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200"
                                >
                                    Sign out
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </header>

            {/* Desktop Filters (Hidden on Mobile) */}
            <section className="hidden md:block rounded-3xl bg-white shadow-sm ring-1 ring-black/5">
                <button
                    onClick={() => setShowFilters((prev) => !prev)}
                    className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 rounded-3xl"
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
                {
                    showFilters && (
                        <div className="space-y-3 border-t border-slate-100 px-4 py-2 mx-2 text-sm text-slate-700">
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
                                        className="w-full rounded-lg border border-slate-200 px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                                    />
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                                        Priority
                                    </label>
                                    <select
                                        value={selectedPriority}
                                        onChange={(event) => setSelectedPriority(event.target.value as 'all' | Priority)}
                                        className="w-full rounded-lg border border-slate-200 px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
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
                    )
                }
            </section>
        </>
    );
}
