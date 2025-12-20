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
    normalizeBlockNoteDocument(card.content ?? [])
  );
  const [tags, setTags] = useState<string[]>(card.tags || []);
  const [tagInput, setTagInput] = useState('');
  const [dueDate, setDueDate] = useState(card.due_date || '');
  const [dueStart, setDueStart] = useState(card.due_start ? card.due_start.slice(0, 5) : '');
  const [dueEnd, setDueEnd] = useState(card.due_end ? card.due_end.slice(0, 5) : '');
  const [dueBucket, setDueBucket] = useState<DueBucket | null>(card.due_bucket ?? null);
  const [dueBucketPosition, setDueBucketPosition] = useState<number | null>(card.due_bucket_position ?? null);
  const [priority, setPriority] = useState<Priority>(card.priority || 'medium');
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
  const [assigneeTouched, setAssigneeTouched] = useState(false);
  const [targetBoardId, setTargetBoardId] = useState(card.board_id);
  const [isDirty, setIsDirty] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [showDirtyDialog, setShowDirtyDialog] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const cardIdRef = useRef(card.id);
  const onCloseRef = useRef(onClose);
  const requestCloseRef = useRef<() => void>(() => {});
  const memberButtonRef = useRef<HTMLButtonElement | null>(null);
  const memberDropdownRef = useRef<HTMLDivElement | null>(null);

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

  const requestClose = useCallback(() => {
    if (isDirty) {
      setShowDirtyDialog(true);
      return;
    }
    onCloseRef.current();
  }, [isDirty]);

  useEffect(() => {
    requestCloseRef.current = requestClose;
  }, [requestClose]);

  // card prop が変わったときの処理（ただし編集中は無視）
  useEffect(() => {
    // card.id が変わった場合（別のカードを開いた）、または編集していない場合のみ更新
    if (card.id !== cardIdRef.current) {
      cardIdRef.current = card.id;
      setContent(normalizeBlockNoteDocument(card.content ?? []));
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
      setIsDirty(false);
      setEditorError(null);
      setShowDirtyDialog(false);
    } else if (!isDirty) {
      // 同じカードで編集していない場合のみ、外部の変更を反映
      setContent(normalizeBlockNoteDocument(card.content ?? []));
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
    };
  }, []); // 空配列でマウント時のみ実行

  // Close member dropdown when clicking outside
  useClickOutside(memberDropdownRef, () => setShowMemberDropdown(false));

  const handleSave = () => {
    const normalizedDueDate = dueDate || null;
    const hasTime = dueStart && dueEnd; // Both must be present
    const normalizedStart = hasTime ? `${dueStart}:00` : null;
    const normalizedEnd = hasTime ? `${dueEnd}:00` : null;

    // Always send bucket fields (timelineはnull、A/Bはa|bを保持)
    const normalizedBucket: DueBucket | null = dueBucket ?? null;
    const normalizedBucketPosition: number | null =
      normalizedBucket != null ? dueBucketPosition ?? Date.now() : null;

    const normalizedContent = ensureTitleBlock(normalizeBlockNoteDocument(content));
    const nextTitle = deriveTitleFromDocument(normalizedContent);
    if (!nextTitle) {
      setEditorError("タイトルを入力してください");
      return;
    }
    const nextExcerpt = deriveExcerptFromDocument(normalizedContent);

    setEditorError(null);
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
    });

    if (targetBoardId !== card.board_id) {
      onMoveToBoard(card.id, targetBoardId);
    }
  };

  const handleAddMember = (profileId: string) => {
    if (!assigneeIds.includes(profileId)) {
      setAssigneeIds([...assigneeIds, profileId]);
      setAssigneeTouched(true);
      setIsDirty(true);
    }
    setShowMemberDropdown(false);
    setMemberSearch('');
  };

  const handleRemoveMember = (profileId: string) => {
    setAssigneeIds(assigneeIds.filter(id => id !== profileId));
    setAssigneeTouched(true);
    setIsDirty(true);
  };

  const handleAddTag = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && tagInput.trim()) {
      e.preventDefault();
      if (!tags.includes(tagInput.trim())) {
        setTags([...tags, tagInput.trim()]);
        setIsDirty(true);
      }
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter(t => t !== tagToRemove));
    setIsDirty(true);
  };

  const handleTimeToggle = (enabled: boolean) => {
    setIsDirty(true);
    if (!enabled) {
      setDueStart('');
      setDueEnd('');
      // Keep bucket - don't clear it
      if (dueDate && !dueBucket) {
        setDueBucket(DEFAULT_BUCKET);
        setDueBucketPosition(Date.now());
      }
    }
    // Don't clear bucket when time is added - keep it for fallback
  };

  const handleBucketChange = (next: DueBucket) => {
    setDueBucket(next);
    setDueBucketPosition(Date.now());
    setIsDirty(true);
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
        <div className="flex flex-1 overflow-hidden">
          {/* Left Column - Details */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {/* Block Editor */}
            <div>
              <label className="text-sm font-medium text-slate-600 dark:text-gray-400 mb-2 block">
                Title & Notes
              </label>
              <CardBlockEditor
                key={card.id}
                initialContent={content}
                onChange={(next) => {
                  setContent(next);
                  setIsDirty(true);
                  if (editorError) {
                    setEditorError(null);
                  }
                }}
              />
              {editorError && (
                <p className="mt-2 text-xs text-red-600">{editorError}</p>
              )}
            </div>

            {/* Tags */}
            <div>
              <label className="text-sm font-medium text-slate-600 dark:text-gray-400 mb-1 block">
                Tags
              </label>
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleAddTag}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg dark:bg-gray-700 dark:border-gray-600 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-transparent"
                placeholder="Press Enter to add tag"
              />
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-sky-100 dark:bg-sky-900 text-sky-700 dark:text-sky-300 rounded-md text-xs"
                    >
                      {tag}
                      <button
                        onClick={() => handleRemoveTag(tag)}
                        className="text-sky-600 dark:text-sky-400 hover:text-sky-800 dark:hover:text-sky-200"
                        aria-label={`Remove tag ${tag}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Schedule */}
            <div>
              <label className="text-sm font-medium text-slate-600 dark:text-gray-400 mb-1 block">
                Schedule
              </label>
              <div className="space-y-3">
                {/* Date */}
                <div>
                  <label className="text-xs font-medium text-slate-500 dark:text-gray-400 mb-1 block">
                    Date
                  </label>
                  <input
                    type="date"
                    value={dueDate ? new Date(dueDate).toISOString().split('T')[0] : ''}
                    onChange={(e) => {
                      setDueDate(e.target.value ? new Date(e.target.value).toISOString() : '');
                      setIsDirty(true);
                    }}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg dark:bg-gray-700 dark:border-gray-600 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-transparent"
                  />
                </div>

                {dueDate && (
                  <>
                    {/* Time (optional) */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs font-medium text-slate-500 dark:text-gray-400 mb-1 block">
                          Start Time
                        </label>
                        <input
                          type="time"
                          step={900}
                          value={dueStart}
                          onChange={(e) => {
                            setDueStart(e.target.value);
                            handleTimeToggle(!!e.target.value);
                            setIsDirty(true);
                          }}
                          className="w-full px-3 py-2 border border-slate-200 rounded-lg dark:bg-gray-700 dark:border-gray-600 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-slate-500 dark:text-gray-400 mb-1 block">
                          End Time
                        </label>
                        <input
                          type="time"
                          step={900}
                          value={dueEnd}
                          onChange={(e) => {
                            setDueEnd(e.target.value);
                            setIsDirty(true);
                          }}
                          className="w-full px-3 py-2 border border-slate-200 rounded-lg dark:bg-gray-700 dark:border-gray-600 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-transparent"
                        />
                      </div>
                    </div>

                    {/* Bucket */}
                    <div>
                      <label className="text-xs font-medium text-slate-500 dark:text-gray-400 mb-1 block">
                        Priority Bucket {dueStart && dueEnd && '(Timeline takes priority)'}
                      </label>
                      <select
                        value={(dueBucket ?? DEFAULT_BUCKET) as DueBucket}
                        onChange={(e) => handleBucketChange(e.target.value as DueBucket)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg dark:bg-gray-700 dark:border-gray-600 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-transparent"
                      >
                        {BUCKET_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      {dueStart && dueEnd && (
                        <p className="text-xs text-slate-400 mt-1">
                          Time is set, so this card appears in Timeline. Bucket is kept for when time is removed.
                        </p>
                      )}
                    </div>
                  </>
                )}

                {!dueDate && (
                  <p className="text-xs text-slate-500">
                    No schedule set. This card will only appear in the Kanban list.
                  </p>
                )}
                {dueDate && dueStart && dueEnd && (
                  <p className="text-xs text-slate-500">
                    📅 This card will appear in the Timeline view.
                  </p>
                )}
                {dueDate && !dueStart && !dueEnd && (
                  <p className="text-xs text-slate-500">
                    📋 This card will appear in the A/B List.
                  </p>
                )}

                {/* Google Calendar Sync Toggle */}
                {dueDate && dueStart && dueEnd && (
                  <div className="space-y-2">
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
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={handleSyncNow}
                        disabled={!canSyncNow || syncNowLoading}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {syncNowLoading ? "同期中..." : "今すぐ同期"}
                      </button>
                      {showResyncSection && (
                        <button
                          type="button"
                          onClick={handleResyncRequest}
                          disabled={!canSearchResync || resyncLoading}
                          className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {resyncLoading ? "候補取得中..." : "再シンク候補を探す"}
                        </button>
                      )}
                    </div>
                    {syncToast && (
                      <p className="text-xs text-emerald-700">{syncToast}</p>
                    )}
                    {resyncError && (
                      <p className="text-xs text-red-600">{resyncError}</p>
                    )}
                    {showResyncSection && resyncCandidates.length > 0 && (
                      <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                        <p className="font-semibold text-slate-600">再接続候補</p>
                        {resyncCandidates.slice(0, 5).map((candidate) => (
                          <div key={candidate.id} className="flex items-start gap-2 rounded-md bg-white/60 p-2 ring-1 ring-slate-100">
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium">{candidate.title || "無題の予定"}</p>
                              <p className="text-[11px] text-slate-500">{formatCandidateTime(candidate)}</p>
                              {candidate.calendarId && (
                                <p className="text-[11px] text-slate-400">Cal: {candidate.calendarId}</p>
                              )}
                            </div>
                            <div className="flex flex-col items-end gap-1">
                              {typeof candidate.score === "number" && (
                                <span className="text-[11px] text-slate-400">score {candidate.score.toFixed(2)}</span>
                              )}
                              <button
                                type="button"
                                className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                                onClick={() => handleResyncSelect(candidate.id)}
                                disabled={resyncLoading}
                              >
                                再接続
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {showResyncSection && resyncFetched && resyncCandidates.length === 0 && (
                      <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600">
                        候補は見つかりませんでした。新規イベントとして同期できます。
                        <div className="mt-2 flex justify-end">
                          <button
                            type="button"
                            className="rounded bg-sky-600 px-3 py-1 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
                            onClick={() => handleResyncSelect()}
                            disabled={resyncLoading}
                          >
                            Googleに新規作成
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {dueDate && (!dueStart || !dueEnd) && (
                  <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-200">
                    Google Calendar 連携は開始・終了時刻があるタイムラインカードのみ有効です。時間を設定するとトグルが有効になります。
                  </div>
                )}
              </div>
            </div>

            {/* Priority */}
            <div>
              <label className="text-sm font-medium text-slate-600 dark:text-gray-400 mb-1 block">
                Priority
              </label>
              <select
                value={priority}
                onChange={(e) => {
                  setPriority(e.target.value as Priority);
                  setIsDirty(true);
                }}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg dark:bg-gray-700 dark:border-gray-600 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-transparent"
              >
                <option value="low">🟢 Low</option>
                <option value="medium">🟡 Medium</option>
                <option value="high">🔴 High</option>
              </select>
            </div>

            {/* Members */}
            <div className="relative">
              {/* Debug Log */}
              {/* {console.log('[CardModal] Rendering members', { profilesCount: profiles.length, assigneeIds, showMemberDropdown, dropdownPos })} */}
              <label className="text-sm font-medium text-slate-600 dark:text-gray-400 mb-2 block">
                Members
              </label>
              <div className="flex flex-wrap gap-2 items-center">
                {/* Selected Members */}
                {selectedAssignees.map((member) => {
                  const identity = resolveProfileIdentity(member, member.email ?? null);
                  return (
                    <div
                      key={member.id}
                      className="group relative inline-flex items-center gap-1 bg-slate-100 dark:bg-gray-700 rounded-full pr-1 hover:bg-slate-200 dark:hover:bg-gray-600 transition-colors"
                      title={identity.label}
                    >
                      {member.avatar_url ? (
                        <Image
                          src={member.avatar_url}
                          alt={identity.label}
                          width={32}
                          height={32}
                          className="h-8 w-8 rounded-full object-cover"
                        />
                      ) : (
                        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-300 text-slate-700 font-semibold text-xs dark:bg-gray-600 dark:text-gray-200">
                          {getProfileInitials(member)}
                        </span>
                      )}
                      <span className="text-xs font-medium px-2 max-w-[120px] truncate">
                        {identity.label}
                      </span>
                      <button
                        onClick={() => handleRemoveMember(member.id)}
                        className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 transition-opacity"
                        aria-label={`Remove ${identity.label}`}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  );
                })}

                {/* Add Member Button */}
                {/* Add Member Button */}
                <button
                  ref={(el) => {
                    // @ts-ignore
                    memberButtonRef.current = el;
                  }}
                  onClick={() => {
                    console.log('[CardModal] Add member clicked', { showMemberDropdown, button: memberButtonRef.current });
                    if (showMemberDropdown) {
                      setShowMemberDropdown(false);
                    } else {
                      // Calculate position
                      const button = memberButtonRef.current;
                      if (button) {
                        const rect = button.getBoundingClientRect();
                        console.log('[CardModal] Button rect', rect);
                        setDropdownPos({
                          top: rect.bottom + 8,
                          left: rect.left,
                        });
                        setShowMemberDropdown(true);
                      } else {
                        console.error('[CardModal] Member button ref is missing');
                      }
                    }
                  }}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 hover:bg-slate-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-slate-600 dark:text-gray-300 transition-colors"
                  aria-label="Add member"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </button>
              </div>

              {/* Member Dropdown - Fixed Position */}
              {showMemberDropdown && (
                <div
                  ref={memberDropdownRef}
                  className="fixed z-[60] w-64 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-slate-200 dark:border-gray-700"
                  style={{
                    top: dropdownPos.top,
                    left: dropdownPos.left,
                  }}
                >
                  <div className="p-2">
                    <input
                      type="text"
                      value={memberSearch}
                      onChange={(e) => setMemberSearch(e.target.value)}
                      placeholder="Search members..."
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg dark:bg-gray-700 dark:border-gray-600 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                      autoFocus
                    />
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    {filteredProfiles.length > 0 ? (
                      filteredProfiles.map((profile) => {
                        const identity = resolveProfileIdentity(profile, profile.email ?? null);
                        const secondary = identity.secondary && identity.secondary !== identity.label
                          ? identity.secondary
                          : (profile.email && profile.email !== identity.label ? profile.email : null);

                        return (
                          <button
                            key={profile.id}
                            onClick={() => handleAddMember(profile.id)}
                            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-100 dark:hover:bg-gray-700 text-left transition-colors"
                          >
                            {profile.avatar_url ? (
                              <Image
                                src={profile.avatar_url}
                                alt={identity.label}
                                width={32}
                                height={32}
                                className="h-8 w-8 rounded-full object-cover"
                              />
                            ) : (
                              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-300 text-slate-700 font-semibold text-xs dark:bg-gray-600 dark:text-gray-200">
                                {getProfileInitials(profile)}
                              </span>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">{identity.label}</div>
                              {secondary && (
                                <div className="text-xs text-slate-500 dark:text-gray-400 truncate">{secondary}</div>
                              )}
                            </div>
                          </button>
                        );
                      })
                    ) : (
                      <div className="px-3 py-4 text-center text-sm text-slate-500 dark:text-gray-400">
                        {memberSearch ? 'No members found' : 'All members assigned'}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Move to Board */}
            {boards.length > 1 && (
              <div>
                <label className="text-sm font-medium text-slate-600 dark:text-gray-400 mb-1 block">
                  Move to Board
                </label>
                <select
                  value={targetBoardId}
                  onChange={(e) => {
                    setTargetBoardId(e.target.value);
                    setIsDirty(true);
                  }}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg dark:bg-gray-700 dark:border-gray-600 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-transparent"
                >
                  {boards.map((board) => (
                    <option key={board.id} value={board.id}>
                      {board.name} {board.id === card.board_id ? '(current)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Copy Links */}
            {card.short_id && (
              <div>
                <label className="text-sm font-medium text-slate-600 dark:text-gray-400 mb-1 block">
                  Share Link
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const shortUrl = `${window.location.origin}/c/${card.short_id}`;
                      navigator.clipboard.writeText(shortUrl);
                    }}
                    className="flex-1 px-3 py-1.5 bg-slate-100 dark:bg-gray-700 text-slate-700 dark:text-gray-200 rounded-lg text-xs hover:bg-slate-200 dark:hover:bg-gray-600 transition-colors"
                  >
                    📋 Copy Short Link
                  </button>
                  {card.id_short && card.slug && (
                    <button
                      type="button"
                      onClick={() => {
                        const readableUrl = `${window.location.origin}/c/${card.short_id}/${card.id_short}-${card.slug}`;
                        navigator.clipboard.writeText(readableUrl);
                      }}
                      className="flex-1 px-3 py-1.5 bg-slate-100 dark:bg-gray-700 text-slate-700 dark:text-gray-200 rounded-lg text-xs hover:bg-slate-200 dark:hover:bg-gray-600 transition-colors"
                    >
                      📋 Copy Full Link
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Right Column - Comments */}
          <div className="w-96 border-l border-slate-200 dark:border-gray-700 overflow-y-auto p-6">
            <h3 className="text-lg font-semibold mb-4 text-slate-800 dark:text-gray-100">
              Comments
            </h3>
            <CommentsPanel
              cardId={card.id}
              boardId={card.board_id}
              initialProfiles={profiles}
            />
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex gap-2 p-6 pt-4 border-t border-slate-200 dark:border-gray-700">
          <button
            onClick={handleSave}
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
                    handleSave();
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
