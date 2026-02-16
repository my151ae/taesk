"use client";

import { useEffect, useMemo, useRef, useState, useCallback, useLayoutEffect } from "react";
import { useClickOutside } from "@/app/(board)/_hooks/useClickOutside";
import type { Card, Board, Priority, ProfileSummary, DueBucket, CardContentHistoryMeta } from "@/lib/supabase";
import TiptapEditor from "@/app/(board)/_components/tiptap/TiptapEditor";
import { JSONContent } from "@tiptap/react";
import {
    deriveExcerptFromContent,
    extractTitleTask,
    setTitleTask,
    ensureTitleTask,
    getTiptapPlainText,
    normalizeContent,
} from "@/lib/tiptap";
import { useGoogleCalendar } from "@/app/(board)/_hooks/useGoogleCalendar";
import { GoogleSyncToggle } from "@/app/(board)/_components/GoogleSyncToggle";
import { ResyncCandidate, fetchResyncCandidates } from "@/app/(board)/_utils/resync";
import CardModalHeader from "@/app/components/card-modal/CardModalHeader";
import CardModalSidebar from "@/app/components/card-modal/CardModalSidebar";
import type { CardModalSavePayload, ReminderMinuteOption } from "@/app/components/card-modal/types";

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
    const [content, setContent] = useState<JSONContent>(() =>
        normalizeContent(card.content)
    );
    const [title, setTitle] = useState(card.title || "");
    const [tags, setTags] = useState<string[]>(card.tags || []);
    const [tagInput, setTagInput] = useState('');
    const [dueDate, setDueDate] = useState(card.due_date || '');
    const [dueStart, setDueStart] = useState(card.due_start ? card.due_start.slice(0, 5) : '');
    const [dueEnd, setDueEnd] = useState(card.due_end ? card.due_end.slice(0, 5) : '');
    const [startReminderEnabled, setStartReminderEnabled] = useState(Boolean(card.start_reminder_enabled));
    const [startReminderMinutes, setStartReminderMinutes] = useState<ReminderMinuteOption>(
        REMINDER_MINUTE_OPTIONS.includes((card.start_reminder_minutes ?? 0) as ReminderMinuteOption)
            ? (card.start_reminder_minutes ?? 0) as ReminderMinuteOption
            : 0
    );
    const [endReminderEnabled, setEndReminderEnabled] = useState(Boolean(card.end_reminder_enabled));
    const [endReminderMinutes, setEndReminderMinutes] = useState<ReminderMinuteOption>(
        REMINDER_MINUTE_OPTIONS.includes((card.end_reminder_minutes ?? 0) as ReminderMinuteOption)
            ? (card.end_reminder_minutes ?? 0) as ReminderMinuteOption
            : 0
    );
    const [dueBucket, setDueBucket] = useState<DueBucket | null>(card.due_bucket ?? null);
    const [dueBucketPosition, setDueBucketPosition] = useState<number | null>(card.due_bucket_position ?? null);
    const [duration, setDuration] = useState<number | "">(card.duration ?? 60);
    const [priority, setPriority] = useState<Priority>(card.priority || 'medium');
    const [checked, setChecked] = useState(card.checked || false);
    // Initialize assigneeIds from card.assignee_ids (array) or card.assignee_id (single, legacy)
    const [assigneeIds, setAssigneeIds] = useState<string[]>(() => {
        if (card.assignee_ids && card.assignee_ids.length > 0) {
            return card.assignee_ids;
        }
        if (card.assignee_id) {
            return [card.assignee_id];
        }
        return [];
    });
    const [showMemberDropdown, setShowMemberDropdown] = useState(false);
    const [memberSearch, setMemberSearch] = useState('');
    const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
    const [stickyOpacity, setStickyOpacity] = useState(0);

    // Sidebar resize state
    const [sidebarWidth, setSidebarWidth] = useState(384); // Default w-96 = 384px
    const [isResizing, setIsResizing] = useState(false);

    const resizeRef = useRef<HTMLDivElement>(null);
    const contentScrollRef = useRef<HTMLDivElement>(null);
    const editorContainerRef = useRef<HTMLDivElement>(null);
    const [assigneeTouched, setAssigneeTouched] = useState(false);
    const [targetBoardId, setTargetBoardId] = useState(card.board_id);
    const [showSidebar, setShowSidebar] = useState(false);
    const [activeSidebarTab, setActiveSidebarTab] = useState<"comments" | "history">("comments");
    const [historyItems, setHistoryItems] = useState<CardContentHistoryMeta[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyError, setHistoryError] = useState<string | null>(null);
    const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
    const [previewHistoryContent, setPreviewHistoryContent] = useState<JSONContent | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const [editorError, setEditorError] = useState<string | null>(null);
    const lastTitleVisibilityRef = useRef<number | null>(null);

    const dialogRef = useRef<HTMLDivElement>(null);
    const cardIdRef = useRef(card.id);
    const hasAppliedInitialLoadRef = useRef(false);
    const previousLoadingRef = useRef<boolean | null>(null);
    const onCloseRef = useRef(onClose);
    const requestCloseRef = useRef<() => void>(() => { });
    const hasPendingChangesRef = useRef(false);
    const memberButtonRef = useRef<HTMLButtonElement | null>(null);
    const memberDropdownRef = useRef<HTMLDivElement | null>(null);

    // Debounce and max-wait for auto-save
    const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const autoSaveMaxTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const filteredProfiles = useMemo(() => {
        const query = memberSearch.trim().toLowerCase();
        const base = !query
            ? profiles
            : profiles.filter((profile) => {
                const username = profile.username?.toLowerCase() ?? '';
                const display = profile.display_name?.toLowerCase() ?? '';
                const name = profile.full_name?.toLowerCase() ?? '';
                const email = profile.email?.toLowerCase() ?? '';
                return (
                    username.includes(query) ||
                    display.includes(query) ||
                    name.includes(query) ||
                    email.includes(query)
                );
            });

        // Filter out already assigned members
        return base.filter((profile) => !assigneeIds.includes(profile.id));
    }, [profiles, memberSearch, assigneeIds]);

    const selectedAssignees = useMemo(() => {
        return profiles.filter((profile) => assigneeIds.includes(profile.id));
    }, [profiles, assigneeIds]);

    const titlePreview = title || card.title || "";

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

    useEffect(() => {
        const root = contentScrollRef.current;
        const dialog = dialogRef.current;
        const editorWrap = editorContainerRef.current;
        const proseMirror = editorWrap?.querySelector<HTMLElement>('.ProseMirror') ?? null;
        const getDebugName = (el: Element | null) =>
            el
                ? `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${el.className ? `.${String(el.className).trim().replace(/\\s+/g, ".")}` : ""}`
                : "null";
        if ((!root && !dialog) || isLoading || typeof window === "undefined") {
            setStickyOpacity(0);
            return;
        }

        let rafId = 0;
        const fadeDistance = 40;

        const getScrollTop = () => {
            const rootTop = root?.scrollTop ?? 0;
            const dialogTop = dialog?.scrollTop ?? 0;
            const editorTop = editorWrap?.scrollTop ?? 0;
            const proseTop = proseMirror?.scrollTop ?? 0;
            const docTop = document.scrollingElement?.scrollTop ?? 0;
            const maxTop = Math.max(rootTop, dialogTop, editorTop, proseTop, docTop);
            return {
                maxTop,
                rootTop,
                dialogTop,
                editorTop,
                proseTop,
                docTop,
            };
        };

        const updateVisibility = () => {
            rafId = 0;
            const { maxTop, rootTop, dialogTop, editorTop, proseTop, docTop } = getScrollTop();
            const progress = Math.min(1, Math.max(0, maxTop / fadeDistance));
            setStickyOpacity(progress);
            if (lastTitleVisibilityRef.current !== progress) {
                console.log("[CardModal][StickyTitle] scrollTop:", maxTop, "opacity:", progress);
                lastTitleVisibilityRef.current = progress;
            }
        };

        const onScroll = () => {
            if (rafId) return;
            rafId = window.requestAnimationFrame(updateVisibility);
        };

        updateVisibility();
        root?.addEventListener("scroll", onScroll, { passive: true });
        dialog?.addEventListener("scroll", onScroll, { passive: true });
        editorWrap?.addEventListener("scroll", onScroll, { passive: true });
        proseMirror?.addEventListener("scroll", onScroll, { passive: true });
        document.addEventListener("scroll", onScroll, { passive: true, capture: true });
        window.addEventListener("resize", onScroll);

        return () => {
            if (rafId) {
                window.cancelAnimationFrame(rafId);
            }
            root?.removeEventListener("scroll", onScroll);
            dialog?.removeEventListener("scroll", onScroll);
            editorWrap?.removeEventListener("scroll", onScroll);
            proseMirror?.removeEventListener("scroll", onScroll);
            document.removeEventListener("scroll", onScroll, true);
            window.removeEventListener("resize", onScroll);
        };
    }, [card.id, isLoading]);

    // card prop が変わったときの処理
    useEffect(() => {
        // カードIDが変わった場合は、エディタも含め全てリセット
        if (card.id !== cardIdRef.current) {
            cardIdRef.current = card.id;
            hasAppliedInitialLoadRef.current = false;
            previousLoadingRef.current = null;
            const incomingContent = normalizeContent(card.content);
            // ステートのリセット（TiptapEditor は key={card.id} でリマウントされる）
            setContent(incomingContent);
            setTitle(card.title || "");
            setTags(card.tags || []);
            setDueDate(card.due_date || '');
            setDueStart(card.due_start ? card.due_start.slice(0, 5) : '');
            setDueEnd(card.due_end ? card.due_end.slice(0, 5) : '');
            setStartReminderEnabled(Boolean(card.start_reminder_enabled));
            setStartReminderMinutes(
                REMINDER_MINUTE_OPTIONS.includes((card.start_reminder_minutes ?? 0) as ReminderMinuteOption)
                    ? (card.start_reminder_minutes ?? 0) as ReminderMinuteOption
                    : 0
            );
            setEndReminderEnabled(Boolean(card.end_reminder_enabled));
            setEndReminderMinutes(
                REMINDER_MINUTE_OPTIONS.includes((card.end_reminder_minutes ?? 0) as ReminderMinuteOption)
                    ? (card.end_reminder_minutes ?? 0) as ReminderMinuteOption
                    : 0
            );
            setDueBucket(card.due_bucket ?? null);
            setDueBucketPosition(card.due_bucket_position ?? null);
            setDuration(card.duration ?? 60);
            setPriority(card.priority || 'medium');
            setChecked(card.checked || false);

            const newAssigneeIds = card.assignee_ids && card.assignee_ids.length > 0
                ? card.assignee_ids
                : card.assignee_id
                    ? [card.assignee_id]
                    : [];
            setAssigneeIds(newAssigneeIds);
            setMemberSearch('');
            setAssigneeTouched(false);
            setTargetBoardId(card.board_id);
            setEditorError(null);
            hasPendingChangesRef.current = false;
            setActiveSidebarTab('comments');
            setHistoryItems([]);
            setHistoryError(null);
            setHistoryLoading(false);
            setSelectedHistoryId(null);
            setPreviewHistoryContent(null);
            setPreviewError(null);
            setPreviewLoading(false);
        }
        // NOTE: 同期ループ防止のため、同じカード間での外部データ -> contentステートへの同期はここでは行わない。
        // TiptapEditor は非制御のため、マウント時のデータ（card.content）のみを信じる。
    // eslint-disable-next-line react-hooks/exhaustive-deps -- カード切替時のみ初期化する設計
    }, [card.id]); // id 変化のみを監視

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
        const extracted = extractTitleTask(incomingContent);
        setTitle(extracted.text);
        setChecked(extracted.checked);
        setEditorError(null);
        hasAppliedInitialLoadRef.current = true;
    }, [card.content, card.id, isLoading]);

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

    const isHistoryPreviewing = previewHistoryContent !== null;

    const fetchHistoryList = useCallback(async () => {
        setHistoryLoading(true);
        setHistoryError(null);
        try {
            const response = await fetch(`/api/boards/${card.board_id}/cards/${card.id}/history?limit=50`);
            const body = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(body?.error?.message || '履歴の取得に失敗しました');
            }
            setHistoryItems(Array.isArray(body?.history) ? body.history : []);
        } catch (error) {
            setHistoryError(error instanceof Error ? error.message : '履歴の取得に失敗しました');
        } finally {
            setHistoryLoading(false);
        }
    }, [card.board_id, card.id]);

    const handleSelectHistory = useCallback(async (historyId: string) => {
        setSelectedHistoryId(historyId);
        setPreviewLoading(true);
        setPreviewError(null);
        try {
            const response = await fetch(`/api/boards/${card.board_id}/cards/${card.id}/history/${historyId}`);
            const body = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(body?.error?.message || '履歴の取得に失敗しました');
            }
            const historyContent = normalizeContent(body?.history?.content);
            setPreviewHistoryContent(historyContent);
        } catch (error) {
            setPreviewError(error instanceof Error ? error.message : '履歴の取得に失敗しました');
            setPreviewHistoryContent(null);
        } finally {
            setPreviewLoading(false);
        }
    }, [card.board_id, card.id]);

    const cancelHistoryPreview = useCallback(() => {
        setSelectedHistoryId(null);
        setPreviewHistoryContent(null);
        setPreviewError(null);
        setPreviewLoading(false);
    }, []);

    const handleSave = useCallback((isAutoSave = false, options?: { restoreFromHistory?: boolean; historySourceId?: string; contentOverride?: JSONContent; }) => {
        const normalizedDueDate = dueDate || null;
        const hasTime = dueStart && dueEnd; // Both must be present
        const normalizedStart = hasTime ? `${dueStart}:00` : null;
        const normalizedEnd = hasTime ? `${dueEnd}:00` : null;

        // Always send bucket fields (timelineはnull、A/Bはa|bを保持)
        const normalizedBucket: DueBucket | null = dueBucket ?? null;
        const normalizedBucketPosition: number | null =
            normalizedBucket != null ? dueBucketPosition ?? null : null;

        // 保存時に構造を最終補正
        const sourceContent = options?.contentOverride ?? content;
        const { content: correctedContent } = ensureTitleTask(sourceContent, title, checked);
        // 重要：最新の content (エディタの中身) からタイトルとチェック状態を優先的に再抽出する
        // これにより、onChange での同期と保存時の最終ステートを一致させる
        const extracted = extractTitleTask(correctedContent);
        // 合意A: 空文字も正当なタイトルとして受け入れる（復活バグの防止）
        const nextTitle = extracted.text.trim();
        const nextChecked = extracted.checked;
        const nextExcerpt = deriveExcerptFromContent(correctedContent);

        hasPendingChangesRef.current = false;

        if (!isAutoSave) {
            setEditorError(null);
        }
        onSave({
            id: card.id,
            title: nextTitle,
            content: correctedContent,
            excerpt: nextExcerpt,
            checked: nextChecked,
            tags,
            due_date: normalizedDueDate,
            priority,
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
        priority,
        assigneeIds,
            assigneeTouched,
            checked,
            targetBoardId,
            onSave,
            onMoveToBoard,
    ]);

    const triggerAutoSave = useCallback(() => {
        if (isHistoryPreviewing) return;
        hasPendingChangesRef.current = true;
        if (autoSaveTimeoutRef.current) {
            clearTimeout(autoSaveTimeoutRef.current);
        }
        autoSaveTimeoutRef.current = setTimeout(() => {
            if (autoSaveMaxTimeoutRef.current) {
                clearTimeout(autoSaveMaxTimeoutRef.current);
                autoSaveMaxTimeoutRef.current = null;
            }
            handleSave(true);
        }, 2000);
        if (!autoSaveMaxTimeoutRef.current) {
            autoSaveMaxTimeoutRef.current = setTimeout(() => {
                if (autoSaveTimeoutRef.current) {
                    clearTimeout(autoSaveTimeoutRef.current);
                }
                autoSaveMaxTimeoutRef.current = null;
                handleSave(true);
            }, 15000);
        }
    }, [handleSave, isHistoryPreviewing]);

    const requestClose = useCallback(() => {
        if (isHistoryPreviewing) {
            cancelHistoryPreview();
            return;
        }
        if (hasPendingChangesRef.current) {
            if (autoSaveTimeoutRef.current) {
                clearTimeout(autoSaveTimeoutRef.current);
            }
            if (autoSaveMaxTimeoutRef.current) {
                clearTimeout(autoSaveMaxTimeoutRef.current);
                autoSaveMaxTimeoutRef.current = null;
            }
            // 閉じる操作は待たずに反映し、保存は即時 autosave として送信する
            handleSave(true);
            onCloseRef.current();
            return;
        }
        onCloseRef.current();
    }, [handleSave, isHistoryPreviewing, cancelHistoryPreview]);

    useEffect(() => {
        requestCloseRef.current = requestClose;
    }, [requestClose]);

    useEffect(() => {
        if (!showSidebar || activeSidebarTab !== 'history') return;
        void fetchHistoryList();
    }, [activeSidebarTab, showSidebar, fetchHistoryList]);


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

    const handlePriorityChange = useCallback((value: Priority) => {
        if (isHistoryPreviewing) return;
        setPriority(value);
        triggerAutoSave();
    }, [isHistoryPreviewing, triggerAutoSave]);

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

    // Resize handlers
    const startResizing = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        setIsResizing(true);
    }, []);

    const stopResizing = useCallback(() => {
        setIsResizing(false);
    }, []);

    const resize = useCallback(
        (e: MouseEvent) => {
            if (isResizing && resizeRef.current) {
                const containerRect = resizeRef.current.getBoundingClientRect();
                // Calculate new width relative to the container’s right edge
                const newWidth = containerRect.right - e.clientX;
                // Clamp between 250px and 600px
                if (newWidth >= 250 && newWidth <= 600) {
                    setSidebarWidth(newWidth);
                }
            }
        },
        [isResizing]
    );

    useEffect(() => {
        if (isResizing) {
            window.addEventListener('mousemove', resize);
            window.addEventListener('mouseup', stopResizing);
        } else {
            window.removeEventListener('mousemove', resize);
            window.removeEventListener('mouseup', stopResizing);
        }
        return () => {
            window.removeEventListener('mousemove', resize);
            window.removeEventListener('mouseup', stopResizing);
        };
    }, [isResizing, resize, stopResizing]);

    const handleBucketChange = (next: DueBucket) => {
        if (isHistoryPreviewing) return;
        setDueBucket(next);
        setDueBucketPosition(Date.now());
        triggerAutoSave();
    };

    // Google Calendar Integration
    const { connected: googleConnected, canWrite: googleCanWrite } = useGoogleCalendar();
    // Handle calendar_sync possibly being an array or object due to Supabase join
    const syncData = (card as Card & {
        calendar_sync?: { status?: "active" | "unlinked" | "deleted"; last_google_event_id?: string | null } | Array<{ status?: "active" | "unlinked" | "deleted"; last_google_event_id?: string | null }>;
    }).calendar_sync;
    const syncStatusFromCard = Array.isArray(syncData) ? syncData[0]?.status : syncData?.status;
    const lastGoogleEventIdFromCard = Array.isArray(syncData) ? syncData[0]?.last_google_event_id : syncData?.last_google_event_id;

    const [syncStatus, setSyncStatus] = useState<"active" | "unlinked" | "deleted" | undefined>(syncStatusFromCard);
    const [lastGoogleEventId, setLastGoogleEventId] = useState<string | undefined | null>(lastGoogleEventIdFromCard);

    useEffect(() => {
        setSyncStatus(syncStatusFromCard);
        setLastGoogleEventId(lastGoogleEventIdFromCard);
    }, [syncStatusFromCard, lastGoogleEventIdFromCard, card.id]);

    useEffect(() => {
        console.log("[CardModal][GoogleSync] state", {
            cardId: card.id,
            syncStatus,
            lastGoogleEventId,
            googleConnected,
            googleCanWrite,
        });
    }, [card.id, syncStatus, lastGoogleEventId, googleConnected, googleCanWrite]);

    useEffect(() => {
        let cancelled = false;
        const loadSyncStatus = async () => {
            try {
                const res = await fetch(`/api/calendar-sync/${card.id}`);
                const body = await res.json().catch(() => null);
                if (!res.ok) {
                    console.warn("[CardModal][GoogleSync] status fetch failed", { cardId: card.id, status: res.status, body });
                    return;
                }
                if (cancelled) return;
                const nextStatus = body?.status as "active" | "unlinked" | "deleted" | undefined;
                const nextLast = body?.last_google_event_id ?? body?.google_event_id ?? null;
                setSyncStatus(nextStatus);
                setLastGoogleEventId(nextLast);
                console.log("[CardModal][GoogleSync] status fetched", { cardId: card.id, status: nextStatus, last: nextLast });
            } catch (error) {
                if (cancelled) return;
                console.warn("[CardModal][GoogleSync] status fetch error", { cardId: card.id, error });
            }
        };
        loadSyncStatus();
        return () => {
            cancelled = true;
        };
    }, [card.id]);

    const [resyncCandidates, setResyncCandidates] = useState<ResyncCandidate[]>([]);
    const [resyncLoading, setResyncLoading] = useState(false);
    const [resyncError, setResyncError] = useState<string | null>(null);
    const [resyncFetched, setResyncFetched] = useState(false);
    const [syncNowLoading, setSyncNowLoading] = useState(false);
    const [syncToast, setSyncToast] = useState<string | null>(null);

    const handleResyncRequest = useCallback(async () => {
        // deriveTitleFromContent here
        const nextTitle = extractTitleTask(ensureTitleTask(content).content).text;
        if (!nextTitle) return;
        setResyncLoading(true);
        setResyncError(null);
        setResyncFetched(false);
        try {
            const candidates = await fetchResyncCandidates({
                title: nextTitle,
                start: dueDate ?? undefined,
                end: dueDate ?? undefined,
            });
            setResyncCandidates(candidates);
            setResyncFetched(true);
            console.log("[CardModal][GoogleSync] resync candidates", {
                cardId: card.id,
                title: nextTitle,
                start: dueDate,
                end: dueDate,
                count: candidates.length,
            });
        } catch (error) {
            console.error("resync candidates error", error);
            setResyncError(error instanceof Error ? error.message : "候補の取得に失敗しました");
            setResyncCandidates([]);
            setResyncFetched(true);
        } finally {
            setResyncLoading(false);
        }
    }, [content, dueDate, card.id]);

    const handleResyncSelect = useCallback(async (googleEventId?: string) => {
        setResyncLoading(true);
        setResyncError(null);
        setSyncToast("Google同期中...");
        try {
            const url = googleEventId
                ? `/api/calendar-sync/${card.id}?google_event_id=${encodeURIComponent(googleEventId)}`
                : `/api/calendar-sync/${card.id}`;
            const res = await fetch(url, { method: "POST" });
            const body = await res.json().catch(() => null);
            if (!res.ok) {
                throw new Error(body?.error?.message || "再シンクに失敗しました");
            }
            setSyncStatus("active");
            setLastGoogleEventId((prev) => googleEventId ?? prev ?? lastGoogleEventIdFromCard ?? null);
            setSyncToast("Google同期が完了しました");
        } catch (error) {
            const message = error instanceof Error ? error.message : "再シンクに失敗しました";
            setResyncError(message);
            setSyncToast(message);
        } finally {
            setResyncLoading(false);
            window.setTimeout(() => setSyncToast(null), 3000);
        }
    }, [card.id, lastGoogleEventIdFromCard, setSyncStatus]);

    const handleSyncNow = useCallback(async () => {
        if (!dueDate || !dueStart || !dueEnd) {
            setSyncToast("開始・終了時刻を設定してください");
            window.setTimeout(() => setSyncToast(null), 2500);
            return;
        }
        if (!googleConnected || !googleCanWrite || syncStatus !== "active") {
            setSyncToast("Googleとシンクを有効にしてください");
            window.setTimeout(() => setSyncToast(null), 2500);
            return;
        }
        setSyncNowLoading(true);
        setSyncToast("Google同期中...");
        try {
            const res = await fetch(`/api/calendar-sync/${card.id}`, { method: "POST" });
            const body = await res.json().catch(() => null);
            if (!res.ok) {
                throw new Error(body?.error?.message || "同期に失敗しました");
            }
            if (body?.pullStats) {
                // Show pull-side diagnostics in console for debugging Google→Taesk
                // pullStats: { matched, updated }
                console.info("[GoogleSync][syncNow] pull stats", body.pullStats);
            }
            setSyncToast("Google同期が完了しました");
        } catch (error) {
            setSyncToast(error instanceof Error ? error.message : "同期に失敗しました");
        } finally {
            setSyncNowLoading(false);
            window.setTimeout(() => setSyncToast(null), 3000);
        }
    }, [card.id, dueDate, dueEnd, dueStart, googleCanWrite, googleConnected, syncStatus]);

    const handleDelete = () => {
        if (confirm('Delete this card?')) {
            onDelete(card.id);
        }
    };

    const handleApplyHistory = useCallback(() => {
        if (!previewHistoryContent || !selectedHistoryId) return;
        const extracted = extractTitleTask(previewHistoryContent);
        setContent(previewHistoryContent);
        setTitle(extracted.text);
        setChecked(extracted.checked);
        hasPendingChangesRef.current = false;
        handleSave(false, {
            restoreFromHistory: true,
            historySourceId: selectedHistoryId,
            contentOverride: previewHistoryContent,
        });
    }, [previewHistoryContent, selectedHistoryId, handleSave]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
            <div
                aria-hidden="true"
                className="absolute inset-0 bg-black/50"
                onClick={requestClose}
                data-testid="card-modal-overlay"
            />
            <div
                ref={dialogRef}
                tabIndex={-1}
                className="relative z-10 max-h-[95vh] sm:h-[90vh] sm:max-h-[90vh] w-full max-w-6xl rounded-2xl bg-white shadow-2xl outline-none dark:bg-gray-800 flex flex-col overflow-hidden"
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
                    duration={duration}
                    onDurationChange={handleDurationChange}
                    onBucketChange={handleBucketChange}
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
                    <div className={`flex flex-col flex-1 min-h-0 p-0 relative ${showSidebar ? "hidden sm:flex" : "flex"}`}>
                        {!isLoading && (
                            <div
                                className="absolute top-0 left-0 right-0 z-20"
                                style={{ opacity: stickyOpacity, pointerEvents: stickyOpacity > 0 ? "auto" : "none" }}
                                aria-hidden={stickyOpacity === 0}
                            >
                                <div
                                    data-sticky-title
                                    className="bg-white dark:bg-gray-800 border-b border-slate-100 dark:border-gray-700 px-6 sm:px-8 py-3 flex items-center gap-3 transition-opacity"
                                >
                                    <input
                                        type="checkbox"
                                        checked={checked}
                                        disabled={isHistoryPreviewing}
                                        onChange={(e) => {
                                            if (isHistoryPreviewing) return;
                                            const val = e.target.checked;
                                            setChecked(val);
                                            const { content: newContent, changed } = setTitleTask(content, { checked: val });
                                            if (changed) {
                                                setContent(newContent);
                                            }
                                            triggerAutoSave();
                                        }}
                                        className="h-5 w-5 rounded border-slate-300 text-sky-600 focus:ring-sky-500 cursor-pointer"
                                    />
                                    <input
                                        type="text"
                                        value={title}
                                        disabled={isHistoryPreviewing}
                                        onChange={(e) => {
                                            if (isHistoryPreviewing) return;
                                            const val = e.target.value;
                                            setTitle(val);
                                            const { content: newContent, changed } = setTitleTask(content, { text: val });
                                            if (changed) {
                                                setContent(newContent);
                                            }
                                            triggerAutoSave();
                                        }}
                                        onBlur={() => {
                                            if (isHistoryPreviewing) return;
                                            // フォーカスアウト時に構造補正を確実に行う
                                            const { content: correctedContent } = ensureTitleTask(content, title, checked);
                                            setContent(correctedContent);
                                        }}
                                        placeholder="タイトルなし"
                                        className="flex-1 bg-transparent border-none p-0 text-xl font-bold text-slate-900 dark:text-gray-100 placeholder-slate-400 focus:ring-0 focus:outline-none disabled:opacity-60"
                                    />
                                </div>
                            </div>
                        )}
                        <div ref={contentScrollRef} className="flex-1 overflow-y-auto min-h-0">
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
                                                containerRef={editorContainerRef}
                                                initialContent={isHistoryPreviewing ? previewHistoryContent : content}
                                                editable={!isHistoryPreviewing}
                                                onChange={(val) => {
                                                    if (isHistoryPreviewing) return;
                                                    setContent(val);
                                                    const { text: extractedText, checked: newChecked } = extractTitleTask(val);
                                                    if (extractedText !== title) {
                                                        setTitle(extractedText);
                                                    }
                                                    if (newChecked !== checked) {
                                                        setChecked(newChecked);
                                                    }
                                                    triggerAutoSave();
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
                        <CardModalSidebar
                            sidebarWidth={sidebarWidth}
                            tagInput={tagInput}
                            tags={tags}
                            onTagInputChange={setTagInput}
                            onTagInputKeyDown={handleAddTag}
                            onRemoveTag={handleRemoveTag}
                            priority={priority}
                            onPriorityChange={handlePriorityChange}
                            boards={boards}
                            targetBoardId={targetBoardId}
                            onTargetBoardChange={handleTargetBoardChange}
                            cardShortId={card.short_id ?? null}
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
                            googleSync={{
                                cardId: card.id,
                                connected: googleConnected,
                                canWrite: googleCanWrite,
                                status: syncStatus,
                                onStatusChange: setSyncStatus,
                            }}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
