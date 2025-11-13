import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const formatDateJst = (base: Date, offsetDays = 0): string => {
  const utcMs = base.getTime();
  const jstMs = utcMs + JST_OFFSET_MS + offsetDays * MS_PER_DAY;
  const jstDate = new Date(jstMs);
  const year = jstDate.getUTCFullYear();
  const month = `${jstDate.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${jstDate.getUTCDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const toMinutes = (time: string | null) => {
  if (!time) return null;
  const [hour, minute] = time.split(':');
  const h = Number(hour ?? '0');
  const m = Number(minute ?? '0');
  return h * 60 + m;
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

  const now = new Date();
  const todayIso = formatDateJst(now, 0);
  const tomorrowIso = formatDateJst(now, 1);
  const targetDates = [todayIso, tomorrowIso];

  const { data: cards, error } = await supabase
    .from('cards')
    .select(
      'id, title, description, list_id, board_id, position, tags, due_date, due_start, due_end, due_channel, due_bucket, priority, checked, assignee_id, assigned_to, short_id, id_short, slug'
    )
    .eq('board_id', boardId);

  if (error) {
    console.error('[timeline] Failed to fetch cards', error);
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: 'Failed to fetch timeline cards' } },
      { status: 500 }
    );
  }

  const events: any[] = [];
  const abBuckets: Record<string, any[]> = {
    today_a: [],
    today_b: [],
    tomorrow_a: [],
    tomorrow_b: [],
  };

  cards?.forEach((card) => {
    const dateOnly = card.due_date ? card.due_date.slice(0, 10) : null;
    const isToday = dateOnly === todayIso;
    const isTomorrow = dateOnly === tomorrowIso;

    if (card.due_channel === 'timeline' && dateOnly && (isToday || isTomorrow)) {
      const start = toMinutes(card.due_start);
      const end = toMinutes(card.due_end);
      events.push({
        card_id: card.id,
        due_date: card.due_date,
        due_start: card.due_start,
        due_end: card.due_end,
        durationMinutes: start != null && end != null ? Math.max(end - start, 0) : null,
        title: card.title,
        tags: card.tags ?? [],
        priority: card.priority,
        checked: card.checked,
        assignee_id: card.assignee_id,
        assigned_to: card.assigned_to,
        short_id: card.short_id,
        slug: card.slug,
      });
    } else if (card.due_channel === 'ab-list' && card.due_bucket) {
      if (!abBuckets[card.due_bucket]) {
        abBuckets[card.due_bucket] = [];
      }
      abBuckets[card.due_bucket].push({
        card_id: card.id,
        title: card.title,
        due_date: card.due_date,
        due_start: card.due_start,
        due_end: card.due_end,
        checked: card.checked,
        tags: card.tags ?? [],
        short_id: card.short_id,
        slug: card.slug,
      });
    }
  });

  events.sort((a, b) => {
    if (a.due_date === b.due_date) {
      const aStart = toMinutes(a.due_start) ?? 0;
      const bStart = toMinutes(b.due_start) ?? 0;
      return aStart - bStart;
    }
    return a.due_date.localeCompare(b.due_date);
  });

  const responseBody = {
    days: [
      { key: 'today', label: 'Today', isoDate: todayIso },
      { key: 'tomorrow', label: 'Tomorrow', isoDate: tomorrowIso },
    ],
    events,
    abBuckets,
    serverNow: new Date().toISOString(),
  };

  return NextResponse.json(responseBody, { status: 200 });
}
