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
  top_items?: unknown;
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

export function formatDailyDigestPushCopy(input: {
  boardName: string;
  todayCount: number;
  overdueCount: number;
  topItemTitle?: string | null;
}): PushCopy {
  const boardName = truncateGraphemes(input.boardName, DIGEST_BOARD_NAME_HARD_MAX);
  const title = truncateGraphemes(`Taesk: ${boardName}`, PUSH_TITLE_HARD_MAX);
  const summary = `今日 ${input.todayCount}件 / overdue ${input.overdueCount}件`;
  const topItemTitle = asString(input.topItemTitle ?? '');

  const body = topItemTitle
    ? truncateGraphemes(`${summary} - ${topItemTitle}`, PUSH_BODY_HARD_MAX)
    : summary;

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
