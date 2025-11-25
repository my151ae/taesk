"use client";

import { useCallback, useEffect, useMemo, useRef, useState, isValidElement, cloneElement, type ReactNode, type ReactElement, type KeyboardEvent as ReactKeyboardEvent } from "react";
import clsx from "clsx";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Board, Card, DueBucket, Priority, ProfileSummary } from "@/lib/supabase";
import { buildBoardUrl } from "@/lib/board-url";
import {
  DndContext,
  MeasuringStrategy,
} from "@dnd-kit/core";

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
import TimelineBuckets from "@/app/(board)/_components/timeline/TimelineBuckets";
import TimelineGrid from "@/app/(board)/_components/timeline/TimelineGrid";
import { DraggableCard } from "@/app/(board)/_components/timeline/TimelineDraggableCard";
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
  withJstMidnight,
  toLocalDay,

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
import { useTimelineDragAndDrop, bucketsFirstCollisionDetection } from "@/app/(board)/_hooks/useTimelineDragAndDrop";
import { normalizeDueBucket } from "@/lib/bucket-normalization";
import { useBoardMembersStore } from "@/app/(board)/_stores/board-members-store";
import { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { useCardModal } from "@/app/(board)/_hooks/useCardModal";

type TimelineBoardPageProps = {
  initialBoard: Board;
};

type DataMode = 'api' | 'mock';


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

const resolveBucketKey = (card: Card, days: TimelineDay[]) => {
  let normalizedBucket: DueBucket | null = null;
  try {
    normalizedBucket = normalizeDueBucket(card.due_bucket);
  } catch (error) {
    console.error('[timeline] invalid due_bucket received', {
      cardId: card.id,
      due_bucket: card.due_bucket,
      error,
    });
    return null;
  }

  if (!normalizedBucket) return null;

  const localDay = toLocalDay(card.due_date ?? null);
  const matchedDay = days?.find((day) => toLocalDay(day.isoDate) === localDay);

  if (matchedDay?.key) {
    return `${matchedDay.key}_${normalizedBucket}`;
  }

  if (days?.[0]?.key) {
    return `${days[0].key}_${normalizedBucket}`;
  }

  return null;
};

export default function TimelineBoardPage({ initialBoard }: TimelineBoardPageProps) {
  const [data, setData] = useState<TimelineResponse | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
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
  const [showBoardMenu, setShowBoardMenu] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const { user, signOut } = useAuth();

  const {
    modalCard,
    cardModalStatus,
    cardModalError,
    setCardModalError,
    isModalClosing,
    openCardModal,
    closeCardModal,
    modalProfiles,
  } = useCardModal({
    initialBoard,
    dataMode,
    data,
  });

  const fetchProfile = useCallback(async () => {
    if (!user) return;
    try {
      const response = await fetch('/api/profiles');
      if (response.ok) {
        const data = await response.json();
        setProfile(data);
      }
    } catch (error) {
      console.error('Failed to fetch profile:', error);
    }
  }, [user]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);
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
            assignee_id: card.assignee_id,
            assignee_ids: card.assignee_ids ?? null,
            assigned_to: card.assigned_to,
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
          const bucketKey = resolveBucketKey(card, prev.days);
          if (!bucketKey) {
            console.warn('[timeline] skip bucket item with unknown bucket', {
              cardId: card.id,
              due_bucket: card.due_bucket,
              due_date: card.due_date,
            });
            return prev;
          }

          if (!nextBuckets[bucketKey]) nextBuckets[bucketKey] = [];

          nextBuckets[bucketKey].push({
            card_id: card.id,
            title: card.title,
            due_date: toLocalDay(card.due_date ?? null),
            due_start: card.due_start,
            due_end: card.due_end,
            checked: card.checked,
            tags: card.tags ?? [],
            assignee_id: card.assignee_id,
            assignee_ids: card.assignee_ids ?? null,
            assigned_to: card.assigned_to,
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
      due_bucket?: DueBucket | null,
      due_bucket_position?: number | null
    ) => {
      // Use the memoized modalCard for targetCard
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
          due_bucket: normalizeDueBucket(due_bucket),
          due_bucket_position,
          priority,
          slug: slugify(title),
        };
        if (assigneeTouched) {
          payload.assignee_id = nextAssignee;
          payload.assignee_ids = assigneeIds && assigneeIds.length > 0 ? assigneeIds : null;
          payload.assigned_to = null;
        }
        console.log('[timeline] Sending card update payload:', payload);
        const response = await fetch(`/api/boards/${targetCard.board_id}/cards/${targetCard.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          console.error('[timeline] save card failed', {
            status: response.status,
            body,
          });
          throw new Error(body?.error?.message || 'Failed to update card');
        }
        if (body?.card) {
          const updatedCard = body.card as Card;
          // setModalCardOverride(updatedCard); // Removed as we rely on data update
          setData((prev) => {
            if (!prev) return prev;

            // Helper to calculate duration
            const start = getMinutesFromTime(updatedCard.due_start);
            const end = getMinutesFromTime(updatedCard.due_end);
            const duration = start !== null && end !== null ? Math.max(end - start, 0) : null;

            return {
              ...prev,
              events: prev.events.map((e) =>
                e.card_id === updatedCard.id
                  ? {
                    ...e,
                    title: updatedCard.title,
                    priority: updatedCard.priority,
                    checked: updatedCard.checked,
                    assignee_id: updatedCard.assignee_id,
                    assignee_ids: updatedCard.assignee_ids ?? null,
                    assigned_to: updatedCard.assigned_to,
                    due_date: getIsoDateJst(updatedCard.due_date ?? ''),
                    due_start: updatedCard.due_start,
                    due_end: updatedCard.due_end,
                    durationMinutes: duration,
                    tags: updatedCard.tags,
                  }
                  : e
              ),
              abBuckets: Object.fromEntries(
                Object.entries(prev.abBuckets).map(([key, items]) => [
                  key,
                  items.map(item =>
                    item.card_id === updatedCard.id
                      ? {
                        ...item,
                        title: updatedCard.title,
                        checked: updatedCard.checked,
                        tags: updatedCard.tags ?? [],
                        due_date: getIsoDateJst(updatedCard.due_date ?? ''),
                        due_start: updatedCard.due_start,
                        due_end: updatedCard.due_end,
                        assignee_id: updatedCard.assignee_id,
                        assignee_ids: updatedCard.assignee_ids ?? null,
                        assigned_to: updatedCard.assigned_to,
                        bucketPosition: updatedCard.due_bucket_position ?? item.bucketPosition,
                      }
                      : item
                  )
                ])
              )
            };
          });
        }
        // No need to setModalCard here, as the realtime update will handle it
        // and the memoized modalCard will re-evaluate.
        // await fetchTimeline(); // Realtime should handle this
        closeCardModal();
      } catch (error) {
        console.error('[timeline] save card failed', error);
        setCardModalError(error instanceof Error ? error.message : 'Failed to save card');
      }
    },
    [modalCard, closeCardModal]
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

        // Optimistic delete
        setData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            events: prev.events.filter(e => e.card_id !== modalCard?.id),
            abBuckets: Object.fromEntries(
              Object.entries(prev.abBuckets).map(([key, items]) => [
                key,
                items.filter(item => item.card_id !== modalCard?.id)
              ])
            )
          };
        });

        // await fetchTimeline(); // Realtime should handle this
      } catch (error) {
        console.error('[timeline] delete card failed', error);
        setCardModalError(error instanceof Error ? error.message : 'Failed to delete card');
      } finally {
        closeCardModal();
      }
    },
    [modalCard, closeCardModal]
  );

  const handleCardModalMove = useCallback((cardId: string, targetBoardId: string) => {
    console.warn('[timeline] move card not yet supported', { cardId, targetBoardId });
  }, []);




  const filteredData = useMemo(() => {
    if (!data) return null;

    // Convert TimelineEvents and BucketItems back to Cards for filtering
    // This is a bit inefficient but reuses the shared logic.
    // Ideally filterAndSortCards should be generic or we should adapt the data.
    // For now, we'll filter the arrays directly using the same logic as filterAndSortCards but inline or adapted.

    const filterItem = (item: { title: string; tags: string[]; priority?: string | null; checked: boolean }) => {
      // Priority (only for events that have priority, buckets might not?)
      if (selectedPriority !== 'all') {
        if (item.priority !== selectedPriority) return false;
      }
      // Tags
      if (selectedTags.length > 0) {
        const tagSet = new Set(item.tags ?? []);
        if (!selectedTags.every(tag => tagSet.has(tag))) return false;
      }
      // Search (Title + Tags)
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const source = `${item.title ?? ''} ${(item.tags ?? []).join(' ')}`.toLowerCase();
        if (!source.includes(query)) return false;
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
        // fetchTimeline(); // Realtime should handle this
      } catch (error) {
        console.error('[timeline] update error', error);
        setErrorMessage('Failed to update card');
      }
    },
    [dataMode, initialBoard.id]
  );





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



  const eventsByDay = useMemo(() => {
    if (!data) return {} as Record<string, TimelineEvent[]>;
    const sourceEvents = filteredData?.events ?? data.events;
    return data.days.reduce((acc, day) => {
      acc[day.isoDate] = sourceEvents.filter((event) => event.due_date === day.isoDate);
      return acc;
    }, {} as Record<string, TimelineEvent[]>);
  }, [data, filteredData]);

  const bucketDayMap = useMemo(() => {
    if (!data?.days?.length) return {} as Record<string, string | null>;
    return {
      today_a: data.days[0]?.isoDate ?? null,
      today_b: data.days[0]?.isoDate ?? null,
      tomorrow_a: data.days[1]?.isoDate ?? null,
      tomorrow_b: data.days[1]?.isoDate ?? null,
    };
  }, [data?.days]);

  const createCard = useCallback(async (payload: Partial<Card>) => {
    if (dataMode !== 'api') return;
    try {
      const response = await fetch(`/api/boards/${initialBoard.id}/cards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error('Failed to create card');
      const body = await response.json();

      if (body.card) {
        // Optimistic update
        const newCard = body.card as Card;
        setData((prev) => {
          if (!prev) return prev;
          const start = getMinutesFromTime(newCard.due_start ?? null) ?? 0;
          const end = getMinutesFromTime(newCard.due_end ?? null) ?? (start + 60);
          const newEvent: TimelineEvent = {
            card_id: newCard.id,
            due_date: getIsoDateJst(newCard.due_date ?? ''),
            due_start: newCard.due_start ?? null,
            due_end: newCard.due_end ?? null,
            durationMinutes: end - start,
            title: newCard.title,
            tags: newCard.tags ?? [],
            priority: newCard.priority ?? null,
            checked: newCard.checked ?? false,
            short_id: newCard.short_id ?? null,
            slug: newCard.slug ?? null,
          };
          return {
            ...prev,
            events: [...prev.events, newEvent],
          };
        });

        // openCardModalFromTimeline(newCard.short_id, 'create');

        // Fetch in background - skipped because realtime subscription will handle it
        // and it causes unnecessary load/delay
        // fetchTimeline();
      }
    } catch (error) {
      console.error('Create card failed', error);
      setErrorMessage('Failed to create card');
    }
  }, [dataMode, initialBoard.id, fetchTimeline]);

  const handleColumnClick = useCallback((day: TimelineDay, minutes: number) => {
    const payload: Partial<Card> = {
      title: `New card ${Date.now()}`,
      description: '',
      list_id: initialBoard.id,
      position: 999999,
      tags: [],
      due_date: withJstMidnight(day.isoDate),
      due_start: minutesToTime(minutes),
      due_end: minutesToTime(minutes + 60),
      due_bucket: null,
      due_bucket_position: null,
      priority: 'medium',
    };
    createCard(payload);
  }, [createCard, initialBoard.id]);

  const {
    sensors,
    activeDrag,
    pointerPreview,
    activeResize,
    handleDragStart,
    handleDragMove,
    handleDragEnd,
    handleDragCancel,
    handleEventKeyDown,
    handleResizeStart,
    handleResizeMove,
    handleResizeEnd,
  } = useTimelineDragAndDrop({
    data,
    setData,
    applyPatch,
    timelineScrollRef,
    bucketDayMap,
    dataMode,
  });

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
  const floatingLayerTop = 0;
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

  const handleScroll = useCallback(() => {
    // Placeholder to satisfy prop requirement
  }, []);

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
            measuring={{
              droppable: { strategy: MeasuringStrategy.Always },
            }}
            autoScroll={{
              enabled: true,
              threshold: { x: 0, y: 0.2 },
              acceleration: 10,
            }}
          >
            <div className="relative flex flex-col max-h-[80vh] overflow-hidden bg-white shadow-sm ring-1 ring-black/5">
              <div
                ref={timelineHeaderRef}
                className="z-30 grid border-b border-slate-100 bg-white text-xs font-semibold uppercase tracking-wide text-slate-500 pr-[14px]"
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

              <div
                ref={timelineScrollRef}
                className="relative flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-200 [scrollbar-gutter:stable]"
                onScroll={handleScroll}
              >
                <div className="relative" style={{ minHeight: timelineViewportHeight }}>
                  {(status === 'loading' || !data) && (
                    <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/50 backdrop-blur-sm">
                      <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-sky-500" />
                    </div>
                  )}
                  <TimelineBuckets
                    days={data?.days ?? []}
                    abBuckets={abBuckets}
                    floatingLayerTop={floatingLayerTop}
                    status={status}
                    openCardModal={openCardModal}
                  />

                  <TimelineGrid
                    days={data?.days ?? []}
                    eventsByDay={eventsByDay}
                    indicatorTop={indicatorTop}
                    indicatorDayIso={indicatorDayIso}
                    timelineViewportHeight={timelineViewportHeight}
                    activeDrag={activeDrag}
                    pointerPreview={pointerPreview}
                    openCardModal={openCardModal}
                    handleEventKeyDown={handleEventKeyDown}
                    handleColumnClick={handleColumnClick}
                    activeResize={activeResize}
                    handleResizeStart={handleResizeStart}
                    handleResizeMove={handleResizeMove}
                    handleResizeEnd={handleResizeEnd}
                  />
                </div>
              </div>
            </div>
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
              <ProfileSettings onProfileUpdated={fetchProfile} />
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
