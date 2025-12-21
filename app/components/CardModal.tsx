"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useClickOutside } from "@/app/(board)/_hooks/useClickOutside";
import Image from "next/image";
import type { Card, Board, Priority, ProfileSummary, DueBucket } from "@/lib/supabase";
import CommentsPanel from "@/app/(board)/_components/CommentsPanel";
import { resolveProfileIdentity, getProfileInitial } from "@/lib/usernames";
import { CardBlockEditor } from "@/app/(board)/_components/blocknote/CardBlockEditor";
import {
  BlockNoteDocument,
  deriveExcerptFromDocument,
  deriveTitleFromDocument,
  ensureTitleBlock,
  getDocumentPlainText,
  normalizeBlockNoteDocument,
} from "@/lib/blocknote";
import { useGoogleCalendar } from "@/app/(board)/_hooks/useGoogleCalendar";
import { GoogleSyncToggle } from "@/app/(board)/_components/GoogleSyncToggle";
import { ResyncCandidate, fetchResyncCandidates } from "@/app/(board)/_utils/resync";

const getProfileDisplayName = (profile: ProfileSummary): string => {
  const identity = resolveProfileIdentity(profile, profile.email ?? null);
  return identity.label;
};

const getProfileInitials = (profile: ProfileSummary): string => {
  return getProfileInitial(profile, profile.email ?? null);
};

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
    content: BlockNoteDocument;
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
    isAutoSave?: boolean;
  }) => void;
  onDelete: (id: string) => void;
  onMoveToBoard: (cardId: string, targetBoardId: string) => void;
  onClose: () => void;
}

