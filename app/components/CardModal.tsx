"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useClickOutside } from "@/app/(board)/_hooks/useClickOutside";
import type { Card, Board, Priority, ProfileSummary, DueBucket } from "@/lib/supabase";
import TiptapEditor from "@/app/(board)/_components/tiptap/TiptapEditor";
import { JSONContent } from "@tiptap/react";
import {
    deriveExcerptFromContent,
    deriveTitleFromContent,
    ensureTitleBlock,
    getTiptapPlainText,
    normalizeContent,
} from "@/lib/tiptap";
import { useGoogleCalendar } from "@/app/(board)/_hooks/useGoogleCalendar";
import { GoogleSyncToggle } from "@/app/(board)/_components/GoogleSyncToggle";
import { ResyncCandidate, fetchResyncCandidates } from "@/app/(board)/_utils/resync";
import CardModalHeader from "@/app/components/card-modal/CardModalHeader";
import CardModalSidebar from "@/app/components/card-modal/CardModalSidebar";

const DEFAULT_BUCKET: DueBucket = 'b';
const BUCKET_OPTIONS: { value: DueBucket; label: string }[] = [
    { value: 'a', label: 'A (do today)' },
    { value: 'b', label: 'B (if possible)' },
];

interface CardModalProps {
    card: Card;
    boards: Board[];
    profiles: ProfileSummary[];
    onSave: (payload: {
        id: string;
        title: string;
        content: JSONContent | Record<string, any> | any[];
        excerpt: string;
        tags?: string[];
        due_date?: string | null;
        priority?: Priority;
        assigneeIds?: string[];
        assigneeTouched?: boolean;
        due_start?: string | null;
        due_end?: string | null;
        due_bucket?: DueBucket | null;
        due_bucket_position?: number | null;
        duration?: number;
        isAutoSave?: boolean;
    }) => void;
    onDelete: (id: string) => void;
    onMoveToBoard: (cardId: string, targetBoardId: string) => void;
    onClose: () => void;
    isLoading?: boolean;
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
    const [dueBucket, setDueBucket] = useState<DueBucket | null>(card.due_bucket ?? null);
    const [dueBucketPosition, setDueBucketPosition] = useState<number | null>(card.due_bucket_position ?? null);
    const [duration, setDuration] = useState<number | "">(card.duration ?? 60);
    const [priority, setPriority] = useState<Priority>(card.priority || 'medium');
    const contentFetchRef = useRef<string | null>(null);
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

    // Sidebar resize state
    const [sidebarWidth, setSidebarWidth] = useState(384); // Default w-96 = 384px
    const [isResizing, setIsResizing] = useState(false);

    const resizeRef = useRef<HTMLDivElement>(null);
    const [assigneeTouched, setAssigneeTouched] = useState(false);
    const [targetBoardId, setTargetBoardId] = useState(card.board_id);
    const [isDirty, setIsDirty] = useState(false);
    const [showSidebar, setShowSidebar] = useState(() => {
        if (typeof window !== "undefined") {
            return window.innerWidth >= 640; // sm breakpoint
        }
        return true;
    });
    const [editorError, setEditorError] = useState<string | null>(null);
    const [showDirtyDialog, setShowDirtyDialog] = useState(false);

    const dialogRef = useRef<HTMLDivElement>(null);
    const cardIdRef = useRef(card.id);
    const onCloseRef = useRef(onClose);
    const requestCloseRef = useRef<() => void>(() => { });
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


    // card prop が変わったときの処理（ただし編集中は無視）
    useEffect(() => {
        // card.id が変わった場合（別のカードを開いた）、または編集していない場合のみ更新
        const incomingContent = normalizeContent(card.content);
        const incomingText = getTiptapPlainText(incomingContent).trim();
        const localText = getTiptapPlainText(content).trim();
        const shouldForceSync = isDirty && !localText && incomingText.length > 0;

        if (card.id !== cardIdRef.current) {
            cardIdRef.current = card.id;
            setContent(incomingContent);
            setTitle(card.title || "");
            setTags(card.tags || []);
            setDueDate(card.due_date || '');
            setDueStart(card.due_start ? card.due_start.slice(0, 5) : '');
            setDueEnd(card.due_end ? card.due_end.slice(0, 5) : '');
            setDueBucket(card.due_bucket ?? null);
            setDueBucketPosition(card.due_bucket_position ?? null);
            setDuration(card.duration ?? 60);
            setPriority(card.priority || 'medium');
            // Initialize assigneeIds from card
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
            setShowDirtyDialog(false);
        } else if (!isDirty || shouldForceSync) {
            // 同じカードで編集していない場合のみ、外部の変更を反映
            setContent(incomingContent);
            if (!isDirty) setTitle(card.title || "");
            setTags(card.tags || []);
            setDueDate(card.due_date || '');
            setDueStart(card.due_start ? card.due_start.slice(0, 5) : '');
            setDueEnd(card.due_end ? card.due_end.slice(0, 5) : '');
            setDueBucket(card.due_bucket ?? null);
            setDueBucketPosition(card.due_bucket_position ?? null);
            setDuration(card.duration ?? 60);
            setPriority(card.priority || 'medium');
            const newAssigneeIds = card.assignee_ids && card.assignee_ids.length > 0
                ? card.assignee_ids
                : card.assignee_id
                    ? [card.assignee_id]
                    : [];
            setAssigneeIds(newAssigneeIds);
            setAssigneeTouched(false);
            setTargetBoardId(card.board_id);
            setIsDirty(false);
        }
    }, [card, isDirty]);

