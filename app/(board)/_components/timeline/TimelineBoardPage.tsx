"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Board, Card, DueBucket, Priority } from "@/lib/supabase";
import { flattenChecklistText } from "@/lib/checklist";
import {
  buildDocumentFromTitle,
  deriveExcerptFromDocument,
  getDocumentPlainText,
  normalizeBlockNoteDocument,
  type BlockNoteDocument,
} from "@/lib/blocknote";
import { buildBoardUrl } from "@/lib/board-url";

import { CardModal } from "@/app/components/CardModal";
import { slugify } from "@/lib/card-utils";
import { useAuth } from "@/app/contexts/AuthContext";
import TimelineBoardHeader from "@/app/(board)/_components/timeline/TimelineBoardHeader";
import TimelineBoardDialogs from "@/app/(board)/_components/timeline/TimelineBoardDialogs";
import { DesktopTimelineView } from "@/app/(board)/_components/timeline/DesktopTimelineView";
import MobileTimelineView from "@/app/(board)/_components/timeline/MobileTimelineView";
import {
  TIMELINE_HEIGHT,
  TIMELINE_MIN_VIEWPORT,
  TIMELINE_HEADER_ESTIMATE,
  DEFAULT_TIMELINE_DAY_RANGE,
  minuteToPixels,
  pixelsToMinutes,
  getMinutesFromTime,
  getNowMinutesJst,
  getIsoDateJst,
  minutesToTime,
  withJstMidnight,
  type UserProfile,
  type TimelineDay,
  type TimelineEvent,
  type TimelineBucketItem,
  type ExternalCalendarEntry,
} from "@/app/(board)/_utils/timeline-helpers";
import { buildMockTimeline } from "@/app/(board)/_utils/timeline-board-helpers";

import { useBoardFilters } from "@/app/(board)/_hooks/useBoardFilters";
import { useTimelineDragAndDrop } from "@/app/(board)/_hooks/useTimelineDragAndDrop";
import { useTimelineCalendar } from "@/app/(board)/_hooks/useTimelineCalendar";
import { bucketKeyToDueBucket, normalizeDueBucket } from "@/lib/bucket-normalization";
import { useCardModal } from "@/app/(board)/_hooks/useCardModal";
import { MAIN_BOARD_ID } from "@/lib/board-defaults";
import { ResyncCandidate, fetchResyncCandidates } from "@/app/(board)/_utils/resync";
import { applyCardUpdate } from "@/app/(board)/_utils/card-updates";
import { useTimelineUrlState } from "@/app/(board)/_hooks/useTimelineUrlState";
import { useTimelineScrollSync } from "@/app/(board)/_hooks/useTimelineScrollSync";
import { useTimelineData } from "@/app/(board)/_hooks/useTimelineData";

type TimelineBoardPageProps = {
  initialBoard: Board;
};

const DAY_WINDOW_RANGE = DEFAULT_TIMELINE_DAY_RANGE;


const buildMockTimelineResponse = () => buildMockTimeline(DAY_WINDOW_RANGE);

