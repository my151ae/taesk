"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Board, Card, DueBucket, Priority } from "@/lib/supabase";
import type { Checklist } from "@/lib/checklist";
import { normalizeChecklist, EMPTY_CHECKLIST, flattenChecklistText } from "@/lib/checklist";
import type { ChecklistSaveTrigger } from "@/app/(board)/_components/checklist/ChecklistEditor";
import { buildBoardUrl } from "@/lib/board-url";

import { createClientTrace } from "@/lib/metrics/client";
import type { ClientTrace } from "@/lib/metrics/client";
import { CardModal } from "@/app/components/CardModal";
import { slugify } from "@/lib/card-utils";
import ShareDialog from "@/app/(board)/_components/ShareDialog";
import NotificationSettings from "@/app/(board)/_components/NotificationSettings";
import ProfileSettings from "@/app/(board)/_components/ProfileSettings";
import BoardSettings from "@/app/(board)/_components/BoardSettings";
import { useAuth } from "@/app/contexts/AuthContext";
import TimelineHeader from "@/app/(board)/_components/timeline/TimelineHeader";
import { DesktopTimelineView } from "@/app/(board)/_components/timeline/DesktopTimelineView";
import MobileTimelineView from "@/app/(board)/_components/timeline/MobileTimelineView";
import {
  TIMELINE_HEIGHT,
  TIMELINE_MIN_VIEWPORT,
  TIMELINE_HEADER_ESTIMATE,
  DEFAULT_TIMELINE_DAY_RANGE,
  formatDayLabel,
  minuteToPixels,
  getMinutesFromTime,
  getIsoDateJst,
  getNowMinutesJst,
  getMinutesJstFromIso,
  minutesToTime,
  withJstMidnight,
  toLocalDay,

  type UserProfile,
  type TimelineDay,
  type TimelineEvent,
  type TimelineBucketItem,
  type TimelineResponse,
  type ExternalCalendarEntry,
} from "@/app/(board)/_utils/timeline-helpers";

