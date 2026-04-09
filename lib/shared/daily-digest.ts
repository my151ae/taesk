export type DailyDigestSourceCard = {
  id: string;
  title: string;
  due_date: string | null;
  due_start: string | null;
  due_end: string | null;
  short_id: string | null;
  slug: string | null;
};

export type DailyDigestBoard = {
  id: string;
  name: string;
  short_id: string | null;
  id_short: number | null;
  slug: string | null;
};

export type DailyDigestItem = {
  card_id: string;
  card_short_id: string | null;
  card_slug: string | null;
  title: string;
  due_date: string | null;
  due_start: string | null;
  due_end: string | null;
  kind: 'today' | 'overdue';
};

export function getDateTimeParts(value: Date | string, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(typeof value === 'string' ? new Date(value) : value);
  const lookup = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';

  return {
    year: lookup('year'),
    month: lookup('month'),
    day: lookup('day'),
    hour: lookup('hour'),
    minute: lookup('minute'),
    date: `${lookup('year')}-${lookup('month')}-${lookup('day')}`,
    hhmm: `${lookup('hour')}:${lookup('minute')}`,
  };
}

export function getJstDate(value: string | Date): string {
  return getDateTimeParts(value instanceof Date ? value : new Date(value), 'Asia/Tokyo').date;
}

export function buildBoardTail(board: DailyDigestBoard): string {
  const slug = typeof board.slug === 'string' ? board.slug.trim() : '';
  if (!slug) return '';
  return typeof board.id_short === 'number' ? `${board.id_short}-${slug}` : slug;
}

function buildItemSortKey(item: DailyDigestItem): number {
  const kindPriority = item.kind === 'today' ? 0 : 2;
  const hasTime = item.due_start ? 0 : 1;
  return kindPriority + hasTime;
}

export function compareDigestItems(a: DailyDigestItem, b: DailyDigestItem): number {
  const priorityDiff = buildItemSortKey(a) - buildItemSortKey(b);
  if (priorityDiff !== 0) return priorityDiff;

  const dueDateDiff = (a.due_date ?? '').localeCompare(b.due_date ?? '');
  if (dueDateDiff !== 0) return dueDateDiff;

  const startDiff = (a.due_start ?? '').localeCompare(b.due_start ?? '');
  if (startDiff !== 0) return startDiff;

  return a.card_id.localeCompare(b.card_id);
}

export function buildDigestItems(params: {
  cards: DailyDigestSourceCard[];
  summaryDate: string;
  includeOverdue: boolean;
}): DailyDigestItem[] {
  return params.cards
    .map((card): DailyDigestItem | null => {
      if (!card.due_date) return null;
      const dueDateJst = getJstDate(card.due_date);
      if (dueDateJst !== params.summaryDate && (!params.includeOverdue || dueDateJst >= params.summaryDate)) {
        return null;
      }

      if (dueDateJst > params.summaryDate) {
        return null;
      }

      return {
        card_id: card.id,
        card_short_id: card.short_id,
        card_slug: card.slug,
        title: card.title,
        due_date: dueDateJst,
        due_start: card.due_start,
        due_end: card.due_end,
        kind: dueDateJst === params.summaryDate ? 'today' : 'overdue',
      };
    })
    .filter((item): item is DailyDigestItem => item !== null)
    .sort(compareDigestItems);
}
