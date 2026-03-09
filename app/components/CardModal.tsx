"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useClickOutside } from "@/app/(board)/_hooks/useClickOutside";
import type { Card, Board, ProfileSummary, DueBucket } from "@/lib/supabase";
import TiptapEditor, { BodyEditorBridge, FocusTitleRequest } from "@/app/(board)/_components/tiptap/TiptapEditor";
import { JSONContent } from "@tiptap/react";
import {
    deriveExcerptFromContent,
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
    onSave: (payload: CardModalSavePayload) => void;
    onDelete: (id: string) => void;
    onMoveToBoard: (cardId: string, targetBoardId: string) => void;
    onClose: () => void;
    isLoading?: boolean;
    historySaveWarning?: string | null;
    onRetryHistorySave?: () => void;
    onCloseWithoutHistory?: () => void;
}

export function CardModal({
    card,
    boards,
    onSave,
    onDelete,
    profiles,
    onMoveToBoard,
    onClose,
    isLoading,
    historySaveWarning,
    onRetryHistorySave,
    onCloseWithoutHistory,
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

    const dialogRef = useRef<HTMLDivElement>(null);
    const cardIdRef = useRef(card.id);
    const hasAppliedInitialLoadRef = useRef(false);
    const previousLoadingRef = useRef<boolean | null>(null);
    const onCloseRef = useRef(onClose);
    const requestCloseRef = useRef<() => void>(() => { });
    const hasPendingChangesRef = useRef(false);
    const hasAutoSavedEditsRef = useRef(false);
    const memberButtonRef = useRef<HTMLButtonElement | null>(null);
    const memberDropdownRef = useRef<HTMLDivElement | null>(null);

    // Debounce and max-wait for auto-save
    const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const autoSaveMaxTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const pendingAutoSaveContentRef = useRef<JSONContent | null>(null);
    const bodyBridgeRef = useRef<BodyEditorBridge | null>(null);
    const titleInputRef = useRef<HTMLInputElement | null>(null);

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

    // onClose ref を最新に保つ
    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);


    // 初期表示時のみ、デスクトップならサイドバーを開く
    useEffect(() => {
        if (typeof window === "undefined") return;
        const media = window.matchMedia("(min-width: 640px)");
        if (media.matches) {
            setShowSidebar(true);
        }
    }, []);

    // card prop が変わったときの処理
    useEffect(() => {
        // カードIDが変わった場合は、エディタも含め全てリセット
        if (card.id !== cardIdRef.current) {
            cardIdRef.current = card.id;
            hasAppliedInitialLoadRef.current = false;
            previousLoadingRef.current = null;
            resetDraft(card);
            hasPendingChangesRef.current = false;
            hasAutoSavedEditsRef.current = false;
            resetHistoryState();
        }
        // NOTE: 同期ループ防止のため、同じカード間での外部データ -> contentステートへの同期はここでは行わない。
        // TiptapEditor は非制御のため、マウント時のデータ（card.content）のみを信じる。
    // eslint-disable-next-line react-hooks/exhaustive-deps -- カード切替時のみ初期化する設計
    }, [card.id, resetDraft, resetHistoryState]); // id 変化のみを監視

    // 同じカードIDで本文データが後から到着した場合は、未編集の時だけ同期する
    useEffect(() => {
        if (card.id !== cardIdRef.current) return;
        const loadingNow = Boolean(isLoading);
        const wasLoading = previousLoadingRef.current;
        previousLoadingRef.current = loadingNow;
        if (hasPendingChangesRef.current) return;
        if (loadingNow) return;
        if (hasAppliedInitialLoadRef.current) return;
        if (wasLoading !== true) return;

        const incomingContent = normalizeContent(card.content);
        setContent(incomingContent);
        setTitle(card.title || "");
        setChecked(card.checked || false);
        setEditorError(null);
        hasAppliedInitialLoadRef.current = true;
    }, [card.content, card.id, card.title, card.checked, isLoading]);

    // 保存後のリセット対応は 各ハンドラーと card prop の同期にて行う
    // (重い JSON.stringify 比較は行わない)

    // Escape key to close + focus trap
    useEffect(() => {
        // モーダルを開く直前のフォーカス要素を保持
        const previousActiveElement = document.activeElement as HTMLElement | null;

        const focusableSelector =
            'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

        const focusFirstElement = () => {
            const dialog = dialogRef.current;
            if (!dialog) return;
            const autoFocusTarget = dialog.querySelector<HTMLElement>('[data-autofocus]');
            if (autoFocusTarget) {
                autoFocusTarget.focus();
                return;
            }
            const focusable = dialog.querySelectorAll<HTMLElement>(focusableSelector);
            (focusable[0] ?? dialog).focus();
        };

        const trapFocus = (event: KeyboardEvent) => {
            const dialog = dialogRef.current;
            if (!dialog) return;

            if (event.key === "Escape") {
                event.preventDefault();
                requestCloseRef.current();
                return;
            }

            if (event.key !== "Tab") {
                return;
            }

            const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter(
                (element) => !element.hasAttribute("disabled"),
            );

            if (focusable.length === 0) {
                event.preventDefault();
                dialog.focus();
                return;
            }

            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const current = document.activeElement as HTMLElement | null;
            const isShift = event.shiftKey;

            if (!current) {
                event.preventDefault();
                first.focus();
                return;
            }

            if (!isShift && current === last) {
                event.preventDefault();
                first.focus();
                return;
            }

            if (isShift && current === first) {
                event.preventDefault();
                last.focus();
                return;
            }
        };

        document.addEventListener("keydown", trapFocus);
        focusFirstElement();

        return () => {
            document.removeEventListener("keydown", trapFocus);
            if (autoSaveTimeoutRef.current) {
                clearTimeout(autoSaveTimeoutRef.current);
            }
            if (autoSaveMaxTimeoutRef.current) {
                clearTimeout(autoSaveMaxTimeoutRef.current);
            }
            // モーダルが閉じる際にフォーカスを戻す
            // 要素がまだ存在している場合のみフォーカス
            if (previousActiveElement && document.body.contains(previousActiveElement)) {
                previousActiveElement.focus();
            }
        };
    }, []); // 空配列でマウント時のみ実行

    // Close member dropdown when clicking outside
    useClickOutside(memberDropdownRef, () => setShowMemberDropdown(false));

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

        hasPendingChangesRef.current = false;

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

    const triggerAutoSave = useCallback((contentOverride?: JSONContent) => {
        if (isHistoryPreviewing) return;
        hasPendingChangesRef.current = true;
        hasAutoSavedEditsRef.current = true;
        if (contentOverride) {
            pendingAutoSaveContentRef.current = contentOverride;
        }
        if (autoSaveTimeoutRef.current) {
            clearTimeout(autoSaveTimeoutRef.current);
        }
        autoSaveTimeoutRef.current = setTimeout(() => {
            if (autoSaveMaxTimeoutRef.current) {
                clearTimeout(autoSaveMaxTimeoutRef.current);
                autoSaveMaxTimeoutRef.current = null;
            }
            const latestContent = pendingAutoSaveContentRef.current ?? undefined;
            pendingAutoSaveContentRef.current = null;
            handleSave(true, { contentOverride: latestContent });
        }, 2000);
        if (!autoSaveMaxTimeoutRef.current) {
            autoSaveMaxTimeoutRef.current = setTimeout(() => {
                if (autoSaveTimeoutRef.current) {
                    clearTimeout(autoSaveTimeoutRef.current);
                }
                autoSaveMaxTimeoutRef.current = null;
                const latestContent = pendingAutoSaveContentRef.current ?? undefined;
                pendingAutoSaveContentRef.current = null;
                handleSave(true, { contentOverride: latestContent });
            }, 15000);
        }
    }, [handleSave, isHistoryPreviewing]);

    const requestClose = useCallback(() => {
        if (isHistoryPreviewing) {
            cancelHistoryPreview();
            return;
        }
        if (hasPendingChangesRef.current || hasAutoSavedEditsRef.current) {
            if (autoSaveTimeoutRef.current) {
                clearTimeout(autoSaveTimeoutRef.current);
            }
            if (autoSaveMaxTimeoutRef.current) {
                clearTimeout(autoSaveMaxTimeoutRef.current);
                autoSaveMaxTimeoutRef.current = null;
            }
            // 閉じる操作は待たずに反映し、保存は即時 autosave として送信する
            const latestContent = pendingAutoSaveContentRef.current ?? undefined;
            pendingAutoSaveContentRef.current = null;
            hasAutoSavedEditsRef.current = false;
            handleSave(true, { contentOverride: latestContent, forceHistorySnapshot: true });
            onCloseRef.current();
            return;
        }
        onCloseRef.current();
    }, [handleSave, isHistoryPreviewing, cancelHistoryPreview]);

    useEffect(() => {
        requestCloseRef.current = requestClose;
    }, [requestClose]);

    const handleRegisterBodyBridge = useCallback((bridge: BodyEditorBridge | null) => {
        bodyBridgeRef.current = bridge;
    }, []);

    const handleRequestFocusTitle = useCallback((request: FocusTitleRequest) => {
        const input = titleInputRef.current;
        if (!input) return;
        let maxLength = input.value.length;
        let targetPosition = input.value.length;

        input.focus();
        if (request.mode === 'column') {
            const nextPos = Math.min(Math.max(request.column ?? maxLength, 0), maxLength);
            input.setSelectionRange(nextPos, nextPos);
            return;
        }
        const nextPos = Math.min(Math.max(targetPosition, 0), maxLength);
        input.setSelectionRange(nextPos, nextPos);
    }, []);

    const handleTitleKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
        if (isHistoryPreviewing) return;
        if ((event.nativeEvent as KeyboardEvent).isComposing) return;

        const bridge = bodyBridgeRef.current;
        if (!bridge) return;

        const input = event.currentTarget;
        const selectionStart = input.selectionStart;
        const selectionEnd = input.selectionEnd;
        if (selectionStart == null || selectionEnd == null || selectionStart !== selectionEnd) {
            return;
        }

        const caret = selectionStart;
        const isCaretAtEnd = caret === title.length;

        if (event.key === "ArrowDown") {
            event.preventDefault();
            event.stopPropagation();
            bridge.focusBody(caret);
            return;
        }

        if (event.key === "ArrowRight") {
            if (!isCaretAtEnd) return;
            event.preventDefault();
            event.stopPropagation();
            bridge.focusBody(0);
            return;
        }
    }, [isHistoryPreviewing, title]);


    const handleAddMember = (profileId: string) => {
        if (isHistoryPreviewing) return;
        if (!assigneeIds.includes(profileId)) {
            setAssigneeIds([...assigneeIds, profileId]);
            setAssigneeTouched(true);
            triggerAutoSave();
        }
        setShowMemberDropdown(false);
        setMemberSearch('');
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
            if (!tags.includes(tagInput.trim())) {
                setTags([...tags, tagInput.trim()]);
                triggerAutoSave();
            }
            setTagInput('');
        }
    };

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
                    onToggleMemberDropdown={() => setShowMemberDropdown((prev) => !prev)}
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
                    tags={tags}
                    tagInput={tagInput}
                    onTagInputChange={setTagInput}
                    onTagInputKeyDown={handleAddTag}
                    onRemoveTag={handleRemoveTag}
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
                <div ref={resizeRef} className="flex flex-col sm:flex-row flex-1 overflow-hidden min-h-0">
                    {/* Left Column - Details (Note) */}
                    <div className={`flex flex-col flex-1 min-h-0 p-0 ${showSidebar ? "hidden sm:flex" : "flex"}`}>
                        {!isLoading && (
                            <div
                                className="z-20"
                            >
                                <div
                                    data-sticky-title
                                    className="bg-white dark:bg-gray-800 border-b border-slate-100 dark:border-gray-700 px-6 sm:px-8 py-3 flex items-center gap-3"
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
                                    <input
                                        ref={titleInputRef}
                                        type="text"
                                        value={title}
                                        disabled={isHistoryPreviewing}
                                        onChange={(e) => {
                                            if (isHistoryPreviewing) return;
                                            const val = e.target.value;
                                            setTitle(val);
                                            triggerAutoSave();
                                        }}
                                        onKeyDown={handleTitleKeyDown}
                                        placeholder="タイトルなし"
                                        className="flex-1 bg-transparent border-none p-0 text-xl font-bold text-slate-900 dark:text-gray-100 placeholder-slate-400 focus:ring-0 focus:outline-none disabled:opacity-60"
                                    />
                                </div>
                            </div>
                        )}
                        <div className="flex-1 overflow-y-auto min-h-0">
                            {isLoading ? (
                                <div className="flex flex-col items-center justify-center p-12 space-y-4">
                                    <svg className="w-8 h-8 animate-spin text-slate-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    <p className="text-sm text-slate-500 animate-pulse">読み込み中...</p>
                                </div>
                            ) : (
                                <div className="flex flex-col h-full min-h-0">
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
                                            <TiptapEditor
                                                key={isHistoryPreviewing ? `${card.id}-preview-${selectedHistoryId}` : card.id}
                                                initialContent={isHistoryPreviewing ? previewHistoryContent : content}
                                                editable={!isHistoryPreviewing}
                                                boardId={card.board_id}
                                                cardId={card.id}
                                                onEditorError={setEditorError}
                                                onRegisterBodyBridge={handleRegisterBodyBridge}
                                                onRequestFocusTitle={handleRequestFocusTitle}
                                                onChange={(val) => {
                                                    if (isHistoryPreviewing) return;
                                                    setContent(val);
                                                    triggerAutoSave(val);
                                                    if (editorError) {
                                                        setEditorError(null);
                                                    }
                                                }}
                                                placeholder="メモを入力..."
                                                data-autofocus={!isHistoryPreviewing}
                                            />
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
