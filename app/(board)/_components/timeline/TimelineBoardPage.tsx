"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Board } from "@/lib/supabase";
import { buildBoardUrl } from "@/lib/board-url";
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  PointerSensor,
  useDroppable,
  useDraggable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { createClientTrace } from "@/lib/metrics/client";
import type { ClientTrace } from "@/lib/metrics/client";

const HOUR_HEIGHT = 40;
const HOURS = Array.from({ length: 24 }, (_, hour) => `${hour.toString().padStart(2, "0")}:00`);
const TIMELINE_HEIGHT = HOUR_HEIGHT * 24;

const AB_CARD_META: Record<string, { title: string; sections: Array<{ bucket: string; label: string; helper: string }> }> = {
  today: {
    title: 'A/B Today',
    sections: [
      { bucket: 'today_a', label: 'A: do today (not scheduled)', helper: 'Critical tasks' },
      { bucket: 'today_b', label: 'B: if possible today', helper: 'Stretch tasks' },
    ],
  },
  tomorrow: {
    title: 'A/B Tomorrow',
    sections: [
      { bucket: 'tomorrow_a', label: 'A: do tomorrow', helper: 'Planned focus' },
      { bucket: 'tomorrow_b', label: 'B: if possible tomorrow', helper: 'Backlog' },
    ],
  },
};

interface TimelineDay {
  key: string;
  label: string;
  isoDate: string;
}

interface TimelineEvent {
  card_id: string;
  due_date: string;
  due_start: string | null;
  due_end: string | null;
  durationMinutes: number | null;
  title: string;
  tags: string[];
  priority: string | null;
  checked: boolean;
  short_id: string | null;
  slug: string | null;
}

interface TimelineBucketItem {
  card_id: string;
  title: string;
  due_date: string | null;
  due_start: string | null;
  due_end: string | null;
  checked: boolean;
  tags: string[];
  short_id: string | null;
  slug: string | null;
}

interface TimelineResponse {
  days: TimelineDay[];
  events: TimelineEvent[];
  abBuckets: Record<string, TimelineBucketItem[]>;
  serverNow: string;
}

