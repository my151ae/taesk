import { clsx } from 'clsx';
import Link from 'next/link';
import { useState, useRef, useEffect } from 'react';
import { useClickOutside } from '@/app/(board)/_hooks/useClickOutside';
import { Board } from '@/lib/supabase';
import NotificationsBell from '@/app/(board)/_components/NotificationsBell';
import { User } from '@supabase/supabase-js';
import { type UserProfile } from '@/app/(board)/_utils/timeline-helpers';
import type { Priority } from '@/lib/supabase';
import type { ProfileSummary } from '@/lib/supabase';
import { getProfileInitial, resolveProfileIdentity } from '@/lib/usernames';

type TimelineHeaderProps = {
    board: Board;
    modalBoards: Board[];
    handleBoardNavigate: (board: Board) => void;
    showBoardMenu: boolean;
    setShowBoardMenu: (show: boolean | ((prev: boolean) => boolean)) => void;
    boardMenuRef: React.RefObject<HTMLDivElement>;
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
    dayRange: number;
    onDayRangeChange: (days: number) => void;
    onTodayClick: () => void;
    onUpdateBoard: (updates: Partial<Board>) => Promise<void>;
    // Google Calendar props
    googleStatusText: string;
    googleCalendarStatus: string;
    googleCalendarError: string | null;
    calendarPreset: 'visible' | 'this-week' | 'next-week';
    setCalendarPreset: (preset: 'visible' | 'this-week' | 'next-week') => void;
    refreshGoogleCalendar: () => void;
    handleGoogleConnect: () => void;
    isGoogleLoading: boolean;
    isCalendarRangeReady: boolean;
    realtimeStatus: 'connected' | 'connecting' | 'disconnected';
    viewMode: 'timeline' | 'list';
    setViewMode: (mode: 'timeline' | 'list') => void;
    onShortcutsClick: () => void;
    onPrevDay?: () => void;
    onNextDay?: () => void;
    listStartDate?: string | null;
};