export default function TimelineBoardPage({ initialBoard }: TimelineBoardPageProps) {
  const {
    urlDate,
    urlRange,
    urlTime,
    initialRange,
    setDayWindowStart,
    dayWindowStartRef,
    updateUrl,
  } = useTimelineUrlState({ initialDayRange: initialBoard.day_range });

  const [liveNowMinutes, setLiveNowMinutes] = useState<number | null>(null);
  const [liveNowIsoDate, setLiveNowIsoDate] = useState<string | null>(null);
  const abScrollContainersRef = useRef<Record<string, HTMLDivElement | null>>({});
  const timelineHeaderRef = useRef<HTMLDivElement | null>(null);
  const [timelineHeaderHeight, setTimelineHeaderHeight] = useState(TIMELINE_HEADER_ESTIMATE);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const router = useRouter();
  const saveAbortRef = useRef<AbortController | null>(null);
  const saveRequestIdRef = useRef(0);
  const [availableBoards, setAvailableBoards] = useState<Board[]>([initialBoard]);
  const [showBoardMenu, setShowBoardMenu] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const { user, signOut } = useAuth();

  const [activeDayIndex, setActiveDayIndex] = useState(0);

  const [dayRange, setDayRange] = useState(initialRange);
  const [calendarPreset, setCalendarPreset] = useState<'visible' | 'this-week' | 'next-week'>('visible');
  const prevGoogleStatusRef = useRef<string | null>(null);
  const [googleToast, setGoogleToast] = useState<string | null>(null);

  const {
    data,
    setData,
    status,
    setErrorMessage,
    dataMode,
    fetchTimeline,
    realtimeStatus,
  } = useTimelineData({
    initialBoard,
    dayRange,
    dayWindowStartRef,
    setDayWindowStart,
    buildMockTimelineResponse,
  });

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

  const {
    calendarEventsByDay,
    calendarAllDayEventsByDay,
    googleCalendarEvents,
    googleCalendarStatus,
    googleCalendarError,
    refreshGoogleCalendar,
  } = useTimelineCalendar({
    calendarPreset,
    calendarRangeStart,
    calendarRangeEnd,
    days: data?.days ?? [],
  });

  // Realtime & Sync
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
    async (savePayload: {
      id: string;
      title: string;
      content: BlockNoteDocument | Record<string, any>;
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
    }) => {
      // Use the memoized modalCard for targetCard
      const targetCard = modalCard && modalCard.id === savePayload.id ? modalCard : null;
      if (!targetCard) return;
      let requestId = 0;
      try {
        const nextAssignee = savePayload.assigneeIds && savePayload.assigneeIds.length > 0 ? savePayload.assigneeIds[0] : null;
        let normalizedDueDate: string | null = null;
        if (savePayload.due_date) {
          const parsed = new Date(savePayload.due_date);
          if (!Number.isNaN(parsed.getTime())) {
            normalizedDueDate = parsed.toISOString();
          }
        }
        const payload: Record<string, unknown> = {
          title: savePayload.title,
          content: Array.isArray(savePayload.content) ? normalizeBlockNoteDocument(savePayload.content) : savePayload.content,
          excerpt: savePayload.excerpt ?? "",
          tags: savePayload.tags,
          due_date: normalizedDueDate,
          due_start: savePayload.due_start,
          due_end: savePayload.due_end,
          due_bucket: normalizeDueBucket(savePayload.due_bucket),
          due_bucket_position: savePayload.due_bucket_position,
          priority: savePayload.priority,
          slug: slugify(savePayload.title),
        };
        if (savePayload.assigneeTouched) {
          payload.assignee_id = nextAssignee;
          payload.assignee_ids = savePayload.assigneeIds && savePayload.assigneeIds.length > 0 ? savePayload.assigneeIds : null;
          payload.assigned_to = null;
        }
        console.log('[timeline] Sending card update payload:', payload);
        if (saveAbortRef.current) {
          saveAbortRef.current.abort();
        }
        requestId = ++saveRequestIdRef.current;
        const controller = new AbortController();
        saveAbortRef.current = controller;
        const response = await fetch(`/api/boards/${targetCard.board_id}/cards/${targetCard.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        const body = await response.json().catch(() => null);
        if (requestId !== saveRequestIdRef.current) {
          return;
        }
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

        if (!savePayload.isAutoSave) {
          // Only sync if not auto-save and title/time changed
          const titleChanged = targetCard.title !== savePayload.title;
          const dateChanged = targetCard.due_date !== normalizedDueDate;
          const startChanged = (targetCard.due_start ? targetCard.due_start.slice(0, 5) : null) !== (savePayload.due_start ? savePayload.due_start.slice(0, 5) : null);
          const endChanged = (targetCard.due_end ? targetCard.due_end.slice(0, 5) : null) !== (savePayload.due_end ? savePayload.due_end.slice(0, 5) : null);

          if (titleChanged || dateChanged || startChanged || endChanged) {
            console.log('[timeline] syncing with google calendar because title or time changed', { titleChanged, dateChanged, startChanged, endChanged });
            void syncCardNowWithToast(body?.card as Card);
          } else {
            console.log('[timeline] skipping google calendar sync - no title or time change');
          }
          closeCardModal();
        }
      } catch (error) {
        const isAbortError =
          error instanceof DOMException
            ? error.name === 'AbortError'
            : (error as { name?: string }).name === 'AbortError';
        if (isAbortError) {
          return;
        }
        console.error('[timeline] save card failed', error);
        setCardModalError(error instanceof Error ? error.message : 'Failed to save card');
      } finally {
        if (requestId > 0 && requestId === saveRequestIdRef.current) {
          saveAbortRef.current = null;
        }
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

    const filterItem = (item: {
      title: string;
      tags: string[];
      priority?: string | null;
      checked: boolean;
      excerpt?: string | null;
      content?: BlockNoteDocument | Record<string, any> | null;
      checklist?: unknown;
    }) => {
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
        let contentText = "";
        if (Array.isArray(item.content)) {
          contentText = getDocumentPlainText(normalizeBlockNoteDocument(item.content));
        } else if (item.content && typeof item.content === 'object') {
          // Tiptap - simple extraction or ignore
          // Simple hack: JSON.stringify or use generic extractor. 
          // Ideally import getTiptapPlainText but avoiding new imports if possible.
          // Let's just stringify values for search? No, that includes keys. 
          // Leaving empty for object content for now to avoid breaking build, or simple extraction.
          // Actually, import { getTiptapPlainText } from "@/lib/tiptap"; is needed. 
          // I'll add the import in a separate chunk or let it be generic. 
          // For now: 
          try {
            // Basic deep search for 'text' keys
            const extract = (n: any): string => {
              if (!n) return "";
              if (typeof n === 'string') return "";
              if (n.text) return n.text;
              if (n.content && Array.isArray(n.content)) return n.content.map(extract).join(" ");
              return "";
            }
            contentText = extract(item.content);
          } catch (e) { contentText = ""; }
        }
        const checklistText = flattenChecklistText((item as any).checklist ?? null);
        const source = `${item.title ?? ''} ${(item.tags ?? []).join(' ')} ${item.excerpt ?? ''} ${contentText} ${checklistText}`.toLowerCase();
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

  const {
    timelineScrollRef,
    desktopTimelineScrollRef,
    mobileTimelineScrollRef,
    debouncedHandleScroll,
    handleTimelineViewMount,
  } = useTimelineScrollSync({
    urlDate,
    urlRange,
    urlTime,
    data,
    activeDayIndex,
    dayRange,
    indicatorMinutes,
    updateUrl,
  });

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
    const payload = await fetchTimeline(0);
    setActiveDayIndex(0);

    const todayIso = payload?.days?.[0]?.isoDate ?? data?.days?.[0]?.isoDate;
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
    abScrollContainersRef,
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

  const createCard = useCallback(async (payload: Partial<Card>, tempId?: string, options?: { openModal?: boolean }) => {
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

        // Auto-open modal for the new card (default: true)
        if (options?.openModal !== false && newCard.short_id) {
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
            events: prev.events.filter((e) => e.card_id !== tempId),
            abBuckets: Object.fromEntries(
              Object.entries(prev.abBuckets).map(([key, items]) => [
                key,
                items.filter((item) => item.card_id !== tempId),
              ])
            ),
          };
        });
      }
    }
  }, [dataMode, initialBoard.id, setData, openCardModal]);

  const handleColumnClick = useCallback((day: TimelineDay, minutes: number) => {
    console.debug('[timeline] column click', { day, minutes });
    const title = `New card ${Date.now()}`;
    const content = buildDocumentFromTitle(title);
    const excerpt = deriveExcerptFromDocument(content);

    const payload: Partial<Card> = {
      title,
      content,
      excerpt,
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
      excerpt,
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

  const resolveBucketInsertPosition = useCallback((items: TimelineBucketItem[], afterCardId?: string) => {
    const now = Date.now();
    if (!items.length) return now;
    if (!afterCardId) {
      const maxPos = items.reduce((acc, item) => (item.bucketPosition != null ? Math.max(acc, item.bucketPosition) : acc), -Infinity);
      return Number.isFinite(maxPos) ? maxPos + 1000 : now;
    }

    const index = items.findIndex((item) => item.card_id === afterCardId);
    if (index < 0) return now;
    const target = items[index];
    const next = items[index + 1];
    const targetPos = target?.bucketPosition;
    const nextPos = next?.bucketPosition;

    if (targetPos != null && nextPos != null) return (targetPos + nextPos) / 2;
    if (targetPos != null) return targetPos - 1000;
    return now;
  }, []);

  const handleBucketClick = useCallback(
    (bucketKey: string, afterCardId?: string) => {
      const isoDate = bucketDayMap[bucketKey];
      if (!isoDate) return;

      const now = Date.now();
      const dueBucket = bucketKeyToDueBucket(bucketKey);
      const title = `New card ${now}`;
      const content = buildDocumentFromTitle(title);
      const excerpt = deriveExcerptFromDocument(content);
      const tempId = `temp-${now}`;

      const position = resolveBucketInsertPosition((data?.abBuckets?.[bucketKey] ?? []) as TimelineBucketItem[], afterCardId);

      const payload: Partial<Card> = {
        title,
        content,
        excerpt,
        tags: [],
        due_date: withJstMidnight(isoDate),
        due_start: null,
        due_end: null,
        due_bucket: dueBucket,
        due_bucket_position: position,
        priority: 'medium',
      };

      // Optimistic update to show card immediately
      setData((prev) => {
        if (!prev) return prev;
        const nextBuckets = { ...prev.abBuckets };
        const currentItems = nextBuckets[bucketKey] ?? [];
        const nextPosition = resolveBucketInsertPosition(currentItems, afterCardId);
        const optimisticItem: TimelineBucketItem = {
          card_id: tempId,
          title,
          excerpt,
          due_date: isoDate,
          due_start: null,
          due_end: null,
          checked: false,
          tags: [],
          assignee_id: null,
          assignee_ids: null,
          assigned_to: null,
          short_id: null,
          slug: null,
          bucketPosition: nextPosition,
        };

        nextBuckets[bucketKey] = [optimisticItem, ...currentItems].sort(
          (a, b) => (b.bucketPosition ?? 0) - (a.bucketPosition ?? 0)
        );
        return { ...prev, abBuckets: nextBuckets };
      });

      createCard(payload, tempId, { openModal: false });
    },
    [bucketDayMap, createCard, data?.abBuckets, resolveBucketInsertPosition, setData]
  );

  // Show modal as soon as we have a card (e.g., from timeline data), even while the API is still loading.
  const shouldShowCardModal = Boolean(modalCard && (cardModalStatus === 'ready' || cardModalStatus === 'loading'));
  const modalBoards = availableBoards;
  const hasActiveFilters = searchQuery.trim() !== '' || selectedTags.length > 0 || selectedPriority !== 'all';
  const floatingLayerTop = timelineHeaderHeight;

  return (
    <>
      <div className="min-h-screen bg-[#f4f5f7]">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 pt-6">
          <TimelineBoardHeader
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
            availableTags={data?.availableTags ?? []}
            dayRange={dayRange}
            onDayRangeChange={setDayRange}
            onTodayClick={handleTodayClick}
            onUpdateBoard={async (updates) => {
              try {
                const response = await fetch(`/api/boards/${initialBoard.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(updates),
                });
                if (!response.ok) throw new Error("Failed to update board");
                const { board: updatedBoard } = await response.json();

                Object.assign(initialBoard, updatedBoard);

                setAvailableBoards((prev) =>
                  prev.map((board) => (board.id === updatedBoard.id ? updatedBoard : board)),
                );
              } catch (error) {
                console.error("Failed to update board", error);
                alert("Failed to update board");
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
            googleToast={googleToast}
          />

          <div className="hidden md:block">
            <DesktopTimelineView
              onMount={handleTimelineViewMount}
              onScroll={debouncedHandleScroll}
              timelineHeaderRef={timelineHeaderRef}
              timelineScrollRef={desktopTimelineScrollRef}
              registerAbScrollContainer={(dayIso, el) => {
                abScrollContainersRef.current[dayIso] = el;
              }}
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
              onCreateBucketCard={handleBucketClick}
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
                onMount={handleTimelineViewMount}
                onScroll={debouncedHandleScroll}
                registerAbScrollContainer={(dayIso, el) => {
                  abScrollContainersRef.current[dayIso] = el;
                }}
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
                onCreateBucketCard={handleBucketClick}
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
      <TimelineBoardDialogs
        showShareDialog={showShareDialog}
        setShowShareDialog={setShowShareDialog}
        showNotificationSettings={showNotificationSettings}
        setShowNotificationSettings={setShowNotificationSettings}
        showProfileSettings={showProfileSettings}
        setShowProfileSettings={setShowProfileSettings}
        showBoardSettings={showBoardSettings}
        setShowBoardSettings={setShowBoardSettings}
        initialBoard={initialBoard}
        fetchProfile={fetchProfile}
        setAvailableBoards={setAvailableBoards}
        setActiveDayIndex={setActiveDayIndex}
        fetchTimeline={fetchTimeline}
      />
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
