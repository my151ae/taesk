"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ButtonHTMLAttributes, RefObject } from "react";
import Image from "next/image";
import clsx from "clsx";

import { useClickOutside } from "@/app/(board)/_hooks/useClickOutside";
import { GoogleSyncToggle } from "@/app/(board)/_components/GoogleSyncToggle";
import type { Board, DueBucket, ProfileSummary } from "@/lib/supabase";
import { resolveProfileIdentity, getProfileInitial } from "@/lib/usernames";

const getProfileDisplayName = (profile: ProfileSummary): string => {
    const identity = resolveProfileIdentity(profile, profile.email ?? null);
    return identity.label;
};

const getProfileInitials = (profile: ProfileSummary): string => {
    return getProfileInitial(profile, profile.email ?? null);
};

type BucketOption = { value: DueBucket; label: string };
type ReminderMinuteOption = 0 | 5 | 10 | 15 | 30 | 60;
type HeaderActionId = "copyLink" | "googleSync";

type CardModalHeaderProps = {
    dueDate: string;
    dueStart: string;
    dueEnd: string;
    dueBucket: DueBucket | null;
    duration: number | "";
    boards: Board[];
    targetBoardId: string;
    bucketOptions: BucketOption[];
    defaultBucket: DueBucket;
    selectedAssignees: ProfileSummary[];
    filteredProfiles: ProfileSummary[];
    memberSearch: string;
    showMemberDropdown: boolean;
    memberButtonRef: RefObject<HTMLButtonElement>;
    memberDropdownRef: RefObject<HTMLDivElement>;
    onMemberSearchChange: (value: string) => void;
    onToggleMemberDropdown: () => void;
    onAddMember: (id: string) => void;
    onRemoveMember: (id: string) => void;
    onDueDateChange: (value: string) => void;
    onDueStartChange: (value: string) => void;
    onDueEndChange: (value: string) => void;
    startReminderEnabled: boolean;
    startReminderMinutes: ReminderMinuteOption;
    endReminderEnabled: boolean;
    endReminderMinutes: ReminderMinuteOption;
    reminderMinuteOptions: ReminderMinuteOption[];
    onStartReminderEnabledChange: (enabled: boolean) => void;
    onStartReminderMinutesChange: (minutes: ReminderMinuteOption) => void;
    onEndReminderEnabledChange: (enabled: boolean) => void;
    onEndReminderMinutesChange: (minutes: ReminderMinuteOption) => void;
    onTargetBoardChange: (boardId: string) => void;
    onDurationChange: (value: number | "") => void;
    onBucketChange: (bucket: DueBucket) => void;
    cardShortId: string | null;
    onCopyLink: () => void;
    googleSync?: {
        cardId: string;
        connected: boolean;
        canWrite: boolean;
        status?: "active" | "unlinked" | "deleted";
        onStatusChange?: (status: "active" | "unlinked" | "deleted") => void;
    };
    onRequestClose: () => void;
    showSidebar: boolean;
    onToggleSidebar: () => void;
};

