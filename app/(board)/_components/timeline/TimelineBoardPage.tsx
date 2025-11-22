"use client";

import { useCallback, useEffect, useMemo, useRef, useState, isValidElement, cloneElement, type ReactNode, type ReactElement, type KeyboardEvent as ReactKeyboardEvent } from "react";
import clsx from "clsx";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Board, Card, DueBucket, Priority, ProfileSummary, DueChannel } from "@/lib/supabase";
import { buildBoardUrl } from "@/lib/board-url";
import {
  DndContext,
  DragEndEvent,
  DragMoveEvent,
  DragStartEvent,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  type UniqueIdentifier,
  useDroppable,
  useDraggable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { createClientTrace } from "@/lib/metrics/client";
import type { ClientTrace } from "@/lib/metrics/client";
import { CardModal } from "@/app/components/CardModal";
import { slugify } from "@/lib/card-utils";
import ShareDialog from "@/app/(board)/_components/ShareDialog";
import NotificationsBell from "@/app/(board)/_components/NotificationsBell";
import NotificationSettings from "@/app/(board)/_components/NotificationSettings";
import ProfileSettings from "@/app/(board)/_components/ProfileSettings";
import { useAuth } from "@/app/contexts/AuthContext";
import TimelineHeader from "@/app/(board)/_components/timeline/TimelineHeader";
import {
  HOUR_HEIGHT,
  HOURS,
  TIMELINE_HEIGHT,
  TIMELINE_MIN_VIEWPORT,
  AXIS_WIDTH,
  AB_CARD_META,
  TIMELINE_HEADER_ESTIMATE,
  minuteToPixels,
  getMinutesFromTime,
  getIsoDateJst,
  getNowMinutesJst,
  minutesToTime,
  timeLabel,
  withJstMidnight,
  toLocalDay,
  pointerMinutesFromEvent,
  type UserProfile,
  type TimelineDay,
  type TimelineEvent,
  type TimelineBucketItem,
  type TimelineResponse,
} from "@/app/(board)/_utils/timeline-helpers";

import { useSyncQueue } from "@/app/(board)/_hooks/useSyncQueue";
import { useRealtimeBoard } from "@/app/(board)/_hooks/useRealtimeBoard";
import { useBoardFilters, filterAndSortCards, getAllTags } from "@/app/(board)/_hooks/useBoardFilters";
import { useCommentsStore } from "@/app/(board)/_stores/comments-store";
import { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

type TimelineBoardPageProps = {
  initialBoard: Board;
};

type ActiveDragState = {
  cardId: string;
  startMinutes: number;
  duration: number;
};

type PointerPreviewState = {
  visible: boolean;
  startMinutes: number;
  durationMinutes: number;
  dayIso: string | null;
};

const HIDDEN_POINTER_PREVIEW: PointerPreviewState = {
  visible: false,
  startMinutes: 0,
  durationMinutes: 0,
  dayIso: null,
};

type PlacementMeta = {
  target: 'timeline' | 'bucket';
  bucketKey?: string;
  sourceEvent?: TimelineEvent;
  sourceBucketItem?: TimelineBucketItem;
  defaultDuration?: number;
  localDueDate?: string | null;
};

type DataMode = 'api' | 'mock';

const bucketsFirstCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (!pointerCollisions.length) {
    return rectIntersection(args);
  }

  const droppableFor = (id: UniqueIdentifier) => {
    const match = args.droppableContainers.find((entry) => entry.id === id);
    return match?.data.current?.type;
  };
  const bucketCollisions = pointerCollisions.filter(({ id }) => {
    const type = droppableFor(id);
    return type === 'bucket-item' || type === 'ab-bucket';
  });

  if (bucketCollisions.length) {
    return bucketCollisions;
  }

  return pointerCollisions;
};

const buildMockTimeline = (): TimelineResponse => {
  const base = new Date();
  const format = (offsetDays: number) => {
    const next = new Date(base.getTime() + offsetDays * 24 * 60 * 60 * 1000);
    const year = next.getFullYear();
    const month = `${next.getMonth() + 1}`.padStart(2, '0');
    const day = `${next.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const today = format(0);
  const tomorrow = format(1);

  return {
    days: [
      { key: 'today', label: 'Today', isoDate: today },
      { key: 'tomorrow', label: 'Tomorrow', isoDate: tomorrow },
    ],
    events: [
      {
        card_id: 'mock-spec',
        due_date: today,
        due_start: '09:30:00',
        due_end: '10:30:00',
        durationMinutes: 60,
        title: 'Spec writing',
        tags: [],
        priority: 'medium',
        checked: false,
        short_id: null,
        slug: null,
      },
      {
        card_id: 'mock-deepwork-a',
        due_date: today,
        due_start: '13:00:00',
        due_end: '14:00:00',
        durationMinutes: 60,
        title: 'Deep work A',
        tags: [],
        priority: 'high',
        checked: false,
        short_id: null,
        slug: null,
      },
      {
        card_id: 'mock-deepwork-b',
        due_date: today,
        due_start: '13:30:00',
        due_end: '14:30:00',
        durationMinutes: 60,
        title: 'Deep work B',
        tags: [],
        priority: 'high',
        checked: false,
        short_id: null,
        slug: null,
      },
      {
        card_id: 'mock-design-review',
        due_date: tomorrow,
        due_start: '10:00:00',
        due_end: '11:00:00',
        durationMinutes: 60,
        title: 'Design review',
        tags: [],
        priority: 'medium',
        checked: false,
        short_id: null,
        slug: null,
      },
    ],
    abBuckets: {
      today_a: [
        { card_id: 'mock-finish-spec', title: 'Finish spec', due_date: null, due_start: null, due_end: null, checked: false, tags: [], short_id: null, slug: null, bucketPosition: 4000 },
        { card_id: 'mock-prepare-meeting', title: 'Prepare meeting', due_date: null, due_start: null, due_end: null, checked: false, tags: [], short_id: null, slug: null, bucketPosition: 3900 },
        { card_id: 'mock-fix-bug', title: 'Fix bug #123', due_date: null, due_start: null, due_end: null, checked: false, tags: [], short_id: null, slug: null, bucketPosition: 3800 },
      ],
      today_b: [
        { card_id: 'mock-organize-docs', title: 'Organize docs', due_date: null, due_start: null, due_end: null, checked: false, tags: [], short_id: null, slug: null, bucketPosition: 3600 },
        { card_id: 'mock-break-task', title: 'Break down big task', due_date: null, due_start: null, due_end: null, checked: false, tags: [], short_id: null, slug: null, bucketPosition: 3500 },
      ],
      tomorrow_a: [
        { card_id: 'mock-finish-review', title: 'Finish review', due_date: null, due_start: null, due_end: null, checked: false, tags: [], short_id: null, slug: null, bucketPosition: 3400 },
        { card_id: 'mock-prepare-slides', title: 'Prepare slides', due_date: null, due_start: null, due_end: null, checked: false, tags: [], short_id: null, slug: null, bucketPosition: 3300 },
      ],
      tomorrow_b: [
        { card_id: 'mock-refactor', title: 'Refactor old code', due_date: null, due_start: null, due_end: null, checked: false, tags: [], short_id: null, slug: null, bucketPosition: 3200 },
        { card_id: 'mock-research', title: 'Research item', due_date: null, due_start: null, due_end: null, checked: false, tags: [], short_id: null, slug: null, bucketPosition: 3100 },
      ],
    },
    serverNow: new Date().toISOString(),
  };
};

export default function TimelineBoardPage({ initialBoard }: TimelineBoardPageProps) {
  const [data, setData] = useState<TimelineResponse | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeDrag, setActiveDrag] = useState<ActiveDragState | null>(null);
  const activeDragRef = useRef<ActiveDragState | null>(null);
  const [pointerPreview, setPointerPreview] = useState<PointerPreviewState>(HIDDEN_POINTER_PREVIEW);
  const [dataMode, setDataMode] = useState<DataMode>('api');
  const [liveNowMinutes, setLiveNowMinutes] = useState<number | null>(null);
  const [liveNowIsoDate, setLiveNowIsoDate] = useState<string | null>(null);
  const [hasAutoScrolled, setHasAutoScrolled] = useState(false);
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  const timelineHeaderRef = useRef<HTMLDivElement | null>(null);
  const [timelineHeaderHeight, setTimelineHeaderHeight] = useState(TIMELINE_HEADER_ESTIMATE);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const canonicalBoardPath = useMemo(() => buildBoardUrl(initialBoard), [initialBoard]);
  const traceRef = useRef<ClientTrace | null>(createClientTrace('timeline'));
  const [availableBoards, setAvailableBoards] = useState<Board[]>([initialBoard]);
  const [modalProfiles, setModalProfiles] = useState<ProfileSummary[]>([]);
  const [modalCard, setModalCard] = useState<Card | null>(null);
  const [cardModalStatus, setCardModalStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [cardModalError, setCardModalError] = useState<string | null>(null);
  const cardModalShortIdRef = useRef<string | null>(null);
  const { user, signOut } = useAuth();
  const [showBoardMenu, setShowBoardMenu] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    if (!user) return;

    const fetchProfile = async () => {
      try {
        const response = await fetch('/api/profiles');
        if (response.ok) {
          const data = await response.json();
          setProfile(data);
        }
      } catch (error) {
        console.error('Failed to fetch profile:', error);
      }
    };

    fetchProfile();
  }, [user]);
  const [showNotificationSettings, setShowNotificationSettings] = useState(false);
  const [showProfileSettings, setShowProfileSettings] = useState(false);
  const boardMenuRef = useRef<HTMLDivElement | null>(null);
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

  // Realtime & Sync
  const { isOnline, syncQueueStats } = useSyncQueue();
  const upsertComment = useCommentsStore((state) => state.upsertComment);
  const removeComment = useCommentsStore((state) => state.removeComment);

  const handleCardChange = useCallback((payload: RealtimePostgresChangesPayload<Card>) => {
    setData((prev) => {
      if (!prev) return prev;

      const { eventType, new: newRecord, old: oldRecord } = payload;
      const nextEvents = [...prev.events];
      const nextBuckets = { ...prev.abBuckets };

      // Helper to remove card from all collections
      const removeCard = (cardId: string) => {
        // Remove from events
        const eventIdx = nextEvents.findIndex(e => e.card_id === cardId);
        if (eventIdx >= 0) nextEvents.splice(eventIdx, 1);

        // Remove from buckets
        Object.keys(nextBuckets).forEach(key => {
          nextBuckets[key] = nextBuckets[key].filter(item => item.card_id !== cardId);
        });
      };

      if (eventType === 'DELETE') {
        const id = oldRecord.id as string;
        if (id) removeCard(id);
        return { ...prev, events: nextEvents, abBuckets: nextBuckets };
      }

      if (eventType === 'INSERT' || eventType === 'UPDATE') {
        const card = newRecord as Card;

        // First remove existing instance to avoid duplicates/stale data
        removeCard(card.id);

        // Determine where to put the card
        if (card.due_date) {
          // It's a timeline event
          const startMinutes = getMinutesFromTime(card.due_start);
          const endMinutes = getMinutesFromTime(card.due_end);
          const durationMinutes = startMinutes != null && endMinutes != null
            ? Math.max(endMinutes - startMinutes, 15)
            : 60;

          nextEvents.push({
            card_id: card.id,
            due_date: card.due_date,
            due_start: card.due_start,
            due_end: card.due_end,
            durationMinutes,
            title: card.title,
            tags: card.tags ?? [],
            priority: card.priority,
            checked: card.checked,
            short_id: card.short_id,
            slug: card.slug,
          });

          // Sort events
          nextEvents.sort((a, b) => {
            if (a.due_date === b.due_date) {
              const aStart = getMinutesFromTime(a.due_start) ?? 0;
              const bStart = getMinutesFromTime(b.due_start) ?? 0;
              return aStart - bStart;
            }
            return (a.due_date ?? '').localeCompare(b.due_date ?? '');
          });

        } else if (card.due_bucket) {
          // It's a bucket item
          const bucketKey = card.due_bucket;
          if (!nextBuckets[bucketKey]) nextBuckets[bucketKey] = [];

          nextBuckets[bucketKey].push({
            card_id: card.id,
            title: card.title,
            due_date: null,
            due_start: card.due_start,
            due_end: card.due_end,
            checked: card.checked,
            tags: card.tags ?? [],
            short_id: card.short_id,
            slug: card.slug,
            bucketPosition: card.due_bucket_position,
          });

          // Sort bucket items
          nextBuckets[bucketKey].sort((a, b) => (b.bucketPosition ?? 0) - (a.bucketPosition ?? 0));
        }
      }

      return { ...prev, events: nextEvents, abBuckets: nextBuckets };
    });
  }, []);

  const { realtimeStatus } = useRealtimeBoard(initialBoard.id, {
    onCardChange: handleCardChange,
    upsertComment,
    removeComment
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const searchParamsString = searchParams?.toString() ?? '';

  useEffect(() => {
    setAvailableBoards((prev) => {
      const exists = prev.some((board) => board.id === initialBoard.id);
      if (exists) {
        return prev.map((board) => (board.id === initialBoard.id ? initialBoard : board));
      }
      return [initialBoard, ...prev];
    });
  }, [initialBoard]);

  useEffect(() => {
    let cancel = false;
    const loadBoards = async () => {
      try {
        const response = await fetch('/api/boards', { cache: 'no-store' });
        if (!response.ok) {
          return;
        }
        const body = await response.json().catch(() => null);
        if (!body || cancel) return;
        const boards: Board[] = Array.isArray(body.boards) ? body.boards : [];
        if (!boards.length) return;
        setAvailableBoards((prev) => {
          const map = new Map(prev.map((board) => [board.id, board]));
          boards.forEach((board) => {
            map.set(board.id, board);
          });
          if (!map.has(initialBoard.id)) {
            map.set(initialBoard.id, initialBoard);
          }
          return Array.from(map.values());
        });
      } catch (error) {
        console.warn('[timeline] failed to load boards', error);
      }
    };
    loadBoards();
    return () => {
      cancel = true;
    };
  }, [initialBoard]);

  const fetchTimeline = useCallback(async () => {
    if (!initialBoard?.id) return;
    setStatus('loading');
    setErrorMessage(null);
    try {
      traceRef.current?.mark('fetch:start');
      const response = await fetch(`/api/boards/${initialBoard.id}/timeline`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error?.message || 'Failed to load timeline');
      }
      const payload = (await response.json()) as TimelineResponse;
      setData(payload);
      setDataMode('api');
      setStatus('idle');
      const abItemCount = Object.values(payload.abBuckets || {}).reduce(
        (sum, items) => sum + (items?.length ?? 0),
        0
      );
      traceRef.current?.mark('render:complete');
      traceRef.current?.finish('success', {
        eventsCount: payload.events.length,
        abItems: abItemCount,
      });
      traceRef.current = createClientTrace('timeline');
    } catch (error) {
      console.warn('[timeline] fetch failed, rendering mock data', error);
      setErrorMessage('Showing sample schedule until sync succeeds');
      setData(buildMockTimeline());
      setDataMode('mock');
      setStatus('idle');
      traceRef.current?.finish('error', { reason: 'fetch_failed' });
      traceRef.current = createClientTrace('timeline');
    }
  }, [initialBoard?.id]);

  useEffect(() => {
    fetchTimeline();
  }, [fetchTimeline]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!boardMenuRef.current) return;
      if (!boardMenuRef.current.contains(event.target as Node)) {
        setShowBoardMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const updateHeight = () => {
      setViewportHeight(window.innerHeight);
    };
    updateHeight();
    window.addEventListener('resize', updateHeight);
    return () => window.removeEventListener('resize', updateHeight);
  }, []);

  const closeCardModal = useCallback(() => {
    const params = new URLSearchParams(searchParamsString);
    if (params.has('card')) {
      params.delete('card');
      const query = params.toString();
      const target = query ? `${pathname}?${query}` : pathname;
      router.replace(target, { scroll: false });
    }
    cardModalShortIdRef.current = null;
    setModalCard(null);
    setModalProfiles([]);
    setCardModalStatus('idle');
    setCardModalError(null);
  }, [pathname, router, searchParamsString]);

  const handleCardModalSave = useCallback(
    async (
      id: string,
      title: string,
      description: string,
      tags?: string[],
      due_date?: string | null,
      priority?: Priority,
      assigneeIds?: string[],
      assigneeTouched?: boolean,
      due_start?: string | null,
      due_end?: string | null,
      due_channel?: DueChannel,
      due_bucket?: DueBucket | null,
      due_bucket_position?: number | null
    ) => {
      const targetCard = modalCard && modalCard.id === id ? modalCard : null;
      if (!targetCard) return;
      try {
        const nextAssignee = assigneeIds && assigneeIds.length > 0 ? assigneeIds[0] : null;
        let normalizedDueDate: string | null = null;
        if (due_date) {
          const parsed = new Date(due_date);
          if (!Number.isNaN(parsed.getTime())) {
            normalizedDueDate = parsed.toISOString();
          }
        }
        const payload: Record<string, unknown> = {
          title,
          description,
          tags,
          due_date: normalizedDueDate,
          due_start,
          due_end,
          due_channel,
          due_bucket,
          due_bucket_position,
          priority,
          slug: slugify(title),
        };
        if (assigneeTouched) {
          payload.assignee_id = nextAssignee;
          payload.assigned_to = null;
        }
        const response = await fetch(`/api/boards/${targetCard.board_id}/cards/${targetCard.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.error?.message || 'Failed to update card');
        }
        const body = await response.json().catch(() => null);
        if (body?.card) {
          setModalCard(body.card as Card);
        }
        await fetchTimeline();
      } catch (error) {
        console.error('[timeline] save card failed', error);
        setCardModalError(error instanceof Error ? error.message : 'Failed to save card');
      } finally {
        closeCardModal();
      }
    },
    [modalCard, closeCardModal, fetchTimeline]
  );

  const handleCardModalDelete = useCallback(
    async (cardId: string) => {
      const targetCard = modalCard && modalCard.id === cardId ? modalCard : null;
      if (!targetCard) return;
      try {
        const response = await fetch(`/api/boards/${targetCard.board_id}/cards/${targetCard.id}`, {
          method: 'DELETE',
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.error?.message || 'Failed to delete card');
        }
        await fetchTimeline();
      } catch (error) {
        console.error('[timeline] delete card failed', error);
        setCardModalError(error instanceof Error ? error.message : 'Failed to delete card');
      } finally {
        closeCardModal();
      }
    },
    [modalCard, closeCardModal, fetchTimeline]
  );

  const handleCardModalMove = useCallback((cardId: string, targetBoardId: string) => {
    console.warn('[timeline] move card not yet supported', { cardId, targetBoardId });
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(searchParamsString);
    const shortId = params.get('card');
    if (!shortId) {
      cardModalShortIdRef.current = null;
      setModalCard(null);
      setModalProfiles([]);
      setCardModalStatus('idle');
      setCardModalError(null);
      return;
    }
    if (cardModalShortIdRef.current === shortId && (cardModalStatus === 'ready' || cardModalStatus === 'loading')) {
      return;
    }
    cardModalShortIdRef.current = shortId;

    let cancelled = false;
    const loadCard = async () => {
      setCardModalStatus('loading');
      setCardModalError(null);
      try {
        const response = await fetch(`/api/cards/${shortId}`);
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.error?.message || 'Failed to load card');
        }
        const body = await response.json();
        if (cancelled) return;
        setModalCard(body.card ?? null);
        setModalProfiles(body.profiles ?? []);
        setCardModalStatus(body.card ? 'ready' : 'error');
        if (!body.card) {
          setCardModalError('Card not found');
        }
      } catch (error) {
        if (cancelled) return;
        console.error('[timeline] failed to load card', error);
        setCardModalError(error instanceof Error ? error.message : 'Failed to load card');
        setCardModalStatus('error');
      }
    };

    loadCard();
    return () => {
      cancelled = true;
    };
  }, [searchParamsString]);

  const filteredData = useMemo(() => {
    if (!data) return null;

    // Convert TimelineEvents and BucketItems back to Cards for filtering
    // This is a bit inefficient but reuses the shared logic.
    // Ideally filterAndSortCards should be generic or we should adapt the data.
    // For now, we'll filter the arrays directly using the same logic as filterAndSortCards but inline or adapted.

    const filterItem = (item: { title: string; tags: string[]; priority?: string | null; checked: boolean }) => {
      // Search
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        if (!item.title.toLowerCase().includes(query)) return false;
      }
      // Tags
      if (selectedTags.length > 0) {
        if (!selectedTags.every(tag => item.tags.includes(tag))) return false;
      }
      // Priority (only for events that have priority, buckets might not?)
      if (selectedPriority !== 'all') {
        if (item.priority !== selectedPriority) return false;
      }
      return true;
    };

    const filteredEvents = data.events.filter(event => filterItem(event));

    const filteredBuckets = Object.entries(data.abBuckets).reduce((acc, [key, items]) => {
      acc[key] = items.filter(item => filterItem({ ...item, priority: null })); // Bucket items don't have priority in the interface usually?
      return acc;
    }, {} as Record<string, TimelineBucketItem[]>);

    return {
      ...data,
      events: filteredEvents,
      abBuckets: filteredBuckets,
    };
  }, [data, searchQuery, selectedTags, selectedPriority]);

  const nowMinutes = useMemo(() => (data ? getNowMinutesJst(data.serverNow) : null), [data]);
  const indicatorMinutes = liveNowMinutes ?? nowMinutes;
  const indicatorTop = indicatorMinutes != null ? minuteToPixels(indicatorMinutes) : null;
  const indicatorDayIso = liveNowIsoDate ?? (data ? getIsoDateJst(data.serverNow) : null);

  useEffect(() => {
    if (!data) return;
    const updateNow = () => {
      const nowIso = new Date().toISOString();
      setLiveNowMinutes(getNowMinutesJst(nowIso));
      setLiveNowIsoDate(getIsoDateJst(nowIso));
    };
    updateNow();
    const interval = window.setInterval(updateNow, 60_000);
    return () => window.clearInterval(interval);
  }, [data]);

  useEffect(() => {
    if (!timelineScrollRef.current || indicatorMinutes == null || hasAutoScrolled) return;
    const container = timelineScrollRef.current;
    const target = minuteToPixels(indicatorMinutes) - container.clientHeight / 2;
    const clamped = Math.max(0, Math.min(target, TIMELINE_HEIGHT - container.clientHeight));
    container.scrollTop = clamped;
    setHasAutoScrolled(true);
  }, [indicatorMinutes, hasAutoScrolled]);

  useEffect(() => {
    const headerEl = timelineHeaderRef.current;
    if (!headerEl) return;
    const updateHeight = () => setTimelineHeaderHeight(headerEl.offsetHeight);
    updateHeight();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateHeight);
      return () => window.removeEventListener('resize', updateHeight);
    }
    const observer = new ResizeObserver(() => updateHeight());
    observer.observe(headerEl);
    return () => observer.disconnect();
  }, [data?.days?.length]);

  const applyPatch = useCallback(
    async (cardId: string, payload: Record<string, unknown>) => {
      if (dataMode !== 'api') return;
      try {
        console.log('[timeline] patch', cardId, payload);
        const response = await fetch(`/api/boards/${initialBoard.id}/cards/${cardId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          console.error('[timeline] patch failed', response.status, body);
          throw new Error(body?.error?.message || 'Patch failed');
        }
        fetchTimeline();
      } catch (error) {
        console.error('[timeline] update error', error);
        setErrorMessage('Failed to update card');
      }
    },
    [dataMode, fetchTimeline, initialBoard.id]
  );

  const persistPlacement = useCallback(
    (cardId: string, payload: Record<string, unknown>, meta: PlacementMeta) => {
      setData((current) => {
        if (!current) return current;

        const nextEvents = [...current.events];
        const nextBuckets = Object.entries(current.abBuckets || {}).reduce(
          (acc, [key, items]) => {
            acc[key] = [...(items ?? [])];
            return acc;
          },
          {} as Record<string, TimelineBucketItem[]>
        );

        let removedBucketItem: TimelineBucketItem | null = null;
        Object.values(nextBuckets).forEach((items) => {
          const index = items.findIndex((item) => item.card_id === cardId);
          if (index >= 0) {
            removedBucketItem = items[index];
            items.splice(index, 1);
          }
        });

        let removedEvent: TimelineEvent | null = null;
        const eventIndex = nextEvents.findIndex((event) => event.card_id === cardId);
        if (eventIndex >= 0) {
          removedEvent = nextEvents.splice(eventIndex, 1)[0];
        }

        const baseEvent = removedEvent ?? meta.sourceEvent ?? null;
        const baseBucketItem = removedBucketItem ?? meta.sourceBucketItem ?? null;

        const payloadDueDate = (payload.due_date as string | null) ?? null;

        if (meta.target === 'timeline') {
          const nextStart = (payload.due_start as string | null) ?? baseEvent?.due_start ?? baseBucketItem?.due_start ?? null;
          const nextEnd = (payload.due_end as string | null) ?? baseEvent?.due_end ?? baseBucketItem?.due_end ?? null;
          const nextDate = meta.localDueDate ?? toLocalDay(payloadDueDate) ?? baseEvent?.due_date ?? baseBucketItem?.due_date ?? null;
          const startMinutes = getMinutesFromTime(nextStart);
          const endMinutes = getMinutesFromTime(nextEnd);
          const durationMinutes =
            startMinutes != null && endMinutes != null
              ? Math.max(endMinutes - startMinutes, 15)
              : baseEvent?.durationMinutes ?? meta.defaultDuration ?? 60;

          const replacement: TimelineEvent = {
            card_id: cardId,
            due_date: nextDate ?? '',
            due_start: nextStart,
            due_end: nextEnd,
            durationMinutes,
            title: baseEvent?.title ?? baseBucketItem?.title ?? 'Untitled card',
            tags: baseEvent?.tags ?? baseBucketItem?.tags ?? [],
            priority: baseEvent?.priority ?? null,
            checked: baseEvent?.checked ?? baseBucketItem?.checked ?? false,
            short_id: baseEvent?.short_id ?? baseBucketItem?.short_id ?? null,
            slug: baseEvent?.slug ?? baseBucketItem?.slug ?? null,
          };

          nextEvents.push(replacement);
          nextEvents.sort((a, b) => {
            if (a.due_date === b.due_date) {
              const aStart = getMinutesFromTime(a.due_start) ?? 0;
              const bStart = getMinutesFromTime(b.due_start) ?? 0;
              return aStart - bStart;
            }
            return (a.due_date ?? '').localeCompare(b.due_date ?? '');
          });

          return { ...current, events: nextEvents, abBuckets: nextBuckets };
        }

        if (meta.target === 'bucket' && meta.bucketKey) {
          if (!nextBuckets[meta.bucketKey]) {
            nextBuckets[meta.bucketKey] = [];
          }

          const bucketItems = nextBuckets[meta.bucketKey];
          const bucketPosition = (payload.due_bucket_position as number | null) ?? Date.now();
          const nextBucketItem: TimelineBucketItem = {
            card_id: cardId,
            title: baseBucketItem?.title ?? baseEvent?.title ?? 'Untitled card',
            due_date: meta.localDueDate ?? toLocalDay(payloadDueDate) ?? baseBucketItem?.due_date ?? null,
            due_start: (payload.due_start as string | null) ?? null,
            due_end: (payload.due_end as string | null) ?? null,
            checked: baseBucketItem?.checked ?? baseEvent?.checked ?? false,
            tags: baseBucketItem?.tags ?? baseEvent?.tags ?? [],
            short_id: baseBucketItem?.short_id ?? baseEvent?.short_id ?? null,
            slug: baseBucketItem?.slug ?? baseEvent?.slug ?? null,
            bucketPosition,
          };

          bucketItems.unshift(nextBucketItem);
          bucketItems.sort((a, b) => (b.bucketPosition ?? 0) - (a.bucketPosition ?? 0));
          return { ...current, events: nextEvents, abBuckets: nextBuckets };
        }

        return current;
      });

      if (dataMode === 'api') {
        applyPatch(cardId, payload);
      }
    },
    [applyPatch, dataMode]
  );

  const openCardModalFromTimeline = useCallback((shortId: string | null, debugSource?: string) => {
    if (dataMode !== 'api') return;
    if (!shortId) return;
    console.log('[timeline] openCardModal', { shortId, source: debugSource });
    if (canonicalBoardPath) {
      router.push(`${canonicalBoardPath}?card=${shortId}`);
    } else {
      router.push(`/c/${shortId}`);
    }
  }, [canonicalBoardPath, dataMode, router]);

  const handleBoardNavigate = useCallback(
    (board: Board) => {
      const target = buildBoardUrl(board);
      if (target) {
        router.push(target);
      } else if (board.short_id) {
        router.push(`/b/${board.short_id}`);
      } else {
        router.push(`/board?boardId=${board.id}`);
      }
      setShowBoardMenu(false);
    },
    [router]
  );

  const availableTags = useMemo(() => {
    const tags = new Set<string>();
    data?.events?.forEach((event) => {
      (event.tags ?? []).forEach((tag) => tags.add(tag));
    });
    Object.values(data?.abBuckets ?? {}).forEach((items) => {
      (items ?? []).forEach((item) => (item.tags ?? []).forEach((tag) => tags.add(tag)));
    });
    return Array.from(tags).sort();
  }, [data?.events, data?.abBuckets]);

  const filteredEvents = useMemo(() => {
    if (!data?.events?.length) return [] as TimelineEvent[];
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const hasQuery = normalizedQuery.length > 0;
    const hasTags = selectedTags.length > 0;

    return data.events.filter((event) => {
      if (selectedPriority !== 'all' && event.priority !== selectedPriority) {
        return false;
      }
      if (hasTags) {
        const tagSet = new Set(event.tags ?? []);
        const matchesAll = selectedTags.every((tag) => tagSet.has(tag));
        if (!matchesAll) return false;
      }
      if (hasQuery) {
        const source = `${event.title ?? ''} ${(event.tags ?? []).join(' ')}`.toLowerCase();
        if (!source.includes(normalizedQuery)) {
          return false;
        }
      }
      return true;
    });
  }, [data?.events, searchQuery, selectedPriority, selectedTags]);

  const filteredBuckets = useMemo(() => {
    const result: Record<string, TimelineBucketItem[]> = {};
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const hasQuery = normalizedQuery.length > 0;
    const hasTags = selectedTags.length > 0;
    Object.entries(data?.abBuckets ?? {}).forEach(([key, items]) => {
      result[key] = (items ?? []).filter((item) => {
        if (selectedPriority !== 'all') {
          // Bucket items currently lack priority metadata; treat as non-matching when filtering by priority
          return false;
        }
        if (hasTags) {
          const tagSet = new Set(item.tags ?? []);
          const matchesAll = selectedTags.every((tag) => tagSet.has(tag));
          if (!matchesAll) return false;
        }
        if (hasQuery) {
          const source = `${item.title ?? ''} ${(item.tags ?? []).join(' ')}`.toLowerCase();
          if (!source.includes(normalizedQuery)) {
            return false;
          }
        }
        return true;
      });
    });
    return result;
  }, [data?.abBuckets, searchQuery, selectedPriority, selectedTags]);

  const eventsByDay = useMemo(() => {
    if (!data) return {} as Record<string, TimelineEvent[]>;
    return data.days.reduce((acc, day) => {
      acc[day.isoDate] = filteredEvents.filter((event) => event.due_date === day.isoDate);
      return acc;
    }, {} as Record<string, TimelineEvent[]>);
  }, [data, filteredEvents]);

  const bucketDayMap = useMemo(() => {
    if (!data?.days?.length) return {} as Record<string, string | null>;
    return {
      today_a: data.days[0]?.isoDate ?? null,
      today_b: data.days[0]?.isoDate ?? null,
      tomorrow_a: data.days[1]?.isoDate ?? null,
      tomorrow_b: data.days[1]?.isoDate ?? null,
    };
  }, [data?.days]);

  const handleDragStart = (event: DragStartEvent) => {
    const cardId = event.active.data.current?.cardId as string | undefined;
    if (!cardId) return;
    const kind = event.active.data.current?.kind as 'event' | 'bucket';
    console.log('[timeline] drag start', { cardId, kind });
    if (kind === 'event') {
      const eventData = event.active.data.current?.event as TimelineEvent;
      const startMinutes = getMinutesFromTime(eventData?.due_start ?? null) ?? 0;
      const duration = Math.max(eventData.durationMinutes ?? 60, 15);
      const dragState: ActiveDragState = { cardId, startMinutes, duration };
      setActiveDrag(dragState);
      activeDragRef.current = dragState;
    } else {
      const dragState: ActiveDragState = { cardId, startMinutes: 9 * 60, duration: 60 };
      setActiveDrag(dragState);
      activeDragRef.current = dragState;
    }
    setPointerPreview(HIDDEN_POINTER_PREVIEW);
  };

  const handleDragMove = (event: DragMoveEvent) => {
    const currentDrag = activeDragRef.current;
    if (!currentDrag) {
      if (pointerPreview.visible) {
        setPointerPreview(HIDDEN_POINTER_PREVIEW);
      }
      return;
    }
    const overType = event.over?.data.current?.type;
    if (overType !== 'timeline-column') {
      if (pointerPreview.visible) {
        setPointerPreview(HIDDEN_POINTER_PREVIEW);
      }
      return;
    }
    const day = event.over?.data.current?.day as TimelineDay | undefined;
    const scrollTop = timelineScrollRef.current?.scrollTop ?? 0;
    const pointerY = event.activatorEvent instanceof PointerEvent ? event.activatorEvent.clientY : null;
    const pointerMinutes = pointerMinutesFromEvent(event, {
      scrollTop,
      columnRect: event.over?.rect
        ? { top: event.over.rect.top, height: event.over.rect.height }
        : undefined,
    });
    const fallbackPointer = currentDrag.startMinutes + (event.delta.y / HOUR_HEIGHT) * 60;
    let nextStart = pointerMinutes ?? fallbackPointer;
    nextStart = Math.round(nextStart / 15) * 15;
    nextStart = Math.max(0, Math.min(23 * 60 + 45, nextStart));
    const desiredEnd = nextStart + currentDrag.duration;
    const endMinutes = Math.min(desiredEnd, 24 * 60 - 1);
    const durationMinutes = Math.max(endMinutes - nextStart, 1);
    setPointerPreview({
      visible: true,
      startMinutes: nextStart,
      durationMinutes,
      dayIso: day?.isoDate ?? null,
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over, delta } = event;
    setActiveDrag(null);
    activeDragRef.current = null;
    setPointerPreview(HIDDEN_POINTER_PREVIEW);

    if (!over) return;
    const cardId = active.data.current?.cardId as string | undefined;
    if (!cardId) return;

    const sourceEvent = active.data.current?.event as TimelineEvent | undefined;
    const sourceBucketItem = active.data.current?.item as TimelineBucketItem | undefined;

    const overType = over.data.current?.type;

    console.log('[timeline] drag end', {
      cardId,
      overType,
      from: active.data.current?.kind,
      data: active.data.current,
    });

    if (overType === 'bucket-item') {
      const bucketKey = over.data.current?.bucketKey as string | undefined;
      const targetCardId = over.data.current?.cardId as string | undefined;
      if (!bucketKey || !targetCardId) return;
      const bucketItems = data?.abBuckets?.[bucketKey];
      if (!bucketItems?.length) return;
      if (targetCardId === cardId && active.data.current?.bucketKey === bucketKey) {
        return;
      }
      const targetIndex = bucketItems.findIndex((item) => item.card_id === targetCardId);
      if (targetIndex === -1) return;
      const targetItem = bucketItems[targetIndex];
      const prevItem = bucketItems[targetIndex - 1];
      let bucketPosition: number;
      if (prevItem?.bucketPosition != null && targetItem.bucketPosition != null) {
        bucketPosition = (prevItem.bucketPosition + targetItem.bucketPosition) / 2;
      } else if (targetItem.bucketPosition != null) {
        bucketPosition = targetItem.bucketPosition + 1;
      } else if (prevItem?.bucketPosition != null) {
        bucketPosition = prevItem.bucketPosition + 1;
      } else {
        bucketPosition = Date.now();
      }
      const dayIso = bucketDayMap[bucketKey] ?? null;
      const payload = {
        due_channel: 'ab-list',
        due_bucket: bucketKey,
        due_date: withJstMidnight(dayIso),
        due_start: null,
        due_end: null,
        due_bucket_position: bucketPosition,
      };
      console.debug('[timeline] drop into bucket-item', { cardId, bucketKey, bucketPosition });
      persistPlacement(cardId, payload, {
        target: 'bucket',
        bucketKey,
        sourceEvent,
        sourceBucketItem,
        localDueDate: dayIso,
      });
      return;
    }

    if (overType === 'timeline-column' && activeDrag) {
      const day = over.data.current?.day as TimelineDay | undefined;
      if (!day) return;
      const scrollTop = timelineScrollRef.current?.scrollTop ?? 0;
      const pointerY = event.activatorEvent instanceof PointerEvent ? event.activatorEvent.clientY : null;
      const pointerMinutes = pointerMinutesFromEvent(event, {
        scrollTop,
        columnRect: over.rect ? { top: over.rect.top, height: over.rect.height } : undefined,
      });
      const fallbackPointer = activeDrag.startMinutes + (delta.y / HOUR_HEIGHT) * 60;
      let nextStart = pointerMinutes ?? fallbackPointer;
      nextStart = Math.round(nextStart / 15) * 15;
      nextStart = Math.max(0, Math.min(23 * 60 + 45, nextStart));
      let nextEnd = nextStart + activeDrag.duration;

      const payload = {
        due_channel: 'timeline',
        due_bucket: null,
        due_date: withJstMidnight(day.isoDate),
        due_start: minutesToTime(nextStart),
        due_end: minutesToTime(Math.min(nextEnd, 24 * 60 - 1)),
        due_bucket_position: null,
      };
      console.debug('[timeline] drop into timeline', { cardId, day: day.isoDate, start: nextStart });
      persistPlacement(cardId, payload, {
        target: 'timeline',
        sourceEvent,
        sourceBucketItem,
        defaultDuration: activeDrag.duration,
        localDueDate: day.isoDate,
      });
      return;
    }

    if (overType === 'ab-bucket') {
      const bucketKey = over.data.current?.bucketKey as string;
      const dayIso = bucketDayMap[bucketKey] ?? null;
      const bucketPosition = Date.now();
      const payload = {
        due_channel: 'ab-list',
        due_bucket: bucketKey,
        due_date: withJstMidnight(dayIso),
        due_start: null,
        due_end: null,
        due_bucket_position: bucketPosition,
      };
      console.debug('[timeline] drop into bucket', { cardId, bucketKey, bucketPosition });
      persistPlacement(cardId, payload, {
        target: 'bucket',
        bucketKey,
        sourceEvent,
        sourceBucketItem,
        localDueDate: dayIso,
        defaultDuration: activeDrag?.duration,
      });
    }
  };

  const handleDragCancel = () => {
    setActiveDrag(null);
    activeDragRef.current = null;
    setPointerPreview(HIDDEN_POINTER_PREVIEW);
  };

  const handleEventKeyDown = (
    event: TimelineEvent,
    native: ReactKeyboardEvent<HTMLElement>
  ) => {
    if (!['ArrowUp', 'ArrowDown'].includes(native.key)) return;
    native.preventDefault();
    const direction = native.key === 'ArrowUp' ? -15 : 15;
    const startMinutes = getMinutesFromTime(event.due_start ?? null) ?? 0;
    const duration = event.durationMinutes ?? 60;
    const nextStart = Math.max(0, Math.min(23 * 60 + 45, startMinutes + direction));
    const nextEnd = nextStart + duration;
    persistPlacement(
      event.card_id,
      {
        due_channel: 'timeline',
        due_bucket: null,
        due_date: withJstMidnight(event.due_date ?? null),
        due_start: minutesToTime(nextStart),
        due_end: minutesToTime(Math.min(nextEnd, 24 * 60 - 1)),
        due_bucket_position: null,
      },
      {
        target: 'timeline',
        sourceEvent: event,
        defaultDuration: duration,
        localDueDate: event.due_date ?? null,
      }
    );
  };

  const pointerPreviewVisible = pointerPreview.visible;
  const pointerPreviewY = minuteToPixels(pointerPreview.startMinutes);
  const pointerPreviewDuration = pointerPreview.durationMinutes;
  const pointerPreviewDay = pointerPreview.dayIso;
  const pointerPreviewStart = pointerPreviewVisible
    ? minutesToTime(pointerPreview.startMinutes)
    : null;
  const pointerPreviewEnd = pointerPreviewVisible
    ? minutesToTime(Math.min(pointerPreview.startMinutes + pointerPreview.durationMinutes, 24 * 60 - 1))
    : null;
  const floatingLayerTop = timelineHeaderHeight + 12;
  const timelineViewportHeight = useMemo(() => {
    if (viewportHeight == null) return TIMELINE_HEIGHT;
    const chrome = timelineHeaderHeight + 160; // header + padding
    const available = viewportHeight - chrome;
    const clamped = Math.max(TIMELINE_MIN_VIEWPORT, available);
    return Math.min(TIMELINE_HEIGHT, clamped);
  }, [timelineHeaderHeight, viewportHeight]);
  const modalBoards = useMemo(() => {
    if (!availableBoards.length) {
      return [initialBoard];
    }
    const map = new Map<string, Board>();
    availableBoards.forEach((board) => {
      map.set(board.id, board);
    });
    if (!map.has(initialBoard.id)) {
      map.set(initialBoard.id, initialBoard);
    }
    return Array.from(map.values());
  }, [availableBoards, initialBoard]);

  const displayData = filteredData ?? data;
  const events = displayData?.events ?? [];
  const abBuckets = displayData?.abBuckets ?? {};

  const shouldShowCardModal = modalCard && cardModalStatus !== 'idle';
  const hasActiveFilters = Boolean(
    searchQuery.trim() || selectedTags.length > 0 || selectedPriority !== 'all'
  );

  const allTags = useMemo(() => {
    if (!data) return [];
    const tagsSet = new Set<string>();
    data.events.forEach(e => e.tags.forEach(t => tagsSet.add(t)));
    Object.values(data.abBuckets).forEach(items => items.forEach(i => i.tags.forEach(t => tagsSet.add(t))));
    return Array.from(tagsSet).sort();
  }, [data]);

  const renderEvent = (event: TimelineEvent) => {
    const start = getMinutesFromTime(event.due_start ?? null) ?? 0;
    const duration = Math.max(event.durationMinutes ?? 60, 30);
    const top = minuteToPixels(start);
    const height = Math.max(minuteToPixels(duration), 32);

    return (
      <DraggableCard
        key={event.card_id}
        id={`event:${event.card_id}`}
        data={{ kind: 'event', event, cardId: event.card_id }}
        attachListenersToChild
      >
        <div
          role="group"
          tabIndex={0}
          onKeyDown={(native) => handleEventKeyDown(event, native)}
          data-testid="timeline-event"
          className="absolute left-4 right-4 flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
          style={{ top, height }}
        >
          <div className="flex items-start gap-2">
            <span
              aria-hidden="true"
              className={clsx(
                'flex h-3.5 w-3.5 items-center justify-center rounded border text-[8px] font-bold',
                event.checked ? 'border-sky-500 bg-sky-500 text-white' : 'border-slate-300 bg-white text-transparent'
              )}
            >
              ✓
            </span>
            <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-1 text-[11px] font-semibold text-slate-800">
              <span className="min-w-0 flex-1 break-words leading-tight">
                {event.title || 'Untitled card'}
              </span>
              <span
                className="text-[10px] font-semibold text-slate-500 whitespace-nowrap"
                title={timeLabel(event.due_start, event.due_end)}
              >
                {timeLabel(event.due_start, event.due_end)}
              </span>
            </div>
            <button
              type="button"
              onClick={(native) => {
                native.stopPropagation();
                openCardModalFromTimeline(event.short_id, 'event-button');
              }}
              onPointerDown={(native) => {
                native.stopPropagation();
              }}
              className="ml-1 flex h-6 w-6 flex-shrink-0 items-center justify-center self-start rounded-full border border-slate-200 text-[10px] font-semibold text-slate-500 hover:border-sky-300 hover:text-sky-600"
              aria-label="Open card"
              data-testid={`cardOpenButton-${event.card_id}`}
            >
              ↗
            </button>
          </div>
        </div>
      </DraggableCard>
    );
  };

  const renderAbCard = (day: TimelineDay) => {
    const meta = AB_CARD_META[day.key];
    if (!meta) return null;

    return (
      <div className="pointer-events-auto rounded-2xl border border-slate-100 bg-white/95 p-4 shadow-xl ring-1 ring-black/5 backdrop-blur">
        <div className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-500">
          <span>{meta.title}</span>
          <span>{day.isoDate}</span>
        </div>
        <div className="mt-3 space-y-4">
          {meta.sections.map((section) => {
            const items = abBuckets[section.bucket] ?? [];
            return (
              <DroppableBucket key={section.bucket} bucketKey={section.bucket} disabled={status === 'loading'}>
                <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3 shadow-inner">
                  <p className="text-[11px] font-semibold text-slate-600">{section.label}</p>
                  <p className="text-[10px] text-slate-400">{section.helper}</p>
                  <div className="mt-2 space-y-1">
                    {items.length === 0 ? (
                      <p className="text-[11px] text-slate-400">Drop cards here</p>
                    ) : (
                      items.slice(0, 3).map((item) => (
                        <AbBucketDraggableCard
                          key={item.card_id}
                          item={item}
                          bucketKey={section.bucket}
                          openCardModal={(shortId) => openCardModalFromTimeline(shortId, 'bucket-list')}
                        />
                      ))
                    )}
                    {items.length > 3 && (
                      <p className="text-[10px] text-slate-400">and {items.length - 3} more…</p>
                    )}
                  </div>
                </div>
              </DroppableBucket>
            );
          })}
        </div>
      </div>
    );
  };

  const renderColumn = (day: TimelineDay, index: number) => {
    const events = eventsByDay[day.isoDate] ?? [];
    const indicatorVisibleInDay = indicatorTop != null && indicatorDayIso === day.isoDate;
    const indicatorPosition = indicatorTop ?? 0;
    const isFirstColumn = index === 0;

    return (
      <DroppableColumn key={day.isoDate} day={day}>
        <div className="relative h-full border-l border-slate-100 px-4 pb-8" style={{ minHeight: timelineViewportHeight }}>
          <div
            className="pointer-events-none absolute"
            style={{ height: TIMELINE_HEIGHT, left: isFirstColumn ? -2 : 0, right: 0, top: 0 }}
          >
            {HOURS.map((hour, idx) => (
              <div
                key={hour}
                className={clsx(
                  'absolute left-0 right-0 border-b border-slate-200',
                  idx === 0 ? '' : 'border-dashed'
                )}
                style={{ top: idx * HOUR_HEIGHT }}
              />
            ))}
          </div>

          {indicatorVisibleInDay && (
            <div
              className="pointer-events-none absolute z-10"
              style={{ top: indicatorPosition, left: 0, right: 0 }}
            >
              <div className="relative h-px bg-red-400/80">
                <div className="absolute top-1/2 left-0 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500" />
              </div>
            </div>
          )}

          {activeDrag?.cardId && pointerPreviewVisible && pointerPreviewDay === day.isoDate && (
            <div
              className="pointer-events-none absolute left-4 right-4 z-10 border border-dashed border-sky-300 bg-sky-50/40"
              style={{
                top: pointerPreviewY,
                height: minuteToPixels(pointerPreviewDuration),
              }}
            >
              <div className="px-3 py-2 text-[10px] font-semibold text-slate-500">
                {timeLabel(pointerPreviewStart, pointerPreviewEnd)}
              </div>
            </div>
          )}

          <div className="relative" style={{ height: TIMELINE_HEIGHT }}>
            {events.map(renderEvent)}
          </div>
        </div>
      </DroppableColumn>
    );
  };

  const renderFloatingLayer = () => {
    if (!data?.days?.length) return null;
    const templateColumns = `80px repeat(${data.days.length}, minmax(0, 1fr))`;
    return (
      <div
        className="pointer-events-none sticky z-20 h-0 overflow-visible"
        style={{ top: floatingLayerTop }}
      >
        <div className="grid" style={{ gridTemplateColumns: templateColumns }}>
          <div />
          {data.days.map((day) => (
            <div key={day.key} className="relative flex justify-end px-2 sm:px-4">
              <div className="pointer-events-auto w-[210px] max-w-full sm:max-w-[220px]">
                {renderAbCard(day)}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="min-h-screen bg-[#f4f5f7] px-4 pb-10 pt-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-6">
          <TimelineHeader
            board={initialBoard}
            modalBoards={modalBoards}
            handleBoardNavigate={handleBoardNavigate}
            showBoardMenu={showBoardMenu}
            setShowBoardMenu={setShowBoardMenu}
            boardMenuRef={boardMenuRef}
            setShowShareDialog={setShowShareDialog}
            setShowNotificationSettings={setShowNotificationSettings}
            setShowProfileSettings={setShowProfileSettings}
            profile={profile}
            user={user}
            signOut={signOut}
            showFilters={showFilters}
            setShowFilters={setShowFilters}
            hasActiveFilters={hasActiveFilters}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            selectedTags={selectedTags}
            setSelectedTags={setSelectedTags}
            selectedPriority={selectedPriority}
            setSelectedPriority={setSelectedPriority}
            availableTags={availableTags}
          />

          <DndContext
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
            collisionDetection={bucketsFirstCollisionDetection}
          >
            <section className="rounded-3xl bg-white shadow-xl ring-1 ring-black/5">
              <div
                ref={timelineScrollRef}
                className="relative overflow-y-auto"
                style={{ height: timelineViewportHeight }}
              >
                <div
                  ref={timelineHeaderRef}
                  className="sticky top-0 z-30 grid border-b border-slate-100 bg-white text-xs font-semibold uppercase tracking-wide text-slate-500"
                  style={{
                    gridTemplateColumns: data?.days?.length
                      ? `80px repeat(${data.days.length}, minmax(0, 1fr))`
                      : '80px',
                  }}
                >
                  <div className="flex items-end justify-start border-r border-slate-100 px-3 py-3 text-left">
                    <span className="leading-none">GMT+09</span>
                  </div>
                  {data?.days?.map((day, index) => (
                    <div
                      key={day.key}
                      className={clsx(
                        'px-4 py-3 text-center',
                        index > 0 && 'border-l border-slate-100'
                      )}
                    >
                      <p className="text-slate-800">{day.label}</p>
                      <p className="text-[10px] text-slate-400">{day.isoDate}</p>
                    </div>
                  ))}
                </div>
                <div className="relative" style={{ minHeight: timelineViewportHeight }}>
                  {renderFloatingLayer()}
                  <div className="relative">
                    <div
                      className="grid"
                      data-timeline-grid
                      data-testid="timeline-grid"
                      style={{ gridTemplateColumns: data?.days?.length ? `80px repeat(${data.days.length}, minmax(0, 1fr))` : '80px' }}
                    >
                      <aside className="relative border-r border-slate-100 text-xs text-slate-500">
                        {HOURS.map((hour) => (
                          <div key={hour} className="flex h-10 items-start justify-end pr-3">
                            {hour === '00:00' ? null : (
                              <span className="-mt-1 leading-none tracking-tight text-slate-600">
                                {hour}
                              </span>
                            )}
                          </div>
                        ))}
                      </aside>
                      {data?.days?.map((day, index) => renderColumn(day, index))}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </DndContext>
        </div >
      </div >
      {showShareDialog && (
        <ShareDialog boardId={initialBoard.id} onClose={() => setShowShareDialog(false)} />
      )
      }
      {
        showNotificationSettings && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowNotificationSettings(false)}>
            <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-semibold">Notification Settings</h2>
                <button
                  onClick={() => setShowNotificationSettings(false)}
                  className="rounded-full p-2 text-slate-500 hover:bg-slate-100"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
              <NotificationSettings />
            </div>
          </div>
        )
      }
      {
        showProfileSettings && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowProfileSettings(false)}>
            <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-semibold">Profile Settings</h2>
                <button
                  onClick={() => setShowProfileSettings(false)}
                  className="rounded-full p-2 text-slate-500 hover:bg-slate-100"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
              <ProfileSettings onProfileUpdated={() => fetchTimeline()} />
            </div>
          </div>
        )
      }
      {
        shouldShowCardModal && modalCard && (
          <CardModal
            card={modalCard}
            boards={modalBoards}
            profiles={modalProfiles}
            onSave={handleCardModalSave}
            onDelete={handleCardModalDelete}
            onMoveToBoard={handleCardModalMove}
            onClose={closeCardModal}
          />
        )
      }
      {
        cardModalError && (
          <div className="fixed bottom-4 right-4 z-50 rounded-xl bg-black/80 px-4 py-2 text-sm text-white shadow-lg">
            {cardModalError}
          </div>
        )
      }
    </>
  );
}

const DroppableColumn = ({ children, day }: { children: ReactNode; day: TimelineDay }) => {
  const { setNodeRef } = useDroppable({ id: `day:${day.isoDate}`, data: { type: 'timeline-column', day } });
  return (
    <div ref={setNodeRef} className="relative h-full">
      {children}
    </div>
  );
};

const DroppableBucket = ({ children, bucketKey, disabled }: { children: ReactNode; bucketKey: string; disabled?: boolean }) => {
  const { setNodeRef, isOver } = useDroppable({ id: `bucket-drop:${bucketKey}`, data: { type: 'ab-bucket', bucketKey } });
  const highlight = !disabled && isOver ? 'rounded-2xl ring-2 ring-sky-300 ring-offset-2 ring-offset-slate-50' : '';
  return (
    <div ref={setNodeRef} className={highlight}>
      {children}
    </div>
  );
};

const DraggableCard = ({
  id,
  data,
  children,
  extraNodeRef,
  attachListenersToChild = false,
}: {
  id: string;
  data: Record<string, unknown>;
  children: ReactNode;
  extraNodeRef?: (node: HTMLElement | null) => void;
  attachListenersToChild?: boolean;
}) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id, data: { ...data, id } });
  const combinedRef = useCallback(
    (node: HTMLElement | null) => {
      setNodeRef(node);
      if (extraNodeRef) {
        extraNodeRef(node);
      }
    },
    [extraNodeRef, setNodeRef]
  );

  if (attachListenersToChild && isValidElement(children)) {
    const child = children as ReactElement;
    const mergedRef = (node: HTMLElement | null) => {
      combinedRef(node);
    };
    return cloneElement(child, {
      ref: mergedRef,
      style: {
        ...(child.props.style ?? {}),
        transform: CSS.Translate.toString(transform),
      },
      className: [child.props.className, isDragging ? 'z-30 opacity-80' : undefined].filter(Boolean).join(' '),
      ...listeners,
      ...attributes,
    });
  }

  return (
    <div
      ref={combinedRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={isDragging ? 'z-30 opacity-80' : undefined}
      {...listeners}
      {...attributes}
    >
      {children}
    </div>
  );
};

const AbBucketDraggableCard = ({
  item,
  bucketKey,
  openCardModal,
}: {
  item: TimelineBucketItem;
  bucketKey: string;
  openCardModal: (shortId: string | null) => void;
}) => {
  const { setNodeRef } = useDroppable({
    id: `bucket-item:${bucketKey}:${item.card_id}`,
    data: { type: 'bucket-item', bucketKey, cardId: item.card_id },
  });

  return (
    <DraggableCard
      id={`bucket:${item.card_id}`}
      data={{ kind: 'bucket', cardId: item.card_id, bucketKey, item }}
      extraNodeRef={setNodeRef}
    >
      <div
        className="rounded-md bg-white px-3 py-2 text-xs shadow-sm"
        data-testid={`ab-card-${item.card_id}`}
        data-bucket={bucketKey}
      >
        <div className="flex items-start gap-2 text-slate-700">
          <input
            type="checkbox"
            checked={item.checked}
            readOnly
            className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-sky-500"
          />
          <div className="flex min-w-0 flex-1 items-start gap-1">
            <div className="flex-1 text-left">
              <span className="block line-clamp-2">{item.title || 'Untitled card'}</span>
              {item.due_start && (
                <span className="text-[10px] text-slate-400">{timeLabel(item.due_start, item.due_end)}</span>
              )}
            </div>
            <button
              type="button"
              onClick={(native) => {
                native.stopPropagation();
                openCardModal(item.short_id);
              }}
              onPointerDown={(native) => {
                native.stopPropagation();
              }}
              className="flex h-6 w-6 flex-shrink-0 items-center justify-center self-start rounded-full border border-slate-200 text-[10px] font-semibold text-slate-500 hover:border-sky-300 hover:text-sky-600"
              aria-label="Open card"
              data-testid={`cardOpenButton-${item.card_id}`}
            >
              ↗
            </button>
          </div>
        </div>
      </div>
    </DraggableCard>
  );
};
