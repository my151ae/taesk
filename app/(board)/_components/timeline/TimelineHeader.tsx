import { clsx } from 'clsx';
import Link from 'next/link';
import { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Board, TeamView } from '@/lib/supabase';
import NotificationsBell from '@/app/(board)/_components/NotificationsBell';
import { User } from '@supabase/supabase-js';
import { type UserProfile } from '@/app/(board)/_utils/timeline-helpers';
import type { ProfileSummary } from '@/lib/supabase';
import type { GoogleCalendarListEntry, GoogleCalendarPartialError } from '@/lib/api-types/google-calendar';
import { getProfileInitial, resolveProfileIdentity } from '@/lib/usernames';

function canCreateBoardInTeam(team: TeamView): boolean {
    return team.role === 'owner'
        || team.role === 'admin'
        || (team.role === 'member' && team.allow_member_create_board);
}

function canEditBoard(board: Board): boolean {
    if (!board.membership_role) return true;
    return board.membership_role === 'owner' || board.membership_role === 'editor';
}

type TimelineHeaderProps = {
    board: Board;
    modalBoards: Board[];
    modalTeams: TeamView[];
    handleBoardNavigate: (board: Board) => void;
    showBoardMenu: boolean;
    setShowBoardMenu: (show: boolean | ((prev: boolean) => boolean)) => void;
    boardMenuRef: React.RefObject<HTMLDivElement>;
    setShowNotificationSettings: (show: boolean) => void;
    onOpenNotificationsPanel: () => void;
    setShowProfileSettings: (show: boolean) => void;
    profile: UserProfile | null;
    user: User | null;
    signOut: () => Promise<void>;
    onOpenBoardSettings: (boardId: string | null | undefined) => void;
    dayRange: number;
    onDayRangeChange: (days: number) => void;
    onTodayClick: () => void;
    // Google Calendar props
    googleStatusText: string;
    googleCalendarStatus: string;
    googleCalendarError: string | null;
    googleCalendars: GoogleCalendarListEntry[];
    selectedGoogleCalendarIds: string[];
    googleCalendarPartialErrors: GoogleCalendarPartialError[];
    googleCalendarSelectionStatus: 'idle' | 'saving' | 'error';
    updateGoogleCalendarSelection: (selectedCalendarIds: string[]) => Promise<void>;
    calendarPreset: 'visible' | 'this-week' | 'next-week';
    setCalendarPreset: (preset: 'visible' | 'this-week' | 'next-week') => void;
    refreshGoogleCalendar: () => void;
    handleGoogleConnect: () => void;
    isGoogleLoading: boolean;
    realtimeStatus: 'connected' | 'connecting' | 'disconnected';
    viewMode: 'timeline' | 'list' | 'month';
    onShortcutsClick: () => void;
    onOpenTeamSettings: (teamId: string | null | undefined) => void;
    collapsed?: boolean;
};

type HeaderMenuPosition = {
    top: number;
    left: number;
    minWidth?: number;
};