const minuteToPixels = (minutes: number) => (minutes / 60) * HOUR_HEIGHT;
const getMinutesFromTime = (value: string | null) => {
  if (!value) return null;
  const [hours, minutes] = value.split(":");
  const h = Number(hours ?? "0");
  const m = Number(minutes ?? "0");
  return h * 60 + m;
};
const getNowMinutesJst = (timestamp: string) => {
  const current = new Date(timestamp);
  const minutes = current.getUTCMinutes();
  const hours = (current.getUTCHours() + 9 + 24) % 24;
  return hours * 60 + minutes;
};
const minutesToTime = (value: number) => {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, value));
  const hours = Math.floor(clamped / 60) % 24;
  const minutes = clamped % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`;
};
const timeLabel = (start: string | null, end: string | null) => {
  if (!start && !end) return 'Anytime';
  const toLabel = (value: string | null) => (value ? value.slice(0, 5) : '--:--');
  return `${toLabel(start)} – ${toLabel(end)}`;
};

type TimelineBoardPageProps = {
  initialBoard: Board;
};

type ActiveDragState = {
  cardId: string;
  startMinutes: number;
  duration: number;
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
        { card_id: 'mock-finish-spec', title: 'Finish spec', due_date: null, due_start: null, due_end: null, checked: false, tags: [], short_id: null, slug: null },
        { card_id: 'mock-prepare-meeting', title: 'Prepare meeting', due_date: null, due_start: null, due_end: null, checked: false, tags: [], short_id: null, slug: null },
        { card_id: 'mock-fix-bug', title: 'Fix bug #123', due_date: null, due_start: null, due_end: null, checked: false, tags: [], short_id: null, slug: null },
      ],
      today_b: [
        { card_id: 'mock-organize-docs', title: 'Organize docs', due_date: null, due_start: null, due_end: null, checked: false, tags: [], short_id: null, slug: null },
        { card_id: 'mock-break-task', title: 'Break down big task', due_date: null, due_start: null, due_end: null, checked: false, tags: [], short_id: null, slug: null },
      ],
      tomorrow_a: [
        { card_id: 'mock-finish-review', title: 'Finish review', due_date: null, due_start: null, due_end: null, checked: false, tags: [], short_id: null, slug: null },
        { card_id: 'mock-prepare-slides', title: 'Prepare slides', due_date: null, due_start: null, due_end: null, checked: false, tags: [], short_id: null, slug: null },
      ],
      tomorrow_b: [
        { card_id: 'mock-refactor', title: 'Refactor old code', due_date: null, due_start: null, due_end: null, checked: false, tags: [], short_id: null, slug: null },
        { card_id: 'mock-research', title: 'Research item', due_date: null, due_start: null, due_end: null, checked: false, tags: [], short_id: null, slug: null },
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
  const [dataMode, setDataMode] = useState<DataMode>('api');
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();
  const canonicalBoardPath = useMemo(() => buildBoardUrl(initialBoard), [initialBoard]);
  const traceRef = useRef<ClientTrace | null>(createClientTrace('timeline'));

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

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

  const eventsByDay = useMemo(() => {
    if (!data) return {} as Record<string, TimelineEvent[]>;
    return data.days.reduce((acc, day) => {
      acc[day.isoDate] = data.events.filter((event) => event.due_date === day.isoDate);
      return acc;
    }, {} as Record<string, TimelineEvent[]>);
  }, [data]);

  const nowMinutes = useMemo(() => (data ? getNowMinutesJst(data.serverNow) : null), [data]);

  useEffect(() => {
    if (!timelineScrollRef.current || nowMinutes == null) return;
    const container = timelineScrollRef.current;
    const target = minuteToPixels(nowMinutes) - container.clientHeight / 2;
    const clamped = Math.max(0, Math.min(target, TIMELINE_HEIGHT - container.clientHeight));
    container.scrollTop = clamped;
  }, [nowMinutes]);

  const applyPatch = useCallback(
    async (cardId: string, payload: Record<string, unknown>) => {
      if (dataMode !== 'api') return;
      try {
        await fetch(`/api/boards/${initialBoard.id}/cards/${cardId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        fetchTimeline();
      } catch (error) {
        console.error('[timeline] update error', error);
        setErrorMessage('Failed to update card');
      }
    },
    [dataMode, fetchTimeline, initialBoard.id]
  );

  const openCardModalFromTimeline = useCallback((shortId: string | null) => {
    if (dataMode !== 'api') return;
    if (!shortId) return;
    if (canonicalBoardPath) {
      router.push(`${canonicalBoardPath}?card=${shortId}`);
    } else {
      router.push(`/c/${shortId}`);
    }
  }, [canonicalBoardPath, dataMode, router]);

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
    if (dataMode !== 'api') return;
    const cardId = event.active.data.current?.cardId as string | undefined;
    if (!cardId) return;
    const kind = event.active.data.current?.kind as 'event' | 'bucket';
    if (kind === 'event') {
      const eventData = event.active.data.current?.event as TimelineEvent;
      const startMinutes = getMinutesFromTime(eventData?.due_start ?? null) ?? 0;
      const duration = Math.max(eventData.durationMinutes ?? 60, 15);
      setActiveDrag({ cardId, startMinutes, duration });
    } else {
      setActiveDrag({ cardId, startMinutes: 9 * 60, duration: 60 });
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    if (dataMode !== 'api') {
      setActiveDrag(null);
      return;
    }
    const { active, over, delta } = event;
    setActiveDrag(null);

    if (!over) return;
    const cardId = active.data.current?.cardId as string | undefined;
    if (!cardId) return;

    const overType = over.data.current?.type;

    if (overType === 'timeline-column' && activeDrag) {
      const day = over.data.current?.day as TimelineDay | undefined;
      if (!day) return;
      const minutesDelta = (delta.y / HOUR_HEIGHT) * 60;
      let nextStart = activeDrag.startMinutes + minutesDelta;
      nextStart = Math.round(nextStart / 15) * 15;
      nextStart = Math.max(0, Math.min(23 * 60 + 45, nextStart));
      const nextEnd = nextStart + activeDrag.duration;

      applyPatch(cardId, {
        due_channel: 'timeline',
        due_bucket: null,
        due_date: day.isoDate,
        due_start: minutesToTime(nextStart),
        due_end: minutesToTime(Math.min(nextEnd, 24 * 60 - 1)),
      });
      return;
    }

    if (overType === 'ab-bucket') {
      const bucketKey = over.data.current?.bucketKey as string;
      const dayIso = bucketDayMap[bucketKey] ?? null;
      applyPatch(cardId, {
        due_channel: 'ab-list',
        due_bucket: bucketKey,
        due_date: dayIso,
        due_start: null,
        due_end: null,
      });
    }
  };

  const renderEvent = (event: TimelineEvent) => {
    const start = getMinutesFromTime(event.due_start ?? null) ?? 0;
    const duration = Math.max(event.durationMinutes ?? 60, 30);
    const top = minuteToPixels(start);
    const height = Math.max(minuteToPixels(duration), 32);

    return (
      <DraggableCard key={event.card_id} id={`event:${event.card_id}`} data={{ kind: 'event', event, cardId: event.card_id }}>
        <button
          type="button"
          disabled={dataMode !== 'api'}
          onClick={() => openCardModalFromTimeline(event.short_id)}
          className="absolute left-4 right-4 flex flex-col gap-1 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
          style={{ top, height }}
        >
          <p className="text-xs font-semibold text-slate-800 line-clamp-2">{event.title || 'Untitled card'}</p>
          <p className="text-[10px] text-slate-500">{timeLabel(event.due_start, event.due_end)}</p>
        </button>
      </DraggableCard>
    );
  };

  const renderAbCard = (day: TimelineDay) => {
    const meta = AB_CARD_META[day.key];
    if (!meta) return null;

    return (
      <div className="pointer-events-auto rounded-2xl border border-slate-100 bg-white/95 p-4 shadow-xl ring-1 ring-black/5">
        <div className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-500">
          <span>{meta.title}</span>
          <span>{day.isoDate}</span>
        </div>
        <div className="mt-3 space-y-4">
          {meta.sections.map((section) => {
            const items = data?.abBuckets?.[section.bucket] ?? [];
            return (
              <DroppableBucket key={section.bucket} bucketKey={section.bucket}>
                <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                  <p className="text-[11px] font-semibold text-slate-600">{section.label}</p>
                  <p className="text-[10px] text-slate-400">{section.helper}</p>
                  <div className="mt-2 space-y-1">
                    {items.length === 0 ? (
                      <p className="text-[11px] text-slate-400">Drop cards here</p>
                    ) : (
                      items.slice(0, 3).map((item) => (
                        <div key={item.card_id} className="rounded-md bg-white px-3 py-2 text-xs shadow-sm">
                          <label className="flex items-start gap-2 text-slate-700">
                            <input
                              type="checkbox"
                              checked={item.checked}
                              readOnly
                              className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-sky-500"
                            />
                            <button
                              type="button"
                              onClick={() => dataMode === 'api' && openCardModalFromTimeline(item.short_id)}
                              className="flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                            >
                              <span className="block line-clamp-2">{item.title || 'Untitled card'}</span>
                              {item.due_start && (
                                <span className="text-[10px] text-slate-400">{timeLabel(item.due_start, item.due_end)}</span>
                              )}
                            </button>
                          </label>
                        </div>
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

    return (
      <DroppableColumn key={day.isoDate} day={day}>
        <div className="relative h-full border-l border-slate-100 px-2 pb-8">
          <div className="pointer-events-none absolute inset-0">
            {HOURS.map((hour, idx) => (
              <div key={hour} className="absolute left-0 right-0 border-b border-dashed border-slate-100/70" style={{ top: idx * HOUR_HEIGHT }} />
            ))}
          </div>

          <div className="pointer-events-none absolute left-4 right-4 top-4 z-10 drop-shadow-md">
            {renderAbCard(day)}
          </div>

          <div className="relative pt-56" style={{ height: TIMELINE_HEIGHT }}>
            {index === 0 && nowMinutes != null && (
              <>
                <div className="pointer-events-none absolute left-0 right-0 h-px bg-red-400/80" style={{ top: minuteToPixels(nowMinutes) }} />
                <div className="pointer-events-none absolute -left-1 h-2 w-2 rounded-full bg-red-500" style={{ top: minuteToPixels(nowMinutes) - 4 }} />
              </>
            )}
            {events.map(renderEvent)}
          </div>
        </div>
      </DroppableColumn>
    );
  };

  return (
    <div className="min-h-screen bg-[#f4f5f7] px-4 pb-10 pt-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-emerald-600 shadow-sm ring-1 ring-black/5">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Live
          </div>
          <h1 className="text-2xl font-semibold text-slate-900">{initialBoard.name}</h1>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <span>GMT+09</span>
            <span className="text-slate-300">•</span>
            <span>Today focus</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {errorMessage && <p className="text-xs text-amber-600">{errorMessage}</p>}
            <button
              onClick={fetchTimeline}
              className="rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50"
              disabled={status === 'loading'}
            >
              {status === 'loading' ? 'Updating…' : 'Refresh'}
            </button>
          </div>
        </header>

        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <section className="rounded-3xl bg-white shadow-xl ring-1 ring-black/5">
            <div className="sticky top-0 grid grid-cols-[80px_repeat(2,minmax(0,1fr))] border-b border-slate-100 bg-white/95 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <div className="px-3 py-3 text-right">GMT+09</div>
              {data?.days?.map((day) => (
                <div key={day.key} className="border-l border-slate-100 px-6 py-3 text-center">
                  <p className="text-slate-800">{day.label}</p>
                  <p className="text-[10px] text-slate-400">{day.isoDate}</p>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-[80px_auto]">
              <aside className="border-r border-slate-100 bg-slate-50 text-right text-[10px] text-slate-500">
                {HOURS.map((hour) => (
                  <div key={hour} className="h-10 pr-3 leading-10">
                    {hour}
                  </div>
                ))}
              </aside>
              <div ref={timelineScrollRef} className="relative max-h-[560px] overflow-y-auto">
                <div className="grid grid-cols-2">
                  {data?.days?.map((day, index) => renderColumn(day, index))}
                </div>
              </div>
            </div>
          </section>
        </DndContext>
      </div>
    </div>
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

const DroppableBucket = ({ children, bucketKey }: { children: ReactNode; bucketKey: string }) => {
  const { setNodeRef, isOver } = useDroppable({ id: `bucket-drop:${bucketKey}`, data: { type: 'ab-bucket', bucketKey } });
  const highlight = isOver ? 'rounded-2xl ring-2 ring-sky-300 ring-offset-2 ring-offset-slate-50' : '';
  return (
    <div ref={setNodeRef} className={highlight}>
      {children}
    </div>
  );
};

const DraggableCard = ({ id, data, children }: { id: string; data: Record<string, unknown>; children: ReactNode }) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id, data: { ...data, id } });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={isDragging ? 'z-30 opacity-80' : undefined}
      {...listeners}
      {...attributes}
    >
      {children}
    </div>
  );
};
