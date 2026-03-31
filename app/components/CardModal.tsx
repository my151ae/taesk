"use client";

import { useEffect, useRef, useCallback, useMemo, useLayoutEffect, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Card, Board, ProfileSummary, DueBucket } from "@/lib/supabase";
import TiptapEditor, {
    BodyEditorBridge,
    BodyEditorShortcutState,
    FocusTitleRequest,
} from "@/app/(board)/_components/tiptap/TiptapEditor";
import { JSONContent } from "@tiptap/react";
import {
    deriveExcerptFromContent,
    getTiptapPlainText,
    normalizeContent,
} from "@/lib/tiptap";
import { useGoogleCalendar } from "@/app/(board)/_hooks/useGoogleCalendar";
import CardModalHeader from "@/app/components/card-modal/CardModalHeader";
import CardModalSidebar from "@/app/components/card-modal/CardModalSidebar";
import type { CardModalSavePayload, ReminderMinuteOption } from "@/app/components/card-modal/types";
import { useCardModalHistory } from "@/app/components/card-modal/hooks/useCardModalHistory";
import { useCardModalGoogleSync } from "@/app/components/card-modal/hooks/useCardModalGoogleSync";
import { useCardModalDraft } from "@/app/components/card-modal/hooks/useCardModalDraft";
import { useCardModalResize } from "@/app/components/card-modal/hooks/useCardModalResize";
import { useCardModalAutoSave } from "@/app/components/card-modal/hooks/useCardModalAutoSave";
import { useCardModalLifecycle } from "@/app/components/card-modal/hooks/useCardModalLifecycle";
import { useCardModalMemberPicker } from "@/app/components/card-modal/hooks/useCardModalMemberPicker";
import { StatusShortcutBar } from "@/app/(board)/_components/timeline/StatusShortcutBar";
import {
    buildShortcutDataAttributes,
    createEmptyShortcutBarPayload,
    getShortcutContextFromTarget,
    resolveShortcutBarPayload,
    type ShortcutBarConfig,
    type ShortcutContextDescriptor,
} from "@/app/(board)/_components/timeline/shortcut-bar-registry";

const DEFAULT_BUCKET: DueBucket = 'b';
const BUCKET_OPTIONS: { value: DueBucket; label: string }[] = [
    { value: 'a', label: 'A (do today)' },
    { value: 'b', label: 'B (if possible)' },
];
const REMINDER_MINUTE_OPTIONS = [0, 5, 10, 15, 30, 60] as const;

interface CardModalProps {
    card: Card;
    boards: Board[];
    profiles: ProfileSummary[];
    availableTags?: string[];
    onSave: (payload: CardModalSavePayload) => void;
    onDelete: (id: string) => void;
    onMoveToBoard: (cardId: string, targetBoardId: string) => void;
    onClose: () => void;
    isLoading?: boolean;
    historySaveWarning?: string | null;
    onRetryHistorySave?: () => void;
    onCloseWithoutHistory?: () => void;
    shortcutBar?: ShortcutBarConfig;
}