import { useSyncQueue } from "@/app/(board)/_hooks/useSyncQueue";
import { useRealtimeBoard } from "@/app/(board)/_hooks/useRealtimeBoard";
import { useBoardFilters } from "@/app/(board)/_hooks/useBoardFilters";
import { useCommentsStore } from "@/app/(board)/_stores/comments-store";
import { useTimelineDragAndDrop } from "@/app/(board)/_hooks/useTimelineDragAndDrop";
import { useGoogleCalendar } from "@/app/(board)/_hooks/useGoogleCalendar";
import { normalizeDueBucket } from "@/lib/bucket-normalization";
import { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { useCardModal } from "@/app/(board)/_hooks/useCardModal";

type TimelineBoardPageProps = {
  initialBoard: Board;
};

type DataMode = 'api' | 'mock';

const DAY_WINDOW_RANGE = DEFAULT_TIMELINE_DAY_RANGE;


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
  const days = Array.from({ length: DEFAULT_TIMELINE_DAY_RANGE }, (_, offset) => {
    const isoDate = format(offset);
    return {
      key: isoDate,
      label: formatDayLabel(isoDate, today),
      isoDate,
    };
  });

  const events: TimelineResponse['events'] = [];

  if (days[0]) {
    events.push(
      {
        card_id: 'mock-spec',
        due_date: days[0].isoDate,
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
        due_date: days[0].isoDate,
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
        due_date: days[0].isoDate,
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
    );
  }

  if (days[1]) {
    events.push({
      card_id: 'mock-design-review',
      due_date: days[1].isoDate,
      due_start: '10:00:00',
      due_end: '11:00:00',
      durationMinutes: 60,
      title: 'Design review',
      tags: [],
      priority: 'medium',
      checked: false,
      short_id: null,
      slug: null,
    });
  }

  const abBuckets = days.reduce((acc, day, index) => {
    const aKey = `${day.key}_a`;
    const bKey = `${day.key}_b`;
    acc[aKey] = [];
    acc[bKey] = [];

    if (index === 0) {
      acc[aKey].push(
        { card_id: 'mock-finish-spec', title: 'Finish spec', due_date: day.isoDate, due_start: null, due_end: null, checked: false, tags: [], short_id: null, slug: null, bucketPosition: 4000 },
        { card_id: 'mock-prepare-meeting', title: 'Prepare meeting', due_date: day.isoDate, due_start: null, due_end: null, checked: false, tags: [], short_id: null, slug: null, bucketPosition: 3900 },
        { card_id: 'mock-fix-bug', title: 'Fix bug #123', due_date: day.isoDate, due_start: null, due_end: null, checked: false, tags: [], short_id: null, slug: null, bucketPosition: 3800 },
      );
      acc[bKey].push(
        { card_id: 'mock-organize-docs', title: 'Organize docs', due_date: day.isoDate, due_start: null, due_end: null, checked: false, tags: [], short_id: null, slug: null, bucketPosition: 3600 },
        { card_id: 'mock-break-task', title: 'Break down big task', due_date: day.isoDate, due_start: null, due_end: null, checked: false, tags: [], short_id: null, slug: null, bucketPosition: 3500 },
      );
    }

    if (index === 1) {
      acc[aKey].push(
        { card_id: 'mock-finish-review', title: 'Finish review', due_date: day.isoDate, due_start: null, due_end: null, checked: false, tags: [], short_id: null, slug: null, bucketPosition: 3400 },
        { card_id: 'mock-prepare-slides', title: 'Prepare slides', due_date: day.isoDate, due_start: null, due_end: null, checked: false, tags: [], short_id: null, slug: null, bucketPosition: 3300 },
      );
      acc[bKey].push(
        { card_id: 'mock-refactor', title: 'Refactor old code', due_date: day.isoDate, due_start: null, due_end: null, checked: false, tags: [], short_id: null, slug: null, bucketPosition: 3200 },
        { card_id: 'mock-research', title: 'Research item', due_date: day.isoDate, due_start: null, due_end: null, checked: false, tags: [], short_id: null, slug: null, bucketPosition: 3100 },
      );
    }

    return acc;
  }, {} as Record<string, TimelineBucketItem[]>);

  return {
    days,
    events,
    abBuckets,
    serverNow: new Date().toISOString(),
    startOffset: 0,
    range: DAY_WINDOW_RANGE,
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
  const traceRef = useRef<ClientTrace | null>(createClientTrace('timeline'));
  const [availableBoards, setAvailableBoards] = useState<Board[]>([initialBoard]);
  const [showBoardMenu, setShowBoardMenu] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const { user, signOut } = useAuth();
  const [activeDayIndex, setActiveDayIndex] = useState(0);
  const [dayWindowStart, setDayWindowStart] = useState(0);
  const dayWindowStartRef = useRef(0);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [dayRange, setDayRange] = useState(initialBoard.day_range ?? 2);
  const [calendarPreset, setCalendarPreset] = useState<'visible' | 'this-week' | 'next-week'>('visible');
  const prevGoogleStatusRef = useRef<string | null>(null);
  const [googleToast, setGoogleToast] = useState<string | null>(null);

  const {
    modalCard,
    cardModalStatus,
    cardModalError,
    setCardModalError,
    setModalCardOverride,
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
  const [showBoardSettings, setShowBoardSettings] = useState(false);
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

  const visibleDays = useMemo(() => {
    const days = data?.days ?? [];
    if (!days.length) return [] as TimelineDay[];
    const startIndex = Math.min(activeDayIndex, Math.max(0, days.length - 1));
    const count = Math.min(dayRange, Math.max(days.length - startIndex, 0));
    return days.slice(startIndex, startIndex + Math.max(count, 0));
  }, [activeDayIndex, data?.days, dayRange]);

  const calendarRangeStart = useMemo(() => {
    if (!visibleDays.length) return null;
    const startIso = withJstMidnight(visibleDays[0]?.isoDate ?? null);
    return startIso ? new Date(startIso) : null;
  }, [visibleDays]);

  const calendarRangeEnd = useMemo(() => {
    if (!visibleDays.length) return null;
    const endIso = withJstMidnight(visibleDays[visibleDays.length - 1]?.isoDate ?? null);
    if (!endIso) return null;
    const end = new Date(endIso);
    end.setUTCDate(end.getUTCDate() + 1);
    return end;
  }, [visibleDays]);

  const startOfWeekJst = useCallback((base: Date) => {
    const jstMs = base.getTime() + 9 * 60 * 60 * 1000;
    const jst = new Date(jstMs);
    const day = jst.getUTCDay();
    const diff = (day + 6) % 7; // Monday start
    const mondayUtc = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() - diff, 0, 0, 0);
    return new Date(mondayUtc - 9 * 60 * 60 * 1000);
  }, []);

  const presetRange = useMemo(() => {
    const now = new Date();
    if (calendarPreset === 'this-week') {
      const start = startOfWeekJst(now);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 7);
      return { start, end };
    }
    if (calendarPreset === 'next-week') {
      const start = startOfWeekJst(now);
      start.setUTCDate(start.getUTCDate() + 7);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 7);
      return { start, end };
    }
    return { start: calendarRangeStart, end: calendarRangeEnd };
  }, [calendarPreset, calendarRangeEnd, calendarRangeStart, startOfWeekJst]);

  const {
    events: googleCalendarEvents,
    status: googleCalendarStatus,
    error: googleCalendarError,
    refresh: refreshGoogleCalendar,
  } = useGoogleCalendar(presetRange.start, presetRange.end);

  const { calendarEventsByDay, calendarAllDayEventsByDay } = useMemo(() => {
    if (!googleCalendarEvents.length || !(data?.days?.length)) {
      return {
        calendarEventsByDay: {} as Record<string, ExternalCalendarEntry[]>,
        calendarAllDayEventsByDay: {} as Record<string, ExternalCalendarEntry[]>,
      };
    }

    const daySet = new Set((data?.days ?? []).map((day) => day.isoDate));
    const timedResult: Record<string, ExternalCalendarEntry[]> = {};
    const allDayResult: Record<string, ExternalCalendarEntry[]> = {};

    googleCalendarEvents.forEach((event) => {
      const start = new Date(event.start);
      const end = new Date(event.end);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;

      const startMs = start.getTime();
      const endMs = end.getTime();
      let cursorMs = startMs;
      const baseId = event.id || `gcal-${startMs}`;

      while (cursorMs < endMs) {
        const cursor = new Date(cursorMs);
        const dayIso = getIsoDateJst(cursor.toISOString());
        const nextDay = new Date(cursor);
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        const nextDayMs = nextDay.getTime();

        const isFirstDay = cursorMs === startMs;
        const isLastDay = nextDayMs >= endMs;

        const startMinutes = isFirstDay ? getMinutesJstFromIso(event.start) : 0;
        let endMinutes = isLastDay ? getMinutesJstFromIso(event.end) : 24 * 60;
        if (isLastDay && endMinutes === 0) endMinutes = 24 * 60;

        const duration = Math.max(15, endMinutes - startMinutes);

        if (daySet.has(dayIso)) {
          const entry: ExternalCalendarEntry = {
            id: `${baseId}-${dayIso}`,
            eventId: event.id || baseId,
            dayIso,
            title: event.title,
            startMinutes,
            durationMinutes: duration,
            isAllDay: event.isAllDay,
            source: event.source,
          };

          const target = event.isAllDay ? allDayResult : timedResult;
          if (!target[dayIso]) target[dayIso] = [];
          target[dayIso].push(entry);
        }

        cursorMs = nextDayMs;
      }
    });

    Object.values(timedResult).forEach((entries) => {
      entries.sort((a, b) => a.startMinutes - b.startMinutes);
    });

    Object.values(allDayResult).forEach((entries) => {
      entries.sort((a, b) => a.title.localeCompare(b.title));
    });

    return {
      calendarEventsByDay: timedResult,
      calendarAllDayEventsByDay: allDayResult,
    };
  }, [googleCalendarEvents, data?.days]);

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
        console.log('[handleCardChange] UPDATE', { cardId: card.id, checked: card.checked, eventType });

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
            due_bucket: card.due_bucket ?? null,
            due_bucket_position: card.due_bucket_position ?? null,
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

  const fetchTimeline = useCallback(async (start?: number) => {
    if (!initialBoard?.id) return null;
    const effectiveStart = typeof start === 'number' ? start : dayWindowStartRef.current;
    setStatus('loading');
    setErrorMessage(null);
    try {
      traceRef.current?.mark('fetch:start');
      const params = new URLSearchParams({
        start: String(effectiveStart),
        range: String(dayRange),
      });
      const response = await fetch(`/api/boards/${initialBoard.id}/timeline?${params.toString()}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error?.message || 'Failed to load timeline');
      }
      const payload = (await response.json()) as TimelineResponse;
      const startOffset = payload.startOffset ?? effectiveStart;
      setData(payload);
      setDataMode('api');
      setDayWindowStart(startOffset);
      dayWindowStartRef.current = startOffset;
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
      return payload;
    } catch (error) {
      console.warn('[timeline] fetch failed, rendering mock data', error);
      setErrorMessage('Showing sample schedule until sync succeeds');
      const fallback = buildMockTimeline();
      setData(fallback);
      setDayWindowStart(0);
      dayWindowStartRef.current = 0;
      setDataMode('mock');
      setStatus('idle');
      traceRef.current?.finish('error', { reason: 'fetch_failed' });
      traceRef.current = createClientTrace('timeline');
      return fallback;
    }
  }, [initialBoard?.id, dayRange]);

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
      checklist: Checklist,
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
          checklist: normalizeChecklist(checklist ?? EMPTY_CHECKLIST),
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
          setModalCardOverride(updatedCard);

          // Use the same logic as handleCardChange to properly move cards
          setData((prev) => {
            if (!prev) return prev;

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

            // Remove card from its current location
            removeCard(updatedCard.id);

            // Determine where to put the card
            if (updatedCard.due_date && updatedCard.due_start && updatedCard.due_end) {
              // It's a timeline event (has date and time)
              const startMinutes = getMinutesFromTime(updatedCard.due_start);
              const endMinutes = getMinutesFromTime(updatedCard.due_end);
              const durationMinutes = startMinutes != null && endMinutes != null
                ? Math.max(endMinutes - startMinutes, 15)
                : 60;

              nextEvents.push({
                card_id: updatedCard.id,
                due_date: getIsoDateJst(updatedCard.due_date ?? ''),
                due_start: updatedCard.due_start,
                due_end: updatedCard.due_end,
                durationMinutes,
                title: updatedCard.title,
                tags: updatedCard.tags ?? [],
                priority: updatedCard.priority,
                checked: updatedCard.checked,
                checklist: normalizeChecklist(updatedCard.checklist ?? EMPTY_CHECKLIST),
                due_bucket: updatedCard.due_bucket ?? null,
                due_bucket_position: updatedCard.due_bucket_position ?? null,
                assignee_id: updatedCard.assignee_id,
                assignee_ids: updatedCard.assignee_ids ?? null,
                assigned_to: updatedCard.assigned_to,
                short_id: updatedCard.short_id,
                slug: updatedCard.slug,
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

            } else if (updatedCard.due_bucket) {
              // It's a bucket item (has date but no time)
              const bucketKey = resolveBucketKey(updatedCard, prev.days);
              if (!bucketKey) {
                console.warn('[timeline] skip bucket item with unknown bucket', {
                  cardId: updatedCard.id,
                  due_bucket: updatedCard.due_bucket,
                  due_date: updatedCard.due_date,
                });
                return prev;
              }

              if (!nextBuckets[bucketKey]) nextBuckets[bucketKey] = [];

              nextBuckets[bucketKey].push({
                card_id: updatedCard.id,
                title: updatedCard.title,
                due_date: toLocalDay(updatedCard.due_date ?? null),
                due_start: updatedCard.due_start,
                due_end: updatedCard.due_end,
                checked: updatedCard.checked,
                checklist: normalizeChecklist(updatedCard.checklist ?? EMPTY_CHECKLIST),
                tags: updatedCard.tags ?? [],
                assignee_id: updatedCard.assignee_id,
                assignee_ids: updatedCard.assignee_ids ?? null,
                assigned_to: updatedCard.assigned_to,
                short_id: updatedCard.short_id,
                slug: updatedCard.slug,
                bucketPosition: updatedCard.due_bucket_position,
              });

              // Sort bucket items
              nextBuckets[bucketKey].sort((a, b) => (b.bucketPosition ?? 0) - (a.bucketPosition ?? 0));
            }

            return { ...prev, events: nextEvents, abBuckets: nextBuckets };
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
    [modalCard, closeCardModal, setCardModalError, setModalCardOverride, setData]
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
    [modalCard, closeCardModal, setCardModalError]
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

    const filterItem = (item: { title: string; tags: string[]; priority?: string | null; checked: boolean; checklist?: Checklist | null }) => {
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
        const checklistText = flattenChecklistText(item.checklist ?? null);
        const source = `${item.title ?? ''} ${(item.tags ?? []).join(' ')} ${checklistText}`.toLowerCase();
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
        setErrorMessage(error instanceof Error ? error.message : 'Failed to update card');
      }
    },
    [dataMode, initialBoard.id]
  );

  const handleToggleCardChecked = useCallback(
    async (cardId: string, nextChecked: boolean) => {
      if (dataMode !== 'api') return;

      try {
        // Optimistic update
        setData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            events: prev.events.map((e) =>
              e.card_id === cardId ? { ...e, checked: nextChecked } : e
            ),
            abBuckets: Object.fromEntries(
              Object.entries(prev.abBuckets).map(([key, items]) => [
                key,
                items.map((item) =>
                  item.card_id === cardId ? { ...item, checked: nextChecked } : item
                ),
              ])
            ),
          };
        });

        // API call
        const response = await fetch(
          `/api/boards/${initialBoard.id}/cards/${cardId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ checked: nextChecked }),
          }
        );

        if (!response.ok) {
          throw new Error('Failed to update checkbox');
        }
      } catch (error) {
        console.error('[timeline] toggle checkbox failed', error);
        // Revert on error by refetching
        fetchTimeline();
      }
    },
    [dataMode, initialBoard.id, fetchTimeline]
  );

  const applyChecklistLocally = useCallback((cardId: string, checklist: Checklist) => {
    const normalized = normalizeChecklist(checklist ?? EMPTY_CHECKLIST);
    setData((prev) => {
      if (!prev) return prev;
      const events = prev.events.map((event) =>
        event.card_id === cardId ? { ...event, checklist: normalized } : event
      );
      const abBuckets = Object.fromEntries(
        Object.entries(prev.abBuckets).map(([key, items]) => [
          key,
          items.map((item) => (item.card_id === cardId ? { ...item, checklist: normalized } : item)),
        ])
      );
      return { ...prev, events, abBuckets };
    });

    setModalCardOverride((current) => {
      if (current && current.id === cardId) {
        return { ...current, checklist: normalized } as Card;
      }
      return current;
    });
  }, [setData, setModalCardOverride]);

  const handleChecklistCommit = useCallback(async (cardId: string, checklist: Checklist, _trigger: ChecklistSaveTrigger) => {
    applyChecklistLocally(cardId, checklist);
    if (dataMode !== 'api') return;
    try {
      await applyPatch(cardId, { checklist: normalizeChecklist(checklist ?? EMPTY_CHECKLIST) });
      setModalCardOverride((current) => current && current.id === cardId ? { ...current, checklist: normalizeChecklist(checklist ?? EMPTY_CHECKLIST) } as Card : current);
    } catch (error) {
      console.error('[timeline] checklist save failed', error);
      setErrorMessage('Failed to save checklist');
    }
  }, [applyChecklistLocally, applyPatch, dataMode, setModalCardOverride]);

  const handleChecklistEditingChange = useCallback((cardId: string, isEditing: boolean) => {
    setEditingCardId((current) => {
      if (isEditing) return cardId;
      if (current === cardId) return null;
      return current;
    });
  }, []);

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

  const googleStatusText = useMemo(() => {
    if (googleCalendarStatus === 'loading') return 'Google予定を同期中...';
    if (googleCalendarStatus === 'success') {
      const count = googleCalendarEvents.length;
      return count > 0 ? `${count}件のGoogle予定を表示中` : 'Google連携済み（予定なし）';
    }
    if (googleCalendarStatus === 'disconnected') return 'Google連携が切れています。接続してください。';
    if (googleCalendarStatus === 'error') return 'Google予定の取得に失敗しました。';
    return 'Google予定の同期を準備中...';
  }, [googleCalendarEvents.length, googleCalendarStatus]);

  useEffect(() => {
    if (prevGoogleStatusRef.current && prevGoogleStatusRef.current !== 'success' && googleCalendarStatus === 'success') {
      setGoogleToast('Googleカレンダーを再接続しました');
      const timer = window.setTimeout(() => setGoogleToast(null), 4000);
      return () => window.clearTimeout(timer);
    }
    prevGoogleStatusRef.current = googleCalendarStatus;
  }, [googleCalendarStatus]);

  const handleGoogleConnect = useCallback(() => {
    if (typeof window === 'undefined') return;
    const redirect = `${window.location.pathname}${window.location.search}`;
    const target = `/api/integrations/google-calendar/connect?redirect=${encodeURIComponent(redirect || '/board')}`;
    window.location.href = target;
  }, []);

  const isGoogleLoading = googleCalendarStatus === 'loading';
  const isCalendarRangeReady = Boolean(calendarRangeStart && calendarRangeEnd);



  const clampActiveDayIndex = useCallback((nextLength: number, desired?: number) => {
    if (!nextLength) return 0;
    const maxStart = Math.max(0, nextLength - dayRange);
    if (typeof desired === 'number') {
      return Math.min(Math.max(0, desired), maxStart);
    }
    return Math.min(activeDayIndex, maxStart);
  }, [activeDayIndex, dayRange]);

  const handlePrevDay = useCallback(async () => {
    if (status === 'loading') return;
    if (activeDayIndex > 0) {
      setActiveDayIndex((prev) => Math.max(0, prev - 1));
      return;
    }

    const baseStart = data?.startOffset ?? dayWindowStartRef.current ?? 0;
    const payload = await fetchTimeline(baseStart - 1);
    const nextDaysLength = payload?.days?.length ?? 0;
    setActiveDayIndex(clampActiveDayIndex(nextDaysLength, 0));
  }, [activeDayIndex, clampActiveDayIndex, data?.startOffset, fetchTimeline, status]);

  const handleNextDay = useCallback(async () => {
    if (status === 'loading' || !data?.days?.length) return;
    const lastStartIndex = Math.max(0, data.days.length - dayRange);
    if (activeDayIndex < lastStartIndex) {
      setActiveDayIndex((prev) => Math.min(lastStartIndex, prev + 1));
      return;
    }

    const baseStart = data?.startOffset ?? dayWindowStartRef.current ?? 0;
    const payload = await fetchTimeline(baseStart + 1);
    const nextDaysLength = payload?.days?.length ?? 0;
    setActiveDayIndex(clampActiveDayIndex(nextDaysLength, nextDaysLength ? nextDaysLength - dayRange : 0));
  }, [activeDayIndex, clampActiveDayIndex, data?.days?.length, data?.startOffset, fetchTimeline, status, dayRange]);

  const bucketDayMap = useMemo(() => {
    const result: Record<string, string | null> = {};
    data?.days?.forEach((day) => {
      result[`${day.key}_a`] = day.isoDate;
      result[`${day.key}_b`] = day.isoDate;
    });
    return result;
  }, [data?.days]);

  const {
    sensors,
    activeDrag,
    pointerPreview,
    activeResize,
    bucketIndicator,
    isOverABList,
    handleDragStart,
    handleDragMove,
    handleDragEnd,
    handleDragCancel,
    handleEventKeyDown,
    handleResizeStart,
    handleResizeMove,
    handleResizeEnd,
  } = useTimelineDragAndDrop({
    data: filteredData,
    setData,
    applyPatch,
    timelineScrollRef,
    bucketDayMap,
    dataMode,
    editingCardId,
  });

  const eventsByDay = useMemo(() => {
    const result: Record<string, TimelineEvent[]> = {};
    filteredData?.events?.forEach((event) => {
      const isoDate = event.due_date ?? '';
      if (!result[isoDate]) result[isoDate] = [];
      result[isoDate].push(event);
    });
    return result;
  }, [filteredData?.events]);

  const abBuckets = filteredData?.abBuckets ?? {};

  const timelineViewportHeight = useMemo(() => {
    if (viewportHeight == null) return TIMELINE_MIN_VIEWPORT;
    const usedHeight = timelineHeaderHeight;
    const available = viewportHeight - usedHeight;
    return Math.max(available, TIMELINE_MIN_VIEWPORT, TIMELINE_HEIGHT);
  }, [viewportHeight, timelineHeaderHeight]);

  const createCard = useCallback(async (payload: Partial<Card>, tempId?: string) => {
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
        // Replace temporary card with real card
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
            checklist: normalizeChecklist(newCard.checklist ?? EMPTY_CHECKLIST),
            due_bucket: newCard.due_bucket ?? null,
            due_bucket_position: newCard.due_bucket_position ?? null,
            priority: newCard.priority ?? null,
            checked: newCard.checked ?? false,
            assignee_id: newCard.assignee_id ?? null,
            assignee_ids: newCard.assignee_ids ?? null,
            assigned_to: newCard.assigned_to ?? null,
            short_id: newCard.short_id ?? null,
            slug: newCard.slug ?? null,
          };

          // If tempId exists, replace the temp card, otherwise just add
          const events = tempId
            ? prev.events.map(e => e.card_id === tempId ? newEvent : e)
            : [...prev.events, newEvent];

          return {
            ...prev,
            events,
          };
        });

        // Auto-open modal for the new card
        if (newCard.short_id) {
          openCardModal(newCard.short_id, 'create-card');
        }
      }
    } catch (error) {
      console.error('Create card failed', error);
      setErrorMessage('Failed to create card');

      // Remove optimistic card on error
      if (tempId) {
        setData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            events: prev.events.filter(e => e.card_id !== tempId),
          };
        });
      }
    }
  }, [dataMode, initialBoard.id, setData, openCardModal]);

  const handleColumnClick = useCallback((day: TimelineDay, minutes: number) => {
    console.debug('[timeline] column click', { day, minutes });

    const payload: Partial<Card> = {
      title: `New card ${Date.now()}`,
      checklist: EMPTY_CHECKLIST,
      tags: [],
      due_date: withJstMidnight(day.isoDate),
      due_start: minutesToTime(minutes),
      due_end: minutesToTime(minutes + 60),
      due_bucket: null,
      due_bucket_position: null,
      priority: 'medium',
    };

    // Optimistic update to show card immediately
    const tempId = `temp-${Date.now()}`;
    const optimisticEvent: TimelineEvent = {
      card_id: tempId,
      due_date: day.isoDate,
      due_start: minutesToTime(minutes),
      due_end: minutesToTime(minutes + 60),
      durationMinutes: 60,
      title: payload.title || 'New card',
      checklist: EMPTY_CHECKLIST,
      tags: [],
      due_bucket: null,
      due_bucket_position: null,
      priority: 'medium',
      checked: false,
      assignee_id: null,
      assignee_ids: null,
      assigned_to: null,
      short_id: null,
      slug: null,
    };

    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        events: [...prev.events, optimisticEvent],
      };
    });

    createCard(payload, tempId);
  }, [createCard, setData]);

  // Show modal as soon as we have a card (e.g., from timeline data), even while the API is still loading.
  const shouldShowCardModal = Boolean(modalCard && (cardModalStatus === 'ready' || cardModalStatus === 'loading'));
  const modalBoards = availableBoards;
  const hasActiveFilters = searchQuery.trim() !== '' || selectedTags.length > 0 || selectedPriority !== 'all';
  const floatingLayerTop = timelineHeaderHeight;

  return (
    <>
      <div className="min-h-screen bg-[#f4f5f7]">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 pt-6">
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
            setShowBoardSettings={setShowBoardSettings}
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
            dayRange={dayRange}
            onDayRangeChange={setDayRange}
            onTodayClick={async () => {
              await fetchTimeline(0);
              setActiveDayIndex(0);
            }}
            onUpdateBoard={async (updates) => {
              try {
                const response = await fetch(`/api/boards/${initialBoard.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(updates),
                });
                if (!response.ok) throw new Error('Failed to update board');
                const { board: updatedBoard } = await response.json();

                // Update initialBoard with new values
                Object.assign(initialBoard, updatedBoard);

                // Update availableBoards to reflect the change in Switch Board menu
                setAvailableBoards(prev =>
                  prev.map(b => b.id === updatedBoard.id ? updatedBoard : b)
                );

                // If day_range was updated (though we use local state now, we might still want to sync if possible or just ignore)
                // For now, we keep this generic handler for other board updates (name, etc.)
              } catch (error) {
                console.error('Failed to update board', error);
                alert('Failed to update board');
              }
            }}
            googleStatusText={googleStatusText}
            googleCalendarStatus={googleCalendarStatus}
            googleCalendarError={googleCalendarError}
            calendarPreset={calendarPreset}
            setCalendarPreset={setCalendarPreset}
            refreshGoogleCalendar={refreshGoogleCalendar}
            handleGoogleConnect={handleGoogleConnect}
            isGoogleLoading={isGoogleLoading}
            isCalendarRangeReady={isCalendarRangeReady}
          />

          {/* Google Calendar controls moved to header */}
          {googleToast && (
            <div className="rounded-lg bg-emerald-600 px-3 py-2 text-sm text-white shadow-md">
              {googleToast}
            </div>
          )}

          <div className="hidden md:block">
            <DesktopTimelineView
              timelineHeaderRef={timelineHeaderRef}
              timelineScrollRef={timelineScrollRef}
              days={data?.days ?? []}
              activeDayIndex={activeDayIndex}
              dayRange={dayRange}
              status={status}
              handlePrevDay={handlePrevDay}
              handleNextDay={handleNextDay}
              eventsByDay={eventsByDay}
              abBuckets={abBuckets}
              indicatorTop={indicatorTop}
              indicatorDayIso={indicatorDayIso}
              timelineViewportHeight={timelineViewportHeight}
              activeDrag={activeDrag}
              pointerPreview={pointerPreview}
              activeResize={activeResize}
              bucketIndicator={bucketIndicator}
              openCardModal={openCardModal}
              handleEventKeyDown={handleEventKeyDown}
              handleColumnClick={handleColumnClick}
              handleResizeStart={handleResizeStart}
              handleResizeMove={handleResizeMove}
              handleResizeEnd={handleResizeEnd}
              onToggleCheck={handleToggleCardChecked}
              onChecklistCommit={handleChecklistCommit}
              onChecklistEditingChange={handleChecklistEditingChange}
              editingCardId={editingCardId}
              sensors={sensors}
              handleDragStart={handleDragStart}
              handleDragMove={handleDragMove}
              handleDragEnd={handleDragEnd}
              handleDragCancel={handleDragCancel}
              isOverABList={isOverABList}
              floatingLayerTop={floatingLayerTop}
              calendarEventsByDay={calendarEventsByDay}
              calendarAllDayByDay={calendarAllDayEventsByDay}
            />
          </div>

          <div className="md:hidden">
            <div className="relative h-[calc(100vh-140px)] overflow-hidden bg-white shadow-sm ring-1 ring-black/5">
              <MobileTimelineView
                timelineScrollRef={timelineScrollRef}
                days={data?.days ?? []}
                activeDayIndex={activeDayIndex}
                onPrevDay={handlePrevDay}
                onNextDay={handleNextDay}
                eventsByDay={eventsByDay}
                abBuckets={abBuckets}
                indicatorTop={indicatorTop}
                indicatorDayIso={indicatorDayIso}
                timelineViewportHeight={timelineViewportHeight}
                openCardModal={openCardModal}
                onToggleCheck={handleToggleCardChecked}
                onChecklistCommit={handleChecklistCommit}
                onChecklistEditingChange={handleChecklistEditingChange}
                editingCardId={editingCardId}
                status={status}
                activeDrag={activeDrag}
                sensors={sensors}
                handleDragStart={handleDragStart}
                handleDragMove={handleDragMove}
                handleDragEnd={handleDragEnd}
                handleDragCancel={handleDragCancel}
                bucketIndicator={bucketIndicator}
                isOverABList={isOverABList}
                pointerPreview={pointerPreview}
                calendarEventsByDay={calendarEventsByDay}
                calendarAllDayByDay={calendarAllDayEventsByDay}
              />
            </div>
          </div>
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
        showBoardSettings && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowBoardSettings(false)}>
            <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-semibold">Board Settings</h2>
                <button
                  onClick={() => setShowBoardSettings(false)}
                  className="rounded-full p-2 text-slate-500 hover:bg-slate-100"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
              <BoardSettings
                board={initialBoard}
                onUpdate={async (updates) => {
                  try {
                    const response = await fetch(`/api/boards/${initialBoard.id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(updates),
                    });
                    if (!response.ok) throw new Error('Failed to update board');
                    const { board: updatedBoard } = await response.json();

                    // Update initialBoard with new values
                    Object.assign(initialBoard, updatedBoard);

                    // Update availableBoards to reflect the change in Switch Board menu
                    setAvailableBoards(prev =>
                      prev.map(b => b.id === updatedBoard.id ? updatedBoard : b)
                    );

                    // Close settings dialog
                    setShowBoardSettings(false);

                    // Reset active day index to 0
                    setActiveDayIndex(0);

                    // Refetch timeline with new day_range
                    await fetchTimeline();
                  } catch (error) {
                    console.error('Failed to update board', error);
                    alert('Failed to update board');
                  }
                }}
              />
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