export default function TimelineHeader({
    board,
    modalBoards,
    modalTeams,
    handleBoardNavigate,
    showBoardMenu,
    setShowBoardMenu,
    boardMenuRef,
    setShowNotificationSettings,
    onOpenNotificationsPanel,
    setShowProfileSettings,
    profile,
    user,
    signOut,
    onOpenBoardSettings,
    dayRange,
    onDayRangeChange,
    onTodayClick,
    googleStatusText,
    googleCalendarStatus,
    googleCalendarError,
    googleCalendars,
    selectedGoogleCalendarIds,
    googleCalendarPartialErrors,
    googleCalendarSelectionStatus,
    updateGoogleCalendarSelection,
    calendarPreset,
    setCalendarPreset,
    refreshGoogleCalendar,
    handleGoogleConnect,
    isGoogleLoading,
    realtimeStatus,
    viewMode,
    onShortcutsClick,
    onOpenTeamSettings,
    collapsed = false,
}: TimelineHeaderProps) {
    const [isCreatingBoard, setIsCreatingBoard] = useState(false);
    const [createBoardTeamId, setCreateBoardTeamId] = useState<string | null>(board.team_id ?? null);
    const [newBoardName, setNewBoardName] = useState('');
    const [isSubmittingBoard, setIsSubmittingBoard] = useState(false);
    const [showProfileMenu, setShowProfileMenu] = useState(false);
    const [showGoogleMenu, setShowGoogleMenu] = useState(false);
    const [showMobileActions, setShowMobileActions] = useState(false);
    const [boardMenuPosition, setBoardMenuPosition] = useState<HeaderMenuPosition | null>(null);
    const [googleMenuPosition, setGoogleMenuPosition] = useState<HeaderMenuPosition | null>(null);
    const [profileMenuPosition, setProfileMenuPosition] = useState<HeaderMenuPosition | null>(null);
    const [mobileActionsPosition, setMobileActionsPosition] = useState<HeaderMenuPosition | null>(null);
    const boardMenuButtonRef = useRef<HTMLButtonElement>(null);
    const profileMenuRef = useRef<HTMLDivElement>(null);
    const profileMenuButtonRef = useRef<HTMLButtonElement>(null);
    const googleMenuRef = useRef<HTMLDivElement>(null);
    const googleMenuButtonRef = useRef<HTMLButtonElement>(null);
    const mobileActionsRef = useRef<HTMLDivElement>(null);
    const mobileActionsButtonRef = useRef<HTMLButtonElement>(null);
    const mobileActionsMenuRef = useRef<HTMLDivElement>(null);
    const profileIdentity = resolveProfileIdentity(profile as unknown as ProfileSummary | null, user?.email ?? null);
    const profileInitial = getProfileInitial(profile as unknown as ProfileSummary | null, user?.email ?? null);
    const todayButtonClassName = "shrink-0 rounded-full bg-sky-200 px-2.5 py-1 text-xs font-medium text-sky-800 shadow-sm ring-1 ring-sky-300 hover:bg-sky-300";
    const selectedGoogleCalendarSet = useMemo(() => new Set(selectedGoogleCalendarIds), [selectedGoogleCalendarIds]);
    const selectedGoogleCalendarCount = selectedGoogleCalendarIds.length;
    const orderedGoogleCalendars = useMemo(
        () => [...googleCalendars].sort((left, right) => {
            const leftSelected = selectedGoogleCalendarSet.has(left.id);
            const rightSelected = selectedGoogleCalendarSet.has(right.id);
            if (leftSelected !== rightSelected) return leftSelected ? -1 : 1;
            if (left.primary !== right.primary) return left.primary ? -1 : 1;
            return left.summary.localeCompare(right.summary);
        }),
        [googleCalendars, selectedGoogleCalendarSet],
    );
    const toggleGoogleCalendar = (calendarId: string, checked: boolean) => {
        const next = checked
            ? [...selectedGoogleCalendarIds, calendarId]
            : selectedGoogleCalendarIds.filter((id) => id !== calendarId);
        void updateGoogleCalendarSelection(next);
    };

    const handleCreateBoard = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newBoardName.trim()) return;

        try {
            setIsSubmittingBoard(true);
            if (!createBoardTeamId) {
                throw new Error('Current board has no team_id');
            }
            const response = await fetch('/api/boards', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newBoardName.trim(), team_id: createBoardTeamId }),
            });

            if (!response.ok) throw new Error('Failed to create board');

            const { board: createdBoard } = await response.json();
            window.location.href = `/b/${createdBoard.short_id}`;
        } catch (error) {
            console.error('Failed to create board:', error);
            alert('Failed to create board');
        } finally {
            setIsSubmittingBoard(false);
            setIsCreatingBoard(false);
            setNewBoardName('');
        }
    };

    const handleStartCreateBoard = (teamId: string) => {
        setCreateBoardTeamId(teamId);
        setIsCreatingBoard(true);
        setNewBoardName('');
    };

    const handleBoardSelection = (nextBoard: Board) => {
        if (nextBoard.id === board.id) {
            handleBoardNavigate(nextBoard);
            return;
        }

        if (!confirm(`"${nextBoard.name || 'Untitled board'}" を開きますか？`)) {
            return;
        }

        handleBoardNavigate(nextBoard);
    };

    useEffect(() => {
        if (!showBoardMenu) {
            setIsCreatingBoard(false);
            setNewBoardName('');
            setCreateBoardTeamId(board.team_id ?? null);
        }
    }, [board.team_id, showBoardMenu]);

    useEffect(() => {
        if (!collapsed) return;
        setShowBoardMenu(false);
        setShowProfileMenu(false);
        setShowGoogleMenu(false);
        setShowMobileActions(false);
        setIsCreatingBoard(false);
    }, [collapsed, setShowBoardMenu]);

    useEffect(() => {
        if (!showBoardMenu) return;

        const updateMenuPosition = () => {
            const rect = boardMenuButtonRef.current?.getBoundingClientRect();
            if (!rect) return;
            setBoardMenuPosition({
                top: rect.bottom + 8,
                left: rect.left,
                minWidth: 320,
            });
        };

        updateMenuPosition();
        window.addEventListener('resize', updateMenuPosition);
        window.addEventListener('scroll', updateMenuPosition, true);

        return () => {
            window.removeEventListener('resize', updateMenuPosition);
            window.removeEventListener('scroll', updateMenuPosition, true);
        };
    }, [showBoardMenu]);

    useEffect(() => {
        if (!showGoogleMenu) return;

        const updateMenuPosition = () => {
            const rect = googleMenuButtonRef.current?.getBoundingClientRect();
            if (!rect) return;
            setGoogleMenuPosition({
                top: rect.bottom + 8,
                left: rect.left,
                minWidth: 256,
            });
        };

        updateMenuPosition();
        window.addEventListener('resize', updateMenuPosition);
        window.addEventListener('scroll', updateMenuPosition, true);

        return () => {
            window.removeEventListener('resize', updateMenuPosition);
            window.removeEventListener('scroll', updateMenuPosition, true);
        };
    }, [showGoogleMenu]);

    useEffect(() => {
        if (!showProfileMenu) return;

        const updateMenuPosition = () => {
            const rect = profileMenuButtonRef.current?.getBoundingClientRect();
            if (!rect) return;
            setProfileMenuPosition({
                top: rect.bottom + 8,
                left: Math.max(8, rect.right - 224),
                minWidth: 224,
            });
        };

        updateMenuPosition();
        window.addEventListener('resize', updateMenuPosition);
        window.addEventListener('scroll', updateMenuPosition, true);

        return () => {
            window.removeEventListener('resize', updateMenuPosition);
            window.removeEventListener('scroll', updateMenuPosition, true);
        };
    }, [showProfileMenu]);

    useEffect(() => {
        if (!showMobileActions) return;

        const updateMenuPosition = () => {
            const rect = mobileActionsButtonRef.current?.getBoundingClientRect();
            if (!rect) return;
            const minWidth = 256;
            setMobileActionsPosition({
                top: rect.bottom + 8,
                left: Math.max(8, rect.right - minWidth),
                minWidth,
            });
        };

        updateMenuPosition();
        window.addEventListener('resize', updateMenuPosition);
        window.addEventListener('scroll', updateMenuPosition, true);

        return () => {
            window.removeEventListener('resize', updateMenuPosition);
            window.removeEventListener('scroll', updateMenuPosition, true);
        };
    }, [showMobileActions]);

    useEffect(() => {
        if (!showBoardMenu) return;

        const listener = (event: MouseEvent | TouchEvent) => {
            const target = event.target as Node;
            if (boardMenuButtonRef.current?.contains(target) || boardMenuRef.current?.contains(target)) return;
            setShowBoardMenu(false);
        };

        document.addEventListener('mousedown', listener);
        document.addEventListener('touchstart', listener);
        return () => {
            document.removeEventListener('mousedown', listener);
            document.removeEventListener('touchstart', listener);
        };
    }, [showBoardMenu, boardMenuRef, setShowBoardMenu]);

    useEffect(() => {
        if (!showGoogleMenu) return;

        const listener = (event: MouseEvent | TouchEvent) => {
            const target = event.target as Node;
            if (googleMenuButtonRef.current?.contains(target) || googleMenuRef.current?.contains(target)) return;
            setShowGoogleMenu(false);
        };

        document.addEventListener('mousedown', listener);
        document.addEventListener('touchstart', listener);
        return () => {
            document.removeEventListener('mousedown', listener);
            document.removeEventListener('touchstart', listener);
        };
    }, [showGoogleMenu]);

    useEffect(() => {
        if (!showProfileMenu) return;

        const listener = (event: MouseEvent | TouchEvent) => {
            const target = event.target as Node;
            if (profileMenuButtonRef.current?.contains(target) || profileMenuRef.current?.contains(target)) return;
            setShowProfileMenu(false);
        };

        document.addEventListener('mousedown', listener);
        document.addEventListener('touchstart', listener);
        return () => {
            document.removeEventListener('mousedown', listener);
            document.removeEventListener('touchstart', listener);
        };
    }, [showProfileMenu]);

    useEffect(() => {
        if (!showMobileActions) return;

        const listener = (event: MouseEvent | TouchEvent) => {
            const target = event.target as Node;
            if (mobileActionsButtonRef.current?.contains(target) || mobileActionsMenuRef.current?.contains(target)) return;
            setShowMobileActions(false);
        };

        document.addEventListener('mousedown', listener);
        document.addEventListener('touchstart', listener);
        return () => {
            document.removeEventListener('mousedown', listener);
            document.removeEventListener('touchstart', listener);
        };
    }, [showMobileActions]);

    const boardsByTeamId = useMemo(() => {
        const groups = new Map<string, Board[]>();
        for (const b of modalBoards) {
            const teamId = b.team_id ?? '__no_team__';
            const list = groups.get(teamId) ?? [];
            list.push(b);
            groups.set(teamId, list);
        }
        return groups;
    }, [modalBoards]);

    const teamSections = useMemo(() => {
        const sortedTeams = [...modalTeams].sort((a, b) => {
            if (a.id === board.team_id && b.id !== board.team_id) return -1;
            if (b.id === board.team_id && a.id !== board.team_id) return 1;
            return a.name.localeCompare(b.name);
        });

        const sections = sortedTeams.map((team) => ({
            team,
            boards: (boardsByTeamId.get(team.id) ?? [])
                .slice()
                .sort((a, b) => {
                    if (a.id === board.id && b.id !== board.id) return -1;
                    if (b.id === board.id && a.id !== board.id) return 1;
                    return a.name.localeCompare(b.name);
                }),
        }));
        return sections;
    }, [board.id, board.team_id, boardsByTeamId, modalTeams]);

    const currentTeam = useMemo(
        () => modalTeams.find((team) => team.id === board.team_id) ?? null,
        [board.team_id, modalTeams]
    );

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
            <header className="relative z-50 flex items-center gap-1.5 px-1.5 py-1 md:gap-2 md:px-3">
                <div className="flex min-w-0 flex-1 items-center gap-1.5 md:gap-2">
                    {/* Board Switch */}
                    <div ref={boardMenuRef} className="relative shrink-0">
                        <button
                            ref={boardMenuButtonRef}
                            type="button"
                            onClick={() => setShowBoardMenu((prev) => !prev)}
                            data-focus-group="header"
                            data-focus-part="control"
                            className="flex cursor-pointer select-none items-center justify-center rounded-full bg-white p-1.5 text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50"
                            aria-haspopup="true"
                            aria-expanded={showBoardMenu}
                            data-testid="board-menu-button"
                            title="Switch Team or Board"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
                            </svg>
                        </button>
                        {showBoardMenu && boardMenuPosition && typeof document !== 'undefined' && createPortal(
                            <div
                                ref={boardMenuRef}
                                className="fixed z-[120] rounded-2xl border border-slate-200 bg-white p-2 shadow-xl"
                                style={{
                                    top: boardMenuPosition.top,
                                    left: boardMenuPosition.left,
                                    minWidth: boardMenuPosition.minWidth,
                                }}
                            >
                                <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Teams</p>
                                <div className="max-h-[70vh] space-y-3 overflow-y-auto px-1 pb-1">
                                    {teamSections.map(({ team, boards }) => (
                                        <div key={team.id} className="rounded-xl border border-slate-100 bg-slate-50/60 p-2">
                                            <div className="mb-1 flex items-center justify-between gap-2 px-1">
                                                <div className="min-w-0">
                                                    <p className="truncate text-sm font-semibold text-slate-800">{team.name}</p>
                                                    <p className="truncate text-[11px] text-slate-500">{team.role}</p>
                                                </div>
                                                <button
                                                    onClick={() => onOpenTeamSettings(team.id)}
                                                    className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                                                >
                                                    Team Settings
                                                </button>
                                            </div>
                                            <div className="space-y-1">
                                                {boards.map((b) => (
                                                    <div key={b.id} className="flex items-center gap-1 pr-1">
                                                        <button
                                                            onClick={() => handleBoardSelection(b)}
                                                            className={clsx(
                                                                'flex-1 rounded-lg border px-2.5 py-2 text-left text-sm transition',
                                                                b.id === board.id
                                                                    ? 'border-slate-300 bg-white text-slate-900 shadow-sm'
                                                                    : 'border-slate-200 bg-white/90 text-slate-700 hover:border-slate-300 hover:bg-white'
                                                            )}
                                                        >
                                                            <div className="font-medium text-slate-800">{b.name || 'Untitled board'}</div>
                                                            {b.description ? (
                                                                <p className="text-xs text-slate-500">{b.description}</p>
                                                            ) : null}
                                                        </button>
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                if (!canEditBoard(b)) return;
                                                                onOpenBoardSettings(b.id);
                                                            }}
                                                            className={clsx(
                                                                "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-[11px] font-medium shadow-sm",
                                                                canEditBoard(b)
                                                                    ? "text-slate-600 hover:bg-slate-50"
                                                                    : "cursor-not-allowed text-slate-300"
                                                            )}
                                                            title="Board settings"
                                                            aria-label="Board settings"
                                                            disabled={!canEditBoard(b)}
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor" className="h-4 w-4">
                                                                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.592c.55 0 1.02.398 1.11.94l.213 1.279c.066.395.324.73.684.893.265.12.52.268.764.443.33.236.757.296 1.136.16l1.227-.438a1.125 1.125 0 011.363.512l1.296 2.245c.275.477.173 1.084-.245 1.446l-1.013.88a1.125 1.125 0 00-.363 1.059c.03.286.03.575 0 .86a1.125 1.125 0 00.363 1.06l1.013.879c.418.363.52.97.245 1.446l-1.296 2.245a1.125 1.125 0 01-1.363.512l-1.227-.438a1.125 1.125 0 00-1.136.16 5.97 5.97 0 01-.764.443 1.125 1.125 0 00-.684.893l-.213 1.28c-.09.541-.56.939-1.11.939h-2.592c-.55 0-1.02-.398-1.11-.94l-.213-1.279a1.125 1.125 0 00-.684-.893 5.97 5.97 0 01-.764-.443 1.125 1.125 0 00-1.136-.16l-1.227.438a1.125 1.125 0 01-1.363-.512L2.98 17.728a1.125 1.125 0 01.245-1.446l1.013-.88a1.125 1.125 0 00.363-1.059 8.257 8.257 0 010-.86 1.125 1.125 0 00-.363-1.06l-1.013-.879a1.125 1.125 0 01-.245-1.446l1.296-2.245a1.125 1.125 0 011.363-.512l1.227.438c.379.136.806.076 1.136-.16.244-.175.499-.323.764-.443.36-.163.618-.498.684-.893l.213-1.28Z" />
                                                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0Z" />
                                                            </svg>
                                                        </button>
                                                    </div>
                                                ))}
                                                {boards.length === 0 && (
                                                    <p className="px-2 py-1 text-xs text-slate-500">No boards yet</p>
                                                )}
                                            </div>
                                            <div className="mt-2 border-t border-slate-200 pt-2">
                                                {isCreatingBoard && createBoardTeamId === team.id && canCreateBoardInTeam(team) ? (
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
                                                        onClick={() => handleStartCreateBoard(team.id)}
                                                        disabled={!canCreateBoardInTeam(team)}
                                                        className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:border-sky-300 hover:bg-sky-50 hover:text-sky-600"
                                                    >
                                                        {canCreateBoardInTeam(team) ? '+ New Board' : 'No permission to create board'}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                    {teamSections.length === 0 && (
                                        <p className="px-2 py-3 text-sm text-slate-500">No teams available</p>
                                    )}
                                </div>
                            </div>,
                            document.body
                        )}
                    </div>

                    {/* Board Name */}
                    <div className="flex min-w-0 shrink items-center gap-1.5">
                        <div className="flex min-w-0 shrink items-baseline gap-1.5">
                            <h1 className="truncate text-sm font-medium text-slate-900 md:text-lg md:font-semibold">
                                {board.name}
                            </h1>
                            {currentTeam ? (
                                <span className="truncate text-[11px] font-medium text-slate-500 md:text-xs">
                                    {currentTeam.name}
                                </span>
                            ) : null}
                        </div>
                        <div className="hidden md:flex group relative items-center justify-center" title={`Realtime: ${getRealtimeStatusText()}`}>
                            <div className={clsx("w-2 h-2 rounded-full", getRealtimeStatusColor())} />
                        </div>
                    </div>

                    {/* Google Calendar Icon + Status Text */}
                    <div className="hidden shrink-0 items-center gap-1 md:flex">
                        <div ref={googleMenuRef} className="relative">
                            <button
                                ref={googleMenuButtonRef}
                                type="button"
                                onClick={() => setShowGoogleMenu((prev) => !prev)}
                                data-focus-group="header"
                                data-focus-part="control"
                                className={clsx(
                                    "flex cursor-pointer select-none items-center justify-center rounded-full p-1 transition-colors",
                                    googleCalendarStatus === 'success' ? "text-emerald-600 hover:bg-emerald-50" : "text-slate-400 hover:bg-slate-100 hover:text-emerald-600"
                                )}
                                aria-haspopup="true"
                                aria-expanded={showGoogleMenu}
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
                            {showGoogleMenu && googleMenuPosition && typeof document !== 'undefined' && createPortal(
                                <div
                                    ref={googleMenuRef}
                                    className="fixed z-[120] rounded-xl border border-slate-100 bg-white p-3 shadow-xl"
                                    style={{
                                        top: googleMenuPosition.top,
                                        left: googleMenuPosition.left,
                                        minWidth: Math.max(googleMenuPosition.minWidth ?? 0, 320),
                                    }}
                                >
                                    <div className="flex flex-col gap-2">
                                        <p className="text-xs font-semibold text-slate-500 uppercase">Google Calendar</p>
                                        <p className="text-xs text-slate-700">{googleStatusText}</p>
                                        {googleCalendarError && (
                                            <p className="text-xs text-red-600">{googleCalendarError}</p>
                                        )}
                                        {googleCalendarPartialErrors.length > 0 && (
                                            <p className="text-xs text-amber-700">
                                                一部のカレンダーを取得できませんでした
                                            </p>
                                        )}
                                        {googleCalendarStatus === 'success' && (
                                            <>
                                                <div className="max-h-48 overflow-y-auto rounded-md border border-slate-100 bg-slate-50 p-1">
                                                    {googleCalendars.length === 0 && (
                                                        <p className="px-2 py-1 text-xs text-slate-500">カレンダー候補がありません</p>
                                                    )}
                                                    {orderedGoogleCalendars.map((calendar) => {
                                                        const checked = selectedGoogleCalendarSet.has(calendar.id);
                                                        const disabled = googleCalendarSelectionStatus === 'saving'
                                                            || !calendar.selectable
                                                            || (checked && selectedGoogleCalendarCount <= 1);
                                                        const reason = !calendar.selectable
                                                            ? calendar.accessRole === 'freeBusyReader'
                                                                ? '予定詳細の表示権限がありません'
                                                                : '選択できない権限です'
                                                            : calendar.hidden
                                                                ? 'Hidden'
                                                                : calendar.primary
                                                                    ? 'Primary'
                                                                    : 'Shared';
                                                        return (
                                                            <label
                                                                key={calendar.id}
                                                                className={clsx(
                                                                    "flex items-center gap-2 rounded px-2 py-1.5 text-xs",
                                                                    disabled ? "text-slate-400" : "cursor-pointer text-slate-700 hover:bg-white"
                                                                )}
                                                            >
                                                                <input
                                                                    type="checkbox"
                                                                    checked={checked}
                                                                    disabled={disabled}
                                                                    onChange={(event) => toggleGoogleCalendar(calendar.id, event.target.checked)}
                                                                />
                                                                <span
                                                                    className="h-2.5 w-2.5 shrink-0 rounded-full border border-white shadow-sm"
                                                                    style={{ backgroundColor: calendar.backgroundColor ?? '#94a3b8' }}
                                                                    aria-hidden="true"
                                                                />
                                                                <span className="min-w-0 flex-1 truncate">{calendar.summary}</span>
                                                                <span className="shrink-0 text-[10px] uppercase text-slate-400">{reason}</span>
                                                            </label>
                                                        );
                                                    })}
                                                </div>
                                                {googleCalendarSelectionStatus === 'saving' && (
                                                    <p className="text-xs text-slate-500">保存中...</p>
                                                )}
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
                                </div>,
                                document.body
                            )}
                        </div>
                        <span className="text-xs text-slate-500 whitespace-nowrap">{googleStatusText}</span>
                    </div>

                    <div className="hidden shrink-0 items-center gap-1.5 md:flex">
                        <NotificationsBell onOpenNotificationsPanel={onOpenNotificationsPanel} />
                    </div>
                </div>

                <div className="ml-auto flex items-center gap-1.5 md:hidden">
                    <button
                        onClick={onTodayClick}
                        className={todayButtonClassName}
                    >
                        Today
                    </button>
                    <NotificationsBell
                        onOpenNotificationsPanel={onOpenNotificationsPanel}
                        badgeTestId="mobile-notification-badge"
                    />
                    <div ref={mobileActionsRef} className="relative z-[130]">
                    <button
                        ref={mobileActionsButtonRef}
                        type="button"
                        onClick={() => setShowMobileActions((prev) => !prev)}
                        aria-expanded={showMobileActions}
                        aria-label="ヘッダーメニュー"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-slate-700 shadow-sm ring-1 ring-slate-200"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="h-5 w-5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                        </svg>
                    </button>
                    {showMobileActions && mobileActionsPosition && typeof document !== 'undefined' && createPortal(
                        <div
                            ref={mobileActionsMenuRef}
                            className="fixed z-[140] w-64 rounded-xl border border-slate-100 bg-white p-2 shadow-lg ring-1 ring-black/5"
                            style={{
                                top: mobileActionsPosition.top,
                                left: mobileActionsPosition.left,
                                minWidth: mobileActionsPosition.minWidth,
                            }}
                        >
                            <div className="space-y-1">
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
                                        setShowProfileSettings(true);
                                        setShowMobileActions(false);
                                    }}
                                    className="flex w-full items-center rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                                >
                                    Profile Settings
                                </button>
                                <Link
                                    href="/playground"
                                    className="flex w-full items-center rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                                    onClick={() => setShowMobileActions(false)}
                                >
                                    Playground
                                </Link>
                                <button
                                    onClick={() => {
                                        onShortcutsClick();
                                        setShowMobileActions(false);
                                    }}
                                    className="flex w-full items-center rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                                >
                                    Shortcuts
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
                        </div>,
                        document.body
                    )}
                </div>
                </div>

                <div className="hidden items-center gap-2 md:flex">
                <button
                    type="button"
                    onClick={onShortcutsClick}
                    data-focus-group="header"
                    data-focus-part="control"
                    className="inline-flex shrink-0 items-center gap-2 rounded-full bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor" className="h-4 w-4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5h10.5A2.25 2.25 0 0119.5 9.75v4.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 14.25v-4.5A2.25 2.25 0 016.75 7.5Z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 10.5h.75m2.25 0h.75m2.25 0h.75m-6 2.25h6" />
                    </svg>
                    Shortcuts
                </button>
                {/* Profile Menu */}
                <div ref={profileMenuRef} className="relative shrink-0">
                    <button
                        ref={profileMenuButtonRef}
                        type="button"
                        onClick={() => setShowProfileMenu((prev) => !prev)}
                        data-focus-group="header"
                        data-focus-part="control"
                        className="flex cursor-pointer select-none items-center gap-1 rounded-full bg-white px-2 py-1 text-xs font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50"
                        data-testid="profile-menu-button"
                        aria-haspopup="true"
                        aria-expanded={showProfileMenu}
                    >
                        <div className="h-6 w-6 rounded-full bg-sky-100 text-xs flex items-center justify-center text-sky-600 font-bold">
                            {profileInitial}
                        </div>
                        <span className="hidden max-w-[140px] truncate text-xs font-medium text-slate-700 md:block">
                            {profileIdentity.label}
                        </span>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4 text-slate-400">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m5 7.5 5 5 5-5" />
                        </svg>
                    </button>

                    {showProfileMenu && profileMenuPosition && typeof document !== 'undefined' && createPortal(
                        <div
                            ref={profileMenuRef}
                            className="fixed z-[120] origin-top-right rounded-xl border border-slate-100 bg-white py-1 shadow-lg ring-1 ring-black/5 focus:outline-none"
                            style={{
                                top: profileMenuPosition.top,
                                left: profileMenuPosition.left,
                                minWidth: profileMenuPosition.minWidth,
                            }}
                        >
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
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor" className="h-4 w-4">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6.75a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0ZM4.5 20.118a7.5 7.5 0 0115 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.5-1.632Z" />
                                    </svg>
                                    Profile Settings
                                </button>
                                <Link
                                    href="/playground"
                                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                                    onClick={() => setShowProfileMenu(false)}
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor" className="h-4 w-4">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 2.25v2.386c0 .51.203 1 .565 1.361l5.538 5.538a2.25 2.25 0 010 3.182l-4.636 4.636a2.25 2.25 0 01-3.182 0l-5.538-5.538a1.927 1.927 0 00-1.36-.565H3.75m10.5-10.5L12 5.25m2.25-3H9.75m4.5 0h.008v.008h-.008V2.25Z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 9.75h.008v.008H8.25V9.75Z" />
                                    </svg>
                                    Playground
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
                                    className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor" className="h-3.5 w-3.5">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6A2.25 2.25 0 005.25 5.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15" />
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M18 12H9.75m0 0 2.625-2.625M9.75 12l2.625 2.625" />
                                    </svg>
                                    Sign out
                                </button>
                            </div>
                        </div>,
                        document.body
                    )}
                </div>
                </div>
            </header>
        </>
    );
}
