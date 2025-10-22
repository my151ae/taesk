"use client";

import { useState, useEffect, Suspense, useRef, useMemo } from "react";
import Image from "next/image";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
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
import { MAIN_BOARD_ID } from "@/lib/board-defaults";
import { initializeCommentsStore, useCommentsStore } from "../_stores/comments-store";
import ShareDialog from "./ShareDialog";
import NotificationsBell from "./NotificationsBell";
import NotificationSettings from "./NotificationSettings";

type KanbanBoardClientProps = {
  initialBoard?: Board | null;
  initialData?: BoardData | null;
  initialCardId?: string | null;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  email: string | null;
};

// LocalStorage helper - Supabase同期のキャッシュとして使用
const STORAGE_KEY = "kanban_board_data";
const CARD_CLICK_THRESHOLD = 5;

const loadFromStorage = (): BoardData => {
  if (typeof window === "undefined") return { lists: [], cards: [] };
  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) {
    return { lists: [], cards: [] };
  }
  return JSON.parse(data);
};

const getProfileDisplayName = (profile?: ProfileSummary | null): string | null => {
  if (!profile) return null;
  if (typeof profile.full_name === 'string' && profile.full_name.trim().length > 0) {
    return profile.full_name.trim();
  }
  if (typeof profile.email === 'string' && profile.email.trim().length > 0) {
    return profile.email;
  }
  return null;
};

