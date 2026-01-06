"use client";

import { useState, useEffect, Suspense, useRef, useMemo, useCallback } from "react";
import Image from "next/image";
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCorners,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { v4 as uuidv4 } from "uuid";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  supabase,
  sanitizeCardsForUpload,
  isAssigneeColumnMissing,
  type Card,
  type List,
  type Board,
  type BoardData,
  type Priority,
  type DueBucket,
  type ProfileSummary,
  type CommentWithAuthor,
} from "@/lib/supabase";
import type { PostgrestError, RealtimeChannel } from "@supabase/supabase-js";
import { useAuth } from "@/app/contexts/AuthContext";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { addToSyncQueue, syncQueue, getSyncQueueStats } from "@/lib/syncQueue";
import { createUniqueShortId, getNextIdShort, slugify } from "@/lib/card-utils";
import { buildCardUrl } from "@/lib/card-url";
import { createUniqueBoardShortId, getNextBoardIdShort, slugifyBoardName } from "@/lib/board-utils";
import { buildBoardCanonicalUrl, buildBoardShortUrl, buildBoardUrl } from "@/lib/board-url";
import { CardModal } from "@/app/components/CardModal";
import { useBoardFilters, filterAndSortCards, getAllTags } from "@/app/(board)/_hooks/useBoardFilters";
import { useBoardMembers } from "@/app/(board)/_hooks/useBoardMembers";
import { useSyncQueue } from "@/app/(board)/_hooks/useSyncQueue";
import { useRealtimeBoard } from "@/app/(board)/_hooks/useRealtimeBoard";
import { MAIN_BOARD_ID } from "@/lib/board-defaults";
import { initializeCommentsStore, useCommentsStore } from "../_stores/comments-store";
import { useBoardMembersStore, type BoardMember } from "../_stores/board-members-store";
import { createClientTrace } from "@/lib/metrics/client";
import type { ClientTrace } from "@/lib/metrics/client";
import type { TraceSummary } from "@/lib/metrics/types";
import ShareDialog from "./ShareDialog";
import NotificationsBell from "./NotificationsBell";
import NotificationSettings from "./NotificationSettings";
import ProfileSettings from "./ProfileSettings";
import { resolveProfileIdentity, getProfileInitial } from "@/lib/usernames";
import { normalizeChecklist, EMPTY_CHECKLIST, flattenChecklistText, type Checklist } from "@/lib/checklist";
import { buildContentFromTitle } from "@/lib/tiptap";
import type { JSONContent } from "@tiptap/react";


type KanbanBoardClientProps = {
  initialBoard?: Board | null;
  initialData?: BoardData | null;
  initialCardId?: string | null;
};

type ProfileRow = {
  id: string;
  username: string | null;
  display_name: string | null;
  full_name: string | null;
  avatar_url: string | null;
  email: string | null;
};

type BoardLoadMetrics = {
  source: "supabase" | "storage" | "seeded-defaults" | "error";
  fetchDurationMs?: number;
  parseDurationMs?: number;
  payloadSizeBytes?: number;
  server?: TraceSummary;
  error?: string;
};

type BoardFetchResult = {
  data: BoardData;
  metrics: BoardLoadMetrics;
};

// LocalStorage helper - Supabase同期のキャッシュとして使用
const STORAGE_KEY = "kanban_board_data";

const getChecklistText = (card: Pick<Card, 'checklist'>) => flattenChecklistText(card.checklist ?? null);

const loadFromStorage = (): BoardData => {
  if (typeof window === "undefined") return { lists: [], cards: [] };
  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) {
    return { lists: [], cards: [] };
  }

  try {
    const parsed = JSON.parse(data) as Partial<BoardData> | undefined;
    const lists = Array.isArray(parsed?.lists) ? parsed!.lists : [];
    const cards = Array.isArray(parsed?.cards)
      ? (parsed!.cards as Partial<Card>[]).map((card) => ({
        ...card,
        checked: typeof card.checked === 'boolean' ? card.checked : false,
        due_start: card.due_start ?? null,
        due_end: card.due_end ?? null,
        due_bucket: (card.due_bucket ?? null) as DueBucket | null,
        due_bucket_position: typeof card.due_bucket_position === 'number' ? card.due_bucket_position : null,
        checklist: normalizeChecklist((card as any).checklist ?? EMPTY_CHECKLIST),
      })) as Card[]
      : [];

    return { lists, cards };
  } catch (error) {
    console.warn("Failed to parse cached board data:", error);
    return { lists: [], cards: [] };
  }
};

const getProfileDisplayName = (profile?: ProfileSummary | null): string | null => {
  if (!profile) return null;
  const identity = resolveProfileIdentity(profile, profile.email ?? null);
  return identity.label;
};

const getUserDisplayName = (profile: ProfileRow | null, fallbackEmail?: string): string => {
  if (!profile) {
    if (fallbackEmail?.trim()) {
      return fallbackEmail.split('@')[0];
    }
    return 'User';
  }

  const identity = resolveProfileIdentity(
    {
      id: profile.id,
      username: profile.username,
      display_name: profile.display_name,
      full_name: profile.full_name,
      avatar_url: profile.avatar_url,
      email: profile.email,
    },
    fallbackEmail ?? profile.email
  );

  if (identity.source === 'email' && identity.label.includes('@')) {
    const localPart = identity.label.split('@')[0];
    return localPart || identity.label;
  }

  return identity.label;
};

const saveToStorage = (() => {
  let pendingTimer: number | null = null;
  let latestPayload: BoardData | null = null;

  const scheduleFlush = () => {
    if (typeof window === "undefined") return;

    const flush = () => {
      if (typeof window === "undefined" || !latestPayload) {
        pendingTimer = null;
        return;
      }

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(latestPayload));
      } catch (error) {
        console.error("Failed to persist board cache:", error);
      } finally {
        pendingTimer = null;
      }
    };

    pendingTimer = window.setTimeout(flush, 120);
  };

  return (data: BoardData) => {
    if (typeof window === "undefined") return;
    latestPayload = data;

    if (pendingTimer !== null) {
      window.clearTimeout(pendingTimer);
      pendingTimer = null;
    }

    scheduleFlush();
  };
})();

const copyBoardUrl = async (url: string) => {
  if (!url) return;

  const showMessage = (message: string) => {
    if (typeof window !== "undefined") {
      window.alert(message);
    }
  };

  const copyWithFallback = (): boolean => {
    if (typeof document === "undefined") return false;

    const textarea = document.createElement("textarea");
    textarea.value = url;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";

    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);

    let successful = false;
    try {
      successful = document.execCommand("copy");
    } catch (error) {
      console.error("Legacy clipboard copy failed:", error);
      successful = false;
    } finally {
      document.body.removeChild(textarea);
    }

    return successful;
  };

  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      showMessage("URLをコピーしました");
      return;
    }
  } catch (error) {
    console.warn("Primary clipboard API failed, falling back:", error);
  }

  const fallbackSuccess = copyWithFallback();
  if (fallbackSuccess) {
    showMessage("URLをコピーしました");
    return;
  }

  showMessage("クリップボードにコピーできませんでした。手動でコピーしてください。");
  if (typeof window !== "undefined") {
    window.prompt("クリップボードにコピーできませんでした。手動でコピーしてください。", url);
  }
};

const buildBoardUrlForCopy = (board: Board | undefined, kind: "short" | "canonical"): string => {
  if (!board?.short_id) return "";

  const origin = typeof window !== "undefined" ? window.location.origin : undefined;

  if (kind === "short") {
    const path = buildBoardShortUrl(board);
    if (!path) return "";
    if (!origin) return path;
    return `${origin}${path}`;
  }

  return buildBoardCanonicalUrl(board, origin);
};

// Load board data from API route (replaces direct Supabase access)
const getHrTime = () => {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
};

const loadFromSupabase = async (boardId: string, trace?: ClientTrace, signal?: AbortSignal): Promise<BoardFetchResult> => {
  const fetchStartedAt = getHrTime();
  trace?.mark("fetch:start", { boardId });

  try {
    const response = await fetch(`/api/boards/${boardId}/data`, {
      headers: trace ? trace.buildHeaders("board-data") : undefined,
      cache: "no-store",
      signal,
    });

    // Check if request was aborted after fetch
    if (signal?.aborted) {
      const abortError = new DOMException('Request aborted', 'AbortError');
      throw abortError;
    }

    const fetchCompletedAt = getHrTime();
    trace?.mark("fetch:response", { status: response.status });

    const rawBody = await response.text();
    const parseStartedAt = getHrTime();
    const payloadSizeBytes =
      typeof TextEncoder !== "undefined" ? new TextEncoder().encode(rawBody).length : rawBody.length;

    let payload: unknown = {};

    if (rawBody.trim().length > 0) {
      try {
        payload = JSON.parse(rawBody);
      } catch (parseError) {
        console.error("Failed to parse board payload:", parseError);
        throw parseError;
      }
    }

    const parseCompletedAt = getHrTime();

    // Check if request was aborted after parsing
    if (signal?.aborted) {
      const abortError = new DOMException('Request aborted', 'AbortError');
      throw abortError;
    }

    const metrics: BoardLoadMetrics = {
      source: "supabase",
      fetchDurationMs: fetchCompletedAt - fetchStartedAt,
      parseDurationMs: parseCompletedAt - parseStartedAt,
      payloadSizeBytes,
    };

    if (!response.ok || typeof payload !== "object" || payload === null) {
      metrics.error = `Failed to load board data: ${response.statusText}`;
      throw new Error(metrics.error);
    }

    const { lists, cards, metrics: serverMetrics } = payload as BoardData & { metrics?: TraceSummary };
    if (serverMetrics) {
      metrics.server = serverMetrics;
    }

    const data: BoardData = {
      lists: Array.isArray(lists) ? lists : [],
      cards: Array.isArray(cards) ? cards : [],
    };

    trace?.mark("fetch:parsed", { count: data.lists.length + data.cards.length });

    return {
      data,
      metrics,
    };
  } catch (error) {
    // Ignore AbortError - it's expected when component unmounts or dependencies change
    const isAbort = (error instanceof DOMException && error.name === 'AbortError') ||
      (error instanceof Error && error.name === 'AbortError') ||
      (typeof error === 'string' && error.includes('Component unmounted'));

    if (isAbort) {
      throw error; // Re-throw to be handled by caller
    }

    console.error("Error loading from Supabase:", error);
    const fallback = loadFromStorage();

    const metrics: BoardLoadMetrics = {
      source: "storage",
      error: error instanceof Error ? error.message : String(error),
    };

    trace?.mark("fetch:fallback", { count: fallback.lists.length + fallback.cards.length });

    return {
      data: fallback,
      metrics,
    };
  }
};