export function CardModal({
  card,
  boards,
  onSave,
  onDelete,
  profiles,
  onMoveToBoard,
  onClose,
}: CardModalProps) {
  const [content, setContent] = useState<BlockNoteDocument>(() =>
    ensureTitleBlock(normalizeBlockNoteDocument(card.content ?? []))
  );
  const [tags, setTags] = useState<string[]>(card.tags || []);
  const [tagInput, setTagInput] = useState('');
  const [dueDate, setDueDate] = useState(card.due_date || '');
  const [dueStart, setDueStart] = useState(card.due_start ? card.due_start.slice(0, 5) : '');
  const [dueEnd, setDueEnd] = useState(card.due_end ? card.due_end.slice(0, 5) : '');
  const [dueBucket, setDueBucket] = useState<DueBucket | null>(card.due_bucket ?? null);
  const [dueBucketPosition, setDueBucketPosition] = useState<number | null>(card.due_bucket_position ?? null);
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

  const titlePreview = useMemo(() => {
    const normalized = ensureTitleBlock(content);
    const title = deriveTitleFromDocument(normalized);
    return title || card.title || "Edit Card";
  }, [content, card.title]);

  // onClose ref を最新に保つ
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);


  // card prop が変わったときの処理（ただし編集中は無視）
  useEffect(() => {
    // card.id が変わった場合（別のカードを開いた）、または編集していない場合のみ更新
    const incomingContent = normalizeBlockNoteDocument(card.content ?? []);
    const incomingText = getDocumentPlainText(incomingContent).trim();
    const localText = getDocumentPlainText(content).trim();
    const shouldForceSync = isDirty && !localText && incomingText.length > 0;

    if (card.id !== cardIdRef.current) {
      cardIdRef.current = card.id;
      setContent(incomingContent);
      setTags(card.tags || []);
      setDueDate(card.due_date || '');
      setDueStart(card.due_start ? card.due_start.slice(0, 5) : '');
      setDueEnd(card.due_end ? card.due_end.slice(0, 5) : '');
      setDueBucket(card.due_bucket ?? null);
      setDueBucketPosition(card.due_bucket_position ?? null);
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
      setTags(card.tags || []);
      setDueDate(card.due_date || '');
      setDueStart(card.due_start ? card.due_start.slice(0, 5) : '');
      setDueEnd(card.due_end ? card.due_end.slice(0, 5) : '');
      setDueBucket(card.due_bucket ?? null);
      setDueBucketPosition(card.due_bucket_position ?? null);
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

    // 追加：保存後のリセット対応
    // card prop が更新された際、ローカルの状態がサーバの状態と一致していれば Dirty を落とす
    // このチェックは isDirty が true の時でも（保存が完了したことを検知するために）行う必要がある
    if (isDirty) {
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

      if (localSerialized === incomingSerialized &&
        dateMatch && startMatch && endMatch &&
        priorityMatch && tagsMatch && bucketMatch && assigneesMatch) {
        setIsDirty(false);
      }
    }

    if (!isDirty && !localText && !incomingText && card.short_id && contentFetchRef.current !== card.short_id) {
      contentFetchRef.current = card.short_id;
      fetch(`/api/cards/${card.short_id}`)
        .then((res) => res.json().catch(() => null))
        .then((body) => {
          const remote = normalizeBlockNoteDocument(body?.card?.content ?? []);
          const remoteText = getDocumentPlainText(remote).trim();
          if (!remoteText) return;
          setContent(remote);
          setIsDirty(false);
        })
        .catch(() => {
          contentFetchRef.current = null;
        });
    }
  }, [card, isDirty]);

  // Escape key to close + focus trap
  useEffect(() => {
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

    const normalizedContent = ensureTitleBlock(normalizeBlockNoteDocument(content));
    const nextTitle = deriveTitleFromDocument(normalizedContent);
    if (!nextTitle) {
      if (!isAutoSave) {
        setEditorError("タイトルを入力してください");
      }
      return;
    }
    const nextExcerpt = deriveExcerptFromDocument(normalizedContent);

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
      isAutoSave,
    });

    if (!isAutoSave && targetBoardId !== card.board_id) {
      onMoveToBoard(card.id, targetBoardId);
    }
  }, [
    card.id,
    card.board_id,
    content,
    tags,
    dueDate,
    dueStart,
    dueEnd,
    dueBucket,
    dueBucketPosition,
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
    const nextTitle = deriveTitleFromDocument(ensureTitleBlock(content));
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

  const canSyncNow = Boolean(dueDate && dueStart && dueEnd && googleConnected && googleCanWrite && syncStatus === "active");
  const canSearchResync = Boolean(dueDate && dueStart && dueEnd && googleConnected && googleCanWrite);
  const showResyncSection = canSearchResync && (!syncStatus || syncStatus === "unlinked" || syncStatus === "deleted");

  const formatCandidateTime = (candidate: ResyncCandidate) => {
    if (candidate.isAllDay) {
      const start = candidate.start ? new Date(candidate.start) : null;
      return start ? `${start.getMonth() + 1}/${start.getDate()} 終日` : "終日";
    }
    const start = candidate.start ? new Date(candidate.start) : null;
    const end = candidate.end ? new Date(candidate.end) : null;
    if (!start || !end) return "時間未設定";
    const opts: Intl.DateTimeFormatOptions = { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" };
    return `${start.toLocaleString(undefined, opts)} - ${end.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
  };

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
        className="relative z-10 max-h-[90vh] w-full max-w-6xl rounded-2xl bg-white shadow-2xl outline-none dark:bg-gray-800 flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex justify-between items-start p-6 pb-4 border-b border-slate-200 dark:border-gray-700">
          <h2 id="modal-title" className="text-2xl font-bold text-slate-800 dark:text-gray-100">
            {titlePreview}
          </h2>
          <button
            onClick={requestClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl leading-none"
            aria-label="Close modal"
            data-autofocus
          >
            ✕
          </button>
        </div>

        {/* 2 Column Layout */}
        <div ref={resizeRef} className="flex flex-1 overflow-hidden">
          {/* Left Column - Details */}
          <div className="flex-1 overflow-y-auto p-6">
            {/* Block Editor */}
            <div className="h-full flex flex-col">
              <label className="text-xs font-semibold text-slate-500 dark:text-gray-400 mb-2 uppercase tracking-wider">
                Note
              </label>
              <div className="flex-1">
                <CardBlockEditor
                  key={card.id}
                  initialContent={content}
                  onChange={(next) => {
                    setContent(next);
                    triggerAutoSave();
                    if (editorError) {
                      setEditorError(null);
                    }
                  }}
                />
                {editorError && (
                  <p className="mt-2 text-xs text-red-600">{editorError}</p>
                )}
              </div>
            </div>
          </div>

          {/* Resizer Divider */}
          <div
            onMouseDown={startResizing}
            className={`w-1 cursor-col-resize hover:bg-sky-400 active:bg-sky-500 transition-colors z-10 ${isResizing ? 'bg-sky-500' : 'bg-slate-200 dark:bg-gray-700'
              }`}
          />

          {/* Right Column - Sidebar */}
          <div
            style={{ width: `${sidebarWidth}px` }}
            className="border-l border-transparent overflow-y-auto flex flex-col shrink-0"
          >
            <div className="p-6 space-y-5 border-b border-slate-100 dark:border-gray-700/50 bg-slate-50/30 dark:bg-gray-800/20">
              {/* Schedule Section */}
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 dark:text-gray-500 uppercase tracking-widest">
                  Schedule
                </label>
                <div className="grid grid-cols-1 gap-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={dueDate ? new Date(dueDate).toISOString().split('T')[0] : ''}
                      onChange={(e) => {
                        setDueDate(e.target.value ? new Date(e.target.value).toISOString() : '');
                        triggerAutoSave();
                      }}
                      className="flex-1 px-2 py-1.5 border border-slate-200 rounded-lg dark:bg-gray-700 dark:border-gray-600 text-xs focus:outline-none focus:ring-2 focus:ring-sky-300"
                    />
                  </div>
                  {dueDate && (
                    <div className="grid grid-cols-2 gap-2 pl-2 border-l-2 border-slate-100 dark:border-gray-700 ml-1">
                      <input
                        type="time"
                        step={900}
                        value={dueStart}
                        onChange={(e) => {
                          setDueStart(e.target.value);
                          handleTimeToggle(!!e.target.value);
                          triggerAutoSave();
                        }}
                        className="px-2 py-1.5 border border-slate-200 rounded-lg dark:bg-gray-700 dark:border-gray-600 text-[11px] focus:outline-none focus:ring-2 focus:ring-sky-300"
                      />
                      <input
                        type="time"
                        step={900}
                        value={dueEnd}
                        onChange={(e) => {
                          setDueEnd(e.target.value);
                          triggerAutoSave();
                        }}
                        className="px-2 py-1.5 border border-slate-200 rounded-lg dark:bg-gray-700 dark:border-gray-600 text-[11px] focus:outline-none focus:ring-2 focus:ring-sky-300"
                      />
                    </div>
                  )}
                  {dueDate && (
                    <div className="pl-2 border-l-2 border-slate-100 dark:border-gray-700 ml-1">
                      <select
                        value={(dueBucket ?? DEFAULT_BUCKET) as DueBucket}
                        onChange={(e) => handleBucketChange(e.target.value as DueBucket)}
                        className="w-full px-2 py-1.5 border border-slate-200 rounded-lg dark:bg-gray-700 dark:border-gray-600 text-[11px] focus:outline-none focus:ring-2 focus:ring-sky-300"
                      >
                        {BUCKET_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Google Calendar Sync Toggle */}
                  {dueDate && dueStart && dueEnd && (
                    <div className="pl-2 border-l-2 border-emerald-100 dark:border-emerald-900 ml-1 mt-1">
                      <GoogleSyncToggle
                        cardId={card.id}
                        initialStatus={syncStatus}
                        connected={googleConnected}
                        canWrite={googleCanWrite}
                        hasResyncCandidate={Boolean(!syncStatus || syncStatus === 'unlinked' || syncStatus === 'deleted') && Boolean(lastGoogleEventId)}
                        onResyncRequest={lastGoogleEventId ? handleResyncRequest : undefined}
                        onStatusChange={(next) => {
                          setSyncStatus(next);
                          if (next === "unlinked") {
                            setLastGoogleEventId((prev) => prev ?? lastGoogleEventIdFromCard ?? null);
                          }
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Members Section */}
              <div className="space-y-2 overflow-visible">
                <label className="text-[10px] font-bold text-slate-400 dark:text-gray-500 uppercase tracking-widest">
                  Members
                </label>
                <div className="flex flex-wrap gap-1.5 items-center relative">
                  {selectedAssignees.map((member) => (
                    <div
                      key={member.id}
                      className="group relative h-7 w-7"
                      title={resolveProfileIdentity(member, member.email ?? null).label}
                    >
                      {member.avatar_url ? (
                        <Image
                          src={member.avatar_url}
                          alt="assigned member"
                          width={28}
                          height={28}
                          className="h-7 w-7 rounded-full object-cover ring-1 ring-white dark:ring-gray-800"
                        />
                      ) : (
                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-slate-600 font-bold text-[11px] ring-1 ring-white dark:ring-gray-800">
                          {getProfileInitial(member, member.email ?? null)}
                        </span>
                      )}
                      <button
                        onClick={() => handleRemoveMember(member.id)}
                        className="absolute -top-1 -right-1 bg-white dark:bg-gray-700 rounded-full text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm ring-1 ring-slate-200"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  ))}
                  <button
                    ref={(el) => {
                      // @ts-ignore
                      memberButtonRef.current = el;
                    }}
                    onClick={() => {
                      const button = memberButtonRef.current;
                      if (button) {
                        const rect = button.getBoundingClientRect();
                        setDropdownPos({ top: rect.bottom + 8, left: rect.left - 200 });
                        setShowMemberDropdown(!showMemberDropdown);
                      }
                    }}
                    className="h-7 w-7 flex items-center justify-center rounded-full border border-dashed border-slate-300 hover:border-sky-400 hover:bg-sky-50 dark:border-gray-600 dark:hover:border-sky-600 dark:hover:bg-sky-900/20 text-slate-400 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                  </button>
                </div>
              </div>

              {/* Tags Section */}
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 dark:text-gray-500 uppercase tracking-widest">
                  Tags
                </label>
                <div className="flex flex-wrap gap-1.5 items-center">
                  <div className="relative flex-1 min-w-[140px]">
                    <input
                      type="text"
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={handleAddTag}
                      className="w-full px-2 py-1.5 border border-slate-200 rounded-lg dark:bg-gray-700 dark:border-gray-600 text-xs focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-transparent placeholder:text-slate-400"
                      placeholder="+ Add tag..."
                    />
                  </div>
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-white dark:bg-sky-900/30 text-sky-600 dark:text-sky-300 rounded-md text-[10px] font-medium border border-slate-100 dark:border-sky-800"
                    >
                      {tag}
                      <button
                        onClick={() => handleRemoveTag(tag)}
                        className="text-sky-400 hover:text-sky-600"
                        aria-label={`Remove tag ${tag}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>

              {/* Priority - Compact row */}
              <div className="flex items-center justify-between pt-1">
                <label className="text-[10px] font-bold text-slate-400 dark:text-gray-500 uppercase tracking-widest">
                  Priority
                </label>
                <select
                  value={priority}
                  onChange={(e) => {
                    setPriority(e.target.value as Priority);
                    triggerAutoSave();
                  }}
                  className="bg-transparent text-xs font-medium text-slate-600 dark:text-gray-300 focus:outline-none cursor-pointer"
                >
                  <option value="low">🟢 Low</option>
                  <option value="medium">🟡 Medium</option>
                  <option value="high">🔴 High</option>
                </select>
              </div>

              {/* Advanced (Board & Links) */}
              <div className="pt-2 flex items-center justify-between gap-2 border-t border-slate-100 dark:border-gray-700/50 mt-2">
                {boards.length > 1 && (
                  <div className="flex-1 min-w-0">
                    <select
                      value={targetBoardId}
                      onChange={(e) => {
                        setTargetBoardId(e.target.value);
                        triggerAutoSave();
                      }}
                      className="w-full bg-transparent text-[10px] font-medium text-slate-500 hover:text-slate-700 dark:text-gray-400 dark:hover:text-gray-200 focus:outline-none cursor-pointer truncate"
                    >
                      {boards.map((board) => (
                        <option key={board.id} value={board.id}>
                          Board: {board.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {card.short_id && (
                  <button
                    type="button"
                    onClick={() => {
                      const shortUrl = `${window.location.origin}/c/${card.short_id}`;
                      navigator.clipboard.writeText(shortUrl);
                    }}
                    className="text-[10px] font-medium text-sky-500 hover:text-sky-600 dark:text-sky-400 whitespace-nowrap"
                  >
                    🔗 Copy Link
                  </button>
                )}
              </div>
            </div>

            {/* Comments Area */}
            <div className="flex-1 min-h-0 flex flex-col p-6 pt-4">
              <h3 className="text-xs font-bold text-slate-400 dark:text-gray-500 uppercase tracking-widest mb-4">
                Comments
              </h3>
              <div className="flex-1 min-h-0">
                <CommentsPanel
                  cardId={card.id}
                  boardId={card.board_id}
                  initialProfiles={profiles}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex gap-2 p-6 pt-4 border-t border-slate-200 dark:border-gray-700">
          <button
            onClick={() => handleSave(false)}
            className="px-4 py-2 bg-sky-500 text-white rounded-lg text-sm hover:bg-sky-600 transition-colors font-medium"
          >
            Save
          </button>
          <button
            onClick={handleDelete}
            className="px-4 py-2 bg-red-500 text-white rounded-lg text-sm hover:bg-red-600 transition-colors font-medium"
          >
            Delete
          </button>
          <button
            onClick={requestClose}
            className="px-4 py-2 bg-slate-200 dark:bg-gray-600 text-slate-700 dark:text-gray-200 rounded-lg text-sm hover:bg-slate-300 dark:hover:bg-gray-500 transition-colors font-medium ml-auto"
          >
            Close
          </button>
        </div>

        {showDirtyDialog && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
              <h3 className="text-base font-semibold text-slate-900">未保存の変更があります</h3>
              <p className="mt-2 text-sm text-slate-600">保存して閉じますか？</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowDirtyDialog(false);
                    handleSave(false);
                  }}
                  className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700"
                >
                  保存して閉じる
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowDirtyDialog(false);
                    setIsDirty(false);
                    onCloseRef.current();
                  }}
                  className="rounded-lg bg-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-300"
                >
                  破棄
                </button>
                <button
                  type="button"
                  onClick={() => setShowDirtyDialog(false)}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  キャンセル
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