    // Added: Sync content when isLoading turns false and not dirty
    useEffect(() => {
        if (!isLoading && !isDirty) {
            setContent(normalizeContent(card.content));
        }
    }, [isLoading, card.content, isDirty]);

    // 追加：保存後のリセット対応
    // card prop が更新された際、ローカルの状態がサーバの状態と一致していれば Dirty を落とす
    // このチェックは isDirty が true の時でも（保存が完了したことを検知するために）行う必要がある
    useEffect(() => {
        if (isDirty) {
            const incomingContent = normalizeContent(card.content);
            const localSerialized = JSON.stringify(ensureTitleBlock(content));
            const incomingSerialized = JSON.stringify(incomingContent);

            const normalizedDueDate = card.due_date || '';
            const dateMatch = normalizedDueDate === (dueDate || '');

            const normalizedStart = card.due_start ? card.due_start.slice(0, 5) : '';
            const startMatch = normalizedStart === (dueStart || '');

            const normalizedEnd = card.due_end ? card.due_end.slice(0, 5) : '';
            const endMatch = normalizedEnd === (dueEnd || '');

            const priorityMatch = (card.priority || 'medium') === priority;

            const cardAssignees = card.assignee_ids || (card.assignee_id ? [card.assignee_id] : []);
            const assigneesMatch = cardAssignees.length === assigneeIds.length && cardAssignees.every(id => assigneeIds.includes(id));

            const cardTags = card.tags || [];
            const tagsMatch = cardTags.length === tags.length && cardTags.every(t => tags.includes(t));

            const bucketMatch = (card.due_bucket ?? null) === (dueBucket ?? null);
            const durationMatch = (card.duration ?? 60) === duration;
            const titleMatch = (card.title || "") === title;

            if (localSerialized === incomingSerialized &&
                titleMatch &&
                dateMatch && startMatch && endMatch &&
                priorityMatch && tagsMatch && bucketMatch && assigneesMatch && durationMatch) {
                setIsDirty(false);
            }
        }
    }, [isDirty, card, content, title, dueDate, dueStart, dueEnd, priority, assigneeIds, tags, dueBucket, duration]);

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

