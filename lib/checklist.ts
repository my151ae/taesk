export const CHECKLIST_VERSION = 1;
export const MAX_CHECKLIST_LINES = 200;
export const MAX_CHECKLIST_TEXT_LENGTH = 500;

export type ChecklistLine = {
  id: string;
  level: number;
  checked: boolean;
  text: string;
  linked_card_id?: string;
  linked_card_short_id?: string;
  linked_card_slug?: string;
};
export type Checklist = { version: typeof CHECKLIST_VERSION; lines: ChecklistLine[] };

export const EMPTY_CHECKLIST: Checklist = { version: CHECKLIST_VERSION, lines: [] };

const generateLineId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `chk_${Math.random().toString(36).slice(2, 10)}`;
};

const clampLine = (text: string, maxLength: number) => {
  if (!Number.isFinite(maxLength) || maxLength <= 0) return text ?? '';
  return (text ?? '').slice(0, maxLength);
};

export const clampChecklist = (
  checklist: Checklist | null | undefined,
  options?: { maxLines?: number; maxLineLength?: number }
): Checklist => {
  const maxLines = options?.maxLines ?? MAX_CHECKLIST_LINES;
  const maxLen = options?.maxLineLength ?? MAX_CHECKLIST_TEXT_LENGTH;
  const source = checklist?.lines ?? [];
  const lines = source.slice(0, maxLines).map((line) => ({
    id: line?.id || generateLineId(),
    level: Math.max(0, Math.floor(line?.level ?? 0)),
    checked: Boolean(line?.checked),
    text: clampLine(line?.text ?? '', maxLen),
    ...(line?.linked_card_id ? { linked_card_id: line.linked_card_id } : {}),
    ...(line?.linked_card_short_id ? { linked_card_short_id: line.linked_card_short_id } : {}),
    ...(line?.linked_card_slug ? { linked_card_slug: line.linked_card_slug } : {}),
  }));
  return { version: CHECKLIST_VERSION, lines };
};

export const normalizeChecklist = (value?: Checklist | null): Checklist => {
  if (!value) return EMPTY_CHECKLIST;
  if (value.version !== CHECKLIST_VERSION || !Array.isArray(value.lines)) {
    return EMPTY_CHECKLIST;
  }
  return clampChecklist(value);
};

export const checklistToText = (checklist: Checklist | null | undefined): string => {
  const normalized = normalizeChecklist(checklist ?? undefined);
  return normalized.lines
    .map((line) => {
      const indent = line.level > 0 ? '  '.repeat(line.level) : '';
      const checkbox = line.checked ? '- [x] ' : '- [ ] ';
      return `${indent}${checkbox}${line.text ?? ''}`.trimEnd();
    })
    .join('\n');
};

export const textToChecklist = (
  text: string,
  previous?: Checklist | null,
  options?: { maxLines?: number; maxLineLength?: number }
): Checklist => {
  const maxLines = options?.maxLines ?? MAX_CHECKLIST_LINES;
  const maxLen = options?.maxLineLength ?? MAX_CHECKLIST_TEXT_LENGTH;
  const prevLines = previous?.lines ?? [];
  const rawLines = (text || '').replace(/\r\n/g, '\n').split('\n').slice(0, maxLines);

  const lines: ChecklistLine[] = rawLines
    .map((raw, index) => {
      const sanitized = (raw ?? '').replace(/\t/g, '  ');
      const leadingSpaces = sanitized.match(/^(\s*)/u)?.[1]?.length ?? 0;
      const level = Math.max(0, Math.floor(leadingSpaces / 2));
      let content = sanitized.trimStart();
      let checked = false;

      if (content.toLowerCase().startsWith('- [x]')) {
        checked = true;
        content = content.slice(5).trimStart();
      } else if (content.startsWith('- [ ]')) {
        checked = false;
        content = content.slice(5).trimStart();
      } else if (content.startsWith('-')) {
        content = content.replace(/^-+\s*/, '');
      }

      const textContent = clampLine(content, maxLen);
      const id = prevLines[index]?.id || generateLineId();
      return { id, level, checked, text: textContent };
    })
    .filter((line) => line.text.length > 0 || line.checked);

  return clampChecklist({ version: CHECKLIST_VERSION, lines }, { maxLines, maxLineLength: maxLen });
};

export const countNonEmptyLines = (checklist: Checklist | null | undefined): number => {
  const normalized = normalizeChecklist(checklist ?? undefined);
  return normalized.lines.filter((line) => line.text.trim().length > 0).length;
};

export const countCheckedLines = (checklist: Checklist | null | undefined): number => {
  const normalized = normalizeChecklist(checklist ?? undefined);
  return normalized.lines.filter((line) => line.checked).length;
};

export const flattenChecklistText = (checklist: Checklist | null | undefined): string => {
  const normalized = normalizeChecklist(checklist ?? undefined);
  return normalized.lines.map((line) => line.text).join(' ');
};

export const ensureChecklistId = (checklist: Checklist | null | undefined): Checklist => {
  const normalized = normalizeChecklist(checklist ?? undefined);
  const lines = normalized.lines.map((line) => ({
    ...line,
    id: line.id || generateLineId(),
  }));
  return { ...normalized, lines };
};