function HeaderActionButton({
    children,
    className,
    ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
    return (
        <button
            type="button"
            className={clsx(
                "inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700",
                className
            )}
            {...props}
        >
            {children}
        </button>
    );
}

export default function CardModalHeader({
    dueDate,
    dueStart,
    dueEnd,
    dueBucket,
    duration,
    boards,
    targetBoardId,
    bucketOptions,
    defaultBucket,
    selectedAssignees,
    filteredProfiles,
    memberSearch,
    showMemberDropdown,
    memberButtonRef,
    memberDropdownRef,
    onMemberSearchChange,
    onToggleMemberDropdown,
    onAddMember,
    onRemoveMember,
    onDueDateChange,
    onDueStartChange,
    onDueEndChange,
    startReminderEnabled,
    startReminderMinutes,
    endReminderEnabled,
    endReminderMinutes,
    reminderMinuteOptions,
    onStartReminderEnabledChange,
    onStartReminderMinutesChange,
    onEndReminderEnabledChange,
    onEndReminderMinutesChange,
    onTargetBoardChange,
    onDurationChange,
    onBucketChange,
    cardShortId,
    onCopyLink,
    googleSync,
    onRequestClose,
    showSidebar,
    onToggleSidebar,
}: CardModalHeaderProps) {
    const [mobileMetaExpanded, setMobileMetaExpanded] = useState(false);
    const actionOrder = useMemo<HeaderActionId[]>(() => {
        const items: HeaderActionId[] = [];
        if (cardShortId) {
            items.push("copyLink");
        }
        if (googleSync) {
            items.push("googleSync");
        }
        return items;
    }, [cardShortId, googleSync]);

    const actionsContainerRef = useRef<HTMLDivElement | null>(null);
    const overflowMenuRef = useRef<HTMLDivElement | null>(null);
    const measureRefs = useRef<Partial<Record<HeaderActionId, HTMLDivElement | null>>>({});

    const [visibleActionIds, setVisibleActionIds] = useState<HeaderActionId[]>([]);
    const [showOverflowMenu, setShowOverflowMenu] = useState(false);

    const overflowActionIds = actionOrder.filter((actionId) => !visibleActionIds.includes(actionId));

    const recalculateVisibleActions = useCallback(() => {
        const container = actionsContainerRef.current;
        if (!container) return;

        const availableWidth = container.clientWidth;
        if (availableWidth <= 0) {
            setVisibleActionIds([]);
            return;
        }

        let usedWidth = 0;
        const nextVisible: HeaderActionId[] = [];
        const gapWidth = 8;

        for (const actionId of actionOrder) {
            const measuredWidth = measureRefs.current[actionId]?.offsetWidth ?? 0;
            if (measuredWidth === 0) continue;

            const nextWidth = usedWidth + (nextVisible.length > 0 ? gapWidth : 0) + measuredWidth;
            if (nextWidth > availableWidth) break;

            nextVisible.push(actionId);
            usedWidth = nextWidth;
        }

        setVisibleActionIds((prev) => {
            if (
                prev.length === nextVisible.length &&
                prev.every((value, index) => value === nextVisible[index])
            ) {
                return prev;
            }
            return nextVisible;
        });
    }, [actionOrder]);

    useEffect(() => {
        const rafId = window.requestAnimationFrame(() => {
            recalculateVisibleActions();
        });

        return () => {
            window.cancelAnimationFrame(rafId);
        };
    }, [recalculateVisibleActions, cardShortId, googleSync?.status, googleSync?.connected, googleSync?.canWrite]);

    useEffect(() => {
        const container = actionsContainerRef.current;
        if (!container) return;

        const observer = new ResizeObserver(() => {
            recalculateVisibleActions();
        });
        observer.observe(container);

        return () => {
            observer.disconnect();
        };
    }, [recalculateVisibleActions]);

    useEffect(() => {
        if (overflowActionIds.length === 0) {
            setShowOverflowMenu(false);
        }
    }, [overflowActionIds.length]);

    useClickOutside(overflowMenuRef, () => setShowOverflowMenu(false));

    const handleToggleOverflowMenu = () => {
        setShowOverflowMenu((prev) => !prev);
    };

    useEffect(() => {
        if (!dueDate) {
            setMobileMetaExpanded(false);
        }
    }, [dueDate]);

    const hasMobileExpandableMeta = Boolean(dueDate);

    const renderInlineAction = (actionId: HeaderActionId) => {
        switch (actionId) {
            case "copyLink":
                return (
                    <HeaderActionButton
                        key={actionId}
                        onClick={onCopyLink}
                        data-testid="card-modal-copy-link-inline"
                    >
                        Copy Link
                    </HeaderActionButton>
                );
            case "googleSync":
                if (!googleSync) return null;
                return (
                    <div className="shrink-0" key={actionId}>
                        <GoogleSyncToggle
                            cardId={googleSync.cardId}
                            initialStatus={googleSync.status}
                            connected={googleSync.connected}
                            canWrite={googleSync.canWrite}
                            onStatusChange={googleSync.onStatusChange}
                            displayMode="inline"
                        />
                    </div>
                );
        }
    };

    return (
        <div className="relative z-30 flex flex-col gap-3 border-b border-slate-200 p-3 pb-2 dark:border-gray-700 sm:p-4 sm:pb-3">
            <div className="absolute left-0 top-0 -z-10 opacity-0 pointer-events-none">
                <div className="flex items-center gap-2 whitespace-nowrap">
                    {actionOrder.includes("copyLink") && (
                        <div ref={(node) => { measureRefs.current.copyLink = node; }}>
                            <HeaderActionButton>Copy Link</HeaderActionButton>
                        </div>
                    )}
                    {actionOrder.includes("googleSync") && googleSync && (
                        <div ref={(node) => { measureRefs.current.googleSync = node; }}>
                            <GoogleSyncToggle
                                cardId={googleSync.cardId}
                                initialStatus={googleSync.status}
                                connected={googleSync.connected}
                                canWrite={googleSync.canWrite}
                                onStatusChange={googleSync.onStatusChange}
                                displayMode="inline"
                            />
                        </div>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-1.5 sm:gap-2">
                        <button
                            type="button"
                            onClick={onRequestClose}
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                            aria-label="Close modal"
                        >
                            <span className="text-base leading-none">✕</span>
                        </button>

                        <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-2">
                                <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                                    <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-gray-500">Date</span>
                                    <input
                                        type="date"
                                        value={dueDate ? new Date(dueDate).toISOString().split("T")[0] : ""}
                                        onChange={(e) => onDueDateChange(e.target.value)}
                                        className="min-w-0 rounded-md border border-slate-200 bg-transparent px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-sky-300 dark:border-gray-600 dark:bg-gray-700"
                                    />
                                </div>
                                {hasMobileExpandableMeta && (
                                    <button
                                        type="button"
                                        onClick={() => setMobileMetaExpanded((prev) => !prev)}
                                        className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 shadow-sm transition-colors hover:bg-slate-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 md:hidden"
                                        aria-expanded={mobileMetaExpanded}
                                        aria-label={mobileMetaExpanded ? "詳細を閉じる" : "詳細を開く"}
                                    >
                                        <span>{mobileMetaExpanded ? "閉じる" : "詳細"}</span>
                                        <svg
                                            className={clsx("h-3 w-3 transition-transform", mobileMetaExpanded && "rotate-180")}
                                            fill="none"
                                            stroke="currentColor"
                                            viewBox="0 0 24 24"
                                        >
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m6 9 6 6 6-6" />
                                        </svg>
                                    </button>
                                )}
                            </div>

                            <div className="mt-3 flex min-w-0 flex-col gap-3 md:mt-0 md:flex-row md:flex-wrap md:items-center md:gap-x-4 md:gap-y-3 md:text-sm sm:gap-6">
                                {dueDate && (
                                    <div
                                        className={clsx(
                                            "flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2",
                                            mobileMetaExpanded ? "flex" : "hidden",
                                            "md:flex"
                                        )}
                                    >
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-gray-500">Start</span>
                                    <input
                                        type="time"
                                        step={900}
                                        value={dueStart}
                                        onChange={(e) => onDueStartChange(e.target.value)}
                                        className="rounded-md border border-slate-200 bg-transparent px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-sky-300 dark:border-gray-600 dark:bg-gray-700"
                                    />
                                    <label className="inline-flex items-center gap-1 text-[10px] text-slate-500 dark:text-gray-400">
                                        <input
                                            type="checkbox"
                                            checked={startReminderEnabled}
                                            onChange={(e) => onStartReminderEnabledChange(e.target.checked)}
                                            className="h-3.5 w-3.5 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                                        />
                                        通知
                                    </label>
                                    {startReminderEnabled && (
                                        <select
                                            value={startReminderMinutes}
                                            onChange={(e) => onStartReminderMinutesChange(Number(e.target.value) as ReminderMinuteOption)}
                                            className="rounded-md border border-slate-200 bg-transparent px-1.5 py-1 text-[10px] focus:outline-none focus:ring-2 focus:ring-sky-300 dark:border-gray-600 dark:bg-gray-700"
                                        >
                                            {reminderMinuteOptions.map((minute) => (
                                                <option key={`start-${minute}`} value={minute}>
                                                    {minute}分前
                                                </option>
                                            ))}
                                        </select>
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-gray-500">Dur</span>
                                    <div className="flex items-center gap-1">
                                        <input
                                            type="number"
                                            min={0}
                                            step={1}
                                            value={duration}
                                            onChange={(e) => {
                                                const raw = e.target.value;
                                                if (raw === "") {
                                                    onDurationChange("");
                                                    return;
                                                }
                                                const val = parseInt(raw, 10);
                                                if (isNaN(val)) return;

                                                const prev = typeof duration === "number" ? duration : 0;
                                                const diff = val - prev;

                                                if (Math.abs(diff) === 5 || Math.abs(diff) === 1) {
                                                    let nextVal = val;
                                                    if (diff > 0) {
                                                        if (prev >= 5) {
                                                            nextVal = (Math.floor(prev / 5) + 1) * 5;
                                                        } else {
                                                            nextVal = prev + 1;
                                                        }
                                                    } else if (prev > 5) {
                                                        nextVal = (Math.ceil(prev / 5) - 1) * 5;
                                                    } else {
                                                        nextVal = Math.max(0, prev - 1);
                                                    }
                                                    onDurationChange(nextVal);
                                                } else {
                                                    onDurationChange(val);
                                                }
                                            }}
                                            className="w-14 rounded-md border border-slate-200 bg-transparent px-1 py-1 text-center text-xs focus:outline-none focus:ring-2 focus:ring-sky-300 dark:border-gray-600 dark:bg-gray-700"
                                        />
                                        <span className="text-[10px] font-medium text-slate-400 dark:text-gray-500">min</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-gray-500">End</span>
                                    <input
                                        type="time"
                                        step={900}
                                        value={dueEnd}
                                        onChange={(e) => onDueEndChange(e.target.value)}
                                        className="rounded-md border border-slate-200 bg-transparent px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-sky-300 dark:border-gray-600 dark:bg-gray-700"
                                    />
                                    <label className="inline-flex items-center gap-1 text-[10px] text-slate-500 dark:text-gray-400">
                                        <input
                                            type="checkbox"
                                            checked={endReminderEnabled}
                                            onChange={(e) => onEndReminderEnabledChange(e.target.checked)}
                                            className="h-3.5 w-3.5 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                                        />
                                        通知
                                    </label>
                                    {endReminderEnabled && (
                                        <select
                                            value={endReminderMinutes}
                                            onChange={(e) => onEndReminderMinutesChange(Number(e.target.value) as ReminderMinuteOption)}
                                            className="rounded-md border border-slate-200 bg-transparent px-1.5 py-1 text-[10px] focus:outline-none focus:ring-2 focus:ring-sky-300 dark:border-gray-600 dark:bg-gray-700"
                                        >
                                            {reminderMinuteOptions.map((minute) => (
                                                <option key={`end-${minute}`} value={minute}>
                                                    {minute}分前
                                                </option>
                                            ))}
                                        </select>
                                    )}
                                </div>
                                    </div>
                                )}

                                {dueDate && (
                                    <div
                                        className={clsx(
                                            "items-center gap-2 sm:border-l sm:border-slate-100 sm:pl-4 sm:dark:border-gray-700",
                                            mobileMetaExpanded ? "flex" : "hidden",
                                            "md:flex"
                                        )}
                                    >
                                <span className="text-[10px] font-bold uppercase tracking-widest whitespace-nowrap text-slate-400 dark:text-gray-500">Members</span>
                                <div className="relative flex flex-wrap items-center gap-1.5">
                                    {selectedAssignees.map((member) => (
                                        <div
                                            key={member.id}
                                            className="group relative h-6 w-6"
                                            title={resolveProfileIdentity(member, member.email ?? null).label}
                                        >
                                            {member.avatar_url ? (
                                                <Image
                                                    src={member.avatar_url}
                                                    alt="assigned member"
                                                    width={24}
                                                    height={24}
                                                    className="h-6 w-6 rounded-full object-cover ring-1 ring-white dark:ring-gray-800"
                                                />
                                            ) : (
                                                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-600 ring-1 ring-white dark:ring-gray-800">
                                                    {getProfileInitial(member, member.email ?? null)}
                                                </span>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => onRemoveMember(member.id)}
                                                className="absolute -right-1 -top-1 rounded-full bg-white text-slate-400 opacity-0 shadow-sm ring-1 ring-slate-200 transition-opacity hover:text-red-500 group-hover:opacity-100 dark:bg-gray-700"
                                            >
                                                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                </svg>
                                            </button>
                                        </div>
                                    ))}
                                    <button
                                        ref={memberButtonRef}
                                        type="button"
                                        onClick={onToggleMemberDropdown}
                                        className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-slate-300 text-slate-400 transition-colors hover:border-sky-400 hover:bg-sky-50 dark:border-gray-600 dark:hover:border-sky-600 dark:hover:bg-sky-900/20"
                                    >
                                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                        </svg>
                                    </button>

                                    {showMemberDropdown && (
                                        <div
                                            ref={memberDropdownRef}
                                            className="absolute left-0 top-full z-[100] mt-2 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800"
                                        >
                                            <div className="border-b border-slate-100 p-2 dark:border-gray-700">
                                                <input
                                                    autoFocus
                                                    type="text"
                                                    placeholder="Search members..."
                                                    value={memberSearch}
                                                    onChange={(e) => onMemberSearchChange(e.target.value)}
                                                    className="w-full rounded-md border-none bg-slate-50 px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-sky-500 dark:bg-gray-900"
                                                />
                                            </div>
                                            <div className="max-h-60 overflow-y-auto p-1">
                                                {filteredProfiles.length === 0 ? (
                                                    <div className="p-4 text-center text-xs text-slate-400">
                                                        No members found
                                                    </div>
                                                ) : (
                                                    filteredProfiles.map((profile) => (
                                                        <button
                                                            key={profile.id}
                                                            type="button"
                                                            onClick={() => onAddMember(profile.id)}
                                                            className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-slate-50 dark:hover:bg-gray-700"
                                                        >
                                                            {profile.avatar_url ? (
                                                                <Image
                                                                    src={profile.avatar_url}
                                                                    alt=""
                                                                    width={24}
                                                                    height={24}
                                                                    className="h-6 w-6 rounded-full object-cover"
                                                                />
                                                            ) : (
                                                                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-500">
                                                                    {getProfileInitials(profile)}
                                                                </span>
                                                            )}
                                                            <div className="min-w-0 flex-1">
                                                                <div className="truncate text-xs font-medium text-slate-700 dark:text-gray-200">
                                                                    {getProfileDisplayName(profile)}
                                                                </div>
                                                                <div className="truncate text-[10px] text-slate-400">
                                                                    {profile.email}
                                                                </div>
                                                            </div>
                                                        </button>
                                                    ))
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="relative z-10 flex items-start justify-end gap-2 pl-2">
                    <div
                        ref={actionsContainerRef}
                        className="flex min-w-0 items-center justify-end gap-2"
                    >
                        {visibleActionIds.map((actionId) => renderInlineAction(actionId))}
                    </div>

                    {overflowActionIds.length > 0 && (
                        <div ref={overflowMenuRef} className="relative shrink-0">
                            <button
                                type="button"
                                onClick={handleToggleOverflowMenu}
                                aria-expanded={showOverflowMenu}
                                aria-label="Card modal actions"
                                data-testid="card-modal-overflow-button"
                                className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 shadow-sm transition-colors hover:bg-slate-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                            >
                                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                                </svg>
                            </button>

                            {showOverflowMenu && (
                                <div
                                    className="absolute right-0 top-full z-[120] mt-2 w-80 max-w-[calc(100vw-2rem)] space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-gray-700 dark:bg-gray-800"
                                    data-testid="card-modal-overflow-menu"
                                >
                                    {boards.length > 1 && (
                                        <div className="space-y-2">
                                            <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-gray-500">
                                                Board
                                            </label>
                                            <select
                                                value={targetBoardId}
                                                onChange={(e) => onTargetBoardChange(e.target.value)}
                                                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
                                            >
                                                {boards.map((board) => (
                                                    <option key={board.id} value={board.id}>
                                                        {board.name}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    )}

                                    {dueDate && (
                                        <div className="space-y-2">
                                            <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-gray-500">
                                                Bucket
                                            </label>
                                            <select
                                                value={(dueBucket ?? defaultBucket) as DueBucket}
                                                onChange={(e) => onBucketChange(e.target.value as DueBucket)}
                                                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
                                            >
                                                {bucketOptions.map((option) => (
                                                    <option key={option.value} value={option.value}>
                                                        {option.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    )}

                                    {overflowActionIds.includes("copyLink") && cardShortId && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                onCopyLink();
                                                setShowOverflowMenu(false);
                                            }}
                                            className="flex w-full items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                                            data-testid="card-modal-copy-link-overflow"
                                        >
                                            <span>Copy Link</span>
                                            <span className="text-xs text-slate-400">/c/{cardShortId}</span>
                                        </button>
                                    )}

                                    {overflowActionIds.includes("googleSync") && googleSync && (
                                        <div className="rounded-xl border border-slate-200 p-3 dark:border-gray-600">
                                            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-gray-500">
                                                Google Calendar
                                            </p>
                                            <GoogleSyncToggle
                                                cardId={googleSync.cardId}
                                                initialStatus={googleSync.status}
                                                connected={googleSync.connected}
                                                canWrite={googleSync.canWrite}
                                                onStatusChange={googleSync.onStatusChange}
                                                displayMode="menu"
                                            />
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    <button
                        type="button"
                        onClick={onToggleSidebar}
                        className={clsx(
                            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-all duration-200",
                            showSidebar
                                ? "bg-sky-50 text-sky-500 ring-1 ring-sky-200 dark:bg-sky-900/40 dark:ring-sky-800"
                                : "text-slate-400 hover:bg-slate-100 dark:hover:bg-gray-700"
                        )}
                        title={showSidebar ? "Hide details" : "Show details"}
                    >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    );
}
