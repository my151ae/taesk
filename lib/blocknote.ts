export type BlockNoteInlineContent = {
  type?: string;
  text?: string;
  content?: BlockNoteInlineContent[] | string;
};

export type BlockNoteBlock = {
  id?: string;
  type?: string;
  props?: Record<string, unknown>;
  content?: BlockNoteInlineContent[] | string;
  children?: BlockNoteBlock[];
};

export type BlockNoteDocument = BlockNoteBlock[];

export const DEFAULT_EXCERPT_LENGTH = 160;
const MAX_TITLE_LENGTH = 255;

const clampText = (value: string, max: number) => {
  if (!Number.isFinite(max) || max <= 0) return value;
  return value.slice(0, max);
};

export const normalizeBlockNoteDocument = (value: unknown): BlockNoteDocument => {
  return Array.isArray(value) ? (value as BlockNoteDocument) : [];
};

export const createTitleBlock = (title = ""): BlockNoteBlock => {
  if (!title) {
    return { type: "paragraph", content: [] };
  }
  return {
    type: "paragraph",
    content: [{ type: "text", text: title }],
  };
};

export const ensureTitleBlock = (blocks: BlockNoteDocument): BlockNoteDocument => {
  if (!blocks.length) {
    return [createTitleBlock()];
  }
  const first = blocks[0];
  const firstType = typeof first?.type === "string" ? first.type : null;
  if (firstType !== "paragraph") {
    return [createTitleBlock(), ...blocks];
  }
  return blocks;
};

const collectText = (node: unknown, parts: string[]) => {
  if (!node) return;
  if (typeof node === "string") {
    if (node.trim()) parts.push(node);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item) => collectText(item, parts));
    return;
  }
  if (typeof node === "object") {
    const record = node as Record<string, unknown>;
    const text = record.text;
    if (typeof text === "string" && text.trim()) {
      parts.push(text);
    }
    if ("content" in record) {
      collectText(record.content, parts);
    }
    if ("children" in record) {
      collectText(record.children, parts);
    }
  }
};

export const getBlockPlainText = (block: unknown): string => {
  const parts: string[] = [];
  collectText(block, parts);
  return parts.join(" ").replace(/\s+/g, " ").trim();
};

export const getDocumentPlainText = (blocks: BlockNoteDocument): string => {
  if (!blocks.length) return "";
  const parts = blocks.map((block) => getBlockPlainText(block)).filter(Boolean);
  return parts.join(" ").replace(/\s+/g, " ").trim();
};

export const deriveTitleFromDocument = (blocks: BlockNoteDocument): string => {
  if (!blocks.length) return "";
  const raw = getBlockPlainText(blocks[0]);
  const normalized = raw.replace(/\s+/g, " ").trim();
  return clampText(normalized, MAX_TITLE_LENGTH);
};

export const deriveExcerptFromDocument = (
  blocks: BlockNoteDocument,
  maxLength = DEFAULT_EXCERPT_LENGTH
): string => {
  if (blocks.length <= 1) return "";
  const body = getDocumentPlainText(blocks.slice(1));
  return clampText(body, maxLength);
};

export const buildDocumentFromTitle = (title: string): BlockNoteDocument => {
  const normalized = title.replace(/\s+/g, " ").trim();
  return [createTitleBlock(clampText(normalized, MAX_TITLE_LENGTH))];
};