const saveToStorage = (data: BoardData) => {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
};

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
const loadFromSupabase = async (boardId: string): Promise<BoardData> => {
  try {
    const response = await fetch(`/api/boards/${boardId}/data`);

    if (!response.ok) {
      throw new Error(`Failed to load board data: ${response.statusText}`);
    }

    const { lists, cards } = await response.json();

    return {
      lists: lists || [],
      cards: cards || [],
    };
  } catch (error) {
    console.error("Error loading from Supabase:", error);
    return loadFromStorage();
  }
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

  const defaultLists = [
    { title: "To Do", position: 0, user_id: actualUserId },
    { title: "In Progress", position: 1, user_id: actualUserId },
    { title: "Done", position: 2, user_id: actualUserId },
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
};

function CardVisual({ card, subtle = false, withGrab = false, className = '', assigneeProfile = null, legacyAssignee = null, ...rest }: CardVisualProps) {
  const priorityIcon = card.priority && card.priority !== 'medium'
    ? card.priority === 'high'
      ? '🔴'
      : '🟢'
    : null;

  const assigneeName = assigneeProfile
    ? (assigneeProfile.full_name && assigneeProfile.full_name.trim().length > 0
        ? assigneeProfile.full_name.trim()
        : assigneeProfile.email ?? 'Unknown user')
    : legacyAssignee;

  const assigneeAlt = assigneeName ?? 'Assignee avatar';

  const initialsSource = assigneeProfile?.full_name
    ?? assigneeProfile?.email
    ?? legacyAssignee
    ?? '';

  const assigneeInitials = initialsSource
    ? initialsSource
        .replace(/[^\p{L}\p{N}\s@.]/gu, ' ')
        .trim()
        .split(/\s+|@|\.|_/)
        .filter(Boolean)
        .slice(0, 2)
        .map((word) => word.charAt(0).toUpperCase())
        .join('') || initialsSource.slice(0, 1).toUpperCase()
    : '?';

  const baseClasses = `rounded-xl border border-slate-200/60 bg-white p-4 shadow-sm transition-shadow dark:border-gray-700/50 dark:bg-gray-800 ${withGrab ? 'cursor-grab active:cursor-grabbing hover:shadow-md' : ''}`;
  const subtleClasses = subtle ? ' ring-2 ring-sky-200/40 dark:ring-sky-600/40' : '';

  return (
    <div
      {...rest}
      className={`${baseClasses}${subtleClasses} ${className}`.trim()}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3 className="flex-1 text-sm font-semibold text-slate-700 dark:text-gray-100">{card.title}</h3>
        {priorityIcon ? <span className="text-xs">{priorityIcon}</span> : null}
      </div>

      {card.description ? (
        <p className="mb-2 line-clamp-2 text-xs leading-relaxed text-slate-500 dark:text-gray-400">
          {card.description}
        </p>
      ) : null}

      {assigneeName ? (
        <div className="mb-2 flex items-center gap-2 text-xs text-slate-500 dark:text-gray-400">
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
    </div>
  );
}

function SortableCard({
  card,
  isDraggingRef,
  onCardClick,
  assigneeProfile = null,
  legacyAssignee = null,
}: {
  card: Card;
  isDraggingRef: React.RefObject<boolean>;
  onCardClick: (cardId: string) => void;
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

  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const allowNavigationRef = useRef(true);

  const registerPointerStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointerStartRef.current = { x: event.clientX, y: event.clientY };
    allowNavigationRef.current = true;
  };

  const evaluatePointerDelta = (event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = pointerStartRef.current;
    if (!origin) return;
    const moved = Math.hypot(event.clientX - origin.x, event.clientY - origin.y);
    if (moved > CARD_CLICK_THRESHOLD) {
      allowNavigationRef.current = false;
    }
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    evaluatePointerDelta(event);

    // ドラッグ中または移動があった場合はクリック無効化（Trello準拠）
    if (!isDragging && allowNavigationRef.current && !isDraggingRef.current) {
      // クリックとみなし、モーダルを開く
      onCardClick(card.id);
    }

    pointerStartRef.current = null;
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    evaluatePointerDelta(event);
  };

  const handlePointerCancel = () => {
    pointerStartRef.current = null;
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      data-testid={`card-${card.id}`}
      className="mb-3 touch-none"
      onPointerDown={registerPointerStart}
      onPointerUp={handlePointerUp}
      onPointerMove={handlePointerMove}
      onPointerCancel={handlePointerCancel}
    >
      <CardVisual
        {...listeners}
        card={card}
        assigneeProfile={assigneeProfile}
        legacyAssignee={legacyAssignee}
        withGrab
        subtle={isDragging}
      />
    </div>
  );
}

// Filter and sort helper functions
const filterAndSortCards = (
  cards: Card[],
  searchQuery: string,
  selectedTags: string[],
  selectedPriority: Priority | 'all',
  sortBy: 'none' | 'due_date_asc' | 'due_date_desc'
): Card[] => {
  let filtered = [...cards];

  // Search filter (title + description)
  if (searchQuery.trim()) {
    const query = searchQuery.toLowerCase();
    filtered = filtered.filter(
      (card) =>
        card.title.toLowerCase().includes(query) || card.description?.toLowerCase().includes(query)
    );
  }

  // Tag filter
  if (selectedTags.length > 0) {
    filtered = filtered.filter((card) =>
      selectedTags.every((tag) => card.tags?.includes(tag))
    );
  }

  // Priority filter
  if (selectedPriority !== 'all') {
    filtered = filtered.filter((card) => card.priority === selectedPriority);
  }

  // Sort by due date
  if (sortBy === 'due_date_asc') {
    filtered.sort((a, b) => {
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
    });
  } else if (sortBy === 'due_date_desc') {
    filtered.sort((a, b) => {
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return new Date(b.due_date).getTime() - new Date(a.due_date).getTime();
    });
  }

  return filtered;
};

// Get all unique tags from all cards
const getAllTags = (cards: Card[]): string[] => {
  const tagsSet = new Set<string>();
  cards.forEach((card) => {
    card.tags?.forEach((tag) => tagsSet.add(tag));
  });
  return Array.from(tagsSet).sort();
};

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
  isDraggingRef,
  onCardClick,
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
  isDraggingRef: React.RefObject<boolean>;
  onCardClick: (cardId: string) => void;
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

  const containerClasses = `backdrop-blur-sm rounded-2xl p-4 w-72 md:w-80 flex-shrink-0 touch-none self-start transition-shadow transition-colors duration-150 ${
    isDropTarget
      ? 'bg-white/90 dark:bg-gray-800/70 border border-sky-300/70 shadow-lg ring-2 ring-sky-200/60 dark:ring-sky-600/40'
      : 'bg-white/70 dark:bg-gray-800/60 border border-slate-200/50 dark:border-gray-700/50 shadow-md'
  }`;

  const dropZoneClasses = `mb-4 px-1 transition-colors duration-150 ${
    isDropTarget ? 'bg-slate-100/70 dark:bg-gray-700/40 rounded-xl py-1' : ''
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
              className="flex-1 px-3 py-2 border border-slate-200 rounded-lg dark:bg-gray-700 dark:border-gray-600 font-semibold focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-transparent"
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
                className="text-slate-400 hover:text-slate-600 text-xl font-bold transition-colors w-6 h-6 flex items-center justify-center rounded hover:bg-slate-100"
              >
                ⋯
              </button>
              {showMenu && (
                <div className="absolute right-0 mt-2 w-40 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-slate-200 dark:border-gray-700 py-1 z-10">
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
              isDraggingRef={isDraggingRef}
              onCardClick={onCardClick}
              assigneeProfile={card.assignee_id ? profilesById[card.assignee_id] ?? null : null}
              legacyAssignee={!card.assignee_id ? card.assigned_to ?? null : null}
            />
          ))}
        </SortableContext>
      </div>

      <button
        onClick={() => onAddCard(list.id)}
        className="w-full py-2.5 bg-sky-400 text-white rounded-lg hover:bg-sky-500 text-sm font-medium transition-colors shadow-sm hover:shadow-md"
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
  const initialBoardId = initialBoard?.id ?? MAIN_BOARD_ID;
  const [boards, setBoards] = useState<Board[]>(() => (initialBoard ? [initialBoard] : []));
  const [currentBoardId, setCurrentBoardId] = useState<string>(initialBoardId);
  const [boardData, setBoardData] = useState<BoardData>(() => initialData ?? { lists: [], cards: [] });
  const [boardMembers, setBoardMembers] = useState<ProfileSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dragOverListId, setDragOverListId] = useState<string | null>(null);
  const [isClient, setIsClient] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [realtimeStatus, setRealtimeStatus] = useState<'connected' | 'connecting' | 'disconnected'>('connecting');
  const [showBoardMenu, setShowBoardMenu] = useState(false);

  // ドラッグ中のクリック抑止用（Trello準拠）
  const isDraggingRef = useRef(false);
  const realtimeChannelRef = useRef<{ channel: RealtimeChannel | null; token: number }>({ channel: null, token: 0 });

  // モーダル状態管理（クライアントサイド・即時表示）
  const [selectedCardId, setSelectedCardId] = useState<string | null>(initialCardId ?? null);
  const [cardModalStatus, setCardModalStatus] = useState<'loading' | 'ready' | 'error'>(initialCardId ? 'ready' : 'loading');

  // Phase3: Share dialog state
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [showNotificationSettings, setShowNotificationSettings] = useState(false);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedPriority, setSelectedPriority] = useState<Priority | 'all'>('all');
  const [sortBy, setSortBy] = useState<'none' | 'due_date_asc' | 'due_date_desc'>('none');
  const [showFilters, setShowFilters] = useState(false);
  const [showCreateBoardDialog, setShowCreateBoardDialog] = useState(false);
  const [newBoardName, setNewBoardName] = useState('');
  const [newBoardDescription, setNewBoardDescription] = useState('');
  const [syncQueueStats, setSyncQueueStats] = useState({ pending: 0, failed: 0, total: 0, lastSyncedAt: null as number | null });

  const upsertComment = useCommentsStore((state) => state.upsertComment);
  const removeComment = useCommentsStore((state) => state.removeComment);

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
    return boardMembers.reduce<Record<string, ProfileSummary>>((map, profile) => {
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

  useEffect(() => {
    if (initialBoard?.id && initialBoard.id !== currentBoardId) {
      setCurrentBoardId(initialBoard.id);
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

  useEffect(() => {
    let isDisposed = false;

    const loadBoardMembers = async () => {
      if (!user || !currentBoardId) {
        if (!isDisposed) {
          setBoardMembers([]);
        }
        return;
      }

      try {
        const response = await fetch(`/api/boards/${currentBoardId}/members`);

        if (!response.ok) {
          console.warn('Error loading board members:', response.statusText);
          if (!isDisposed) {
            setBoardMembers([]);
          }
          return;
        }

        const { members } = await response.json();
        const profiles: ProfileSummary[] = members.map((m: any) => m.profile);

        if (!isDisposed) {
          setBoardMembers(profiles);
        }
      } catch (error) {
        console.error('Unexpected error loading board members:', error);
        if (!isDisposed) {
          setBoardMembers([]);
        }
      }
    };

    loadBoardMembers();

    return () => {
      isDisposed = true;
    };
  }, [user, currentBoardId]);

  // Load board data when currentBoardId changes
  useEffect(() => {
    setIsClient(true);
    let isCancelled = false;

    // Load data from Supabase or localStorage
    const loadData = async () => {
      if (!user || !currentBoardId) return;

      const currentBoard = boards.find((board) => board.id === currentBoardId);
      const data = await loadFromSupabase(currentBoardId);
      if (isCancelled) return;

      const shouldSeedDefaults =
        data.lists.length === 0 && (!currentBoard || !currentBoard.is_test_board);

      if (shouldSeedDefaults) {
        const defaultLists = await initializeDefaultLists(user.id, currentBoardId);
        if (isCancelled) return;

        if (defaultLists.length > 0) {
          const newData = { lists: defaultLists, cards: [] };
          setBoardData(newData);
          saveToStorage(newData);
          return;
        }
      }

      setBoardData(data);
      saveToStorage(data);
    };

    loadData();

    return () => {
      isCancelled = true;
    };
  }, [user, currentBoardId, boards]);

  // Online/Offline detection with auto-sync
  useEffect(() => {
    const handleOnline = async () => {
      console.log('オンライン復帰 - 同期開始');
      setIsOnline(true);

      // Sync pending queue when coming back online
      const result = await syncQueue();
      if (result.total > 0) {
        console.log(`同期完了: ${result.success}件成功, ${result.failed}件失敗`);
      }
    };

    const handleOffline = () => {
      console.log('オフライン検出');
      setIsOnline(false);
    };

    // Set initial online state
    setIsOnline(navigator.onLine);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Sync queue on app load if online
  useEffect(() => {
    const syncOnLoad = async () => {
      if (navigator.onLine && user) {
        console.log('アプリ起動時 - 同期キューをチェック');
        const result = await syncQueue();
        if (result.total > 0) {
          console.log(`起動時同期完了: ${result.success}件成功, ${result.failed}件失敗`);
        }
        // Update stats after sync
        setSyncQueueStats(getSyncQueueStats());
      }
    };

    syncOnLoad();
  }, [user]);

  // Update sync queue stats periodically
  useEffect(() => {
    const updateStats = () => {
      setSyncQueueStats(getSyncQueueStats());
    };

    // Update immediately
    updateStats();

    // Update every 2 seconds
    const interval = setInterval(updateStats, 2000);

    return () => clearInterval(interval);
  }, [isOnline]);

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

  // Realtime subscription for multi-device sync
  useEffect(() => {
    if (!currentBoardId) return;

    console.log('[Realtime] Setting up subscription for board:', currentBoardId);
    const realtimeState = realtimeChannelRef.current;
    const token = (realtimeState.token ?? 0) + 1;
    realtimeState.token = token;
    console.log('[Realtime] New token:', token);

    const previousChannel = realtimeState.channel;
    if (previousChannel) {
      console.log('[Realtime] Unsubscribing from previous channel');
      previousChannel.unsubscribe();
      supabase.removeChannel(previousChannel).catch((error) => {
        console.warn('[Realtime] Failed to remove previous channel:', error);
      });
    }

    setRealtimeStatus('connecting');

    const channel = supabase
      .channel(`board-changes-${currentBoardId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'lists',
          filter: `board_id=eq.${currentBoardId}`,
        },
        (payload) => {
          if (realtimeState.token !== token) return;
          console.log('List change detected:', payload);

          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            setBoardData((prev) => {
              const newList = payload.new as List;
              const idx = prev.lists.findIndex(list => list.id === newList.id);

              if (idx >= 0) {
                const updatedLists = [...prev.lists];
                updatedLists[idx] = newList;
                return { ...prev, lists: updatedLists };
              }

              return { ...prev, lists: [...prev.lists, newList] };
            });
          } else if (payload.eventType === 'DELETE') {
            setBoardData((prev) => ({
              ...prev,
              lists: prev.lists.filter((list) => list.id !== payload.old.id),
              cards: prev.cards.filter((card) => card.list_id !== payload.old.id),
            }));
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'cards',
          filter: `board_id=eq.${currentBoardId}`,
        },
        (payload) => {
          if (realtimeState.token !== token) return;
          console.log('Card change detected:', payload);

          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            setBoardData((prev) => {
              const newCard = payload.new as Card;
              const idx = prev.cards.findIndex(card => card.id === newCard.id);

              if (idx >= 0) {
                const updatedCards = [...prev.cards];
                updatedCards[idx] = newCard;
                return { ...prev, cards: updatedCards };
              }

              return { ...prev, cards: [...prev.cards, newCard] };
            });
          } else if (payload.eventType === 'DELETE') {
            setBoardData((prev) => ({
              ...prev,
              cards: prev.cards.filter((card) => card.id !== payload.old.id),
            }));
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'comments',
          filter: `board_id=eq.${currentBoardId}`,
        },
        async (payload) => {
          if (realtimeState.token !== token) return;

          if (payload.eventType === 'DELETE') {
            const oldRow = payload.old as { id: string; card_id: string };
            if (oldRow?.card_id && oldRow?.id) {
              removeComment(oldRow.card_id, oldRow.id);
            }
            return;
          }

          const newRow = payload.new as { id?: string };
          if (!newRow?.id) return;

          const { data, error } = await supabase
            .from('comments')
            .select(`*, author:profiles!comments_author_id_fkey(id, full_name, avatar_url, email)`)
            .eq('id', newRow.id)
            .single();

          if (error || !data) {
            console.warn('[Realtime] Failed to fetch comment for update', error);
            return;
          }

          const commentData = data as CommentWithAuthor;
          upsertComment(commentData.card_id, {
            ...commentData,
            idempotencyKey: commentData.idempotency_key ?? null,
          });
        }
      );

    realtimeState.channel = channel;

    channel.subscribe((status) => {
      if (realtimeState.token !== token) return;
      console.log('Realtime subscription status:', status);
      if (status === 'SUBSCRIBED') {
        setRealtimeStatus('connected');
      } else if (status === 'CLOSED') {
        setRealtimeStatus('disconnected');
      }
    });

    return () => {
      if (realtimeState.channel === channel) {
        realtimeState.channel = null;
      }

      channel.unsubscribe();
      supabase.removeChannel(channel).catch((error) => {
        console.warn('[Realtime] Failed to remove channel:', error);
      });

      if (realtimeState.token === token) {
        setRealtimeStatus('disconnected');
      }
    };
  }, [currentBoardId, removeComment, upsertComment]);

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

  const upsertCardsWithAssigneeFallback = async (cardsToSync: Card[]): Promise<Error | null> => {
    if (cardsToSync.length === 0 || !currentBoardId) {
      return null;
    }

    try {
      const updates = cardsToSync.map((card) => ({
        id: card.id,
        list_id: card.list_id,
        position: card.position,
        title: card.title,
        description: card.description,
        tags: card.tags,
        due_date: card.due_date,
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
  };

  const updateCardDetailsOnServer = async (card: Card): Promise<Error | null> => {
    if (!currentBoardId) {
      return new Error('No board selected');
    }

    try {
      const payload = {
        title: card.title,
        description: card.description,
        list_id: card.list_id,
        position: card.position,
        tags: card.tags,
        due_date: card.due_date,
        priority: card.priority,
        assignee_id: card.assignee_id,
        assigned_to: card.assigned_to ?? null,
        slug: card.slug ?? undefined,
      };

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
  };

  const syncToSupabase = async (data: BoardData) => {
    // If offline, don't sync - operations are already in queue
    if (!isOnline || !currentBoardId) {
      console.log('Offline or no board: skipping sync (operations queued)');
      return;
    }

    try {
      // Sync lists via API route
      if (data.lists.length > 0) {
        const listUpdates = data.lists.map(list => ({
          id: list.id,
          position: list.position,
          title: list.title,
        }));

        const listResponse = await fetch(`/api/boards/${currentBoardId}/lists/reorder`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ updates: listUpdates }),
        });

        if (!listResponse.ok) {
          const errorData = await listResponse.json();
          throw new Error(errorData.error?.message || 'Failed to sync lists');
        }
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

    const position = boardData.lists.length;
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
      description: "",
      list_id: listId,
      board_id: currentBoardId,
      position,
      user_id: getActualUserId(user.id),
      tags: [],
      due_date: null,
      priority: 'medium',
      assigned_to: null,
      assignee_id: null,
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
            description: "",
            list_id: listId,
            position,
            tags: tempCard.tags,
            due_date: tempCard.due_date,
            priority: tempCard.priority,
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
        const newLists = arrayMove(boardData.lists, oldIndex, newIndex).map((list, index) => ({
          ...list,
          position: index,
          updated_at: new Date().toISOString(),
        }));
        const newData = { ...boardData, lists: newLists };
        updateData(newData);

        // Add to sync queue if offline, otherwise sync directly
        if (!isOnline) {
          // Queue all affected lists for update
          newLists.forEach(list => {
            addToSyncQueue({ type: 'UPDATE', table: 'lists', data: list });
          });
        } else {
          await syncToSupabase(newData);
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

  const handleSaveCard = async (
    id: string,
    title: string,
    description: string,
    tags?: string[],
    due_date?: string | null,
    priority?: Priority,
    assigneeIds?: string[],
    assigneeTouched?: boolean
  ) => {
    console.log('[handleSaveCard] Starting...', { id, title, description, assigneeIds });

    try {
      const slug = slugify(title);
      const updatedCards = boardData.cards.map((card) => {
        if (card.id === id) {
          // Handle assignee_ids (array) and maintain backward compatibility with assignee_id (single)
          const nextAssigneeIds = assigneeIds && assigneeIds.length > 0 ? assigneeIds : [];
          const nextAssigneeId = nextAssigneeIds.length > 0 ? nextAssigneeIds[0] : null;

          return {
            ...card,
            title,
            description,
            tags: tags || [],
            due_date: due_date || null,
            priority: priority || 'medium',
            assignee_id: nextAssigneeId, // Keep for backward compatibility
            assignee_ids: nextAssigneeIds.length > 0 ? nextAssigneeIds : null,
            assigned_to: null, // Clear legacy field
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
      const updatedCard = updatedCards.find((c) => c.id === id);
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
                        setCurrentBoardId(board.id);
                        updateURL(board);
                        setShowBoardMenu(false);
                      }}
                      className={`w-full text-left px-4 py-2 hover:bg-slate-100 transition-colors ${
                        board.id === currentBoardId ? 'bg-slate-50 font-semibold' : ''
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
                <span className="flex items-center gap-1 text-orange-600 font-medium">
                  <div className="w-2 h-2 rounded-full bg-orange-600" />
                  Offline
                </span>
              )}
              {isOnline && realtimeStatus === 'connected' && (
                <span className="flex items-center gap-1 text-green-600 font-medium">
                  <div className="w-2 h-2 rounded-full bg-green-600 animate-pulse" />
                  Live
                </span>
              )}
              {isOnline && realtimeStatus === 'connecting' && (
                <span className="flex items-center gap-1 text-yellow-600 font-medium">
                  <div className="w-2 h-2 rounded-full bg-yellow-600 animate-pulse" />
                  Connecting...
                </span>
              )}
              {isOnline && realtimeStatus === 'disconnected' && (
                <span className="flex items-center gap-1 text-gray-500 font-medium">
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
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
              Share
            </button>
            <span className="text-sm text-gray-600">{user.email}</span>
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
                          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                            selectedTags.includes(tag)
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
          <div className="flex gap-3 md:gap-4 overflow-x-auto pb-4 -mx-4 px-4 md:mx-0 md:px-0 min-h-[calc(100vh-12rem)]">
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
                  isDraggingRef={isDraggingRef}
                  onCardClick={handleOpenCardModal}
                  isDropTarget={dragOverListId === list.id}
                  profilesById={profilesById}
                />
              ))}
            </SortableContext>

            <button
              onClick={handleAddList}
              className="bg-white/40 dark:bg-gray-800/40 backdrop-blur-sm rounded-2xl p-6 w-72 md:w-80 flex-shrink-0 h-fit hover:bg-white/60 dark:hover:bg-gray-800/60 border-2 border-dashed border-slate-300/60 dark:border-gray-600/50 transition-all hover:border-sky-300 dark:hover:border-sky-400 shadow-sm"
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
              <div className="w-72 md:w-80 rounded-2xl bg-white dark:bg-gray-800 border border-slate-200/70 dark:border-gray-700/70 shadow-2xl p-4">
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
                const profiles: ProfileSummary[] = members.map((m: any) => m.profile);
                setBoardMembers(profiles);
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
