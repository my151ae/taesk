"use client";

import { useState, useEffect, Suspense, useRef } from "react";
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
import { supabase, type Card, type List, type Board, type BoardData, type Priority } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { addToSyncQueue, syncQueue, getSyncQueueStats } from "@/lib/syncQueue";
import { createUniqueShortId, getNextIdShort, slugify } from "@/lib/card-utils";
import { buildCardUrl } from "@/lib/card-url";
import { createUniqueBoardShortId, getNextBoardIdShort, slugifyBoardName } from "@/lib/board-utils";
import { buildBoardUrl } from "@/lib/board-url";
import { CardModal } from "@/app/components/CardModal";

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

const saveToStorage = (data: BoardData) => {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
};

// Supabase data loading with board filter
const loadFromSupabase = async (boardId: string): Promise<BoardData> => {
  try {
    const [{ data: lists, error: listsError }, { data: cards, error: cardsError }] = await Promise.all([
      supabase.from("lists").select("*").eq("board_id", boardId).order("position", { ascending: true }),
      supabase.from("cards").select("*").eq("board_id", boardId).order("position", { ascending: true }),
    ]);

    if (listsError) throw listsError;
    if (cardsError) throw cardsError;

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

// Activity log helper
const logActivity = async (
  boardId: string,
  userId: string,
  action: 'created' | 'updated' | 'deleted' | 'moved',
  entityType: 'card' | 'list',
  entityId: string,
  entityTitle: string,
  details?: Record<string, unknown>
) => {
  try {
    const actualUserId = getActualUserId(userId);
    await supabase.from('activity_logs').insert({
      board_id: boardId,
      user_id: actualUserId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      entity_title: entityTitle,
      details: details || null,
    });
  } catch (error) {
    console.error('Error logging activity:', error);
  }
};

// Initialize with default lists if empty
// Note: user_id is stored for future features (personal boards), but currently
// all authenticated users can see and edit all data (shared team board)
// In test mode (bypass auth), user_id is set to null to avoid foreign key constraint issues
const initializeDefaultLists = async (userId: string, boardId: string): Promise<List[]> => {
  // Use null for user_id in test mode to avoid foreign key constraint with auth.users
  const actualUserId = getActualUserId(userId);

  const defaultLists = [
    { title: "To Do", position: 0, board_id: boardId, user_id: actualUserId },
    { title: "In Progress", position: 1, board_id: boardId, user_id: actualUserId },
    { title: "Done", position: 2, board_id: boardId, user_id: actualUserId },
  ];

  try {
    const { data, error } = await supabase.from("lists").insert(defaultLists).select();
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error("Error initializing default lists:", error);
    return [];
  }
};

// Sortable Card Component
function SortableCard({ card, isDraggingRef, onCardClick }: { card: Card; isDraggingRef: React.RefObject<boolean>; onCardClick: (cardId: string) => void }) {
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
    opacity: isDragging ? 0.5 : 1,
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
      <div
        {...listeners}
        className="block rounded-xl border border-slate-200/60 bg-white p-4 shadow-sm transition-shadow hover:shadow-md dark:border-gray-700/50 dark:bg-gray-800 cursor-grab active:cursor-grabbing"
      >
        <div className="mb-2 flex items-start justify-between gap-2">
          <h3 className="flex-1 text-sm font-semibold text-slate-700 dark:text-gray-100">{card.title}</h3>
          {card.priority && card.priority !== "medium" && (
            <span className="text-xs">
              {card.priority === "high" ? "🔴" : "🟢"}
            </span>
          )}
        </div>

        {card.description && (
          <p className="mb-2 line-clamp-2 text-xs leading-relaxed text-slate-500 dark:text-gray-400">
            {card.description}
          </p>
        )}

        <div className="flex flex-wrap gap-1">
          {card.tags && card.tags.length > 0 && card.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-md bg-sky-100 px-2 py-0.5 text-xs text-sky-700 dark:bg-sky-900 dark:text-sky-300"
            >
              {tag}
            </span>
          ))}
          {card.due_date && (
            <span className="rounded text-xs bg-orange-100 px-2 py-0.5 text-orange-700 dark:bg-orange-900 dark:text-orange-300">
              📅 {new Date(card.due_date).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="bg-white/70 dark:bg-gray-800/60 backdrop-blur-sm rounded-2xl p-4 w-72 md:w-80 flex-shrink-0 touch-none border border-slate-200/50 dark:border-gray-700/50 shadow-md self-start"
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

      <div className="mb-4 px-1" data-testid={`list-${list.id}-dropzone`}>
        <SortableContext items={sortedCards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {sortedCards.map((card) => (
            <SortableCard
              key={card.id}
              card={card}
              isDraggingRef={isDraggingRef}
              onCardClick={onCardClick}
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
// Default Main Board ID
const MAIN_BOARD_ID = '00000000-0000-0000-0000-000000000001';

function KanbanBoard() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [boards, setBoards] = useState<Board[]>([]);
  const [currentBoardId, setCurrentBoardId] = useState<string>(MAIN_BOARD_ID);
  const [boardData, setBoardData] = useState<BoardData>({ lists: [], cards: [] });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isClient, setIsClient] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [realtimeStatus, setRealtimeStatus] = useState<'connected' | 'connecting' | 'disconnected'>('connecting');
  const [showBoardMenu, setShowBoardMenu] = useState(false);

  // ドラッグ中のクリック抑止用（Trello準拠）
  const isDraggingRef = useRef(false);

  // モーダル状態管理（クライアントサイド・即時表示）
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [cardModalStatus, setCardModalStatus] = useState<'loading' | 'ready' | 'error'>('loading');

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

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  // URL からモーダル状態を復元（初回ロード時）
  useEffect(() => {
    if (!isClient || !pathname || boardData.cards.length === 0) return;

    if (pathname.startsWith('/c/')) {
      const [, , shortId] = pathname.split('/');
      const card = boardData.cards.find((c) => c.short_id === shortId);

      if (card) {
        setSelectedCardId(card.id);
        setCardModalStatus('ready');

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
          window.history.replaceState({ cardId: card.id }, '', correctUrl);
        }
      }
    }
  }, [isClient, pathname, boardData.cards]);

  // Handle URL parameters for board selection
  useEffect(() => {
    const boardParam = searchParams.get('board');

    // Update board from URL
    if (boardParam && boardParam !== currentBoardId) {
      setCurrentBoardId(boardParam);
    }
  }, [searchParams, currentBoardId]);

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
    if (!user || !currentBoardId) return;

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
          console.log('List change detected:', payload);

          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            setBoardData((prev) => {
              const newList = payload.new as List;
              const idx = prev.lists.findIndex(list => list.id === newList.id);

              if (idx >= 0) {
                // Update existing list
                const updatedLists = [...prev.lists];
                updatedLists[idx] = newList;
                return { ...prev, lists: updatedLists };
              }

              // Insert new list
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
          console.log('Card change detected:', payload);

          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            setBoardData((prev) => {
              const newCard = payload.new as Card;
              const idx = prev.cards.findIndex(card => card.id === newCard.id);

              if (idx >= 0) {
                // Update existing card
                const updatedCards = [...prev.cards];
                updatedCards[idx] = newCard;
                return { ...prev, cards: updatedCards };
              }

              // Insert new card
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
      .subscribe((status) => {
        console.log('Realtime subscription status:', status);
        if (status === 'SUBSCRIBED') {
          setRealtimeStatus('connected');
        } else if (status === 'CLOSED') {
          setRealtimeStatus('disconnected');
        }
      });

    return () => {
      console.log('[Realtime] Cleaning up subscription for board:', currentBoardId);
      supabase.removeChannel(channel).then(() => {
        console.log('[Realtime] Channel removed successfully');
      });
      setRealtimeStatus('disconnected');
    };
  }, [user, currentBoardId]);

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

  // Helper to update URL with board parameter
  const updateURL = (boardId?: string) => {
    const params = new URLSearchParams();

    // Only add board param if it's not the main board
    if (boardId && boardId !== MAIN_BOARD_ID) {
      params.set('board', boardId);
    }

    const queryString = params.toString();
    const newUrl = queryString ? `/?${queryString}` : '/';
    router.push(newUrl, { scroll: false });
  };

  const syncToSupabase = async (data: BoardData) => {
    // If offline, don't sync - operations are already in queue
    if (!isOnline) {
      console.log('Offline: skipping sync (operations queued)');
      return;
    }

    try {
      await Promise.all([
        supabase.from("lists").upsert(data.lists),
        supabase.from("cards").upsert(data.cards),
      ]);
    } catch (error) {
      console.error("Error syncing to Supabase:", error);
    }
  };

  const handleAddList = async () => {
    if (!user || !currentBoardId) return;

    // Note: user_id is saved for future features, but all authenticated users
    // can currently see and edit all lists (shared team board)
    const newList: List = {
      id: uuidv4(),
      title: "New List",
      position: boardData.lists.length,
      board_id: currentBoardId,
      user_id: getActualUserId(user.id),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const newData = { ...boardData, lists: [...boardData.lists, newList] };
    updateData(newData);

    // Add to sync queue if offline, otherwise sync directly
    if (!isOnline) {
      addToSyncQueue({ type: 'INSERT', table: 'lists', data: newList });
    } else {
      await syncToSupabase(newData);
    }
  };

  const handleAddCard = async (listId: string) => {
    if (!user || !currentBoardId) return;

    // Generate short_id, id_short, and slug
    const shortId = await createUniqueShortId();
    const idShort = await getNextIdShort(currentBoardId);
    const title = "New Card";
    const slug = slugify(title);

    // Note: user_id is saved for future features, but all authenticated users
    // can currently see and edit all cards (shared team board)
    const newCard: Card = {
      id: uuidv4(),
      title,
      description: "",
      list_id: listId,
      board_id: currentBoardId,
      position: boardData.cards.filter((c) => c.list_id === listId).length,
      user_id: getActualUserId(user.id),
      tags: [],
      due_date: null,
      priority: 'medium',
      assigned_to: null,
      short_id: shortId,
      id_short: idShort,
      slug,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const newData = { ...boardData, cards: [...boardData.cards, newCard] };
    updateData(newData);

    // Add to sync queue if offline, otherwise sync directly
    if (!isOnline) {
      addToSyncQueue({ type: 'INSERT', table: 'cards', data: newCard });
    } else {
      await syncToSupabase(newData);
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
    const updatedLists = boardData.lists.filter((list) => list.id !== id);
    const updatedCards = boardData.cards.filter((card) => card.list_id !== id);
    const newData = { lists: updatedLists, cards: updatedCards };
    updateData(newData);

    // Add to sync queue if offline, otherwise delete directly
    if (!isOnline) {
      addToSyncQueue({ type: 'DELETE', table: 'lists', data: { id } });
    } else {
      try {
        await supabase.from("lists").delete().eq("id", id);
      } catch (error) {
        console.error("Error deleting list:", error);
      }
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
    isDraggingRef.current = true;
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeData = active.data.current;
    const overData = over.data.current;

    // カードをリスト間で移動（一時的な表示更新のみ）
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
      }
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
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
      // Generate short_id, id_short, and slug
      const shortId = await createUniqueBoardShortId();
      const idShort = await getNextBoardIdShort();
      const slug = slugifyBoardName(newBoardName.trim());

      const newBoard: Board = {
        id: uuidv4(),
        name: newBoardName.trim(),
        description: newBoardDescription.trim() || undefined,
        is_test_board: false,
        user_id: getActualUserId(user.id),
        short_id: shortId,
        id_short: idShort,
        slug,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase.from('boards').insert(newBoard);
      if (error) throw error;

      setBoards([...boards, newBoard]);
      setCurrentBoardId(newBoard.id);
      updateURL(newBoard.id);
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

    // モーダルを即座に開く（ローディング状態）
    setSelectedCardId(cardId);
    setCardModalStatus('ready'); // すでにカードデータはある

    // URL 同期（即時）
    if (card.short_id) {
      const url = buildCardUrl({
        shortId: card.short_id,
        slug: card.slug ?? undefined,
        idShort: card.id_short ?? undefined,
        title: card.title,
      });
      window.history.replaceState({ cardId }, '', url);
    }
  };

  const handleCloseCardModal = () => {
    setSelectedCardId(null);
    setCardModalStatus('loading');

    // URL を `/` に戻す
    const boardParam = searchParams.get('board');
    const newUrl = boardParam && boardParam !== MAIN_BOARD_ID ? `/?board=${boardParam}` : '/';
    window.history.replaceState({}, '', newUrl);
  };

  const handleSaveCard = async (
    id: string,
    title: string,
    description: string,
    tags?: string[],
    due_date?: string | null,
    priority?: Priority,
    assigned_to?: string | null
  ) => {
    const slug = slugify(title);
    const updatedCards = boardData.cards.map((card) => {
      if (card.id === id) {
        return {
          ...card,
          title,
          description,
          tags: tags || [],
          due_date: due_date || null,
          priority: priority || 'medium',
          assigned_to: assigned_to || null,
          slug,
          updated_at: new Date().toISOString(),
        };
      }
      return card;
    });

    const newData = { ...boardData, cards: updatedCards };
    updateData(newData);

    // Supabase に保存
    const updatedCard = updatedCards.find((c) => c.id === id);
    if (updatedCard) {
      if (!isOnline) {
        addToSyncQueue({ type: 'UPDATE', table: 'cards', data: updatedCard });
      } else {
        await syncToSupabase(newData);
      }
    }

    handleCloseCardModal();
  };

  const handleDeleteCard = async (id: string) => {
    const updatedCards = boardData.cards.filter((card) => card.id !== id);
    const newData = { ...boardData, cards: updatedCards };
    updateData(newData);

    // Supabase から削除
    if (!isOnline) {
      addToSyncQueue({ type: 'DELETE', table: 'cards', data: { id } });
    } else {
      try {
        await supabase.from('cards').delete().eq('id', id);
      } catch (error) {
        console.error('Error deleting card:', error);
      }
    }

    handleCloseCardModal();
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
                        updateURL(board.id);
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
            {activeId ? (
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-4 opacity-95 rotate-2 cursor-grabbing border border-sky-300 scale-105">
                <span className="text-sm text-slate-600 dark:text-gray-300 font-medium">Dragging...</span>
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
      {selectedCardId && (
        <CardModal
          card={boardData.cards.find((c) => c.id === selectedCardId)!}
          boards={boards}
          onSave={handleSaveCard}
          onDelete={handleDeleteCard}
          onMoveToBoard={handleMoveCardToBoard}
          onClose={handleCloseCardModal}
        />
      )}

    </div>
  );
}


export default function KanbanBoardPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen">Loading...</div>}>
      <KanbanBoard />
    </Suspense>
  );
}