    const handleSave = useCallback((isAutoSave = false) => {
        const normalizedDueDate = dueDate || null;
        const hasTime = dueStart && dueEnd; // Both must be present
        const normalizedStart = hasTime ? `${dueStart}:00` : null;
        const normalizedEnd = hasTime ? `${dueEnd}:00` : null;

        // Always send bucket fields (timelineはnull、A/Bはa|bを保持)
        const normalizedBucket: DueBucket | null = dueBucket ?? null;
        const normalizedBucketPosition: number | null =
            normalizedBucket != null ? dueBucketPosition ?? null : null;

        const normalizedContent = content; // ensureTitleBlock removed
        // Use title state directly
        const nextTitle = title.trim();
        // Title can be empty
        const nextExcerpt = deriveExcerptFromContent(normalizedContent);

        if (!isAutoSave) {
            setEditorError(null);
        }
        onSave({
            id: card.id,
            title: nextTitle,
            content: normalizedContent,
            excerpt: nextExcerpt,
            tags,
            due_date: normalizedDueDate,
            priority,
            assigneeIds: assigneeIds.length > 0 ? assigneeIds : [],
            assigneeTouched,
            due_start: normalizedStart,
            due_end: normalizedEnd,
            due_bucket: normalizedBucket,
            due_bucket_position: normalizedBucketPosition,
            duration: Number(duration) || 0,
            isAutoSave,
        });

        if (!isAutoSave && targetBoardId !== card.board_id) {
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
        dueBucket,
        dueBucketPosition,
        duration,
        priority,
        assigneeIds,
        assigneeTouched,
        targetBoardId,
        onSave,
        onMoveToBoard,
    ]);

    const triggerAutoSave = useCallback(() => {
        setIsDirty(true);
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
    }, [handleSave]);

    const requestClose = useCallback(() => {
        if (isDirty) {
            if (autoSaveTimeoutRef.current) {
                clearTimeout(autoSaveTimeoutRef.current);
            }
            if (autoSaveMaxTimeoutRef.current) {
                clearTimeout(autoSaveMaxTimeoutRef.current);
                autoSaveMaxTimeoutRef.current = null;
            }
            handleSave(false);
            return;
        }
        onCloseRef.current();
    }, [isDirty, handleSave]);

    useEffect(() => {
        requestCloseRef.current = requestClose;
    }, [requestClose]);


    const handleAddMember = (profileId: string) => {
        if (!assigneeIds.includes(profileId)) {
            setAssigneeIds([...assigneeIds, profileId]);
            setAssigneeTouched(true);
            triggerAutoSave();
        }
        setShowMemberDropdown(false);
        setMemberSearch('');
    };

    const handleRemoveMember = (profileId: string) => {
        setAssigneeIds(assigneeIds.filter(id => id !== profileId));
        setAssigneeTouched(true);
        triggerAutoSave();
    };

    const handleAddTag = (e: React.KeyboardEvent<HTMLInputElement>) => {
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
        setTags(tags.filter(t => t !== tagToRemove));
        triggerAutoSave();
    };

    const handleTimeToggle = (checked: boolean) => {
        if (!checked) {
            setDueStart('');
            setDueEnd('');
            if (dueDate && !dueBucket) {
                setDueBucket(DEFAULT_BUCKET);
                setDueBucketPosition(Date.now());
            }
        }
    };

    const handleDueDateInputChange = useCallback((value: string) => {
        setDueDate(value ? new Date(value).toISOString() : '');
        triggerAutoSave();
    }, [triggerAutoSave]);

    const handleDueStartChange = useCallback((value: string) => {
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
    }, [handleTimeToggle, duration, triggerAutoSave]);

    const handleDueEndChange = useCallback((value: string) => {
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
    }, [dueStart, triggerAutoSave]);

    const handlePriorityChange = useCallback((value: Priority) => {
        setPriority(value);
        triggerAutoSave();
    }, [triggerAutoSave]);

    const handleDurationChange = useCallback((value: number | "") => {
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
    }, [dueStart, triggerAutoSave]);

    const handleTargetBoardChange = useCallback((value: string) => {
        setTargetBoardId(value);
        triggerAutoSave();
    }, [triggerAutoSave]);

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
        setDueBucket(next);
        setDueBucketPosition(Date.now());
        triggerAutoSave();
    };

    // Google Calendar Integration
    const { connected: googleConnected, canWrite: googleCanWrite } = useGoogleCalendar();
    // Handle calendar_sync possibly being an array or object due to Supabase join
    const syncData = (card as any).calendar_sync;
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
        const nextTitle = deriveTitleFromContent(ensureTitleBlock(content));
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
                className="relative z-10 max-h-[95vh] sm:max-h-[90vh] w-full max-w-6xl rounded-2xl bg-white shadow-2xl outline-none dark:bg-gray-800 flex flex-col overflow-hidden"
                role="dialog"
                aria-modal="true"
                aria-labelledby="modal-title"
                onClick={(e) => e.stopPropagation()}
            >
                <CardModalHeader
                    titlePreview={titlePreview}
                    onTitleChange={(val) => {
                        setTitle(val);
                        triggerAutoSave();
                    }}
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
                    duration={duration}
                    onDurationChange={handleDurationChange}
                    onBucketChange={handleBucketChange}
                    onRequestClose={requestClose}
                    showSidebar={showSidebar}
                    onToggleSidebar={() => setShowSidebar((prev) => !prev)}
                />

                {/* 2 Column Layout - Vertical on mobile, Horizontal on desktop */}
                <div ref={resizeRef} className="flex flex-col sm:flex-row flex-1 overflow-hidden min-h-0">
                    {/* Left Column - Details (Note) */}
                    {(!showSidebar || (typeof window !== "undefined" && window.innerWidth >= 640)) && (
                        <div className="flex-1 overflow-y-auto p-0">
                            {isLoading ? (
                                <div className="flex flex-col items-center justify-center p-12 space-y-4">
                                    <svg className="w-8 h-8 animate-spin text-slate-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    <p className="text-sm text-slate-500 animate-pulse">読み込み中...</p>
                                </div>
                            ) : (
                                <TiptapEditor
                                    key={card.id}
                                    initialContent={content}
                                    onChange={(val) => {
                                        setContent(val);
                                        triggerAutoSave();
                                        if (editorError) {
                                            setEditorError(null);
                                        }
                                    }}
                                    placeholder="メモを入力..."
                                />
                            )}
                            {editorError && (
                                <p className="mt-2 text-xs text-red-600">{editorError}</p>
                            )}
                        </div>
                    )}

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
