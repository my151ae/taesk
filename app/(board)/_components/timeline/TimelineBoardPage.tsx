"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Board } from "@/lib/supabase";
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

const HOUR_HEIGHT = 40;
const HOURS = Array.from({ length: 24 }, (_, hour) => `${hour.toString().padStart(2, "0")}:00`);

const AB_BUCKET_META: Record<string, { title: string; subtitle: string }> = {
  today_a: { title: "A/B Today", subtitle: "A: do today" },
  today_b: { title: "A/B Today", subtitle: "B: if possible" },
  tomorrow_a: { title: "A/B Tomorrow", subtitle: "A: do tomorrow" },
  tomorrow_b: { title: "A/B Tomorrow", subtitle: "B: if possible" },
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

const timeLabel = (start: string | null, end: string | null) => {
  if (!start && !end) return "Anytime";
  const toLabel = (value: string | null) => (value ? value.slice(0, 5) : "--:--");
  return `${toLabel(start)} – ${toLabel(end)}`;
};

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

type TimelineBoardPageProps = {
  initialBoard: Board;
};

type ActiveDragState = {
  cardId: string;
  startMinutes: number;
  duration: number;
};

export default function TimelineBoardPage({ initialBoard }: TimelineBoardPageProps) {
  const [data, setData] = useState<TimelineResponse | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeDrag, setActiveDrag] = useState<ActiveDragState | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const fetchTimeline = useCallback(async () => {
    if (!initialBoard?.id) return;
    setStatus('loading');
    setErrorMessage(null);
    try {
      const response = await fetch(`/api/boards/${initialBoard.id}/timeline`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error?.message || 'Failed to load timeline');
      }
      const payload = (await response.json()) as TimelineResponse;
      setData(payload);
      setStatus('idle');
    } catch (error) {
      console.error('[timeline] fetch error', error);
      setErrorMessage(error instanceof Error ? error.message : 'Unknown error');
      setStatus('error');
    }
  }, [initialBoard?.id]);

  useEffect(() => {
    fetchTimeline();
  }, [fetchTimeline]);

  const bucketDayMap = useMemo(() => {
    if (!data?.days?.length) return {} as Record<string, string | null>;
    return {
      today_a: data.days[0]?.isoDate ?? null,
      today_b: data.days[0]?.isoDate ?? null,
      tomorrow_a: data.days[1]?.isoDate ?? null,
      tomorrow_b: data.days[1]?.isoDate ?? null,
    };
  }, [data?.days]);

  const eventsByDay = useMemo(() => {
    if (!data) return {} as Record<string, TimelineEvent[]>;
    return data.days.reduce((acc, day) => {
      acc[day.isoDate] = data.events.filter((event) => event.due_date === day.isoDate);
      return acc;
    }, {} as Record<string, TimelineEvent[]>);
  }, [data]);

  const nowMinutes = useMemo(() => (data ? getNowMinutesJst(data.serverNow) : null), [data]);

  const applyPatch = useCallback(
    async (cardId: string, payload: Record<string, unknown>) => {
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
    [fetchTimeline, initialBoard.id]
  );

  const handleDragStart = (event: DragStartEvent) => {
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
        <div
          className="absolute left-2 right-2 rounded-md border border-slate-200 bg-white p-2 shadow-sm"
          style={{ top, height }}
        >
          <div className="text-xs font-semibold text-slate-800 line-clamp-2">{event.title || 'Untitled card'}</div>
          <div className="text-[10px] text-slate-500">{timeLabel(event.due_start, event.due_end)}</div>
        </div>
      </DraggableCard>
    );
  };

  const renderColumn = (day: TimelineDay, index: number) => {
    const events = eventsByDay[day.isoDate] ?? [];
    const columnHeight = minuteToPixels(24 * 60);

    return (
      <DroppableColumn key={day.isoDate} day={day}>
        <div className="relative h-full border-r border-slate-100 px-1 last:border-r-0">
          {index === 0 && nowMinutes != null && (
            <>
              <div
                className="pointer-events-none absolute left-0 right-0 h-px bg-red-400/80"
                style={{ top: minuteToPixels(nowMinutes) }}
              />
              <div
                className="pointer-events-none absolute -left-1 h-2 w-2 rounded-full bg-red-500"
                style={{ top: minuteToPixels(nowMinutes) - 4 }}
              />
            </>
          )}
          <div className="relative" style={{ height: columnHeight }}>
            {events.map(renderEvent)}
          </div>
        </div>
      </DroppableColumn>
    );
  };

  const renderBucket = (bucketKey: string) => {
    const meta = AB_BUCKET_META[bucketKey];
    const items = data?.abBuckets?.[bucketKey] ?? [];

    return (
      <DroppableBucket key={bucketKey} bucketKey={bucketKey}>
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-sm font-semibold text-slate-800">{meta?.title}</div>
          <div className="text-xs text-slate-500">{meta?.subtitle}</div>
          <div className="mt-3 space-y-2">
            {items.length === 0 && <div className="text-xs text-slate-400">No cards yet</div>}
            {items.map((item) => (
              <DraggableCard key={item.card_id} id={`bucket:${item.card_id}`} data={{ kind: 'bucket', cardId: item.card_id }}>
                <div className="rounded-md border border-slate-200 px-3 py-2 text-xs">
                  <div className="font-medium text-slate-800 line-clamp-2">{item.title || 'Untitled card'}</div>
                  <div className="text-[10px] text-slate-500">{timeLabel(item.due_start, item.due_end)}</div>
                </div>
              </DraggableCard>
            ))}
          </div>
        </div>
      </DroppableBucket>
    );
  };

  return (
    <div className="min-h-screen bg-slate-100 px-6 py-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Timeline</p>
            <h1 className="text-2xl font-semibold text-slate-900">{initialBoard.name}</h1>
          </div>
          <div className="flex items-center gap-2">
            {status === 'error' && <p className="text-xs text-red-600">{errorMessage}</p>}
            <button
              onClick={fetchTimeline}
              className="rounded-md border border-slate-300 bg-white px-3 py-1 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
              disabled={status === 'loading'}
            >
              {status === 'loading' ? 'Updating…' : 'Refresh'}
            </button>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-2">
          {Object.keys(AB_BUCKET_META).map(renderBucket)}
        </section>

        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <section className="overflow-hidden rounded-xl bg-white shadow-sm">
            <div className="grid grid-cols-[64px_repeat(2,minmax(0,1fr))] border-b border-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <div className="px-2 py-2 text-right">GMT+09</div>
              {data?.days?.map((day) => (
                <div key={day.key} className="border-l border-slate-100 px-4 py-2 text-center">
                  <p className="text-slate-800">{day.label}</p>
                  <p className="text-[10px] text-slate-500">{day.isoDate}</p>
                </div>
              ))}
            </div>
            <div className="flex">
              <aside className="w-16 border-r border-slate-100 bg-slate-50 text-right text-[10px] text-slate-500">
                {HOURS.map((hour) => (
                  <div key={hour} className="h-10 pr-2 leading-10">
                    {hour}
                  </div>
                ))}
              </aside>
              <div className="grid flex-1 grid-cols-2">
                {data?.days?.map((day, index) => renderColumn(day, index))}
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
    <div ref={setNodeRef} className="h-full">
      {children}
    </div>
  );
};

const DroppableBucket = ({ children, bucketKey }: { children: ReactNode; bucketKey: string }) => {
  const { setNodeRef, isOver } = useDroppable({ id: `bucket-drop:${bucketKey}`, data: { type: 'ab-bucket', bucketKey } });
  const highlight = isOver ? 'rounded-lg ring-2 ring-blue-300 ring-offset-2 ring-offset-slate-100' : '';
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
      className={isDragging ? 'z-20 opacity-80' : undefined}
      {...listeners}
      {...attributes}
    >
      {children}
    </div>
  );
};
