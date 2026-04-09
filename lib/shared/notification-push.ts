export const PUSH_TITLE_TARGET = 24;
export const PUSH_TITLE_HARD_MAX = 30;
export const PUSH_BODY_TARGET = 36;
export const PUSH_BODY_HARD_MAX = 40;
export const DIGEST_BOARD_NAME_TARGET = 18;
export const DIGEST_BOARD_NAME_HARD_MAX = 20;

type PushPayload = {
  message?: unknown;
  board_name?: unknown;
  today_count?: unknown;
  overdue_count?: unknown;
  timed_count?: unknown;
  a_count?: unknown;
  b_count?: unknown;
  top_items?: unknown;
  timed_items?: unknown;
  a_items?: unknown;
  b_items?: unknown;
};

export type PushCopy = {
  title: string;
  body: string;
  titleLength: number;
  bodyLength: number;
};

function getSegmenter() {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    return new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  }
  return null;
}

function splitGraphemes(value: string): string[] {
  const segmenter = getSegmenter();
  if (!segmenter) {
    return Array.from(value);
  }

  return Array.from(segmenter.segment(value), (segment) => segment.segment);
}

export function countGraphemes(value: string): number {
  return splitGraphemes(value).length;
}

export function truncateGraphemes(value: string, hardMax: number): string {
  const normalized = value.trim();
  if (hardMax <= 0) return '';

  const graphemes = splitGraphemes(normalized);
  if (graphemes.length <= hardMax) {
    return normalized;
  }

  if (hardMax === 1) {
    return '…';
  }

  return `${graphemes.slice(0, hardMax - 1).join('').trimEnd()}…`;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function getTopItemTitle(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return '';
  const firstItem = value[0];
  if (!firstItem || typeof firstItem !== 'object') return '';
  return asString((firstItem as { title?: unknown }).title);
}

type DigestPreviewItem = {
  title: string;
  due_start?: string | null;
};

function getDigestItems(value: unknown): DigestPreviewItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      title: asString((item as { title?: unknown }).title),
      due_start: typeof (item as { due_start?: unknown }).due_start === 'string'
        ? (item as { due_start?: string }).due_start ?? null
        : null,
    }))
    .filter((item) => item.title.length > 0);
}

function normalizeTimeLabel(value: string | null | undefined): string {
  if (!value) return '';
  const trimmed = value.trim();
  return trimmed.length >= 5 ? trimmed.slice(0, 5) : trimmed;
}

function formatDigestLine(prefix: 'T' | 'A' | 'B', items: DigestPreviewItem[]): string | null {
  if (items.length === 0) return null;
  const content = items
    .slice(0, 2)
    .map((item) => {
      if (prefix === 'T') {
        const timeLabel = normalizeTimeLabel(item.due_start);
        return timeLabel ? `${timeLabel} ${item.title}` : item.title;
      }
      return item.title;
    })
    .join(',');

  return `${prefix}:${content}`;
}

export function formatDailyDigestPushCopy(input: {
  boardName: string;
  todayCount: number;
  overdueCount: number;
  timedCount?: number;
  aCount?: number;
  bCount?: number;
  timedItems?: DigestPreviewItem[];
  aItems?: DigestPreviewItem[];
  bItems?: DigestPreviewItem[];
  topItemTitle?: string | null;
}): PushCopy {
  const title = `TaeDigest:Time=${input.timedCount ?? 0},A=${input.aCount ?? 0},B=${input.bCount ?? 0},Over=${input.overdueCount}`;
  const lines = [
    formatDigestLine('T', input.timedItems ?? []),
    formatDigestLine('A', input.aItems ?? []),
    formatDigestLine('B', input.bItems ?? []),
  ].filter((line): line is string => Boolean(line));
  const body = lines.length > 0 ? lines.join(',') : asString(input.topItemTitle ?? '') || `Today=${input.todayCount}`;

  return {
    title,
    body,
    titleLength: countGraphemes(title),
    bodyLength: countGraphemes(body),
  };
}

export function formatPushNotificationCopy(type: string, payload: PushPayload): PushCopy {
  if (type === 'daily_digest') {
    return formatDailyDigestPushCopy({
      boardName: asString(payload.board_name),
      todayCount: asNumber(payload.today_count),
      overdueCount: asNumber(payload.overdue_count),
      timedCount: asNumber(payload.timed_count),
      aCount: asNumber(payload.a_count),
      bCount: asNumber(payload.b_count),
      timedItems: getDigestItems(payload.timed_items),
      aItems: getDigestItems(payload.a_items),
      bItems: getDigestItems(payload.b_items),
      topItemTitle: getTopItemTitle(payload.top_items),
    });
  }

  const title = 'Taesk Notification';
  const rawBody = asString(payload.message);
  const body = type === 'mention' ? truncateGraphemes(rawBody, PUSH_BODY_HARD_MAX) : rawBody;

  return {
    title,
    body,
    titleLength: countGraphemes(title),
    bodyLength: countGraphemes(body),
  };
}
