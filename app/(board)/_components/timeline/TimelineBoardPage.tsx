"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Board, Card, DueBucket, Priority } from "@/lib/supabase";
import type { Checklist } from "@/lib/checklist";
import { normalizeChecklist, EMPTY_CHECKLIST, flattenChecklistText } from "@/lib/checklist";
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
  pixelsToMinutes,
  getMinutesFromTime,
  getIsoDateJst,
  getNowMinutesJst,
  getMinutesJstFromIso,
  minutesToTime,
  withJstMidnight,
  toLocalDay,
  getDayDiff,

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
import { MAIN_BOARD_ID } from "@/lib/board-defaults";
import { ResyncCandidate, fetchResyncCandidates } from "@/app/(board)/_utils/resync";
import { applyCardUpdate } from "@/app/(board)/_utils/card-updates";

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
  // デバウンス用カスタムhook
  const useDebounce = (callback: (...args: any[]) => void, delay: number) => {
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);

    return useCallback((...args: any[]) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        callback(...args);
      }, delay);
    }, [callback, delay]);
  };

  // URLパラメータの取得
  const searchParams = useSearchParams();
  const urlDate = searchParams.get('date');
  const urlRange = searchParams.get('range');
  const urlTime = searchParams.get('time');

  const [data, setData] = useState<TimelineResponse | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dataMode, setDataMode] = useState<DataMode>('api');
  const [liveNowMinutes, setLiveNowMinutes] = useState<number | null>(null);
  const [liveNowIsoDate, setLiveNowIsoDate] = useState<string | null>(null);
  const [hasAutoScrolled, setHasAutoScrolled] = useState(false);
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  const desktopTimelineScrollRef = useRef<HTMLDivElement | null>(null);
  const mobileTimelineScrollRef = useRef<HTMLDivElement | null>(null);
  const timelineHeaderRef = useRef<HTMLDivElement | null>(null);
  const [timelineHeaderHeight, setTimelineHeaderHeight] = useState(TIMELINE_HEADER_ESTIMATE);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const router = useRouter();
  const traceRef = useRef<ClientTrace | null>(null);

  useEffect(() => {
    traceRef.current = createClientTrace('timeline');
  }, []);
  const [availableBoards, setAvailableBoards] = useState<Board[]>([initialBoard]);
  const [showBoardMenu, setShowBoardMenu] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const { user, signOut } = useAuth();

  const [activeDayIndex, setActiveDayIndex] = useState(0);

  const [dayWindowStart, setDayWindowStart] = useState(0);
  const dayWindowStartRef = useRef(0);
  const [isTimelineViewMounted, setIsTimelineViewMounted] = useState(false);

  const syncActiveTimelineScrollRef = useCallback(() => {
    if (typeof window === 'undefined') return;
    const isDesktop = window.matchMedia('(min-width: 768px)').matches;
    timelineScrollRef.current = isDesktop ? desktopTimelineScrollRef.current : mobileTimelineScrollRef.current;
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(min-width: 768px)');
    const sync = () => syncActiveTimelineScrollRef();
    sync();
    mql.addEventListener('change', sync);
    return () => mql.removeEventListener('change', sync);
  }, [syncActiveTimelineScrollRef]);

  // URL更新関数
  const updateUrl = useCallback((date: string | null, range: number, time?: number | null) => {
    const params = new URLSearchParams();

    if (date) {
      params.set('date', date);
    }

    params.set('range', String(range));

    // timeが指定されている場合のみURLに追加
    if (time != null && time >= 0) {
      params.set('time', String(Math.round(time)));
    }

    const newUrl = `${window.location.pathname}?${params.toString()}`;

    // replaceを使用して履歴を増やさない
    router.replace(newUrl, { scroll: false });
  }, [router]);

  // 初期化ロジック (SSRエラー回避のためuseEffect内で行う)
  // 初期化ロジック (urlDateがある場合)
  useEffect(() => {
    if (urlDate) {
      const todayJst = getIsoDateJst(new Date().toISOString());
      const start = getDayDiff(urlDate, todayJst);
      if (!isNaN(start)) {
        setDayWindowStart(start);
        dayWindowStartRef.current = start;
      }
    }
  }, [urlDate]);

  // デフォルトパラメータ設定 (パラメータがない場合)
  useEffect(() => {
    if (!urlDate && !urlRange && !urlTime) {
      const todayJst = getIsoDateJst(new Date().toISOString());
      const nowMinutes = getNowMinutesJst(new Date().toISOString());
      const defaultRange = initialBoard.day_range ?? 2;

      updateUrl(todayJst, defaultRange, nowMinutes);
    }
  }, [urlDate, urlRange, urlTime, initialBoard.day_range, updateUrl]);

  // dayRangeの初期値をURLパラメータから取得
  const initialRange = useMemo(() => {
    const urlRangeValue = urlRange ? parseInt(urlRange, 10) : null;
    if (urlRangeValue && urlRangeValue >= 1 && urlRangeValue <= 7) {
      return urlRangeValue;
    }
    return initialBoard.day_range ?? 2;
  }, [urlRange, initialBoard.day_range]);

  const [dayRange, setDayRange] = useState(initialRange);
  const lastScrollRestoreKeyRef = useRef<string | null>(null);
  const scrollRestoreAttemptRef = useRef(0);
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
    const parseDateOnly = (value?: string | null) => {
      if (!value) return null;
      const [year, month, day] = value.split("-").map((part) => Number(part));
      if (!year || !month || !day) return null;
      return Date.UTC(year, (month ?? 1) - 1, day ?? 1);
    };
    const utcDateToIso = (ms: number) => new Date(ms).toISOString().split("T")[0];

    googleCalendarEvents.forEach((event) => {
      const baseId = event.id || `gcal-${event.start}`;

      if (event.isAllDay && event.startDate && event.endDate) {
        const startMs = parseDateOnly(event.startDate);
        const endMs = parseDateOnly(event.endDate);
        if (startMs != null && endMs != null && startMs < endMs) {
          let cursorMs = startMs;
          while (cursorMs < endMs) {
            const dayIso = utcDateToIso(cursorMs);
            if (daySet.has(dayIso)) {
              const entry: ExternalCalendarEntry = {
                id: `${baseId}-${dayIso}`,
                eventId: event.id || baseId,
                dayIso,
                title: event.title,
                startMinutes: 0,
                durationMinutes: 24 * 60,
                isAllDay: true,
                source: event.source,
                startDate: event.startDate ?? null,
                endDate: event.endDate ?? null,
                displayTz: event.displayTz ?? null,
                calendarId: event.calendarId ?? null,
              };

              if (!allDayResult[dayIso]) allDayResult[dayIso] = [];
              allDayResult[dayIso].push(entry);
            }
            cursorMs += 24 * 60 * 60 * 1000;
          }
          return;
        }
      }

      const start = new Date(event.start);
      const end = new Date(event.end);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;

      const startMs = start.getTime();
      const endMs = end.getTime();
      let cursorMs = startMs;
      const baseIdFallback = event.id || `gcal-${startMs}`;

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
            id: `${baseIdFallback}-${dayIso}`,
            eventId: event.id || baseIdFallback,
            dayIso,
            title: event.title,
            startMinutes,
            durationMinutes: duration,
            isAllDay: event.isAllDay,
            source: event.source,
            startDate: event.startDate ?? null,
            endDate: event.endDate ?? null,
            displayTz: event.displayTz ?? null,
            calendarId: event.calendarId ?? null,
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
      entries.sort((a, b) => {
        if (a.startDate && b.startDate && a.startDate !== b.startDate) {
          return a.startDate.localeCompare(b.startDate);
        }
        return (a.title || "").localeCompare(b.title || "");
      });
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

      const { eventType, new: newRecord } = payload;
      if (eventType === 'INSERT' || eventType === 'UPDATE' || eventType === 'DELETE') {
        return applyCardUpdate(prev, newRecord as Card, eventType);
      }
      return prev;
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

  const fetchTimeline = useCallback(async (start?: number, options?: { silent?: boolean }) => {
    if (!initialBoard?.id) return null;
    const effectiveStart = typeof start === 'number' ? start : dayWindowStartRef.current;

    if (!options?.silent) {
      setStatus('loading');
    }
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

      if (!options?.silent) {
        setStatus('idle');
      }
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
      setDataMode('mock');
      setStatus('idle'); // Ensure status is idle even on error
      return fallback;
    } finally {
      if (!options?.silent && status === 'loading') {
        setStatus('idle');
      }
    }
  }, [dayRange, initialBoard.id, setDayWindowStart]);

  // Polling Fallback: Refresh board data every 10 seconds only when Realtime is not connected
  useEffect(() => {
    if (!initialBoard.id) return;
    if (!isOnline) return;
    if (realtimeStatus === 'connected') return;

    // Check if we are online and page is visible
    if (typeof document !== 'undefined' && document.hidden) return;

    const intervalId = window.setInterval(() => {
      // Use silent fetch to avoid loading spinners
      fetchTimeline(undefined, { silent: true });
    }, 10000);

    return () => clearInterval(intervalId);
  }, [fetchTimeline, initialBoard.id, isOnline, realtimeStatus]);


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

  const syncCardNowWithToast = useCallback(async (card: Card | null) => {
    if (!card?.due_date || !card?.due_start || !card?.due_end) return;
    try {
      const statusRes = await fetch(`/api/calendar-sync/${card.id}`);
      const statusBody = await statusRes.json().catch(() => null);
      if (!statusRes.ok || statusBody?.status !== 'active') return;
      setGoogleToast('Google同期中...');
      const syncRes = await fetch(`/api/calendar-sync/${card.id}`, { method: 'POST' });
      const syncBody = await syncRes.json().catch(() => null);
      if (!syncRes.ok) {
        setGoogleToast(syncBody?.error?.message ? `同期失敗: ${syncBody.error.message}` : 'Google同期に失敗しました');
        window.setTimeout(() => setGoogleToast(null), 3500);
        return;
      }
      setGoogleToast('Google同期が完了しました');
    } catch (error) {
      console.error('[timeline] immediate sync failed', error);
      setGoogleToast('Google同期に失敗しました');
    } finally {
      window.setTimeout(() => setGoogleToast(null), 3500);
    }
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
          // Use shared logic for update
          setData((prev) => {
            if (!prev) return prev;
            return applyCardUpdate(prev, updatedCard, 'UPDATE');
          });
        }
        // No need to setModalCard here, as the realtime update will handle it
        // and the memoized modalCard will re-evaluate.
        // await fetchTimeline(); // Realtime should handle this
        void syncCardNowWithToast(body?.card as Card);
        closeCardModal();
      } catch (error) {
        console.error('[timeline] save card failed', error);
        setCardModalError(error instanceof Error ? error.message : 'Failed to save card');
      }
    },
    [modalCard, closeCardModal, setCardModalError, setModalCardOverride, setData, syncCardNowWithToast]
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
        // Optimistic delete
        setData((prev) => {
          if (!prev) return prev;
          // Construct a dummy card object for deletion using the ID
          return applyCardUpdate(prev, { id: cardId } as Card, 'DELETE');
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
    return () => clearInterval(interval);
  }, [data?.serverNow]);

  // URLパラメータに基づくactiveDayIndexの初期化
  useEffect(() => {
    if (!data?.days?.length || !urlDate) return;

    const targetIndex = data.days.findIndex(day => day.isoDate === urlDate);

    if (targetIndex >= 0) {
      setActiveDayIndex(targetIndex);
    }
    // urlDateが見つからない場合は何もしない(デフォルトの0のまま)
  }, [data?.days, urlDate]);

  const urlTimeMinutes = useMemo(() => {
    if (!urlTime) return null;
    const timeMinutes = parseInt(urlTime, 10);
    if (isNaN(timeMinutes) || timeMinutes < 0 || timeMinutes >= 24 * 60) return null;
    return timeMinutes;
  }, [urlTime]);

  // スクロール位置の復元（URLのtimeを優先）
  useEffect(() => {
    if (urlTimeMinutes == null || !timelineScrollRef.current || !isTimelineViewMounted) return;

    const restoreKey = `${urlDate ?? ''}|${urlRange ?? ''}|${urlTimeMinutes}`;
    if (lastScrollRestoreKeyRef.current === restoreKey) return;

    scrollRestoreAttemptRef.current = 0;
    let cancelled = false;
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();

    const tryRestore = () => {
      if (cancelled) return;
      const container = timelineScrollRef.current;
      if (!container) return;

      const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
      const desiredTop = minuteToPixels(urlTimeMinutes);
      const clampedTop = Math.max(0, Math.min(desiredTop, maxTop));

      if (Math.abs(container.scrollTop - clampedTop) >= 2) {
        container.scrollTo({ top: clampedTop, behavior: 'auto' });
      }

      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const canReachDesired = maxTop + 1 >= desiredTop;
      const isCloseEnough = Math.abs(container.scrollTop - desiredTop) < 2;

      if (canReachDesired && isCloseEnough) {
        lastScrollRestoreKeyRef.current = restoreKey;
        return;
      }

      // レイアウトが伸びる/縮む途中でも追従できるように、少しの間だけ再試行する
      scrollRestoreAttemptRef.current += 1;
      const timedOut = now - startedAt > 3000;
      if (!timedOut && scrollRestoreAttemptRef.current <= 180) {
        requestAnimationFrame(tryRestore);
        return;
      }

      // 3秒待っても到達できない場合は、現状の最大スクロール位置で確定
      lastScrollRestoreKeyRef.current = restoreKey;
    };

    requestAnimationFrame(tryRestore);
    return () => {
      cancelled = true;
    };
  }, [urlDate, urlRange, urlTimeMinutes, isTimelineViewMounted]);

  useEffect(() => {
    // timeパラメータがある場合は現在時刻へのスクロールをスキップ
    if (urlTime) {
      if (!hasAutoScrolled) setHasAutoScrolled(true);
      return;
    }

    if (!isTimelineViewMounted || !timelineScrollRef.current || indicatorMinutes == null || hasAutoScrolled) return;

    const container = timelineScrollRef.current;
    const target = minuteToPixels(indicatorMinutes) - container.clientHeight / 2;

    const clampedTop = Math.max(0, Math.min(target, container.scrollHeight - container.clientHeight));

    container.scrollTo({
      top: clampedTop,
      behavior: 'auto',
    });

    setHasAutoScrolled(true);
  }, [timelineScrollRef, indicatorMinutes, hasAutoScrolled, urlTime]);

  // スクロールイベントハンドラ(デバウンス付き)
  const stateRef = useRef({ data, activeDayIndex, dayRange, updateUrl });
  // レンダリング毎に最新のstateをrefに保持
  stateRef.current = { data, activeDayIndex, dayRange, updateUrl };

  // スクロールイベントハンドラ(デバウンス付き) - refを使用して依存関係を排除
  const handleTimelineScroll = useCallback((arg?: number | React.UIEvent<HTMLDivElement>) => {
    // 数値が渡されたらそれを使う、イベントならcurrentTarget、なければrefから取得
    let scrollTop: number | undefined;

    if (typeof arg === 'number') {
      scrollTop = arg;
    } else if (arg && 'currentTarget' in arg) {
      scrollTop = arg.currentTarget.scrollTop;
    } else {
      scrollTop = timelineScrollRef.current?.scrollTop;
    }

    if (scrollTop == null) return;

    // refから最新のstateを取得
    const { data, activeDayIndex, dayRange, updateUrl } = stateRef.current;

    const minutes = pixelsToMinutes(scrollTop);
    const currentDay = data?.days?.[activeDayIndex];

    if (currentDay) {
      updateUrl(currentDay.isoDate, dayRange, minutes);
    }
  }, []); // 依存配列は空にして再生成を防ぐ

  const debouncedHandleScroll = useDebounce(handleTimelineScroll, 500);

  // スクロールイベントリスナーの登録


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

  const handleExternalEventClick = useCallback(async (entry: ExternalCalendarEntry) => {
    try {
      const googleEventId = entry.eventId ?? entry.id;
      const res = await fetch('/api/calendar/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ google_event_id: googleEventId }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const details = body?.error?.details ? ` (${body.error.details})` : '';
        throw new Error((body?.error?.message || 'Failed to sync Google event') + details);
      }
      await fetchTimeline(0);
      await refreshGoogleCalendar();
      setGoogleToast('GoogleイベントをTaeskカードに変換しました');

      // Open the card modal for the newly created card
      if (body?.card?.short_id) {
        openCardModal(body.card.short_id, 'gcard-convert');
      }
    } catch (error) {
      console.error('convert failed', error);
      const msg = error instanceof Error ? error.message : 'Failed to sync Google event';
      alert(`変換に失敗しました: ${msg}`);
    }
  }, [fetchTimeline, refreshGoogleCalendar, openCardModal]);

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
      const newIndex = Math.max(0, activeDayIndex - 1);
      setActiveDayIndex(newIndex);

      // URL更新
      const targetDay = data?.days?.[newIndex];
      const currentScrollTop = timelineScrollRef.current?.scrollTop ?? 0;
      const currentTime = pixelsToMinutes(currentScrollTop);
      if (targetDay) {
        updateUrl(targetDay.isoDate, dayRange, currentTime);
      }
      return;
    }

    const baseStart = data?.startOffset ?? dayWindowStartRef.current ?? 0;
    const payload = await fetchTimeline(baseStart - 1);
    const nextDaysLength = payload?.days?.length ?? 0;
    const newIndex = clampActiveDayIndex(nextDaysLength, 0);
    setActiveDayIndex(newIndex);

    // URL更新
    const targetDay = payload?.days?.[newIndex];
    const currentScrollTop = timelineScrollRef.current?.scrollTop ?? 0;
    const currentTime = pixelsToMinutes(currentScrollTop);
    if (targetDay) {
      updateUrl(targetDay.isoDate, dayRange, currentTime);
    }
  }, [activeDayIndex, clampActiveDayIndex, data?.startOffset, data?.days, fetchTimeline, status, dayRange, updateUrl]);

  const handleNextDay = useCallback(async () => {
    if (status === 'loading' || !data?.days?.length) return;
    const lastStartIndex = Math.max(0, data.days.length - dayRange);
    if (activeDayIndex < lastStartIndex) {
      const newIndex = Math.min(lastStartIndex, activeDayIndex + 1);
      setActiveDayIndex(newIndex);

      // URL更新
      const targetDay = data?.days?.[newIndex];
      const currentScrollTop = timelineScrollRef.current?.scrollTop ?? 0;
      const currentTime = pixelsToMinutes(currentScrollTop);
      if (targetDay) {
        updateUrl(targetDay.isoDate, dayRange, currentTime);
      }
      return;
    }

    const baseStart = data?.startOffset ?? dayWindowStartRef.current ?? 0;
    const payload = await fetchTimeline(baseStart + 1);
    const nextDaysLength = payload?.days?.length ?? 0;
    const newIndex = clampActiveDayIndex(nextDaysLength, nextDaysLength ? nextDaysLength - dayRange : 0);
    setActiveDayIndex(newIndex);

    // URL更新
    const targetDay = payload?.days?.[newIndex];
    const currentScrollTop = timelineScrollRef.current?.scrollTop ?? 0;
    const currentTime = pixelsToMinutes(currentScrollTop);
    if (targetDay) {
      updateUrl(targetDay.isoDate, dayRange, currentTime);
    }
  }, [activeDayIndex, clampActiveDayIndex, data?.days?.length, data?.days, data?.startOffset, fetchTimeline, status, dayRange, updateUrl]);

  const bucketDayMap = useMemo(() => {
    const result: Record<string, string | null> = {};
    data?.days?.forEach((day) => {
      result[`${day.key}_a`] = day.isoDate;
      result[`${day.key}_b`] = day.isoDate;
    });
    return result;
  }, [data?.days]);

  // dayRange変更ハンドラ
  const handleDayRangeChange = useCallback((newRange: number) => {
    setDayRange(newRange);

    const currentDay = data?.days?.[activeDayIndex];
    const currentScrollTop = timelineScrollRef.current?.scrollTop ?? 0;
    const currentTime = pixelsToMinutes(currentScrollTop);

    if (currentDay) {
      updateUrl(currentDay.isoDate, newRange, currentTime);
    }
  }, [data?.days, activeDayIndex, updateUrl]);

  // Todayボタンハンドラ (router.pushを使用して履歴に追加)
  const handleTodayClick = useCallback(async () => {
    await fetchTimeline(0);
    setActiveDayIndex(0);

    const todayIso = data?.days?.[0]?.isoDate;
    const currentScrollTop = timelineScrollRef.current?.scrollTop ?? 0;
    const currentTime = pixelsToMinutes(currentScrollTop);

    if (todayIso) {
      const params = new URLSearchParams();
      params.set('date', todayIso);
      params.set('range', String(dayRange));
      if (currentTime >= 0) {
        params.set('time', String(currentTime));
      }

      const newUrl = `${window.location.pathname}?${params.toString()}`;
      router.push(newUrl, { scroll: false }); // pushを使用
    }
  }, [fetchTimeline, data?.days, dayRange, router]);

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
    // 初回レンダー（viewportHeight未確定）でもタイムライン全体の高さは確保しておく
    // （time=... のスクロール復元が、レイアウト確定前にクランプされるのを防ぐ）
    if (viewportHeight == null) return Math.max(TIMELINE_MIN_VIEWPORT, TIMELINE_HEIGHT);
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

          let next = prev;
          if (tempId) {
            // Remove temp card first
            next = applyCardUpdate(next, { id: tempId } as Card, 'DELETE');
          }
          // Add real card
          return applyCardUpdate(next, newCard, 'INSERT');
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
            onDayRangeChange={handleDayRangeChange}
            onTodayClick={handleTodayClick}
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
            realtimeStatus={realtimeStatus}
          />

          {/* Google Calendar controls moved to header */}
          {googleToast && (
            <div className="rounded-lg bg-emerald-600 px-3 py-2 text-sm text-white shadow-md">
              {googleToast}
            </div>
          )}

          <div className="hidden md:block">
            <DesktopTimelineView
              onMount={() => {
                setIsTimelineViewMounted(true);
                syncActiveTimelineScrollRef();
              }}
              onScroll={debouncedHandleScroll}
              timelineHeaderRef={timelineHeaderRef}
              timelineScrollRef={desktopTimelineScrollRef}
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
              sensors={sensors}
              handleDragStart={handleDragStart}
              handleDragMove={handleDragMove}
              handleDragEnd={handleDragEnd}
              handleDragCancel={handleDragCancel}
              isOverABList={isOverABList}
              floatingLayerTop={floatingLayerTop}
              calendarEventsByDay={calendarEventsByDay}
              calendarAllDayByDay={calendarAllDayEventsByDay}
              onExternalEventClick={handleExternalEventClick}
            />
          </div>

          <div className="md:hidden">
            <div className="relative h-[calc(100vh-140px)] overflow-hidden bg-white shadow-sm ring-1 ring-black/5">
              <MobileTimelineView
                timelineScrollRef={mobileTimelineScrollRef}
                onMount={() => {
                  setIsTimelineViewMounted(true);
                  syncActiveTimelineScrollRef();
                }}
                onScroll={debouncedHandleScroll}
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
                onExternalEventClick={handleExternalEventClick}
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
