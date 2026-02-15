import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import type { TimelineResponse, TimelineEvent, TimelineBucketItem, TimelineDay } from '@/lib/api-types/timeline';
import { DEFAULT_TIMELINE_DAY_RANGE, formatDayLabel } from '@/app/(board)/_utils/timeline-helpers';
import { normalizeChecklist, EMPTY_CHECKLIST } from '@/lib/checklist';

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const TIMELINE_DAY_RANGE = DEFAULT_TIMELINE_DAY_RANGE;

const formatDateJst = (base: Date, offsetDays = 0): string => {
  const utcMs = base.getTime();
  const jstMs = utcMs + JST_OFFSET_MS + offsetDays * MS_PER_DAY;
  const jstDate = new Date(jstMs);
  const year = jstDate.getUTCFullYear();
  const month = `${jstDate.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${jstDate.getUTCDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const toJstDate = (value: string | null): string | null => {
  if (!value) return null;
  return formatDateJst(new Date(value));
};

const toMinutes = (time: string | null) => {
  if (!time) return null;
  const [hour, minute] = time.split(':');
  const h = Number(hour ?? '0');
  const m = Number(minute ?? '0');
  return h * 60 + m;
};

const buildDays = (base: Date, startOffset: number, range: number): TimelineDay[] => {
  const todayIso = formatDateJst(base, 0);
  return Array.from({ length: range }, (_, offset) => {
    const isoDate = formatDateJst(base, startOffset + offset);
    return {
      key: isoDate,
      label: formatDayLabel(isoDate, todayIso),
      isoDate,
    };
  });
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  const supabase = await createServerSupabaseClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Login required' } },
      { status: 401 }
    );
  }

  const { boardId } = await params;

  const { data: membership } = await supabase
    .from('board_members')
    .select('role')
    .eq('board_id', boardId)
    .eq('profile_id', user.id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Not a board member' } },
      { status: 403 }
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const parsedStart = Number.parseInt(searchParams.get('start') ?? '0', 10);
  const parsedRange = Number.parseInt(searchParams.get('range') ?? String(TIMELINE_DAY_RANGE), 10);
  const startOffset = Number.isFinite(parsedStart) ? parsedStart : 0;
  const range = Math.max(1, Number.isFinite(parsedRange) ? parsedRange : TIMELINE_DAY_RANGE);

  const now = new Date();
  const days = buildDays(now, startOffset, range);
  const dayKeyMap = new Map(days.map((day) => [day.isoDate, day.key]));

  const baseSelect =
    'id, title, checklist, content, excerpt, list_id, board_id, position, tags, due_date, due_start, due_end, start_reminder_enabled, start_reminder_minutes, end_reminder_enabled, end_reminder_minutes, due_bucket, priority, checked, assignee_id, assignee_ids, assigned_to, short_id, id_short, slug, duration';
  const extendedSelect = `${baseSelect}, due_bucket_position`;

  let cards = null;
  let fetchError = null;

  const initial = await supabase
    .from('cards')
    .select(extendedSelect)
    .eq('board_id', boardId);

  if (initial.error && initial.error.code === '42703') {
    const fallbackSelect = baseSelect
      .replace('checklist, ', '')
      .replace('content, ', '')
      .replace('start_reminder_enabled, ', '')
      .replace('start_reminder_minutes, ', '')
      .replace('end_reminder_enabled, ', '')
      .replace('end_reminder_minutes, ', '');
    const fallback = await supabase
      .from('cards')
      .select(fallbackSelect)
      .eq('board_id', boardId);
    fetchError = fallback.error;
    cards =
      fallback.data
        ? (fallback.data as any[]).map((card) => ({
          ...card,
          checklist: EMPTY_CHECKLIST,
          content: null,
          excerpt: card.excerpt ?? null,
          start_reminder_enabled: false,
          start_reminder_minutes: 0,
          end_reminder_enabled: false,
          end_reminder_minutes: 0,
          due_bucket_position: null,
        }))
        : null;
  } else {
    fetchError = initial.error;
    cards = initial.data;
  }

  if (fetchError) {
    console.error('[timeline] Failed to fetch cards', fetchError);
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: 'Failed to fetch timeline cards' } },
      { status: 500 }
    );
  }

  const events: TimelineEvent[] = [];
  const abBuckets: Record<string, TimelineBucketItem[]> = days.reduce((acc, day) => {
    acc[`${day.key}_a`] = [];
    acc[`${day.key}_b`] = [];
    return acc;
  }, {} as Record<string, TimelineBucketItem[]>);

  cards?.forEach((card) => {
    const checklist = normalizeChecklist((card as any).checklist ?? EMPTY_CHECKLIST);
    const dateOnly = toJstDate(card.due_date);
    const dayKey = dateOnly ? dayKeyMap.get(dateOnly) ?? null : null;

    if (!dayKey) return; // Skip cards outside the visible range

    const hasTime = card.due_start && card.due_end;

    if (hasTime) {
      const start = toMinutes(card.due_start);
      const end = toMinutes(card.due_end);
      events.push({
        card_id: card.id,
        due_date: dateOnly!,
        due_start: card.due_start,
        due_end: card.due_end,
        start_reminder_enabled: card.start_reminder_enabled ?? false,
        start_reminder_minutes: card.start_reminder_minutes ?? 0,
        end_reminder_enabled: card.end_reminder_enabled ?? false,
        end_reminder_minutes: card.end_reminder_minutes ?? 0,
        durationMinutes: start != null && end != null ? Math.max(end - start, 0) : null,
        title: card.title,
        content: (card as any).content ?? null,
        excerpt: card.excerpt ?? null,
        tags: card.tags ?? [],
        priority: card.priority,
        checked: card.checked,
        checklist,
        due_bucket: card.due_bucket ?? null,
        due_bucket_position: card.due_bucket_position ?? null,
        assignee_id: card.assignee_id,
        assignee_ids: card.assignee_ids ?? null,
        assigned_to: card.assigned_to,
        duration: card.duration ?? 60,
        short_id: card.short_id,
        slug: card.slug,
      });
    } else {
      // A/B List
      // Default to 'b' if no bucket specified but has date
      const bucket = card.due_bucket || 'b';
      const key = `${dayKey}_${bucket}`;

      if (!abBuckets[key]) {
        abBuckets[key] = [];
      }
      abBuckets[key].push({
        card_id: card.id,
        title: card.title,
        content: (card as any).content ?? null,
        excerpt: card.excerpt ?? null,
        due_date: dateOnly,
        due_start: card.due_start,
        due_end: card.due_end,
        start_reminder_enabled: card.start_reminder_enabled ?? false,
        start_reminder_minutes: card.start_reminder_minutes ?? 0,
        end_reminder_enabled: card.end_reminder_enabled ?? false,
        end_reminder_minutes: card.end_reminder_minutes ?? 0,
        checked: card.checked,
        checklist,
        tags: card.tags ?? [],
        priority: card.priority,
        assignee_id: card.assignee_id,
        assignee_ids: card.assignee_ids ?? null,
        assigned_to: card.assigned_to,
        duration: card.duration ?? 60,
        short_id: card.short_id,
        slug: card.slug,
        bucketPosition: card.due_bucket_position ?? null,
      });
    }
  });

  Object.keys(abBuckets).forEach((key) => {
    abBuckets[key].sort((a, b) => {
      const aPos = a.bucketPosition ?? 0;
      const bPos = b.bucketPosition ?? 0;
      if (aPos === bPos) {
        return (a.due_date ?? '').localeCompare(b.due_date ?? '');
      }
      return bPos - aPos;
    });
  });

  events.sort((a, b) => {
    if (a.due_date === b.due_date) {
      const aStart = toMinutes(a.due_start) ?? 0;
      const bStart = toMinutes(b.due_start) ?? 0;
      return aStart - bStart;
    }
    return a.due_date.localeCompare(b.due_date);
  });

  const responseBody: TimelineResponse = {
    days,
    events,
    abBuckets,
    serverNow: new Date().toISOString(),
    startOffset,
    range,
  };

  return NextResponse.json(responseBody, { status: 200 });
}