const LIST_POSITION_START = 1000;
const LIST_POSITION_GAP = 10;

/**
 * Normalize list positions to maintain consistent gaps (1000, 1010, ...).
 * This prevents collisions when legacy sequential values remain in the database.
 */
const normalizePositions = (lists: List[]): List[] => {
  return lists.map((list, index) => ({
    ...list,
    position: LIST_POSITION_START + (index * LIST_POSITION_GAP),
    updated_at: new Date().toISOString(),
  }));
};

// Helper to get user_id that works with test mode
// In test mode (bypass auth with mock user), returns null to avoid foreign key constraint
const getActualUserId = (userId: string): string | null => {
  return userId === '00000000-0000-0000-0000-000000000000' ? null : userId;
};

// Activity logging is now handled server-side in API routes
// This function is kept for backward compatibility but does nothing
const logActivity = async (
  boardId: string,
  userId: string,
  action: 'created' | 'updated' | 'deleted' | 'moved',
  entityType: 'card' | 'list',
  entityId: string,
  entityTitle: string,
  details?: Record<string, unknown>
) => {
  // Server-side API routes automatically log activities
  // No client-side action needed
};

// Initialize with default lists if empty
const initializeDefaultLists = async (userId: string, boardId: string): Promise<List[]> => {
  const actualUserId = getActualUserId(userId);

  // Use normalized positions (1000, 1010, 1020...) to match drag & drop behavior
  const START_POSITION = 1000;
  const GAP = 10;

  const defaultLists = [
    { title: "To Do", position: START_POSITION, user_id: actualUserId },
    { title: "In Progress", position: START_POSITION + GAP, user_id: actualUserId },
    { title: "Done", position: START_POSITION + (GAP * 2), user_id: actualUserId },
  ];

  try {
    const response = await fetch(`/api/boards/${boardId}/lists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lists: defaultLists }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || 'Failed to create default lists');
    }

    const { lists } = await response.json();
    return lists || [];
  } catch (error) {
    console.error("Error initializing default lists:", error);
    return [];
  }
};

// Sortable Card Component
type CardVisualProps = React.HTMLAttributes<HTMLDivElement> & {
  card: Card;
  subtle?: boolean;
  withGrab?: boolean;
  assigneeProfile?: ProfileSummary | null;
  legacyAssignee?: string | null;
  onToggleChecked?: (cardId: string, nextChecked: boolean) => void;
  interactiveCheckbox?: boolean;
  onOpenCard?: (cardId: string) => void;
  onInlineTitleChange?: (cardId: string, nextTitle: string) => void;
  onAddCardBelow?: (cardId: string) => void;
  autoFocusInput?: boolean;
  onAutoFocusConsumed?: (cardId: string) => void;
};

function CardVisual({
  card,
  subtle = false,
  withGrab = false,
  className = '',
  assigneeProfile = null,
  legacyAssignee = null,
  onToggleChecked,
  interactiveCheckbox = true,
  onOpenCard,
  onInlineTitleChange,
  onAddCardBelow,
  autoFocusInput = false,
  onAutoFocusConsumed,
  ...rest
}: CardVisualProps) {
  const priorityIcon = card.priority && card.priority !== 'medium'
    ? card.priority === 'high'
      ? '🔴'
      : '🟢'
    : null;

  const assigneeIdentity = assigneeProfile
    ? resolveProfileIdentity(assigneeProfile, assigneeProfile.email ?? legacyAssignee ?? null)
    : null;

  const assigneeName = assigneeIdentity
    ? assigneeIdentity.label
    : legacyAssignee;

  const assigneeAlt = assigneeName ?? 'Assignee avatar';

  const assigneeInitials = assigneeProfile
    ? getProfileInitial(assigneeProfile, assigneeProfile.email ?? legacyAssignee ?? null)
    : legacyAssignee
      ? legacyAssignee.charAt(0).toUpperCase()
      : 'U';

  const [inlineTitle, setInlineTitle] = useState<string>(card.title ?? '');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isChecked = Boolean(card.checked);
  const checkboxEnabled = interactiveCheckbox && typeof onToggleChecked === 'function';
  const checklistText = getChecklistText(card);
  const showDescription = Boolean(checklistText);
  const showAssignee = Boolean(assigneeName);
  const showBadges = Boolean(card.tags && card.tags.length > 0) || Boolean(card.due_date);
  const hasLowerContent = showDescription || showAssignee || showBadges;

  const baseClasses = `rounded-none border border-slate-200/60 bg-white px-3 py-1 shadow-sm transition-shadow dark:border-gray-700/50 dark:bg-gray-800 ${withGrab ? 'cursor-grab active:cursor-grabbing hover:shadow-md' : ''}`;
  const subtleClasses = subtle ? ' ring-2 ring-sky-200/40 dark:ring-sky-600/40' : '';

  useEffect(() => {
    setInlineTitle(card.title ?? '');
  }, [card.title]);

  useEffect(() => {
    if (autoFocusInput && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
      onAutoFocusConsumed?.(card.id);
    }
  }, [autoFocusInput, card.id, onAutoFocusConsumed]);

  const commitInlineTitle = () => {
    if (!onInlineTitleChange) return false;
    const nextTitle = inlineTitle ?? '';
    if (nextTitle === card.title) {
      return false;
    }
    onInlineTitleChange(card.id, nextTitle);
    return true;
  };

  return (
    <div
      {...rest}
      className={`${baseClasses}${subtleClasses} ${className}`.trim()}
    >
      <div className={`${hasLowerContent ? 'mb-1' : 'mb-0'} flex items-center justify-between gap-2`}>
        <div className="flex flex-1 items-center gap-2 min-w-0">
          <input
            type="checkbox"
            className="h-4 w-4 flex-none rounded-none border border-slate-400 text-sky-600 accent-sky-500 focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:outline-none"
            checked={isChecked}
            disabled={!checkboxEnabled}
            aria-label={`「${card.title}」を完了にする`}
            onChange={(event) => {
              if (!checkboxEnabled) return;
              onToggleChecked?.(card.id, event.target.checked);
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onPointerUp={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          />
          <input
            ref={inputRef}
            type="text"
            value={inlineTitle}
            placeholder="Card title"
            data-testid={`card-title-input-${card.id}`}
            className="flex-1 rounded-none border-none bg-transparent text-sm font-semibold leading-4 text-slate-700 placeholder:text-slate-400 focus:outline-none"
            onChange={(event) => setInlineTitle(event.target.value)}
            onBlur={() => {
              commitInlineTitle();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                commitInlineTitle();
                onAddCardBelow?.(card.id);
              }
            }}
            onPointerDown={(event) => event.stopPropagation()}
          />
        </div>
        <div className="flex items-center gap-1">
          {priorityIcon ? <span className="text-xs">{priorityIcon}</span> : null}
          {onOpenCard ? (
            <button
              type="button"
              aria-label={`カード「${card.title}」を詳細表示`}
              className="flex h-6 w-6 items-center justify-center rounded-none border border-slate-200/80 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              data-testid={`cardOpenButton-${card.id}`}
              onClick={(event) => {
                event.stopPropagation();
                onOpenCard(card.id);
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              ↗
            </button>
          ) : null}
        </div>
      </div>

      {showDescription ? (
        <p className={`${showAssignee || showBadges ? 'mb-1' : 'mb-0'} line-clamp-2 text-xs leading-snug text-slate-500 dark:text-gray-400`}>
          {checklistText || 'No checklist'}
        </p>
      ) : null}

      {showAssignee ? (
        <div className={`${showBadges ? 'mb-1' : 'mb-0'} flex items-center gap-2 text-xs text-slate-500 dark:text-gray-400`}>
          {assigneeProfile?.avatar_url ? (
            <Image
              src={assigneeProfile.avatar_url}
              alt={assigneeAlt}
              width={24}
              height={24}
              className="h-6 w-6 flex-none rounded-full object-cover shadow-sm"
            />
          ) : (
            <span className="inline-flex h-6 w-6 flex-none items-center justify-center rounded-full bg-slate-200 text-slate-600 font-semibold dark:bg-gray-700 dark:text-gray-200">
              {assigneeInitials}
            </span>
          )}
          <span className="truncate">{assigneeName}</span>
        </div>
      ) : null}

      {showBadges ? (
        <div className="flex flex-wrap gap-1">
          {card.tags && card.tags.length > 0
            ? card.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-md bg-sky-100 px-2 py-0.5 text-xs text-sky-700 dark:bg-sky-900 dark:text-sky-300"
              >
                {tag}
              </span>
            ))
            : null}
          {card.due_date ? (
            <span className="rounded text-xs bg-orange-100 px-2 py-0.5 text-orange-700 dark:bg-orange-900 dark:text-orange-300">
              📅 {new Date(card.due_date).toLocaleDateString()}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SortableCard({
  card,
  onCardClick,
  onToggleCardCheck,
  onInlineTitleChange,
  onAddCardBelow,
  autoFocus,
  onAutoFocusConsumed,
  assigneeProfile = null,
  legacyAssignee = null,
}: {
  card: Card;
  onCardClick: (cardId: string) => void;
  onToggleCardCheck: (cardId: string, checked: boolean) => void;
  onInlineTitleChange: (cardId: string, nextTitle: string) => void;
  onAddCardBelow: (cardId: string) => void;
  autoFocus: boolean;
  onAutoFocusConsumed: (cardId: string) => void;
  assigneeProfile?: ProfileSummary | null;
  legacyAssignee?: string | null;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: {
      type: "card",
      card,
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      data-testid={`card-${card.id}`}
      className="mb-0 touch-none"
    >
      <CardVisual
        {...listeners}
        card={card}
        assigneeProfile={assigneeProfile}
        legacyAssignee={legacyAssignee}
        withGrab
        subtle={isDragging}
        onToggleChecked={onToggleCardCheck}
        onOpenCard={onCardClick}
        onInlineTitleChange={onInlineTitleChange}
        onAddCardBelow={onAddCardBelow}
        autoFocusInput={autoFocus}
        onAutoFocusConsumed={onAutoFocusConsumed}
      />
    </div>
  );
}


// Sortable List Component
function SortableList({
  list,
  cards,
  onAddCard,
  onEditList,
  onDeleteList,
  searchQuery,
  selectedTags,
  selectedPriority,
  sortBy,
  onCardClick,
  onToggleCardCheck,
  onInlineTitleChange,
  onQuickAddBelow,
  focusCardId,
  onFocusConsumed,
  isDropTarget,
  profilesById,
}: {
  list: List;
  cards: Card[];
  onAddCard: (listId: string) => void;
  onEditList: (id: string, title: string) => void;
  onDeleteList: (id: string) => void;
  searchQuery: string;
  selectedTags: string[];
  selectedPriority: Priority | 'all';
  sortBy: 'none' | 'due_date_asc' | 'due_date_desc';
  onCardClick: (cardId: string) => void;
  onToggleCardCheck: (cardId: string, checked: boolean) => void;
  onInlineTitleChange: (cardId: string, nextTitle: string) => void;
  onQuickAddBelow: (cardId: string) => void;
  focusCardId: string | null;
  onFocusConsumed: (cardId: string) => void;
  isDropTarget: boolean;
  profilesById: Record<string, ProfileSummary>;
}) {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [title, setTitle] = useState(list.title);
  const [showMenu, setShowMenu] = useState(false);

  useEffect(() => {
    const handleClickOutside = () => setShowMenu(false);
    if (showMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showMenu]);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: list.id,
    data: {
      type: "list",
      list,
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleSaveTitle = () => {
    onEditList(list.id, title);
    setIsEditingTitle(false);
  };

  // First sort by position, then apply filters and custom sorting
  const positionSorted = [...cards].sort((a, b) => a.position - b.position);
  const sortedCards = filterAndSortCards(positionSorted, searchQuery, selectedTags, selectedPriority, sortBy);

  const containerClasses = `backdrop-blur-sm rounded-none p-4 w-72 md:w-80 flex-shrink-0 touch-none self-start transition-shadow transition-colors duration-150 ${isDropTarget
    ? 'bg-white/90 dark:bg-gray-800/70 border border-sky-300/70 shadow-lg ring-2 ring-sky-200/60 dark:ring-sky-600/40'
    : 'bg-white/70 dark:bg-gray-800/60 border border-slate-200/50 dark:border-gray-700/50 shadow-md'
    }`;

  const dropZoneClasses = `mb-4 px-1 transition-colors duration-150 ${isDropTarget ? 'bg-slate-100/70 dark:bg-gray-700/40 rounded-none py-1' : ''
    }`;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={containerClasses}
      data-type="list"
      data-testid={`list-${list.id}`}
    >
      <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing mb-4">
        {isEditingTitle ? (
          <div className="flex gap-2">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleSaveTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveTitle();
                if (e.key === "Escape") {
                  setTitle(list.title);
                  setIsEditingTitle(false);
                }
              }}
              className="flex-1 px-3 py-2 border border-slate-200 rounded-none dark:bg-gray-700 dark:border-gray-600 font-semibold focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-transparent"
              autoFocus
              aria-label="List title"
              data-testid={`list-title-input-${list.id}`}
            />
          </div>
        ) : (
          <div className="flex justify-between items-center">
            <h2 className="font-bold text-lg text-slate-700 dark:text-gray-100">
              {list.title}
            </h2>
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMenu(!showMenu);
                }}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold transition-colors w-6 h-6 flex items-center justify-center rounded-none hover:bg-slate-100"
              >
                ⋯
              </button>
              {showMenu && (
                <div className="absolute right-0 mt-2 w-40 bg-white dark:bg-gray-800 rounded-none shadow-lg border border-slate-200 dark:border-gray-700 py-1 z-10">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowMenu(false);
                      setIsEditingTitle(true);
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-slate-700 dark:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-700"
                  >
                    Rename
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowMenu(false);
                      if (confirm(`Delete list "${list.title}"?`)) {
                        onDeleteList(list.id);
                      }
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20"
                    data-testid="delete-list-button"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className={dropZoneClasses} data-testid={`list-${list.id}-dropzone`}>
        <SortableContext items={sortedCards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {sortedCards.map((card) => (
            <SortableCard
              key={card.id}
              card={card}
              onCardClick={onCardClick}
              onToggleCardCheck={onToggleCardCheck}
              onInlineTitleChange={onInlineTitleChange}
              onAddCardBelow={onQuickAddBelow}
              autoFocus={focusCardId === card.id}
              onAutoFocusConsumed={onFocusConsumed}
              assigneeProfile={card.assignee_id ? profilesById[card.assignee_id] ?? null : null}
              legacyAssignee={!card.assignee_id ? card.assigned_to ?? null : null}
            />
          ))}
        </SortableContext>
      </div>

      <button
        onClick={() => onAddCard(list.id)}
        className="w-full py-2.5 bg-sky-400 text-white rounded-none hover:bg-sky-500 text-sm font-medium transition-colors shadow-sm hover:shadow-md"
      >
        + Add Card
      </button>
    </div>
  );
}

// Main Kanban Board Component
function KanbanBoard({ initialBoard, initialData, initialCardId }: KanbanBoardClientProps) {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const upsertComment = useCommentsStore((state) => state.upsertComment);
  const removeComment = useCommentsStore((state) => state.removeComment);
  const { setMembers: setStoredMembers } = useBoardMembersStore();
  const initialBoardId = initialBoard?.id ?? MAIN_BOARD_ID;
  const [boards, setBoards] = useState<Board[]>(() => (initialBoard ? [initialBoard] : []));
  const [currentBoardId, setCurrentBoardId] = useState<string>(initialBoardId);
  const [boardData, setBoardData] = useState<BoardData>(() => initialData ?? { lists: [], cards: [] });
  const { boardMembers, setBoardMembers } = useBoardMembers(currentBoardId);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dragOverListId, setDragOverListId] = useState<string | null>(null);
  const [isClient, setIsClient] = useState(false);
  const { isOnline, syncQueueStats } = useSyncQueue();
  const { realtimeStatus } = useRealtimeBoard(currentBoardId, { setBoardData, upsertComment, removeComment });
  const [showBoardMenu, setShowBoardMenu] = useState(false);
  const [pendingCardFocusId, setPendingCardFocusId] = useState<string | null>(null);

  // ドラッグ中のクリック抑止用（Trello準拠）
  const isDraggingRef = useRef(false);

  // Phase 1.3 execution guards - prevent duplicate fetches
  const isFetchingRef = useRef(false);
  const hasInitialDataRef = useRef(!!initialData);

  // モーダル状態管理（クライアントサイド・即時表示）
  const [selectedCardId, setSelectedCardId] = useState<string | null>(initialCardId ?? null);
  const [cardModalStatus, setCardModalStatus] = useState<'loading' | 'ready' | 'error'>(initialCardId ? 'ready' : 'loading');

  // Phase3: Share dialog state
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [showNotificationSettings, setShowNotificationSettings] = useState(false);
  const [showProfileSettings, setShowProfileSettings] = useState(false);

  // User profile state
  const [userProfile, setUserProfile] = useState<ProfileRow | null>(null);

  // Search & Filter state
  const {
    searchQuery,
    setSearchQuery,
    selectedTags,
    setSelectedTags,
    selectedPriority,
    setSelectedPriority,
    sortBy,
    setSortBy,
    showFilters,
    setShowFilters,
  } = useBoardFilters();
  const [showCreateBoardDialog, setShowCreateBoardDialog] = useState(false);
  const [newBoardName, setNewBoardName] = useState('');
  const [newBoardDescription, setNewBoardDescription] = useState('');


  useEffect(() => {
    if (initialData) {
      saveToStorage(initialData);
    }
  }, [initialData]);

  useEffect(() => {
    initializeCommentsStore();
  }, []);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  // Fetch user profile
  useEffect(() => {
    if (!user) {
      setUserProfile(null);
      return;
    }

    const fetchProfile = async () => {
      try {
        const response = await fetch('/api/profiles');
        if (response.ok) {
          const profile: ProfileRow = await response.json();
          setUserProfile(profile);
        } else {
          console.error('Failed to fetch user profile');
        }
      } catch (error) {
        console.error('Error fetching user profile:', error);
      }
    };

    fetchProfile();
  }, [user]);

  // URL からモーダル状態を復元（初回ロード時のみ）
  const hasRestoredModalFromUrl = useRef(false);
  const selectedCardIdRef = useRef<string | null>(selectedCardId);
  const lastBoardPathRef = useRef<string | null>(null);
  const modalReturnPathRef = useRef<string | null>(null);
  const supportsAssigneeIdRef = useRef<boolean | null>(null);
  const searchParams = useSearchParams();
  const suppressModalFromQueryRef = useRef(false);
  const cards = boardData.cards;
  const profilesById = useMemo(() => {
    return boardMembers
      .filter((profile): profile is ProfileSummary => profile != null)
      .reduce<Record<string, ProfileSummary>>((map, profile) => {
        map[profile.id] = profile;
        return map;
      }, {});
  }, [boardMembers]);

  useEffect(() => {
    if (!selectedCardId) return;
    const exists = boardData.cards.some((card) => card.id === selectedCardId);
    if (!exists) {
      setSelectedCardId(null);
      setCardModalStatus('loading');
    }
  }, [boardData.cards, selectedCardId]);

  useEffect(() => {
    selectedCardIdRef.current = selectedCardId;
  }, [selectedCardId]);

  useEffect(() => {
    if (!pathname) return;

    if (pathname.startsWith('/b/')) {
      lastBoardPathRef.current = pathname;
    }

    if (pathname.startsWith('/c/')) {
      return;
    }

    const cardParam = searchParams?.get('card');
    if (!cardParam && selectedCardIdRef.current) {
      suppressModalFromQueryRef.current = false;
      setSelectedCardId(null);
      setCardModalStatus('loading');
    }
  }, [pathname, searchParams]);

  useEffect(() => {
    const shortId = searchParams?.get('card');
    if (!shortId) {
      suppressModalFromQueryRef.current = false;
      return;
    }

    if (suppressModalFromQueryRef.current) {
      suppressModalFromQueryRef.current = false;
      return;
    }

    const cardByShortId = cards.find((card) => card.short_id === shortId);
    if (cardByShortId) {
      if (selectedCardIdRef.current !== cardByShortId.id) {
        setSelectedCardId(cardByShortId.id);
      }
      setCardModalStatus('ready');
    } else {
      setCardModalStatus('loading');
    }
  }, [searchParams, cards]);

  useEffect(() => {
    if (!isClient || !pathname || hasRestoredModalFromUrl.current) return;
    if (cards.length === 0) return; // カード読み込み待ち

    if (pathname.startsWith('/c/')) {
      const [, , shortId] = pathname.split('/');
      const card = cards.find((c) => c.short_id === shortId);

      if (card) {
        setSelectedCardId(card.id);
        setCardModalStatus('ready');
        hasRestoredModalFromUrl.current = true; // 1度だけ実行

        // Slug 正規化
        const cardShortId = card.short_id;
        if (!cardShortId) {
          return;
        }

        const correctUrl = buildCardUrl({
          shortId: cardShortId,
          slug: card.slug ?? undefined,
          idShort: card.id_short ?? undefined,
          title: card.title,
        });

        if (pathname !== correctUrl) {
          router.replace(correctUrl, { scroll: false });
        }
      }
    }
  }, [isClient, pathname, cards, router]);

  // Sync initialBoard.id to currentBoardId only on initial mount or when URL changes
  const initialBoardIdRef = useRef<string | null>(initialBoard?.id ?? null);
  useEffect(() => {
    const newBoardId = initialBoard?.id;
    // Only update currentBoardId if initialBoard.id actually changed (not just a re-render)
    if (newBoardId && newBoardId !== initialBoardIdRef.current) {
      initialBoardIdRef.current = newBoardId;
      if (newBoardId !== currentBoardId) {
        setCurrentBoardId(newBoardId);
      }
    }
  }, [initialBoard?.id, currentBoardId]);

  // Load boards list
  useEffect(() => {
    const loadBoards = async () => {
      if (!user) return;

      const { data, error } = await supabase
        .from('boards')
        .select('*')
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error loading boards:', error);
        return;
      }

      setBoards(data || []);
    };

    loadBoards();
  }, [user]);


  // Load board data when currentBoardId changes
  useEffect(() => {
    let isCancelled = false;
    const abortController = new AbortController();

    // Load data from Supabase or localStorage
    const loadData = async () => {
      // Phase 1.3 - Execution guards to prevent duplicate fetches
      if (!user || !currentBoardId) return;

      // Skip fetch if already fetching
      if (isFetchingRef.current) {
        console.log('[board-load] Already fetching, skipping duplicate request');
        return;
      }

      // Skip fetch on initial mount if we have initialData from Server Component AND it's for the current board
      if (hasInitialDataRef.current && initialBoard?.id === currentBoardId) {
        console.log('[board-load] Using initialData from Server Component, skipping fetch');
        hasInitialDataRef.current = false; // Only skip once
        setIsClient(true);
        return;
      }

      // Reset hasInitialDataRef when switching boards
      hasInitialDataRef.current = false;

      isFetchingRef.current = true;

      const trace = createClientTrace("board-load", { boardId: currentBoardId });
      trace.mark("load:start");

      try {
        const currentBoard = boards.find((board) => board.id === currentBoardId);
        const { data, metrics } = await loadFromSupabase(currentBoardId, trace, abortController.signal);
        if (isCancelled || abortController.signal.aborted) {
          trace.finish("cancelled", { reason: "cancelled-after-fetch", sourceComponent: 'KanbanBoardClient' });
          return;
        }

        const shouldSeedDefaults =
          data.lists.length === 0 && (!currentBoard || !currentBoard.is_test_board);

        if (shouldSeedDefaults) {
          trace.mark("defaults:init");
          const defaultLists = await initializeDefaultLists(user.id, currentBoardId);
          if (isCancelled) {
            trace.finish("cancelled", { reason: "cancelled-after-defaults", sourceComponent: 'KanbanBoardClient' });
            return;
          }

          if (defaultLists.length > 0) {
            const newData = { lists: defaultLists, cards: [] };
            setBoardData(newData);
            saveToStorage(newData);
            trace.mark("defaults:applied", { count: defaultLists.length });

            trace.finish("success", {
              ...metrics,
              source: "seeded-defaults",
              listCount: newData.lists.length,
              cardCount: newData.cards.length,
              sourceComponent: 'KanbanBoardClient',
            });
            return;
          }
        }

        setBoardData(data);
        saveToStorage(data);
        trace.mark("state:committed", { count: data.lists.length + data.cards.length });

        const traceStatus: "success" | "error" =
          metrics.source === "supabase" || metrics.source === "seeded-defaults" ? "success" : "error";

        trace.finish(traceStatus, {
          ...metrics,
          listCount: data.lists.length,
          cardCount: data.cards.length,
          sourceComponent: 'KanbanBoardClient',
        });
      } finally {
        // Ensure isFetchingRef is always reset, regardless of how loadData exits
        isFetchingRef.current = false;
      }
    };

    loadData().catch((error) => {
      // Ignore AbortError - it's expected when component unmounts or dependencies change
      const isAbort = (error instanceof DOMException && error.name === 'AbortError') ||
        (error instanceof Error && error.name === 'AbortError') ||
        (typeof error === 'string' && error.includes('Component unmounted'));

      if (isAbort) {
        return;
      }

      console.error('[board-load] Unexpected error:', error);
      // Note: isFetchingRef is reset in finally block, no need to reset here
    });

    setIsClient(true);

    return () => {
      isCancelled = true;
      abortController.abort('Component unmounted or dependencies changed');
      isFetchingRef.current = false;
    };
  }, [user, currentBoardId, boards, initialBoard?.id]);


  // Close board menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (showBoardMenu) {
        const target = e.target as HTMLElement;
        if (!target.closest('.board-menu-container')) {
          setShowBoardMenu(false);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showBoardMenu]);


  // PC/モバイル対応のセンサー設定（Trello準拠）
  const sensors = useSensors(
    // PC用：距離でドラッグ開始（クリックは即時反応）
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 6, // 6px移動後にドラッグ開始
      },
    }),
    // モバイル用：長押しでドラッグ（タップとの区別を明確化）
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 350, // 350ms長押しでドラッグ開始（タップは詳細を開く）
        tolerance: 8,
      },
    }),
    // キーボード操作対応
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const updateData = (newData: BoardData) => {
    setBoardData(newData);
    saveToStorage(newData);
  };

  const getBoardPath = (board?: Board | null, options: { canonical?: boolean } = {}): string => {
    if (!board?.short_id) return "";

    const canonicalPath = buildBoardUrl(board);
    const shortPath = buildBoardShortUrl(board);

    if (options.canonical === false) {
      return shortPath || canonicalPath || "";
    }

    return canonicalPath || shortPath || "";
  };

  const updateURL = (board?: Board | null, { replace = false }: { replace?: boolean } = {}) => {
    const targetBoard = board ?? currentBoard;
    const canonicalPath = targetBoard ? buildBoardUrl(targetBoard) : "";
    const shortPath = targetBoard?.short_id ? `/b/${targetBoard.short_id}` : "";
    const nextPath = canonicalPath || shortPath || "/";

    if (!nextPath) {
      return;
    }

    if (pathname === nextPath) {
      return;
    }

    const navigate = replace ? router.replace : router.push;
    navigate(nextPath, { scroll: false });
  };

  const upsertCardsWithAssigneeFallback = useCallback(async (cardsToSync: Card[]): Promise<Error | null> => {
    if (cardsToSync.length === 0 || !currentBoardId) {
      return null;
    }

    try {
      const updates = cardsToSync.map((card) => ({
        id: card.id,
        list_id: card.list_id,
        position: card.position,
        title: card.title,
        checklist: card.checklist ?? EMPTY_CHECKLIST,
        tags: card.tags,
        due_date: card.due_date,
        due_start: card.due_start,
        due_end: card.due_end,
        due_bucket: card.due_bucket,
        due_bucket_position: card.due_bucket_position,
        priority: card.priority,
        assignee_id: card.assignee_id,
        assigned_to: card.assigned_to ?? null,
        user_id: card.user_id ?? null,
        short_id: card.short_id ?? null,
        id_short: card.id_short ?? null,
        slug: card.slug ?? null,
        updated_at: card.updated_at,
        created_at: card.created_at,
      }));

      const response = await fetch(`/api/boards/${currentBoardId}/cards/reorder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to sync cards');
      }

      return null;
    } catch (error) {
      console.error('[cards] Failed to sync cards:', error);
      return error as Error;
    }
  }, [currentBoardId]);

  const updateCardDetailsOnServer = useCallback(async (card: Card): Promise<Error | null> => {
    if (!currentBoardId) {
      return new Error('No board selected');
    }

    try {
      const payload: Record<string, unknown> = {
        title: card.title,
        checklist: card.checklist ?? EMPTY_CHECKLIST,
        list_id: card.list_id,
        position: card.position,
        tags: card.tags,
        due_date: card.due_date,
        due_start: card.due_start,
        due_end: card.due_end,
        due_bucket: card.due_bucket,
        due_bucket_position: card.due_bucket_position,
        priority: card.priority,
        checked: card.checked,
        assignee_id: card.assignee_id,
        assigned_to: card.assigned_to ?? null,
        duration: card.duration ?? 60,
        slug: card.slug ?? undefined,
      };
      if (card.content !== undefined) {
        payload.content = card.content ?? [];
      }
      if (card.excerpt !== undefined) {
        payload.excerpt = card.excerpt ?? "";
      }

      const response = await fetch(`/api/boards/${currentBoardId}/cards/${card.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error?.message || 'Failed to update card');
      }

      return null;
    } catch (error) {
      console.error('[cards] Failed to update card:', error);
      return error as Error;
    }
  }, [currentBoardId]);

  const syncListPositions = useCallback(async (lists: List[]) => {
    if (!currentBoardId || lists.length === 0) {
      return;
    }

    const listUpdates = lists.map((list) => ({
      id: list.id,
      position: list.position,
    }));

    const listResponse = await fetch(`/api/boards/${currentBoardId}/lists/reorder`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates: listUpdates }),
    });

    if (!listResponse.ok) {
      const errorData = await listResponse.json().catch(() => null);
      const error = new Error(errorData?.error?.message || 'Failed to sync lists') as Error & { issues?: any[] };
      if (errorData?.issues) {
        error.issues = errorData.issues;
      }
      throw error;
    }
  }, [currentBoardId]);

  const syncToSupabase = async (data: BoardData) => {
    // If offline, don't sync - operations are already in queue
    if (!isOnline || !currentBoardId) {
      console.log('Offline or no board: skipping sync (operations queued)');
      return;
    }

    try {
      if (data.lists.length > 0) {
        await syncListPositions(data.lists);
      }

      // Sync cards via API route
      const cardError = await upsertCardsWithAssigneeFallback(data.cards);
      if (cardError) {
        throw cardError;
      }
    } catch (error) {
      console.error("Error syncing to Supabase:", error);
    }
  };

  const handleAddList = async () => {
    if (!user || !currentBoardId) return;

    // Use normalized position (1000, 1010, 1020...) to match drag & drop behavior
    const START_POSITION = 1000;
    const GAP = 10;
    const position = START_POSITION + (boardData.lists.length * GAP);
    const title = "New List";

    const previousData: BoardData = {
      lists: [...boardData.lists],
      cards: [...boardData.cards],
    };

    // Optimistic UI update
    const tempList: List = {
      id: uuidv4(),
      title,
      position,
      board_id: currentBoardId,
      user_id: getActualUserId(user.id),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const optimisticData: BoardData = {
      lists: [...previousData.lists, tempList],
      cards: previousData.cards,
    };
    updateData(optimisticData);

    // Add to sync queue if offline, otherwise create via API
    if (!isOnline) {
      addToSyncQueue({ type: 'INSERT', table: 'lists', data: tempList });
    } else {
      try {
        const response = await fetch(`/api/boards/${currentBoardId}/lists`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: tempList.id,
            title,
            position,
            user_id: tempList.user_id,
            created_at: tempList.created_at,
            updated_at: tempList.updated_at,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error?.message || 'Failed to create list');
        }

        const { lists: createdLists } = await response.json();
        const createdList = createdLists?.[0];

        if (createdList) {
          const updatedLists = optimisticData.lists.map((list) =>
            list.id === tempList.id ? { ...list, ...createdList } : list
          );

          updateData({
            lists: updatedLists,
            cards: optimisticData.cards,
          });
        }
      } catch (error) {
        console.error("Error creating list:", error);
        updateData(previousData);
      }
    }
  };

  const handleAddCard = async (listId: string) => {
    if (!user || !currentBoardId) return;

    // Generate short_id, id_short, and slug
    const shortId = await createUniqueShortId();
    const idShort = await getNextIdShort(currentBoardId);
    const title = "New Card";
    const slug = slugify(title);

    const position = boardData.cards.filter((c) => c.list_id === listId).length;

    // Optimistic UI update
    const tempCard: Card = {
      id: uuidv4(),
      title,
      checklist: EMPTY_CHECKLIST,
      content: buildContentFromTitle(title),
      list_id: listId,
      board_id: currentBoardId,
      position,
      user_id: getActualUserId(user.id),
      tags: [],
      due_date: null,
      due_start: null,
      due_end: null,
      due_bucket: null,
      due_bucket_position: null,
      duration: 60,
      priority: 'medium',
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: idShort,
      slug,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const previousData: BoardData = {
      lists: [...boardData.lists],
      cards: [...boardData.cards],
    };

    const optimisticData: BoardData = {
      lists: previousData.lists,
      cards: [...previousData.cards, tempCard],
    };
    updateData(optimisticData);

    // Add to sync queue if offline, otherwise create via API
    if (!isOnline) {
      addToSyncQueue({ type: 'INSERT', table: 'cards', data: tempCard });
    } else {
      try {
        const response = await fetch(`/api/boards/${currentBoardId}/cards`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: tempCard.id,
            title,
            checklist: tempCard.checklist ?? EMPTY_CHECKLIST,
            list_id: listId,
            position,
            tags: tempCard.tags,
            due_date: tempCard.due_date,
            due_start: tempCard.due_start,
            due_end: tempCard.due_end,
            due_bucket: tempCard.due_bucket,
            due_bucket_position: tempCard.due_bucket_position,
            priority: tempCard.priority,
            checked: tempCard.checked,
            assignee_id: tempCard.assignee_id,
            assigned_to: tempCard.assigned_to,
            user_id: tempCard.user_id,
            short_id: tempCard.short_id,
            id_short: tempCard.id_short,
            slug: tempCard.slug,
            created_at: tempCard.created_at,
            updated_at: tempCard.updated_at,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error?.message || 'Failed to create card');
        }

        const { card: createdCard } = await response.json();

        if (createdCard) {
          const updatedCards = optimisticData.cards.map((card) =>
            card.id === tempCard.id ? { ...card, ...createdCard } : card
          );

          updateData({
            lists: optimisticData.lists,
            cards: updatedCards,
          });
        }
      } catch (error) {
        console.error("Error creating card:", error);
        updateData(previousData);
      }
    }
  };

  const handleEditList = async (id: string, title: string) => {
    const updatedLists = boardData.lists.map((list) =>
      list.id === id ? { ...list, title, updated_at: new Date().toISOString() } : list
    );
    const newData = { ...boardData, lists: updatedLists };
    updateData(newData);

    // Add to sync queue if offline, otherwise sync directly
    const updatedList = updatedLists.find((l) => l.id === id);
    if (updatedList) {
      if (!isOnline) {
        addToSyncQueue({ type: 'UPDATE', table: 'lists', data: updatedList });
      } else {
        await syncToSupabase(newData);
      }
    }
  };

  const handleDeleteList = async (id: string) => {
    if (!currentBoardId) return;

    const updatedLists = boardData.lists.filter((list) => list.id !== id);
    const updatedCards = boardData.cards.filter((card) => card.list_id !== id);
    const newData = { lists: updatedLists, cards: updatedCards };
    updateData(newData);

    // Add to sync queue if offline, otherwise delete via API
    if (!isOnline) {
      addToSyncQueue({ type: 'DELETE', table: 'lists', data: { id } });
    } else {
      try {
        const response = await fetch(`/api/boards/${currentBoardId}/lists/${id}`, {
          method: 'DELETE',
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error?.message || 'Failed to delete list');
        }
      } catch (error) {
        console.error("Error deleting list:", error);
      }
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
    isDraggingRef.current = true;
    const activeData = event.active.data.current;
    if (activeData?.type === "card") {
      const activeCard = activeData.card as Card;
      setDragOverListId(activeCard.list_id);
    } else {
      setDragOverListId(null);
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) {
      setDragOverListId(null);
      return;
    }

    const activeData = active.data.current;
    const overData = over.data.current;

    // カードをリスト間で移動（一時的な表示更新のみ）
    let targetListId: string | null = null;

    if (activeData?.type === "card") {
      const activeCard = activeData.card as Card;

      // カードの上にドロップした場合
      if (overData?.type === "card") {
        const overCard = overData.card as Card;
        if (activeCard.list_id !== overCard.list_id) {
          const updatedCards = boardData.cards.map((card) => {
            if (card.id === activeCard.id) {
              return { ...card, list_id: overCard.list_id, updated_at: new Date().toISOString() };
            }
            return card;
          });
          setBoardData({ ...boardData, cards: updatedCards });
        }
        targetListId = overCard.list_id;
      }
      // リストの上に直接ドロップした場合
      else if (overData?.type === "list") {
        const overList = overData.list as List;
        if (activeCard.list_id !== overList.id) {
          const updatedCards = boardData.cards.map((card) => {
            if (card.id === activeCard.id) {
              return { ...card, list_id: overList.id, updated_at: new Date().toISOString() };
            }
            return card;
          });
          setBoardData({ ...boardData, cards: updatedCards });
        }
        targetListId = overList.id;
      }
    }

    setDragOverListId(targetListId);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    setDragOverListId(null);
    // ドラッグ終了後、次ティックでクリック抑止を解除（イベント順の競合回避）
    setTimeout(() => {
      isDraggingRef.current = false;
    }, 0);

    if (!over) return;

    const activeData = active.data.current;
    const overData = over.data.current;

    // リストの並び替え
    if (activeData?.type === "list" && overData?.type === "list") {
      const oldIndex = boardData.lists.findIndex((list) => list.id === active.id);
      const newIndex = boardData.lists.findIndex((list) => list.id === over.id);

      if (oldIndex !== newIndex) {
        // Save snapshot for rollback on failure
        const previousData: BoardData = {
          lists: [...boardData.lists],
          cards: [...boardData.cards],
        };

        // Normalize positions to maintain gaps (1000, 1010, 1020...)
        const reorderedLists = arrayMove(boardData.lists, oldIndex, newIndex);
        const newLists = normalizePositions(reorderedLists);
        const newData = { ...boardData, lists: newLists };
        updateData(newData);

        // Add to sync queue if offline, otherwise sync directly
        if (!isOnline) {
          // Queue all affected lists for update
          // Note: Offline queue processes in FIFO order, ensuring list updates
          // are synced before any subsequent card updates in the same session
          newLists.forEach(list => {
            addToSyncQueue({ type: 'UPDATE', table: 'lists', data: list });
          });
        } else {
          try {
            await syncToSupabase(newData);
          } catch (error) {
            console.error("Error syncing list reorder:", error);
            // Restore previous state
            updateData(previousData);

            // Display error to user with issues if available
            let errorMessage = error instanceof Error ? error.message : 'Failed to reorder lists';
            const errorWithIssues = error as Error & { issues?: any[] };

            if (errorWithIssues.issues && errorWithIssues.issues.length > 0) {
              const issuesText = errorWithIssues.issues
                .map((issue: any) => `• ${issue.code}: ${issue.message || JSON.stringify(issue)}`)
                .join('\n');
              errorMessage = `${errorMessage}\n\n詳細:\n${issuesText}`;
            }

            if (typeof window !== 'undefined') {
              window.alert(`リストの並び替えに失敗しました:\n${errorMessage}`);
            }
          }
        }
      }
      return;
    }

    // カードの並び替えまたはリスト間移動
    if (activeData?.type === "card") {
      const activeCard = activeData.card as Card;

      // カードを他のカードの上にドロップ
      if (overData?.type === "card") {
        const overCard = overData.card as Card;
        const listCards = boardData.cards.filter((c) => c.list_id === overCard.list_id);
        const oldIndex = listCards.findIndex((c) => c.id === active.id);
        const newIndex = listCards.findIndex((c) => c.id === over.id);

        const newListCards = arrayMove(listCards, oldIndex, newIndex).map((card, index) => ({
          ...card,
          position: index,
          list_id: overCard.list_id,
          updated_at: new Date().toISOString(),
        }));

        const otherCards = boardData.cards.filter((c) => c.list_id !== overCard.list_id);
        const newData = { ...boardData, cards: [...otherCards, ...newListCards] };
        updateData(newData);

        // Add to sync queue if offline, otherwise sync directly
        if (!isOnline) {
          // Queue all affected cards for update
          newListCards.forEach(card => {
            addToSyncQueue({ type: 'UPDATE', table: 'cards', data: card });
          });
        } else {
          await syncToSupabase(newData);
        }
      }
      // カードを空のリストにドロップ
      else if (overData?.type === "list") {
        const overList = overData.list as List;
        if (activeCard.list_id !== overList.id) {
          const updatedCards = boardData.cards.map((card) => {
            if (card.id === activeCard.id) {
              return {
                ...card,
                list_id: overList.id,
                position: boardData.cards.filter((c) => c.list_id === overList.id).length,
                updated_at: new Date().toISOString()
              };
            }
            return card;
          });
          const newData = { ...boardData, cards: updatedCards };
          updateData(newData);

          // Add to sync queue if offline, otherwise sync directly
          if (!isOnline) {
            const movedCard = updatedCards.find(c => c.id === activeCard.id);
            if (movedCard) {
              addToSyncQueue({ type: 'UPDATE', table: 'cards', data: movedCard });
            }
          } else {
            await syncToSupabase(newData);
          }
        }
      }
    }
  };

  const handleCreateBoard = async () => {
    if (!user || !newBoardName.trim()) return;

    try {
      const response = await fetch('/api/boards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newBoardName.trim(),
          description: newBoardDescription.trim() || undefined,
          is_test_board: false,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to create board');
      }

      const { board } = await response.json();

      setBoards([...boards, board]);
      setCurrentBoardId(board.id);
      updateURL(board);
      setShowCreateBoardDialog(false);
      setNewBoardName('');
      setNewBoardDescription('');
    } catch (error) {
      console.error('Error creating board:', error);
    }
  };

  // モーダルハンドラー（クライアントサイド・即時表示）
  const handleOpenCardModal = (cardId: string) => {
    const card = boardData.cards.find((c) => c.id === cardId);
    if (!card) return;

    if (pathname?.startsWith('/b/')) {
      lastBoardPathRef.current = pathname;
      modalReturnPathRef.current = pathname;
    } else if (lastBoardPathRef.current) {
      modalReturnPathRef.current = lastBoardPathRef.current;
    }

    setSelectedCardId(cardId);
    setCardModalStatus('ready');

    if (!isOnline) {
      console.warn('[card-route] Skipping card URL update while offline');
      return;
    }

    if (!card.short_id || typeof window === "undefined") {
      return;
    }

    const currentUrl = new URL(window.location.href);
    const basePath =
      modalReturnPathRef.current ||
      getBoardPath(currentBoard) ||
      getBoardPath(currentBoard, { canonical: false }) ||
      currentUrl.pathname;

    currentUrl.pathname = basePath || currentUrl.pathname;
    currentUrl.searchParams.set('card', card.short_id);

    const target = currentUrl.search
      ? `${currentUrl.pathname}${currentUrl.search}`
      : currentUrl.pathname;

    router.push(target, { scroll: false });
  };

  const handleCloseCardModal = () => {
    console.log('[handleCloseCardModal] Starting...');
    suppressModalFromQueryRef.current = true;
    setSelectedCardId(null);
    setCardModalStatus('loading');

    const fallbackPath =
      modalReturnPathRef.current ||
      lastBoardPathRef.current ||
      getBoardPath(currentBoard) ||
      getBoardPath(currentBoard, { canonical: false }) ||
      '/';

    modalReturnPathRef.current = null;

    if (pathname && pathname.startsWith('/c/')) {
      router.replace(fallbackPath, { scroll: false });
      return;
    }

    if (typeof window !== "undefined") {
      const currentUrl = new URL(window.location.href);
      currentUrl.pathname = fallbackPath;
      currentUrl.searchParams.delete('card');

      const target = currentUrl.search
        ? `${currentUrl.pathname}${currentUrl.search}`
        : currentUrl.pathname;

      router.replace(target, { scroll: false });
      return;
    }

    router.replace(fallbackPath, { scroll: false });
  };

  const handleSaveCard = async (payload: {
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
  }) => {
    console.log('[handleSaveCard] Starting...', { id: payload.id, title: payload.title, assigneeIds: payload.assigneeIds });

    try {
      const slug = slugify(payload.title);
      const updatedCards = boardData.cards.map((card) => {
        if (card.id === payload.id) {
          // Handle assignee_ids (array) and maintain backward compatibility with assignee_id (single)
          const nextAssigneeIds = payload.assigneeIds && payload.assigneeIds.length > 0 ? payload.assigneeIds : [];
          const nextAssigneeId = nextAssigneeIds.length > 0 ? nextAssigneeIds[0] : null;

          const nextBucket: DueBucket | null = payload.due_bucket ?? card.due_bucket ?? null;
          const nextBucketPosition: number | null = payload.due_bucket_position ?? card.due_bucket_position ?? null;
          const nextStart = payload.due_start ?? card.due_start ?? null;
          const nextEnd = payload.due_end ?? card.due_end ?? null;

          return {
            ...card,
            title: payload.title,
            content: payload.content,
            excerpt: payload.excerpt ?? "",
            tags: payload.tags || [],
            due_date: payload.due_date || null,
            due_start: nextStart,
            due_end: nextEnd,
            due_bucket: nextBucket,
            due_bucket_position: nextBucketPosition,
            priority: payload.priority || 'medium',
            assignee_id: nextAssigneeId, // Keep for backward compatibility
            assignee_ids: nextAssigneeIds.length > 0 ? nextAssigneeIds : null,
            assigned_to: null, // Clear legacy field
            duration: payload.duration ?? card.duration ?? 60,
            slug,
            updated_at: new Date().toISOString(),
          };
        }
        return card;
      });

      console.log('[handleSaveCard] Updated cards:', updatedCards.length);
      const newData = { ...boardData, cards: updatedCards };
      updateData(newData);
      console.log('[handleSaveCard] State updated');

      // Supabase に保存（変更されたカードのみ）
      const updatedCard = updatedCards.find((c) => c.id === payload.id);
      if (updatedCard) {
        if (!isOnline) {
          console.log('[handleSaveCard] Adding to sync queue (offline)');
          addToSyncQueue({ type: 'UPDATE', table: 'cards', data: updatedCard });
        } else {
          console.log('[handleSaveCard] Syncing card to Supabase...');
          const error = await updateCardDetailsOnServer(updatedCard);
          if (error) {
            console.error('[handleSaveCard] Error syncing card:', error);
          } else {
            console.log('[handleSaveCard] Card synced to Supabase');
          }
        }
      }
    } finally {
      console.log('[handleSaveCard] Closing modal...');
      handleCloseCardModal();
    }
  };

  const handleToggleCardChecked = async (id: string, nextChecked: boolean) => {
    const existing = boardData.cards.find((card) => card.id === id);
    if (!existing) return;

    const previousChecked = Boolean(existing.checked);
    if (previousChecked === nextChecked) {
      return;
    }

    const updatedCards = boardData.cards.map((card) =>
      card.id === id
        ? { ...card, checked: nextChecked, updated_at: new Date().toISOString() }
        : card
    );
    const newData = { ...boardData, cards: updatedCards };
    updateData(newData);

    const updatedCard = updatedCards.find((card) => card.id === id);
    if (!updatedCard) return;

    if (!isOnline) {
      addToSyncQueue({ type: 'UPDATE', table: 'cards', data: updatedCard });
      return;
    }

    const error = await updateCardDetailsOnServer(updatedCard);
    if (error) {
      console.error('[handleToggleCardChecked] Failed to sync checkbox state:', error);
    }
  };

  const handleInlineTitleChange = useCallback(async (cardId: string, nextTitle: string) => {
    const timestamp = new Date().toISOString();
    let updatedCard: Card | null = null;
    const newCards = boardData.cards.map((card) => {
      if (card.id !== cardId) return card;
      updatedCard = {
        ...card,
        title: nextTitle,
        slug: slugify(nextTitle || card.slug || card.short_id || 'card'),
        updated_at: timestamp,
      };
      return updatedCard;
    });

    if (!updatedCard) {
      return;
    }

    updateData({ ...boardData, cards: newCards });

    if (!isOnline) {
      addToSyncQueue({ type: 'UPDATE', table: 'cards', data: updatedCard });
      return;
    }

    await updateCardDetailsOnServer(updatedCard);
  }, [boardData, isOnline, updateCardDetailsOnServer]);

  const handleQuickAddCardBelow = useCallback(async (cardId: string) => {
    if (!user || !currentBoardId) {
      return;
    }

    const sourceCard = boardData.cards.find((card) => card.id === cardId);
    if (!sourceCard) {
      return;
    }

    const timestamp = new Date().toISOString();
    const cardsToShift = boardData.cards
      .filter((card) => card.list_id === sourceCard.list_id && card.position > sourceCard.position)
      .map((card) => ({
        ...card,
        position: card.position + 10,
        updated_at: timestamp,
      }));
    const shiftedMap = new Map(cardsToShift.map((card) => [card.id, card] as const));
    const newPosition = sourceCard.position + 10;

    const shortId = await createUniqueShortId();
    const idShort = await getNextIdShort(currentBoardId);
    const slug = slugify('New Card');
    const tempCard: Card = {
      id: uuidv4(),
      title: '',
      checklist: EMPTY_CHECKLIST,
      content: buildContentFromTitle(''),
      list_id: sourceCard.list_id,
      board_id: currentBoardId,
      position: newPosition,
      user_id: getActualUserId(user.id),
      tags: [],
      due_date: null,
      due_start: null,
      due_end: null,
      due_bucket: null,
      due_bucket_position: null,
      duration: 60,
      priority: 'medium',
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: idShort,
      slug,
      created_at: new Date().toISOString(),
      updated_at: timestamp,
    };

    const previousData: BoardData = {
      lists: [...boardData.lists],
      cards: [...boardData.cards],
    };

    const optimisticData: BoardData = {
      lists: previousData.lists,
      cards: previousData.cards.map((card) => shiftedMap.get(card.id) ?? card).concat(tempCard),
    };

    updateData(optimisticData);
    setPendingCardFocusId(tempCard.id);

    if (!isOnline) {
      cardsToShift.forEach((card) => addToSyncQueue({ type: 'UPDATE', table: 'cards', data: card }));
      addToSyncQueue({ type: 'INSERT', table: 'cards', data: tempCard });
      return;
    }

    try {
      const response = await fetch(`/api/boards/${currentBoardId}/cards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: tempCard.id,
          title: tempCard.title,
          checklist: tempCard.checklist ?? EMPTY_CHECKLIST,
          list_id: tempCard.list_id,
          position: tempCard.position,
          tags: tempCard.tags,
          due_date: tempCard.due_date,
          due_start: tempCard.due_start,
          due_end: tempCard.due_end,
          due_bucket: tempCard.due_bucket,
          due_bucket_position: tempCard.due_bucket_position,
          priority: tempCard.priority,
          checked: tempCard.checked,
          assignee_id: tempCard.assignee_id,
          assigned_to: tempCard.assigned_to,
          user_id: tempCard.user_id,
          short_id: tempCard.short_id,
          id_short: tempCard.id_short,
          slug: tempCard.slug,
          created_at: tempCard.created_at,
          updated_at: tempCard.updated_at,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to create card');
      }

      const { card: createdCard } = await response.json();
      if (createdCard) {
        const mergedCards = optimisticData.cards.map((card) =>
          card.id === tempCard.id ? { ...card, ...createdCard } : card
        );
        updateData({ lists: optimisticData.lists, cards: mergedCards });
      }

      if (cardsToShift.length > 0) {
        await upsertCardsWithAssigneeFallback(cardsToShift);
      }
    } catch (error) {
      console.error('Error creating card:', error);
      updateData(previousData);
    }
  }, [boardData, currentBoardId, isOnline, upsertCardsWithAssigneeFallback, user]);

  const handleConsumeCardFocus = useCallback((cardId: string) => {
    setPendingCardFocusId((current) => (current === cardId ? null : current));
  }, []);

  const handleDeleteCard = async (id: string) => {
    console.log('[handleDeleteCard] Starting...', { id });

    try {
      const updatedCards = boardData.cards.filter((card) => card.id !== id);
      const newData = { ...boardData, cards: updatedCards };
      updateData(newData);

      // Delete via API route
      if (!isOnline) {
        console.log('[handleDeleteCard] Adding to sync queue (offline)');
        addToSyncQueue({ type: 'DELETE', table: 'cards', data: { id } });
      } else {
        console.log('[handleDeleteCard] Deleting via API...');
        if (!currentBoardId) {
          throw new Error('No board selected');
        }

        const response = await fetch(`/api/boards/${currentBoardId}/cards/${id}`, {
          method: 'DELETE',
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error?.message || 'Failed to delete card');
        }
        console.log('[handleDeleteCard] Card deleted via API');
      }

      console.log('[handleDeleteCard] Closing modal...');
      handleCloseCardModal();
    } catch (error) {
      console.error('[handleDeleteCard] Failed to delete card:', error);
      // エラーが発生してもモーダルは閉じる
      handleCloseCardModal();
    }
  };

  const handleMoveCardToBoard = async (cardId: string, targetBoardId: string) => {
    // 対象ボードの最初のリストを取得
    const targetLists = boardData.lists.filter((list) => list.board_id === targetBoardId);
    if (targetLists.length === 0) return;

    const targetListId = targetLists[0].id;
    const updatedCards = boardData.cards.map((card) => {
      if (card.id === cardId) {
        return {
          ...card,
          board_id: targetBoardId,
          list_id: targetListId,
          updated_at: new Date().toISOString(),
        };
      }
      return card;
    });

    const newData = { ...boardData, cards: updatedCards };
    updateData(newData);

    // Supabase に保存
    const movedCard = updatedCards.find((c) => c.id === cardId);
    if (movedCard) {
      if (!isOnline) {
        addToSyncQueue({ type: 'UPDATE', table: 'cards', data: movedCard });
      } else {
        await syncToSupabase(newData);
      }
    }

    handleCloseCardModal();
  };

  const currentBoard = boards.find(b => b.id === currentBoardId);
  const sortedLists = [...boardData.lists].sort((a, b) => a.position - b.position);
  const selectedCard = selectedCardId ? boardData.cards.find((c) => c.id === selectedCardId) : null;
  const activeCardOverlay = activeId ? boardData.cards.find((c) => c.id === activeId) ?? null : null;
  const activeListOverlay = !activeCardOverlay && activeId ? boardData.lists.find((l) => l.id === activeId) ?? null : null;
  const activeCardAssigneeProfile = activeCardOverlay?.assignee_id
    ? profilesById[activeCardOverlay.assignee_id] ?? null
    : null;
  const activeCardLegacyAssignee = activeCardOverlay && !activeCardOverlay.assignee_id
    ? activeCardOverlay.assigned_to ?? null
    : null;

  if (!isClient || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-slate-50/30 to-blue-50/50 p-4 md:p-8">
      <div className="max-w-full">
        <div className="flex justify-between items-center mb-6 md:mb-8">
          <div className="flex items-center gap-3">
            {/* Board selector dropdown */}
            <div className="relative board-menu-container">
              <button
                onClick={() => setShowBoardMenu(!showBoardMenu)}
                className="flex items-center gap-2 text-2xl md:text-3xl font-bold text-slate-700 tracking-tight hover:text-slate-900 transition-colors"
              >
                {currentBoard?.name || 'Taesk Board'}
                <span className="text-lg">▼</span>
              </button>

              {showBoardMenu && (
                <div className="absolute top-full left-0 mt-2 w-64 bg-white rounded-lg shadow-lg border border-slate-200 py-2 z-50">
                  {boards.map((board) => (
                    <button
                      key={board.id}
                      onClick={() => {
                        if (board.id === currentBoardId) {
                          setShowBoardMenu(false);
                          return;
                        }
                        setCurrentBoardId(board.id);
                        updateURL(board);
                        setShowBoardMenu(false);
                        // Refresh to update Server Component props
                        router.refresh();
                      }}
                      className={`w-full text-left px-4 py-2 hover:bg-slate-100 transition-colors ${board.id === currentBoardId ? 'bg-slate-50 font-semibold' : ''
                        }`}
                    >
                      <div className="font-medium text-slate-800">{board.name}</div>
                      {board.description && (
                        <div className="text-xs text-slate-500 mt-0.5">{board.description}</div>
                      )}
                    </button>
                  ))}
                  {currentBoard && (
                    <>
                      <div className="border-t border-slate-200 my-2" />
                      <button
                        onClick={() => {
                          const url = buildBoardUrlForCopy(currentBoard, "short");
                          copyBoardUrl(url);
                          setShowBoardMenu(false);
                        }}
                        className="w-full text-left px-4 py-2 hover:bg-slate-100 transition-colors text-slate-700"
                      >
                        短縮URLをコピー
                      </button>
                      <button
                        onClick={() => {
                          const url = buildBoardUrlForCopy(currentBoard, "canonical");
                          copyBoardUrl(url);
                          setShowBoardMenu(false);
                        }}
                        className="w-full text-left px-4 py-2 hover:bg-slate-100 transition-colors text-slate-700"
                      >
                        正規URLをコピー
                      </button>
                    </>
                  )}
                  <div className="border-t border-slate-200 my-2" />
                  <button
                    onClick={() => {
                      setShowBoardMenu(false);
                      setShowCreateBoardDialog(true);
                    }}
                    className="w-full text-left px-4 py-2 text-blue-600 hover:bg-blue-50 transition-colors font-medium"
                  >
                    + New Board
                  </button>
                </div>
              )}
            </div>
            {/* Sync status indicator */}
            <div className="flex items-center gap-3 text-xs">
              {!isOnline && (
                <span data-testid="sync-status" className="flex items-center gap-1 text-orange-600 font-medium">
                  <div className="w-2 h-2 rounded-full bg-orange-600" />
                  Offline
                </span>
              )}
              {isOnline && realtimeStatus === 'connected' && (
                <span data-testid="sync-status" className="flex items-center gap-1 text-green-600 font-medium">
                  <div className="w-2 h-2 rounded-full bg-green-600 animate-pulse" />
                  Live
                </span>
              )}
              {isOnline && realtimeStatus === 'connecting' && (
                <span data-testid="sync-status" className="flex items-center gap-1 text-yellow-600 font-medium">
                  <div className="w-2 h-2 rounded-full bg-yellow-600 animate-pulse" />
                  Connecting...
                </span>
              )}
              {isOnline && realtimeStatus === 'disconnected' && (
                <span data-testid="sync-status" className="flex items-center gap-1 text-gray-500 font-medium">
                  <div className="w-2 h-2 rounded-full bg-gray-500" />
                  Disconnected
                </span>
              )}

              {/* Sync queue stats */}
              {syncQueueStats.pending > 0 && (
                <span className="flex items-center gap-1 text-yellow-600 font-medium bg-yellow-50 px-2 py-1 rounded">
                  ⏳ {syncQueueStats.pending} queued
                </span>
              )}
              {syncQueueStats.failed > 0 && (
                <span className="flex items-center gap-1 text-red-600 font-medium bg-red-50 px-2 py-1 rounded">
                  ⚠️ {syncQueueStats.failed} failed
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <NotificationsBell />
            <button
              onClick={() => setShowNotificationSettings(true)}
              className="p-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              title="Notification settings"
              aria-label="Notification settings"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            <button
              onClick={() => setShowShareDialog(true)}
              className="px-3 py-2 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors flex items-center gap-2"
              title="Share board"
              aria-label="Share board"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
              Share
            </button>
            <button
              onClick={() => setShowProfileSettings(true)}
              className="flex items-center gap-2 px-3 py-2 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
              title="Profile settings"
              data-testid="profile-button"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <span className="text-gray-900 dark:text-gray-100" data-testid="user-display-name">
                {getUserDisplayName(userProfile, user.email)}
              </span>
            </button>
            <button
              onClick={async () => {
                await signOut()
                router.push('/login')
              }}
              className="px-4 py-2 text-sm bg-gray-200 hover:bg-gray-300 rounded-lg transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>

        {/* Search & Filter Bar */}
        <div className="mb-6 bg-white/60 dark:bg-gray-800/40 backdrop-blur-sm rounded-xl border border-slate-200/50 dark:border-gray-700/50 shadow-sm overflow-hidden">
          {/* Toggle button */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-100/50 dark:hover:bg-gray-700/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-700 dark:text-gray-200">
                🔍 Search & Filters
              </span>
              {(searchQuery || selectedTags.length > 0 || selectedPriority !== 'all' || sortBy !== 'none') && (
                <span className="px-2 py-0.5 bg-sky-500 text-white text-xs rounded-full">
                  Active
                </span>
              )}
            </div>
            <span className={`text-slate-500 dark:text-gray-400 transition-transform ${showFilters ? 'rotate-180' : ''}`}>
              ▼
            </span>
          </button>

          {/* Collapsible content */}
          {showFilters && (
            <div className="p-4 pt-0 border-t border-slate-200/50 dark:border-gray-700/50">
              <div className="flex flex-col md:flex-row gap-3 pt-3">
                {/* Search input */}
                <div className="flex-1">
                  <input
                    type="text"
                    placeholder="🔍 Search cards..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full px-4 py-2 border border-slate-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-transparent"
                  />
                </div>

                {/* Tag filter */}
                <div className="flex-1 flex items-start gap-2">
                  <label className="text-xs font-medium text-slate-600 dark:text-gray-400 whitespace-nowrap pt-1">
                    Tags:
                  </label>
                  <div className="flex-1 flex flex-wrap gap-2">
                    {getAllTags(boardData.cards).length > 0 ? (
                      getAllTags(boardData.cards).map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => {
                            if (selectedTags.includes(tag)) {
                              setSelectedTags(selectedTags.filter(t => t !== tag));
                            } else {
                              setSelectedTags([...selectedTags, tag]);
                            }
                          }}
                          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${selectedTags.includes(tag)
                            ? 'bg-sky-500 text-white hover:bg-sky-600'
                            : 'bg-slate-200 dark:bg-gray-600 text-slate-700 dark:text-gray-200 hover:bg-slate-300 dark:hover:bg-gray-500'
                            }`}
                        >
                          {tag}
                        </button>
                      ))
                    ) : (
                      <span className="text-xs text-slate-400 dark:text-gray-500 py-1">No tags available</span>
                    )}
                  </div>
                </div>

                {/* Priority filter */}
                <div>
                  <select
                    value={selectedPriority}
                    onChange={(e) => setSelectedPriority(e.target.value as Priority | 'all')}
                    className="w-full px-4 py-2 border border-slate-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-transparent"
                  >
                    <option value="all">All Priorities</option>
                    <option value="low">🟢 Low</option>
                    <option value="medium">🟡 Medium</option>
                    <option value="high">🔴 High</option>
                  </select>
                </div>

                {/* Sort by due date */}
                <div>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as 'none' | 'due_date_asc' | 'due_date_desc')}
                    className="w-full px-4 py-2 border border-slate-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-transparent"
                  >
                    <option value="none">No Sort</option>
                    <option value="due_date_asc">📅 Due: Earliest</option>
                    <option value="due_date_desc">📅 Due: Latest</option>
                  </select>
                </div>

                {/* Clear filters button */}
                {(searchQuery || selectedTags.length > 0 || selectedPriority !== 'all' || sortBy !== 'none') && (
                  <button
                    onClick={() => {
                      setSearchQuery('');
                      setSelectedTags([]);
                      setSelectedPriority('all');
                      setSortBy('none');
                    }}
                    className="px-4 py-2 bg-slate-200 dark:bg-gray-600 text-slate-700 dark:text-gray-200 rounded-lg text-sm hover:bg-slate-300 dark:hover:bg-gray-500 transition-colors whitespace-nowrap"
                  >
                    Clear Filters
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={() => {
            setActiveId(null);
            setDragOverListId(null);
            // ドラッグキャンセル時も次ティックで解除
            setTimeout(() => {
              isDraggingRef.current = false;
            }, 0);
          }}
        >
          <div className="flex gap-0 overflow-x-auto pb-4 -mx-4 px-4 md:mx-0 md:px-0 min-h-[calc(100vh-12rem)]">
            <SortableContext items={sortedLists.map((l) => l.id)} strategy={horizontalListSortingStrategy}>
              {sortedLists.map((list) => (
                <SortableList
                  key={list.id}
                  list={list}
                  cards={boardData.cards.filter((card) => card.list_id === list.id)}
                  onAddCard={handleAddCard}
                  onEditList={handleEditList}
                  onDeleteList={handleDeleteList}
                  searchQuery={searchQuery}
                  selectedTags={selectedTags}
                  selectedPriority={selectedPriority}
                  sortBy={sortBy}
                  onCardClick={handleOpenCardModal}
                  onToggleCardCheck={handleToggleCardChecked}
                  onInlineTitleChange={handleInlineTitleChange}
                  onQuickAddBelow={handleQuickAddCardBelow}
                  focusCardId={pendingCardFocusId}
                  onFocusConsumed={handleConsumeCardFocus}
                  isDropTarget={dragOverListId === list.id}
                  profilesById={profilesById}
                />
              ))}
            </SortableContext>

            <button
              onClick={handleAddList}
              className="bg-white/40 dark:bg-gray-800/40 backdrop-blur-sm rounded-none p-6 w-72 md:w-80 flex-shrink-0 h-fit hover:bg-white/60 dark:hover:bg-gray-800/60 border-2 border-dashed border-slate-300/60 dark:border-gray-600/50 transition-all hover:border-sky-300 dark:hover:border-sky-400 shadow-sm"
            >
              <span className="text-slate-600 dark:text-gray-400 font-medium">+ Add List</span>
            </button>
            {/* 横スクロール用の余白 */}
            <div className="w-4 flex-shrink-0"></div>
          </div>

          <DragOverlay>
            {activeCardOverlay ? (
              <CardVisual
                card={activeCardOverlay}
                assigneeProfile={activeCardAssigneeProfile}
                legacyAssignee={activeCardLegacyAssignee}
                withGrab={false}
                className="shadow-2xl scale-105 border-sky-300/80 ring-2 ring-sky-200/50 dark:ring-sky-600/40"
              />
            ) : activeListOverlay ? (
              <div className="w-72 md:w-80 rounded-none bg-white dark:bg-gray-800 border border-slate-200/70 dark:border-gray-700/70 shadow-2xl p-4">
                <h2 className="font-bold text-lg text-slate-700 dark:text-gray-100 mb-2">{activeListOverlay.title}</h2>
                <p className="text-xs text-slate-500 dark:text-gray-400">Dragging list...</p>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      {/* Create Board Dialog */}
      {showCreateBoardDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
            <h2 className="text-2xl font-bold text-slate-800 mb-4">Create New Board</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Board Name *
                </label>
                <input
                  type="text"
                  value={newBoardName}
                  onChange={(e) => setNewBoardName(e.target.value)}
                  placeholder="e.g., Project Alpha"
                  className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Description (optional)
                </label>
                <textarea
                  value={newBoardDescription}
                  onChange={(e) => setNewBoardDescription(e.target.value)}
                  placeholder="Brief description of this board"
                  rows={3}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowCreateBoardDialog(false);
                  setNewBoardName('');
                  setNewBoardDescription('');
                }}
                className="flex-1 px-4 py-2 border border-slate-300 rounded-md text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateBoard}
                disabled={!newBoardName.trim()}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Card Modal (クライアントサイド・即時表示) */}
      {selectedCard && (
        <CardModal
          card={selectedCard}
          boards={boards}
          profiles={boardMembers}
          onSave={handleSaveCard}
          onDelete={handleDeleteCard}
          onMoveToBoard={handleMoveCardToBoard}
          onClose={handleCloseCardModal}
        />
      )}

      {/* Phase3: Share Dialog */}
      {showShareDialog && (
        <ShareDialog
          boardId={currentBoardId}
          onClose={() => setShowShareDialog(false)}
          onMemberAdded={async () => {
            // Reload board members after adding a new member
            try {
              const response = await fetch(`/api/boards/${currentBoardId}/members`);
              if (response.ok) {
                const { members } = await response.json();
                const boardMembers: BoardMember[] = members.map((m: any) => ({
                  profile: m.profile,
                  role: m.role
                }));
                const profiles: ProfileSummary[] = boardMembers.map(m => m.profile);
                setBoardMembers(profiles);
                setStoredMembers(currentBoardId, boardMembers); // Update store
              }
            } catch (error) {
              console.error('Error reloading board members:', error);
            }
          }}
        />
      )}

      {/* Notification Settings Modal */}
      {showNotificationSettings && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => setShowNotificationSettings(false)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold">Notification Settings</h2>
                <button
                  onClick={() => setShowNotificationSettings(false)}
                  className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                  aria-label="Close"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <NotificationSettings />
            </div>
          </div>
        </div>
      )}

      {/* Profile Settings Modal */}
      {showProfileSettings && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => setShowProfileSettings(false)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold">Profile Settings</h2>
                <button
                  onClick={() => setShowProfileSettings(false)}
                  className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                  aria-label="Close"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <ProfileSettings
                onProfileUpdated={async () => {
                  // Reload user profile after update
                  try {
                    const response = await fetch('/api/profiles');
                    if (response.ok) {
                      const profile: ProfileRow = await response.json();
                      setUserProfile(profile);
                    }
                  } catch (error) {
                    console.error('Error reloading user profile:', error);
                  }
                }}
              />
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
export default function KanbanBoardClient(props: KanbanBoardClientProps) {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen">Loading...</div>}>
      <KanbanBoard {...props} />
    </Suspense>
  );
}