export function CardModal({
    card,
    boards,
    onSave,
    onDelete,
    profiles,
    availableTags = [],
    onMoveToBoard,
    onClose,
    isLoading,
    historySaveWarning,
    onRetryHistorySave,
    onCloseWithoutHistory,
    shortcutBar,
}: CardModalProps) {
    const {
        content,
        setContent,
        title,
        setTitle,
        tags,
        setTags,
        tagInput,
        setTagInput,
        dueDate,
        setDueDate,
        dueStart,
        setDueStart,
        dueEnd,
        setDueEnd,
        startReminderEnabled,
        setStartReminderEnabled,
        startReminderMinutes,
        setStartReminderMinutes,
        endReminderEnabled,
        setEndReminderEnabled,
        endReminderMinutes,
        setEndReminderMinutes,
        dueBucket,
        setDueBucket,
        dueBucketPosition,
        setDueBucketPosition,
        duration,
        setDuration,
        checked,
        setChecked,
        assigneeIds,
        setAssigneeIds,
        showMemberDropdown,
        setShowMemberDropdown,
        memberSearch,
        setMemberSearch,
        assigneeTouched,
        setAssigneeTouched,
        targetBoardId,
        setTargetBoardId,
        showSidebar,
        setShowSidebar,
        activeSidebarTab,
        setActiveSidebarTab,
        editorError,
        setEditorError,
        filteredProfiles,
        selectedAssignees,
        resetDraft,
    } = useCardModalDraft({ card, profiles });
    const resizeRef = useRef<HTMLDivElement>(null);
    const { sidebarWidth, startResizing } = useCardModalResize({ resizeRef });
    const [activeShortcutDescriptor, setActiveShortcutDescriptor] = useState<ShortcutContextDescriptor | null>(null);
    const [bodyShortcutState, setBodyShortcutState] = useState<BodyEditorShortcutState>({
        canUndo: false,
        canRedo: false,
        canIndent: false,
        canOutdent: false,
    });

    const bodyBridgeRef = useRef<BodyEditorBridge | null>(null);
    const titleInputRef = useRef<HTMLTextAreaElement | null>(null);

    const {
        historyItems,
        historyLoading,
        historyError,
        selectedHistoryId,
        previewHistoryContent,
        previewLoading,
        previewError,
        isHistoryPreviewing,
        resetHistoryState,
        selectHistory: handleSelectHistory,
        cancelHistoryPreview,
    } = useCardModalHistory({
        boardId: card.board_id,
        cardId: card.id,
        showSidebar,
        activeSidebarTab,
    });
    const shouldFocusTitleOnOpen = !isLoading && !isHistoryPreviewing && title.trim().length === 0;

    const stickyTitleChecklistProgress = useMemo(() => {
        const plainText = getTiptapPlainText(normalizeContent(content));
        const progress = plainText.split(/\r?\n/).reduce(
            (acc, line) => {
                const match = line.match(/^\s*\[([ xX])\]\s+(.*)$/);
                if (!match || !match[2]?.trim()) return acc;
                acc.total += 1;
                if (match[1].toLowerCase() === "x") {
                    acc.checked += 1;
                }
                return acc;
            },
            { checked: 0, total: 0 }
        );
        return progress.total > 0 ? `${progress.checked}/${progress.total}` : null;
    }, [content]);

    const mergedAvailableTags = useMemo(() => {
        const nextTags = new Set<string>();
        availableTags.forEach((tag) => {
            const normalized = tag.trim();
            if (normalized) nextTags.add(normalized);
        });
        tags.forEach((tag) => {
            const normalized = tag.trim();
            if (normalized) nextTags.add(normalized);
        });
        return Array.from(nextTags).sort((left, right) => left.localeCompare(right));
    }, [availableTags, tags]);

    const handleSave = useCallback((isAutoSave = false, options?: { restoreFromHistory?: boolean; historySourceId?: string; contentOverride?: JSONContent; forceHistorySnapshot?: boolean; }) => {
        const normalizedDueDate = dueDate || null;
        const hasTime = dueStart && dueEnd; // Both must be present
        const normalizedStart = hasTime ? `${dueStart}:00` : null;
        const normalizedEnd = hasTime ? `${dueEnd}:00` : null;

        // Always send bucket fields (timelineはnull、A/Bはa|bを保持)
        const normalizedBucket: DueBucket | null = dueBucket ?? null;
        const normalizedBucketPosition: number | null =
            normalizedBucket != null ? dueBucketPosition ?? null : null;

        const sourceContent = options?.contentOverride ?? content;
        const normalizedContent = normalizeContent(sourceContent);
        const nextTitle = title.trim();
        const nextChecked = checked;
        const nextExcerpt = deriveExcerptFromContent(normalizedContent);

        if (!isAutoSave) {
            setEditorError(null);
        }
        onSave({
            id: card.id,
            title: nextTitle,
            content: normalizedContent,
            excerpt: nextExcerpt,
            checked: nextChecked,
            tags,
            due_date: normalizedDueDate,
            assigneeIds: assigneeIds.length > 0 ? assigneeIds : [],
            assigneeTouched,
            due_start: normalizedStart,
            due_end: normalizedEnd,
            start_reminder_enabled: startReminderEnabled,
            start_reminder_minutes: startReminderMinutes,
            end_reminder_enabled: endReminderEnabled,
            end_reminder_minutes: endReminderMinutes,
            due_bucket: normalizedBucket,
            due_bucket_position: normalizedBucketPosition,
            duration: Number(duration) || 0,
            isAutoSave,
            forceHistorySnapshot: options?.forceHistorySnapshot,
            restoreFromHistory: options?.restoreFromHistory,
            historySourceId: options?.historySourceId,
        });

        if (!isAutoSave && !options?.restoreFromHistory && targetBoardId !== card.board_id) {
            onMoveToBoard(card.id, targetBoardId);
        }
    }, [
        card.id,
        card.board_id,
        content,
        title,
        tags,
        dueDate,
        dueStart,
        dueEnd,
        startReminderEnabled,
        startReminderMinutes,
        endReminderEnabled,
        endReminderMinutes,
        dueBucket,
        dueBucketPosition,
        duration,
        assigneeIds,
            assigneeTouched,
            checked,
            targetBoardId,
            onSave,
            onMoveToBoard,
    ]);

    const {
        hasPendingChangesRef,
        hasAutoSavedEditsRef,
        triggerAutoSave,
        clearAutoSaveTimers,
        requestClose,
    } = useCardModalAutoSave({
        isHistoryPreviewing,
        onAutoSave: (contentOverride, options) =>
            handleSave(true, {
                contentOverride,
                forceHistorySnapshot: options?.forceHistorySnapshot,
            }),
        onRequestClose: onClose,
        onCancelHistoryPreview: cancelHistoryPreview,
    });

    const { dialogRef } = useCardModalLifecycle({
        card,
        isLoading,
        onRequestClose: requestClose,
        resetDraft,
        resetHistoryState,
        setShowSidebar,
        setContent,
        setTitle,
        setChecked,
        setEditorError,
        hasPendingChangesRef,
        hasAutoSavedEditsRef,
        clearAutoSaveTimers,
    });

    const syncActiveShortcutDescriptor = useCallback(() => {
        const isReadonly = Boolean(isLoading || isHistoryPreviewing);
        if (isReadonly) {
            setActiveShortcutDescriptor(null);
            return;
        }

        const root = dialogRef.current;
        const activeElement = document.activeElement;
        if (!(root && activeElement instanceof Element) || !root.contains(activeElement)) {
            setActiveShortcutDescriptor(null);
            return;
        }

        const nextDescriptor = getShortcutContextFromTarget(activeElement);
        setActiveShortcutDescriptor(nextDescriptor?.scope === "modal" ? nextDescriptor : null);
    }, [dialogRef, isHistoryPreviewing, isLoading]);

    useEffect(() => {
        syncActiveShortcutDescriptor();
    }, [syncActiveShortcutDescriptor]);

    const modalShortcutPayload = useMemo(() => {
        if (isLoading || isHistoryPreviewing || !activeShortcutDescriptor) {
            return createEmptyShortcutBarPayload("modal");
        }
        return resolveShortcutBarPayload({
            ...activeShortcutDescriptor,
            capabilities: activeShortcutDescriptor.part === "editor" ? bodyShortcutState : null,
            state: "active",
        }) ?? createEmptyShortcutBarPayload("modal");
    }, [activeShortcutDescriptor, bodyShortcutState, isHistoryPreviewing, isLoading]);

    const {
        memberButtonRef,
        memberDropdownRef,
        closeMemberDropdown,
        toggleMemberDropdown,
    } = useCardModalMemberPicker({
        setShowMemberDropdown,
        setMemberSearch,
    });

    const handleRegisterBodyBridge = useCallback((bridge: BodyEditorBridge | null) => {
        bodyBridgeRef.current = bridge;
    }, []);

    const handleRequestFocusTitle = useCallback((request: FocusTitleRequest) => {
        const input = titleInputRef.current;
        if (!input) return;

        input.focus();
        const maxLength = input.value.length;
        const nextPos =
            request.mode === "end"
                ? maxLength
                : Math.min(Math.max(request.column ?? maxLength, 0), maxLength);
        input.setSelectionRange(nextPos, nextPos);
    }, []);

    const resizeTitleInput = useCallback(() => {
        const input = titleInputRef.current;
        if (!input) return;
        input.style.height = "auto";
        input.style.height = `${input.scrollHeight}px`;
    }, []);

    useLayoutEffect(() => {
        resizeTitleInput();
    }, [resizeTitleInput, title, isLoading]);

    useLayoutEffect(() => {
        const input = titleInputRef.current;
        if (!input || typeof ResizeObserver === "undefined") return;

        let frameId = 0;
        const scheduleResize = () => {
            if (frameId) {
                cancelAnimationFrame(frameId);
            }
            frameId = requestAnimationFrame(() => {
                frameId = 0;
                resizeTitleInput();
            });
        };

        scheduleResize();

        const observer = new ResizeObserver(() => {
            scheduleResize();
        });
        observer.observe(input);
        if (input.parentElement) {
            observer.observe(input.parentElement);
        }

        return () => {
            observer.disconnect();
            if (frameId) {
                cancelAnimationFrame(frameId);
            }
        };
    }, [resizeTitleInput, showSidebar, stickyTitleChecklistProgress]);

    const handleTitleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
        if (isHistoryPreviewing) return;
        const nativeEvent = event.nativeEvent as KeyboardEvent & { keyCode?: number };
        const isImeComposing = nativeEvent.isComposing || nativeEvent.keyCode === 229;

        if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        if (isImeComposing) return;

        const bridge = bodyBridgeRef.current;
        if (!bridge) return;

        const input = event.currentTarget;
        const selectionStart = input.selectionStart;
        const selectionEnd = input.selectionEnd;
        if (selectionStart == null || selectionEnd == null || selectionStart !== selectionEnd) {
            return;
        }

        if (event.key === "ArrowRight" && selectionStart !== title.length) {
            return;
        }

        if (event.key !== "ArrowDown" && event.key !== "ArrowRight") {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        bridge.focusBody(event.key === "ArrowDown" ? selectionStart : 0);
    }, [isHistoryPreviewing, title.length]);

    const handleAddMember = (profileId: string) => {
        if (isHistoryPreviewing) return;
        if (!assigneeIds.includes(profileId)) {
            setAssigneeIds([...assigneeIds, profileId]);
            setAssigneeTouched(true);
            triggerAutoSave();
        }
        closeMemberDropdown();
    };

    const handleRemoveMember = (profileId: string) => {
        if (isHistoryPreviewing) return;
        setAssigneeIds(assigneeIds.filter(id => id !== profileId));
        setAssigneeTouched(true);
        triggerAutoSave();
    };

    const handleAddTag = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (isHistoryPreviewing) return;
        if (e.key === 'Enter' && tagInput.trim()) {
            e.preventDefault();
            const nextTag = tagInput.trim();
            if (!tags.includes(nextTag)) {
                setTags([...tags, nextTag]);
                triggerAutoSave();
            }
            setTagInput('');
        }
    };

    const handleTagInputChange = useCallback((value: string) => {
        if (isHistoryPreviewing) return;
        setTagInput(value);

        const trimmedValue = value.trim();
        if (!trimmedValue || tags.includes(trimmedValue) || !mergedAvailableTags.includes(trimmedValue)) {
            return;
        }

        setTags([...tags, trimmedValue]);
        setTagInput('');
        triggerAutoSave();
    }, [isHistoryPreviewing, mergedAvailableTags, setTagInput, setTags, tags, triggerAutoSave]);

    const handleRemoveTag = (tagToRemove: string) => {
        if (isHistoryPreviewing) return;
        setTags(tags.filter(t => t !== tagToRemove));
        triggerAutoSave();
    };

    const handleCopyLink = useCallback(() => {
        if (!card.short_id || typeof window === "undefined") return;
        navigator.clipboard.writeText(`${window.location.origin}/c/${card.short_id}`);
    }, [card.short_id]);

    const handleTimeToggle = useCallback((isTimeEnabled: boolean) => {
        if (!isTimeEnabled) {
            setDueStart('');
            setDueEnd('');
            if (dueDate && !dueBucket) {
                setDueBucket(DEFAULT_BUCKET);
                setDueBucketPosition(Date.now());
            }
        }
    }, [dueDate, dueBucket]);

    const handleDueDateInputChange = useCallback((value: string) => {
        if (isHistoryPreviewing) return;
        setDueDate(value ? new Date(value).toISOString() : '');
        triggerAutoSave();
    }, [isHistoryPreviewing, triggerAutoSave]);

    const handleDueStartChange = useCallback((value: string) => {
        if (isHistoryPreviewing) return;
        setDueStart(value);
        handleTimeToggle(!!value);

        // Preserve duration and move end time
        if (value && duration) {
            const [hours, mins] = value.split(':').map(Number);
            const startMins = hours * 60 + mins;
            const endMins = startMins + duration;
            const h = Math.floor(endMins / 60) % 24;
            const m = endMins % 60;
            setDueEnd(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
        }

        triggerAutoSave();
    }, [isHistoryPreviewing, handleTimeToggle, duration, triggerAutoSave]);

    const handleDueEndChange = useCallback((value: string) => {
        if (isHistoryPreviewing) return;
        setDueEnd(value);

        // Update duration based on start time
        if (value && dueStart) {
            const [sH, sM] = dueStart.split(':').map(Number);
            const [eH, eM] = value.split(':').map(Number);
            const startMins = sH * 60 + sM;
            let endMins = eH * 60 + eM;
            if (endMins < startMins) endMins += 24 * 60; // Cross midnight
            setDuration(Math.max(0, endMins - startMins));
        }

        triggerAutoSave();
    }, [isHistoryPreviewing, dueStart, triggerAutoSave]);

    const handleStartReminderEnabledChange = useCallback((enabled: boolean) => {
        if (isHistoryPreviewing) return;
        setStartReminderEnabled(enabled);
        if (enabled && !REMINDER_MINUTE_OPTIONS.includes(startReminderMinutes)) {
            setStartReminderMinutes(0);
        }
        triggerAutoSave();
    }, [isHistoryPreviewing, startReminderMinutes, triggerAutoSave]);

    const handleStartReminderMinutesChange = useCallback((minutes: ReminderMinuteOption) => {
        if (isHistoryPreviewing) return;
        setStartReminderMinutes(minutes);
        triggerAutoSave();
    }, [isHistoryPreviewing, triggerAutoSave]);

    const handleEndReminderEnabledChange = useCallback((enabled: boolean) => {
        if (isHistoryPreviewing) return;
        setEndReminderEnabled(enabled);
        if (enabled && !REMINDER_MINUTE_OPTIONS.includes(endReminderMinutes)) {
            setEndReminderMinutes(0);
        }
        triggerAutoSave();
    }, [isHistoryPreviewing, endReminderMinutes, triggerAutoSave]);

    const handleEndReminderMinutesChange = useCallback((minutes: ReminderMinuteOption) => {
        if (isHistoryPreviewing) return;
        setEndReminderMinutes(minutes);
        triggerAutoSave();
    }, [isHistoryPreviewing, triggerAutoSave]);

    const handleDurationChange = useCallback((value: number | "") => {
        if (isHistoryPreviewing) return;
        if (value === "") {
            setDuration("");
            return;
        }
        const nextDuration = Math.max(0, value);
        setDuration(nextDuration);

        // If we have start time, update end time to maintain duration
        if (dueStart) {
            const [hours, mins] = dueStart.split(':').map(Number);
            const startMins = hours * 60 + mins;
            const endMins = startMins + nextDuration;
            const h = Math.floor(endMins / 60) % 24;
            const m = endMins % 60;
            setDueEnd(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
        }
        triggerAutoSave();
    }, [isHistoryPreviewing, dueStart, triggerAutoSave]);

    const handleTargetBoardChange = useCallback((value: string) => {
        if (isHistoryPreviewing) return;
        setTargetBoardId(value);
        triggerAutoSave();
    }, [isHistoryPreviewing, triggerAutoSave]);

    const handleBucketChange = (next: DueBucket) => {
        if (isHistoryPreviewing) return;
        setDueBucket(next);
        setDueBucketPosition(Date.now());
        triggerAutoSave();
    };

    // Google Calendar Integration
    const { connected: googleConnected, canWrite: googleCanWrite } = useGoogleCalendar();
    const {
        syncStatus,
        setSyncStatus,
        lastGoogleEventId,
        resyncCandidates,
        resyncLoading,
        resyncError,
        resyncFetched,
        syncNowLoading,
        syncToast,
        handleResyncRequest,
        handleResyncSelect,
        handleSyncNow,
    } = useCardModalGoogleSync({
        card,
        title,
        dueDate,
        dueStart,
        dueEnd,
        googleConnected,
        googleCanWrite,
    });

    const handleApplyHistory = useCallback(() => {
        if (!previewHistoryContent || !selectedHistoryId) return;
        setContent(previewHistoryContent);
        hasPendingChangesRef.current = false;
        handleSave(false, {
            restoreFromHistory: true,
            historySourceId: selectedHistoryId,
            contentOverride: previewHistoryContent,
        });
    }, [previewHistoryContent, selectedHistoryId, handleSave]);

    const titleShortcutAttributes = useMemo(
        () =>
            buildShortcutDataAttributes({
                scope: "modal",
                region: "modal-title",
                part: "title",
                legacyContext: "cardmodal-title",
            }),
        []
    );
    const bodyShortcutAttributes = useMemo(
        () =>
            buildShortcutDataAttributes({
                scope: "modal",
                region: "modal-body",
                part: "editor",
                legacyContext: "cardmodal-editor",
            }),
        []
    );

    return (
        <div className="fixed inset-0 z-50 flex items-stretch justify-center p-0 sm:items-center sm:p-4" role="presentation">
            <div
                aria-hidden="true"
                className="absolute inset-0 bg-black/50"
                onClick={requestClose}
                data-testid="card-modal-overlay"
            />
            <div
                ref={dialogRef}
                tabIndex={-1}
                className="relative z-10 h-full max-h-[100dvh] sm:h-[90vh] sm:max-h-[90vh] w-full max-w-6xl rounded-none sm:rounded-2xl bg-white shadow-2xl outline-none dark:bg-gray-800 flex flex-col overflow-hidden"
                role="dialog"
                aria-modal="true"
                aria-labelledby="modal-title"
                onClick={(e) => e.stopPropagation()}
                onFocusCapture={(event) => {
                    if (isLoading || isHistoryPreviewing) {
                        setActiveShortcutDescriptor(null);
                        return;
                    }
                    const nextDescriptor = getShortcutContextFromTarget(event.target);
                    setActiveShortcutDescriptor(nextDescriptor?.scope === "modal" ? nextDescriptor : null);
                }}
                onBlurCapture={() => {
                    if (typeof window === "undefined") return;
                    window.requestAnimationFrame(() => {
                        syncActiveShortcutDescriptor();
                    });
                }}
            >
                <CardModalHeader
                    dueDate={dueDate}
                    dueStart={dueStart}
                    dueEnd={dueEnd}
                    dueBucket={dueBucket}
                    boards={boards}
                    targetBoardId={targetBoardId}
                    bucketOptions={BUCKET_OPTIONS}
                    defaultBucket={DEFAULT_BUCKET}
                    selectedAssignees={selectedAssignees}
                    filteredProfiles={filteredProfiles}
                    memberSearch={memberSearch}
                    showMemberDropdown={showMemberDropdown}
                    memberButtonRef={memberButtonRef}
                    memberDropdownRef={memberDropdownRef}
                            onMemberSearchChange={setMemberSearch}
                    onToggleMemberDropdown={toggleMemberDropdown}
                    onAddMember={handleAddMember}
                    onRemoveMember={handleRemoveMember}
                    onDueDateChange={handleDueDateInputChange}
                    onDueStartChange={handleDueStartChange}
                    onDueEndChange={handleDueEndChange}
                    startReminderEnabled={startReminderEnabled}
                    startReminderMinutes={startReminderMinutes}
                    endReminderEnabled={endReminderEnabled}
                    endReminderMinutes={endReminderMinutes}
                    reminderMinuteOptions={[...REMINDER_MINUTE_OPTIONS]}
                    onStartReminderEnabledChange={handleStartReminderEnabledChange}
                    onStartReminderMinutesChange={handleStartReminderMinutesChange}
                    onEndReminderEnabledChange={handleEndReminderEnabledChange}
                    onEndReminderMinutesChange={handleEndReminderMinutesChange}
                    onTargetBoardChange={handleTargetBoardChange}
                    duration={duration}
                    onDurationChange={handleDurationChange}
                    onBucketChange={handleBucketChange}
                    cardShortId={card.short_id ?? null}
                    onCopyLink={handleCopyLink}
                    googleSync={{
                        cardId: card.id,
                        connected: googleConnected,
                        canWrite: googleCanWrite,
                        status: syncStatus,
                        onStatusChange: setSyncStatus,
                    }}
                    onRequestClose={requestClose}
                    showSidebar={showSidebar}
                    onToggleSidebar={() => setShowSidebar((prev) => !prev)}
                />
                <div className="shrink-0 border-b border-slate-200 bg-slate-50/90 px-0 py-0 dark:border-gray-700 dark:bg-gray-900/80">
                    <StatusShortcutBar
                        payload={modalShortcutPayload}
                        maxVisibleItems={shortcutBar?.maxVisibleItems}
                        className="rounded-none border-0 bg-transparent px-0 py-0 shadow-none ring-0"
                        dataTestId="modal-shortcut-bar"
                    />
                </div>
                {historySaveWarning && (
                    <div className="mx-4 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                        <p>{historySaveWarning}</p>
                        <div className="mt-2 flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => onRetryHistorySave?.()}
                                className="rounded-md bg-amber-600 px-2.5 py-1 font-semibold text-white hover:bg-amber-700"
                            >
                                履歴作成を再試行
                            </button>
                            <button
                                type="button"
                                onClick={() => onCloseWithoutHistory?.()}
                                className="rounded-md border border-amber-300 px-2.5 py-1 font-semibold text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-200 dark:hover:bg-amber-900/40"
                            >
                                履歴なしで閉じる
                            </button>
                        </div>
                    </div>
                )}

                {/* 2 Column Layout - Vertical on mobile, Horizontal on desktop */}
                <div ref={resizeRef} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden sm:flex-row">
                    {/* Left Column - Details (Note) */}
                    <div className={`flex min-h-0 min-w-0 flex-1 flex-col p-0 ${showSidebar ? "hidden sm:flex" : "flex"}`}>
                        {!isLoading && (
                            <div
                                className="z-20"
                            >
                                <div
                                    data-sticky-title
                                    className="bg-white dark:bg-gray-800 border-b border-slate-100 dark:border-gray-700 px-6 py-3 flex items-center gap-2"
                                >
                                    <input
                                        type="checkbox"
                                        checked={checked}
                                        disabled={isHistoryPreviewing}
                                        onChange={(e) => {
                                            if (isHistoryPreviewing) return;
                                            const val = e.target.checked;
                                            setChecked(val);
                                            triggerAutoSave();
                                        }}
                                        className="h-5 w-5 rounded border-slate-300 text-sky-600 focus:ring-sky-500 cursor-pointer"
                                    />
                                    {stickyTitleChecklistProgress ? (
                                        <span className="shrink-0 text-xs font-medium leading-none text-slate-500 tabular-nums">
                                            {stickyTitleChecklistProgress}
                                        </span>
                                    ) : null}
                                    <textarea
                                        ref={titleInputRef}
                                        value={title}
                                        rows={1}
                                        wrap="soft"
                                        autoFocus={shouldFocusTitleOnOpen}
                                        data-autofocus={shouldFocusTitleOnOpen ? "true" : undefined}
                                        disabled={isHistoryPreviewing}
                                        onChange={(e) => {
                                            if (isHistoryPreviewing) return;
                                            const normalizedTitle = e.target.value.replace(/\r?\n/g, "");
                                            setTitle(normalizedTitle);
                                            triggerAutoSave();
                                        }}
                                        onKeyDown={handleTitleKeyDown}
                                        placeholder="タイトルなし"
                                        className="min-h-[1lh] min-w-0 basis-0 flex-1 resize-none overflow-hidden bg-transparent border-none p-0 text-xl font-bold leading-tight text-slate-900 break-words dark:text-gray-100 placeholder-slate-400 focus:ring-0 focus:outline-none disabled:opacity-60"
                                        {...titleShortcutAttributes}
                                    />
                                </div>
                            </div>
                        )}
                        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
                            {isLoading ? (
                                <div className="flex flex-col items-center justify-center p-12 space-y-4">
                                    <svg className="w-8 h-8 animate-spin text-slate-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    <p className="text-sm text-slate-500 animate-pulse">読み込み中...</p>
                                </div>
                            ) : (
                                <div className="flex h-full min-h-0 min-w-0 flex-col">
                                    {isHistoryPreviewing && (
                                        <div className="mx-6 mt-4 mb-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                                            <p className="font-semibold">履歴プレビュー中</p>
                                            <p className="mt-1">「この履歴に戻す」で確定するまで本文は変更されません。</p>
                                            <div className="mt-2 flex items-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={handleApplyHistory}
                                                    className="rounded-md bg-amber-600 px-2.5 py-1 font-semibold text-white hover:bg-amber-700"
                                                >
                                                    この履歴に戻す
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={cancelHistoryPreview}
                                                    className="rounded-md border border-amber-300 px-2.5 py-1 font-semibold text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-200 dark:hover:bg-amber-900/40"
                                                >
                                                    キャンセル
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                    {previewError && (
                                        <p className="mx-6 mb-2 text-xs text-red-600">{previewError}</p>
                                    )}
                                    <div className="flex-1 p-0">
                                        {previewLoading ? (
                                            <div className="flex h-full items-center justify-center text-sm text-slate-500">履歴を読み込み中...</div>
                                        ) : (
                                            <div className="flex h-full min-w-0 flex-col" {...bodyShortcutAttributes}>
                                                <TiptapEditor
                                                    key={isHistoryPreviewing ? `${card.id}-preview-${selectedHistoryId}` : card.id}
                                                    initialContent={isHistoryPreviewing ? previewHistoryContent : content}
                                                    editable={!isHistoryPreviewing}
                                                    boardId={card.board_id}
                                                    cardId={card.id}
                                                    onEditorError={setEditorError}
                                                    onRegisterBodyBridge={handleRegisterBodyBridge}
                                                    onRequestFocusTitle={handleRequestFocusTitle}
                                                    onShortcutStateChange={setBodyShortcutState}
                                                    onChange={(val) => {
                                                        if (isHistoryPreviewing) return;
                                                        setContent(val);
                                                        triggerAutoSave(val);
                                                        if (editorError) {
                                                            setEditorError(null);
                                                        }
                                                    }}
                                                    placeholder="メモを入力..."
                                                    data-autofocus={!isHistoryPreviewing && !shouldFocusTitleOnOpen}
                                                />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                        {editorError && (
                            <p className="mt-2 text-xs text-red-600">{editorError}</p>
                        )}
                    </div>

                    {/* Right Column - Sidebar (integrated conditionally on mobile) */}
                    {showSidebar && (
                        <>
                            <div
                                role="separator"
                                aria-orientation="vertical"
                                onMouseDown={startResizing}
                                className="hidden sm:block w-1 cursor-col-resize bg-slate-100 hover:bg-sky-100"
                            />
                            <CardModalSidebar
                                sidebarWidth={sidebarWidth}
                                cardId={card.id}
                                boardId={card.board_id}
                                profiles={profiles}
                                tags={tags}
                                availableTags={mergedAvailableTags}
                                tagInput={tagInput}
                                onTagInputChange={handleTagInputChange}
                                onTagInputKeyDown={handleAddTag}
                                onRemoveTag={handleRemoveTag}
                                activeTab={activeSidebarTab}
                                onTabChange={(tab) => {
                                    setActiveSidebarTab(tab);
                                    if (tab === 'history') {
                                        setShowSidebar(true);
                                    }
                                }}
                                historyItems={historyItems}
                                historyLoading={historyLoading}
                                historyError={historyError}
                                selectedHistoryId={selectedHistoryId}
                                onSelectHistory={handleSelectHistory}
                            />
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
