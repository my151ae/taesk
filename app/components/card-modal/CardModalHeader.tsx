"use client";

import type { RefObject } from "react";
import Image from "next/image";
import clsx from "clsx";
import type { DueBucket, ProfileSummary } from "@/lib/supabase";
import { resolveProfileIdentity, getProfileInitial } from "@/lib/usernames";

const getProfileDisplayName = (profile: ProfileSummary): string => {
    const identity = resolveProfileIdentity(profile, profile.email ?? null);
    return identity.label;
};

const getProfileInitials = (profile: ProfileSummary): string => {
    return getProfileInitial(profile, profile.email ?? null);
};

type BucketOption = { value: DueBucket; label: string };

type CardModalHeaderProps = {
    dueDate: string;
    dueStart: string;
    dueEnd: string;
    dueBucket: DueBucket | null;
    duration: number | "";
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
    onDurationChange: (value: number | "") => void;
    onBucketChange: (bucket: DueBucket) => void;
    onRequestClose: () => void;
    showSidebar: boolean;
    onToggleSidebar: () => void;
};

export default function CardModalHeader({
    dueDate,
    dueStart,
    dueEnd,
    dueBucket,
    duration,
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
    onDurationChange,
    onBucketChange,
    onRequestClose,
    showSidebar,
    onToggleSidebar,
}: CardModalHeaderProps) {
    return (
        <div className="flex flex-col p-3 sm:p-4 pb-2 sm:pb-3 border-b border-slate-200 dark:border-gray-700">
            {/* Schedule Section in Header */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3 sm:gap-6 text-sm">
                <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-slate-400 dark:text-gray-500 uppercase tracking-widest">Date</span>
                    <input
                        type="date"
                        value={dueDate ? new Date(dueDate).toISOString().split("T")[0] : ""}
                        onChange={(e) => onDueDateChange(e.target.value)}
                        className="px-2 py-1 border border-slate-200 rounded-md dark:bg-gray-700 dark:border-gray-600 text-xs focus:outline-none focus:ring-2 focus:ring-sky-300 bg-transparent"
                    />
                </div>

                {dueDate && (
                    <div className="flex items-center gap-x-4 gap-y-2 flex-wrap">
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-slate-400 dark:text-gray-500 uppercase tracking-widest">Start</span>
                            <input
                                type="time"
                                step={900}
                                value={dueStart}
                                onChange={(e) => onDueStartChange(e.target.value)}
                                className="px-2 py-1 border border-slate-200 rounded-md dark:bg-gray-700 dark:border-gray-600 text-xs focus:outline-none focus:ring-2 focus:ring-sky-300 bg-transparent"
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-slate-400 dark:text-gray-500 uppercase tracking-widest">Dur</span>
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

                                        const prev = typeof duration === 'number' ? duration : 0;
                                        const diff = val - prev;

                                        // ステッパーの操作（+1 or -1）と判定される場合のみ特殊ロジックを適用
                                        if (Math.abs(diff) === 5 || Math.abs(diff) === 1) {
                                            let nextVal = val;
                                            if (diff > 0) { // 増加
                                                if (prev >= 5) {
                                                    nextVal = (Math.floor(prev / 5) + 1) * 5;
                                                } else {
                                                    nextVal = prev + 1;
                                                }
                                            } else { // 減少
                                                if (prev > 5) {
                                                    nextVal = (Math.ceil(prev / 5) - 1) * 5;
                                                } else {
                                                    nextVal = Math.max(0, prev - 1);
                                                }
                                            }
                                            onDurationChange(nextVal);
                                        } else {
                                            // 直接入力の場合はそのまま
                                            onDurationChange(val);
                                        }
                                    }}
                                    className="w-14 px-1 py-1 border border-slate-200 rounded-md dark:bg-gray-700 dark:border-gray-600 text-xs focus:outline-none focus:ring-2 focus:ring-sky-300 bg-transparent text-center"
                                />
                                <span className="text-[10px] text-slate-400 dark:text-gray-500 font-medium">min</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-slate-400 dark:text-gray-500 uppercase tracking-widest">End</span>
                            <input
                                type="time"
                                step={900}
                                value={dueEnd}
                                onChange={(e) => onDueEndChange(e.target.value)}
                                className="px-2 py-1 border border-slate-200 rounded-md dark:bg-gray-700 dark:border-gray-600 text-xs focus:outline-none focus:ring-2 focus:ring-sky-300 bg-transparent"
                            />
                        </div>
                    </div>
                )}

                {dueDate && (
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-slate-400 dark:text-gray-500 uppercase tracking-widest">Bucket</span>
                        <select
                            value={(dueBucket ?? defaultBucket) as DueBucket}
                            onChange={(e) => onBucketChange(e.target.value as DueBucket)}
                            className="px-2 py-1 border border-slate-200 rounded-md dark:bg-gray-700 dark:border-gray-600 text-xs focus:outline-none focus:ring-2 focus:ring-sky-300 bg-transparent"
                        >
                            {bucketOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                    </div>
                )}

                {dueDate && (
                    <div className="flex items-center gap-2 sm:border-l sm:border-slate-100 sm:dark:border-gray-700 sm:pl-4">
                        <span className="text-[10px] font-bold text-slate-400 dark:text-gray-500 uppercase tracking-widest whitespace-nowrap">Members</span>
                        <div className="flex flex-wrap gap-1.5 items-center relative">
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
                                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-slate-600 font-bold text-[10px] ring-1 ring-white dark:ring-gray-800">
                                            {getProfileInitial(member, member.email ?? null)}
                                        </span>
                                    )}
                                    <button
                                        onClick={() => onRemoveMember(member.id)}
                                        className="absolute -top-1 -right-1 bg-white dark:bg-gray-700 rounded-full text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm ring-1 ring-slate-200"
                                    >
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                    </button>
                                </div>
                            ))}
                            <button
                                ref={memberButtonRef}
                                onClick={onToggleMemberDropdown}
                                className="h-6 w-6 flex items-center justify-center rounded-full border border-dashed border-slate-300 hover:border-sky-400 hover:bg-sky-50 dark:border-gray-600 dark:hover:border-sky-600 dark:hover:bg-sky-900/20 text-slate-400 transition-colors"
                            >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                            </button>

                            {showMemberDropdown && (
                                <div
                                    ref={memberDropdownRef}
                                    className="absolute z-[100] w-64 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-slate-200 dark:border-gray-700 overflow-hidden"
                                    style={{
                                        top: "100%",
                                        left: 0,
                                        marginTop: "8px",
                                    }}
                                >
                                    <div className="p-2 border-b border-slate-100 dark:border-gray-700">
                                        <input
                                            autoFocus
                                            type="text"
                                            placeholder="Search members..."
                                            value={memberSearch}
                                            onChange={(e) => onMemberSearchChange(e.target.value)}
                                            className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-gray-900 border-none rounded-md focus:ring-1 focus:ring-sky-500 outline-none"
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
                                                    onClick={() => onAddMember(profile.id)}
                                                    className="w-full flex items-center gap-3 p-2 hover:bg-slate-50 dark:hover:bg-gray-700 rounded-lg transition-colors text-left"
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
                                                        <span className="h-6 w-6 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 text-[10px] font-bold">
                                                            {getProfileInitials(profile)}
                                                        </span>
                                                    )}
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-xs font-medium text-slate-700 dark:text-gray-200 truncate">
                                                            {getProfileDisplayName(profile)}
                                                        </div>
                                                        <div className="text-[10px] text-slate-400 truncate">
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
                <div className="flex items-center gap-1 sm:gap-2 ml-auto">
                    <button
                        onClick={onToggleSidebar}
                        className={clsx(
                            "p-2 rounded-lg transition-all duration-200",
                            showSidebar ? "text-sky-500 bg-sky-50 dark:bg-sky-900/40 ring-1 ring-sky-200 dark:ring-sky-800" : "text-slate-400 hover:bg-slate-100 dark:hover:bg-gray-700"
                        )}
                        title={showSidebar ? "Hide details" : "Show details"}
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                    </button>
                    <div className="w-px h-6 bg-slate-200 dark:bg-gray-700 mx-1 hidden sm:block" />
                    <button
                        onClick={onRequestClose}
                        className="text-slate-400 hover:text-slate-600 dark:hover:text-gray-200 flex items-center justify-center w-9 h-9 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-700 transition-colors"
                        aria-label="Close modal"
                    >
                        <span className="text-xl leading-none">✕</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