export default function TimelineHeader({
    board,
    modalBoards,
    handleBoardNavigate,
    showBoardMenu,
    setShowBoardMenu,
    boardMenuRef,
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
    dayRange,
    onDayRangeChange,
    onTodayClick,
    onUpdateBoard,
    googleStatusText,
    googleCalendarStatus,
    googleCalendarError,
    calendarPreset,
    setCalendarPreset,
    refreshGoogleCalendar,
    handleGoogleConnect,
    isGoogleLoading,
    isCalendarRangeReady,
    realtimeStatus,
    viewMode,
    setViewMode,
    onShortcutsClick,
    onPrevDay,
    onNextDay,
    listStartDate,
}: TimelineHeaderProps) {
    const [isCreatingBoard, setIsCreatingBoard] = useState(false);
    const [newBoardName, setNewBoardName] = useState('');
    const [isSubmittingBoard, setIsSubmittingBoard] = useState(false);
    const [showProfileMenu, setShowProfileMenu] = useState(false);
    const [showMobileActions, setShowMobileActions] = useState(false);
    const [showDayRangeDropdown, setShowDayRangeDropdown] = useState(false);
    const dayRangeDropdownRef = useRef<HTMLDivElement>(null);
    const filtersDropdownRef = useRef<HTMLDivElement>(null);
    const profileMenuRef = useRef<HTMLDivElement>(null);
    const mobileActionsRef = useRef<HTMLDivElement>(null);
    const profileIdentity = resolveProfileIdentity(profile as unknown as ProfileSummary | null, user?.email ?? null);
    const profileInitial = getProfileInitial(profile as unknown as ProfileSummary | null, user?.email ?? null);

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

    // Click outside handlers for dropdowns
    useClickOutside(dayRangeDropdownRef, () => setShowDayRangeDropdown(false));
    useClickOutside(filtersDropdownRef, () => setShowFilters(false));
    useClickOutside(profileMenuRef, () => setShowProfileMenu(false));
    useClickOutside(boardMenuRef, () => setShowBoardMenu(false));
    useClickOutside(mobileActionsRef, () => setShowMobileActions(false));

    const getRealtimeStatusColor = () => {
        switch (realtimeStatus) {
            case 'connected': return 'bg-emerald-500';
            case 'connecting': return 'bg-yellow-500';
            case 'disconnected':
            default: return 'bg-red-500';
        }
    };

    const getRealtimeStatusText = () => {
        switch (realtimeStatus) {
            case 'connected': return 'Connected';
            case 'connecting': return 'Connecting...';
            case 'disconnected': return 'Disconnected';
            default: return 'Unknown';
        }
    };

    return (
        <>
            <header className="flex items-center gap-2 border-b border-slate-200 px-2 py-2 md:gap-3 md:px-4">
                <div className="flex min-w-0 flex-1 items-center gap-2 md:gap-3">
                    {/* Board Switch */}
                    <div ref={boardMenuRef} className="relative shrink-0">
                        <button
                            onClick={() => setShowBoardMenu((prev) => !prev)}
                            className="flex items-center justify-center rounded-full bg-white p-2 text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50"
                            aria-haspopup="true"
                            aria-expanded={showBoardMenu}
                            data-testid="board-menu-button"
                            title="Switch Board"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
                            </svg>
                        </button>
                        {showBoardMenu && (
                            <div className="absolute left-0 z-40 mt-2 w-72 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
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

                    {/* Board Name */}
                    <div className="flex items-center gap-2 min-w-0 shrink">
                        <h1 className="text-base font-medium text-slate-900 truncate md:text-xl md:font-semibold shrink min-w-0">{board.name}</h1>
                        <div className="hidden md:flex group relative items-center justify-center" title={`Realtime: ${getRealtimeStatusText()}`}>
                            <div className={clsx("w-2 h-2 rounded-full", getRealtimeStatusColor())} />
                        </div>
                    </div>

                    {/* Google Calendar Icon + Status Text */}
                    <div className="hidden md:flex items-center gap-1.5 shrink-0">
                        <div className="relative group">
                            <button
                                onClick={handleGoogleConnect}
                                disabled={isGoogleLoading}
                                className={clsx(
                                    "p-1.5 rounded-full transition-colors flex items-center justify-center",
                                    googleCalendarStatus === 'success' ? "text-emerald-600 hover:bg-emerald-50" : "text-slate-400 hover:bg-slate-100 hover:text-emerald-600"
                                )}
                                title={googleStatusText}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                                    <path d="M12.75 12.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM7.5 15.75a.75.75 0 1 0 0-1.5 .75.75 0 0 0 0 1.5ZM8.25 17.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM9.75 15.75a.75.75 0 1 0 0-1.5 .75.75 0 0 0 0 1.5ZM10.5 17.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM12 15.75a.75.75 0 1 0 0-1.5 .75.75 0 0 0 0 1.5ZM12.75 17.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM14.25 15.75a.75.75 0 1 0 0-1.5 .75.75 0 0 0 0 1.5ZM15 17.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM16.5 15.75a.75.75 0 1 0 0-1.5 .75.75 0 0 0 0 1.5ZM15 12.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM16.5 13.5a.75.75 0 1 0 0-1.5 .75.75 0 0 0 0 1.5Z" />
                                    <path fillRule="evenodd" d="M6.75 2.25A.75.75 0 0 1 7.5 3v1.5h9V3A.75.75 0 0 1 18 3v1.5h.75a3 3 0 0 1 3 3v11.25a3 3 0 0 1-3 3H5.25a3 3 0 0 1-3-3V7.5a3 3 0 0 1 3-3H6V3a.75.75 0 0 1 .75-.75Zm13.5 9a1.5 1.5 0 0 0-1.5-1.5H5.25a1.5 1.5 0 0 0-1.5 1.5v7.5a1.5 1.5 0 0 0 1.5 1.5h13.5a1.5 1.5 0 0 0 1.5-1.5v-7.5Z" clipRule="evenodd" />
                                </svg>
                                {googleCalendarStatus === 'loading' && (
                                    <span className="absolute top-0 right-0 h-2 w-2 rounded-full bg-sky-500 animate-pulse" />
                                )}
                                {googleCalendarStatus === 'error' && (
                                    <span className="absolute top-0 right-0 h-2 w-2 rounded-full bg-red-500" />
                                )}
                            </button>

                            {/* Popup for Google Calendar settings on hover */}
                            <div className="absolute left-0 top-full mt-2 w-64 p-3 bg-white rounded-xl shadow-xl border border-slate-100 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                                <div className="flex flex-col gap-2">
                                    <p className="text-xs font-semibold text-slate-500 uppercase">Google Calendar</p>
                                    <p className="text-xs text-slate-700">{googleStatusText}</p>
                                    {googleCalendarError && (
                                        <p className="text-xs text-red-600">{googleCalendarError}</p>
                                    )}
                                    {googleCalendarStatus === 'success' && (
                                        <>
                                            <select
                                                value={calendarPreset}
                                                onChange={(e) => setCalendarPreset(e.target.value as typeof calendarPreset)}
                                                className="w-full text-xs rounded-md border border-slate-200 px-2 py-1"
                                            >
                                                <option value="visible">Visible Range</option>
                                                <option value="this-week">This Week</option>
                                                <option value="next-week">Next Week</option>
                                            </select>
                                            <div className="flex gap-2">
                                                <button onClick={() => refreshGoogleCalendar()} className="flex-1 text-xs bg-slate-50 hover:bg-slate-100 py-1 rounded text-slate-700">Refresh</button>
                                                <button onClick={handleGoogleConnect} className="flex-1 text-xs bg-slate-50 hover:bg-slate-100 py-1 rounded text-slate-700">Reconnect</button>
                                            </div>
                                        </>
                                    )}
                                    {googleCalendarStatus !== 'success' && (
                                        <button onClick={handleGoogleConnect} className="w-full text-xs bg-emerald-600 text-white py-1.5 rounded hover:bg-emerald-700">
                                            {googleCalendarStatus === 'disconnected' ? 'Connect' : 'Reconnect'}
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                        <span className="text-xs text-slate-500 whitespace-nowrap">{googleStatusText}</span>
                    </div>
                </div>

                <div className="ml-auto flex items-center gap-2 md:hidden">
                    <button
                        onClick={onTodayClick}
                        className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50"
                    >
                        Today
                    </button>
                    <button
                        onClick={() => setViewMode(viewMode === 'timeline' ? 'list' : 'timeline')}
                        className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50"
                    >
                        {viewMode === 'timeline' ? 'List' : 'Timeline'}
                    </button>
                    <div ref={mobileActionsRef} className="relative">
                    <button
                        type="button"
                        onClick={() => setShowMobileActions((prev) => !prev)}
                        aria-expanded={showMobileActions}
                        aria-label="ヘッダーメニュー"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-700 shadow-sm ring-1 ring-slate-200"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="h-5 w-5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                        </svg>
                    </button>
                    {showMobileActions && (
                        <div className="absolute right-0 z-50 mt-2 w-64 rounded-xl border border-slate-100 bg-white p-2 shadow-lg ring-1 ring-black/5">
                            <div className="space-y-1">
                                <button
                                    onClick={() => {
                                        onShortcutsClick();
                                        setShowMobileActions(false);
                                    }}
                                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                                >
                                    <span>Shortcuts</span>
                                </button>
                                <button
                                    onClick={() => {
                                        setViewMode(viewMode === 'timeline' ? 'list' : 'timeline');
                                        setShowMobileActions(false);
                                    }}
                                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                                >
                                    <span>{viewMode === 'timeline' ? 'Listに切替' : 'Timelineに切替'}</span>
                                </button>
                                {viewMode === 'timeline' && (
                                    <div className="rounded-lg px-3 py-2 text-sm text-slate-700">
                                        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Range</p>
                                        <select
                                            value={dayRange}
                                            onChange={(event) => {
                                                onDayRangeChange(Number(event.target.value));
                                                setShowMobileActions(false);
                                            }}
                                            className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-sky-300"
                                        >
                                            {[1, 2, 3, 4, 5, 6, 7].map((days) => (
                                                <option key={days} value={days}>
                                                    {days} day{days > 1 ? 's' : ''}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                )}
                                <button
                                    onClick={() => {
                                        setShowFilters((prev) => !prev);
                                        setShowMobileActions(false);
                                    }}
                                    className={clsx(
                                        "flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-slate-50",
                                        hasActiveFilters ? "text-sky-700" : "text-slate-700"
                                    )}
                                >
                                    <span>Filters</span>
                                    {hasActiveFilters && <span className="h-2 w-2 rounded-full bg-sky-500" />}
                                </button>
                                <button
                                    onClick={() => {
                                        setShowProfileSettings(true);
                                        setShowMobileActions(false);
                                    }}
                                    className="flex w-full items-center rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                                >
                                    Profile Settings
                                </button>
                                <button
                                    onClick={() => {
                                        setShowNotificationSettings(true);
                                        setShowMobileActions(false);
                                    }}
                                    className="flex w-full items-center rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                                >
                                    Notifications
                                </button>
                                <button
                                    onClick={() => {
                                        setShowBoardSettings(true);
                                        setShowMobileActions(false);
                                    }}
                                    className="flex w-full items-center rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                                >
                                    Board Settings
                                </button>
                                <button
                                    onClick={async () => {
                                        try {
                                            await signOut();
                                            window.location.href = '/login';
                                        } catch (error) {
                                            console.error('Failed to sign out', error);
                                        }
                                    }}
                                    className="flex w-full items-center rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                                >
                                    Sign out
                                </button>
                            </div>
                        </div>
                    )}
                </div>
                </div>

                <div className="hidden items-center gap-2 md:flex">

                {/* Shortcuts Button */}
                <button
                    onClick={onShortcutsClick}
                    className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50 shrink-0"
                >
                    Shortcuts
                </button>

                {/* List Toggle Button */}
                <button
                    onClick={() => setViewMode(viewMode === 'timeline' ? 'list' : 'timeline')}
                    className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50 shrink-0"
                >
                    {viewMode === 'timeline' ? 'List' : 'Timeline'}
                </button>

                {/* Today Button */}
                {viewMode === 'timeline' && (
                    <button
                        onClick={onTodayClick}
                        className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50 shrink-0"
                    >
                        Today
                    </button>
                )}

                {/* Day Range Selector */}
                {viewMode === 'timeline' && (
                <div ref={dayRangeDropdownRef} className="flex items-center gap-1 rounded-full bg-white px-2 py-1 shadow-sm ring-1 ring-slate-200 relative text-xs shrink-0">
                    <button
                        onClick={() => onDayRangeChange(Math.max(1, dayRange - 1))}
                        disabled={dayRange <= 1}
                        className="flex h-6 w-6 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                    >
                        -
                    </button>
                    <button
                        onClick={() => setShowDayRangeDropdown((prev) => !prev)}
                        className="min-w-[3rem] flex items-center justify-center gap-1 text-center font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                    >
                        <span>{`${dayRange} day${dayRange > 1 ? 's' : ''}`}</span>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 text-slate-400">
                            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                        </svg>
                    </button>
                    {showDayRangeDropdown && (
                        <div className="absolute top-full mt-1 left-1/2 -translate-x-1/2 z-50 w-32 origin-top rounded-lg border border-slate-100 bg-white py-1 shadow-lg ring-1 ring-black/5">
                            {[1, 2, 3, 4, 5, 6, 7].map((days) => (
                                <button
                                    key={days}
                                    onClick={() => {
                                        onDayRangeChange(days);
                                        setShowDayRangeDropdown(false);
                                    }}
                                    className={clsx(
                                        "flex w-full items-center justify-center px-3 py-1.5 text-xs font-medium transition",
                                        dayRange === days
                                            ? "bg-sky-50 text-sky-700"
                                            : "text-slate-700 hover:bg-slate-50"
                                    )}
                                >
                                    {days} {days === 1 ? 'day' : 'days'}
                                </button>
                            ))}
                        </div>
                    )}
                    <button
                        onClick={() => onDayRangeChange(Math.min(7, dayRange + 1))}
                        disabled={dayRange >= 7}
                        className="flex h-6 w-6 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                    >
                        +
                    </button>
                </div>
                )}

                {/* Filters Button */}
                <div ref={filtersDropdownRef} className="relative shrink-0">
                    <button
                        onClick={() => setShowFilters((prev) => !prev)}
                        className={clsx(
                            "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium shadow-sm ring-1 ring-slate-200 transition-colors",
                            hasActiveFilters ? "bg-sky-50 text-sky-700 ring-sky-200" : "bg-white text-slate-700 hover:bg-slate-50"
                        )}
                        title="Filters"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" />
                        </svg>
                        <span>Filters</span>
                        {hasActiveFilters && (
                            <span className="flex h-2 w-2 rounded-full bg-sky-500" />
                        )}
                    </button>

                    {showFilters && (
                        <div className="absolute right-0 z-50 mt-2 w-80 origin-top-right rounded-xl border border-slate-100 bg-white p-3 shadow-lg ring-1 ring-black/5 focus:outline-none">
                            <div className="space-y-3">
                                <div className="flex gap-2">
                                    <div className="flex-1">
                                        <input
                                            type="text"
                                            value={searchQuery}
                                            onChange={(event) => setSearchQuery(event.target.value)}
                                            placeholder="Search..."
                                            className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-sky-300"
                                        />
                                    </div>
                                    <div className="w-24">
                                        <select
                                            value={selectedPriority}
                                            onChange={(event) => setSelectedPriority(event.target.value as 'all' | Priority)}
                                            className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-sky-300"
                                        >
                                            <option value="all">Priority</option>
                                            <option value="low">Low</option>
                                            <option value="medium">Medium</option>
                                            <option value="high">High</option>
                                        </select>
                                    </div>
                                </div>

                                <div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {availableTags.length === 0 && (
                                            <span className="text-xs text-slate-400">No tags available</span>
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
                                                        'rounded-full px-2 py-0.5 text-[10px] font-medium transition border',
                                                        active ? 'bg-sky-50 border-sky-200 text-sky-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                                                    )}
                                                >
                                                    #{tag}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                {hasActiveFilters && (
                                    <div className="border-t border-slate-100 pt-2 flex justify-end">
                                        <button
                                            onClick={() => {
                                                setSearchQuery('');
                                                setSelectedTags([]);
                                                setSelectedPriority('all');
                                            }}
                                            className="text-xs font-medium text-slate-500 hover:text-slate-700"
                                        >
                                            Clear all
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Notifications Bell */}
                <NotificationsBell />

                {/* Profile Menu */}
                <div ref={profileMenuRef} className="relative shrink-0">
                    <button
                        onClick={() => setShowProfileMenu((prev) => !prev)}
                        className="flex items-center gap-1 rounded-full bg-white px-2 py-1.5 text-xs font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50"
                        data-testid="profile-menu-button"
                    >
                        <div className="h-6 w-6 rounded-full bg-sky-100 text-xs flex items-center justify-center text-sky-600 font-bold">
                            {profileInitial}
                        </div>
                        <span className="hidden max-w-[140px] truncate text-xs font-medium text-slate-700 md:block">
                            {profileIdentity.label}
                        </span>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-slate-400">
                            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                        </svg>
                    </button>

                    {showProfileMenu && (
                        <div className="absolute right-0 z-50 mt-2 w-56 origin-top-right rounded-xl border border-slate-100 bg-white py-1 shadow-lg ring-1 ring-black/5 focus:outline-none">
                            <div className="px-4 py-3 border-b border-slate-100">
                                <p className="text-sm font-medium text-slate-900">{profileIdentity.label}</p>
                                <p className="text-xs text-slate-500 truncate">{profileIdentity.secondary || user?.email}</p>
                            </div>

                            <div className="p-1">
                                <button
                                    onClick={() => {
                                        setShowProfileSettings(true);
                                        setShowProfileMenu(false);
                                    }}
                                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                                >
                                    <span>👤</span> Profile Settings
                                </button>
                                <button
                                    onClick={() => {
                                        setShowNotificationSettings(true);
                                        setShowProfileMenu(false);
                                    }}
                                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                                >
                                    <span>🔔</span> Notifications
                                </button>
                                <Link
                                    href="/playground"
                                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                                    onClick={() => setShowProfileMenu(false)}
                                >
                                    <span>🧪</span> Playground
                                </Link>
                            </div>

                            <div className="border-t border-slate-100 p-1">
                                <button
                                    onClick={async () => {
                                        try {
                                            await signOut();
                                            window.location.href = '/login';
                                        } catch (error) {
                                            console.error('Failed to sign out', error);
                                        }
                                    }}
                                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-red-600 hover:bg-red-50"
                                >
                                    <span>🚪</span> Sign out
                                </button>
                            </div>
                        </div>
                    )}
                </div>
                </div>
            </header>
        </>
    );
}
