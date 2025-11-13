"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Board } from "@/lib/supabase";

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

type TimelineBoardPageProps = {
  initialBoard: Board;
};

export default function TimelineBoardPage({ initialBoard }: TimelineBoardPageProps) {
  const [data, setData] = useState<TimelineResponse | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

  const eventsByDay = useMemo(() => {
    if (!data) return {} as Record<string, TimelineEvent[]>;
    return data.days.reduce((acc, day) => {
      acc[day.isoDate] = data.events.filter((event) => event.due_date === day.isoDate);
      return acc;
    }, {} as Record<string, TimelineEvent[]>);
  }, [data]);

  const nowMinutes = useMemo(() => (data ? getNowMinutesJst(data.serverNow) : null), [data]);

  const renderEvent = (event: TimelineEvent) => {
    const start = getMinutesFromTime(event.due_start ?? null) ?? 0;
    const duration = Math.max(event.durationMinutes ?? 60, 30);
    const top = minuteToPixels(start);
    const height = Math.max(minuteToPixels(duration), 32);

    return (
      <div
        key={event.card_id}
        className="absolute left-2 right-2 rounded-md border border-slate-200 bg-white p-2 shadow-sm"
        style={{ top, height }}
      >
        <div className="text-xs font-semibold text-slate-800 line-clamp-2">{event.title || 'Untitled card'}</div>
        <div className="text-[10px] text-slate-500">{timeLabel(event.due_start, event.due_end)}</div>
      </div>
    );
  };

  const renderColumn = (day: TimelineDay, index: number) => {
    const events = eventsByDay[day.isoDate] ?? [];
    const columnHeight = minuteToPixels(24 * 60);

    return (
      <div key={day.isoDate} className="relative h-full border-r border-slate-100 px-1 last:border-r-0">
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
    );
  };

  const renderBucket = (bucketKey: string) => {
    const meta = AB_BUCKET_META[bucketKey];
    const items = data?.abBuckets?.[bucketKey] ?? [];

    return (
      <div key={bucketKey} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="text-sm font-semibold text-slate-800">{meta?.title}</div>
        <div className="text-xs text-slate-500">{meta?.subtitle}</div>
        <div className="mt-3 space-y-2">
          {items.length === 0 && <div className="text-xs text-slate-400">No cards yet</div>}
          {items.map((item) => (
            <div key={item.card_id} className="rounded-md border border-slate-200 px-3 py-2 text-xs">
              <div className="font-medium text-slate-800 line-clamp-2">{item.title || 'Untitled card'}</div>
              <div className="text-[10px] text-slate-500">{timeLabel(item.due_start, item.due_end)}</div>
            </div>
          ))}
        </div>
      </div>
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
      </div>
    </div>
  );
}
