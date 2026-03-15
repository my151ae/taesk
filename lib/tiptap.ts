import type { JSONContent } from "@tiptap/react";
import type { Node as ProseMirrorNode, Slice } from "@tiptap/pm/model";

export const DEFAULT_EXCERPT_LENGTH = 160;
const MAX_TITLE_LENGTH = 255;

const clampText = (value: string, max: number) => {
  if (!Number.isFinite(max) || max <= 0) return value;
  return value.slice(0, max);
};

const EMPTY_DOC: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [],
    },
  ],
};

export const normalizeContent = (value: unknown): JSONContent => {
  if (Array.isArray(value)) {
    return EMPTY_DOC;
  }
  if (value && typeof value === "object" && "type" in value && (value as { type?: unknown }).type === "doc") {
    return value as JSONContent;
  }
  return EMPTY_DOC;
};

const joinChildren = (node: JSONContent, formatter: (n: JSONContent) => string) =>
  (node.content ?? []).map(formatter).join("");

type TiptapMark = {
  type?: string;
  attrs?: Record<string, unknown>;
};

type MarkdownSerializeContext = {
  indentLevel: number;
  inListItem: boolean;
  suppressBlockFormatting: boolean;
};

type MarkdownParseResult =
  | {
      kind: "parsed";
      content: JSONContent;
      format: "markdown-v2" | "markdown-v1-compat" | "generic-markdown";
    }
  | {
      kind: "fallback";
      reason:
        | "looks-like-plain-text"
        | "ambiguous-details"
        | "unsupported-structure"
        | "html-preferred"
        | "title-row-preferred";
    };

const LIST_INDENT = "  ";
const DETAILS_FENCE_OPEN = ":::details";
const DETAILS_FENCE_CLOSE = ":::";

const isListNodeType = (type?: string) =>
  type === "bulletList" || type === "orderedList" || type === "taskList";

const isTextBlockType = (type?: string) => type === "paragraph" || type === "heading";

const normalizeMarkdown = (value: string): string =>
  value
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();

const normalizeMarkdownInput = (value: string): string =>
  value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();

const escapeMarkdownText = (value: string): string =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/([*_~[\]])/g, "\\$1");

const fenceInlineCode = (value: string): string => {
  const maxTickRun = Math.max(...Array.from(value.matchAll(/`+/g), (match) => match[0].length), 0);
  const fence = "`".repeat(maxTickRun + 1);
  const padded = value.startsWith("`") || value.endsWith("`") ? ` ${value} ` : value;
  return `${fence}${padded}${fence}`;
};

const indentMultiline = (value: string, indentLevel: number): string => {
  const indent = LIST_INDENT.repeat(indentLevel);
  return value
    .split("\n")
    .map((line) => (line.length > 0 ? `${indent}${line}` : line))
    .join("\n");
};

const applyMarks = (text: string, marks?: TiptapMark[]): string => {
  if (!marks || marks.length === 0 || !text) return text;

  const sortedMarks = [...marks].sort((left, right) => {
    const priority = (markType?: string) => {
      switch (markType) {
        case "code":
          return 0;
        case "bold":
          return 1;
        case "italic":
          return 2;
        case "strike":
          return 3;
        case "link":
          return 4;
        default:
          return 10;
      }
    };
    return priority(left.type) - priority(right.type);
  });

  return sortedMarks.reduce((current, mark) => {
    switch (mark.type) {
      case "code":
        return fenceInlineCode(current);
      case "bold":
        return `**${current}**`;
      case "italic":
        return `*${current}*`;
      case "strike":
        return `~~${current}~~`;
      case "link": {
        const href = typeof mark.attrs?.href === "string" ? mark.attrs.href.trim() : "";
        return href ? `[${current}](${href})` : current;
      }
      default:
        return current;
    }
  }, text);
};

const serializeInlineContent = (nodes: JSONContent[], context: MarkdownSerializeContext): string => {
  return nodes
    .map((node) => serializeMarkdownNode(node, context))
    .join("")
    .replace(/[ \t]+\n/g, "\n");
};

const serializeBlocks = (nodes: JSONContent[], context: MarkdownSerializeContext): string => {
  const rendered = nodes
    .map((node) => serializeMarkdownNode(node, context))
    .map((value) => value.trimEnd())
    .filter((value) => value.length > 0);

  return normalizeMarkdown(rendered.join("\n\n"));
};

const serializeListItem = (
  node: JSONContent,
  prefix: string,
  context: MarkdownSerializeContext
): string => {
  const lines: string[] = [];
  let hasPrefixedContent = false;

  for (const child of node.content ?? []) {
    if (isListNodeType(child.type)) {
      const nested = serializeMarkdownNode(child, {
        ...context,
        indentLevel: context.indentLevel + 1,
        inListItem: false,
        suppressBlockFormatting: false,
      });
      if (nested) {
        lines.push(nested);
      }
      continue;
    }

    const rendered = serializeMarkdownNode(child, {
      ...context,
      inListItem: true,
      suppressBlockFormatting: true,
    }).trimEnd();

    if (!rendered) continue;

    const childLines = rendered.split("\n");
    if (!hasPrefixedContent) {
      lines.push(`${LIST_INDENT.repeat(context.indentLevel)}${prefix}${childLines[0]}`);
      const continuationIndent = `${LIST_INDENT.repeat(context.indentLevel)}${" ".repeat(prefix.length)}`;
      childLines.slice(1).forEach((line) => {
        lines.push(line.length > 0 ? `${continuationIndent}${line}` : "");
      });
      hasPrefixedContent = true;
      continue;
    }

    const continuationIndent = `${LIST_INDENT.repeat(context.indentLevel)}${" ".repeat(prefix.length)}`;
    childLines.forEach((line) => {
      lines.push(line.length > 0 ? `${continuationIndent}${line}` : "");
    });
  }

  if (!hasPrefixedContent) {
    lines.unshift(`${LIST_INDENT.repeat(context.indentLevel)}${prefix}`.trimEnd());
  }

  return lines.join("\n");
};

const serializeMarkdownNode = (node: JSONContent, context: MarkdownSerializeContext): string => {
  switch (node.type) {
    case "text":
      return applyMarks(escapeMarkdownText(node.text ?? ""), node.marks as TiptapMark[] | undefined);
    case "hardBreak":
      return "  \n";
    case "mention": {
      const name = typeof node.attrs?.name === "string" ? node.attrs.name.trim() : "";
      const raw = name ? `@${name.replace(/^@+/, "")}` : "";
      return applyMarks(raw, node.marks as TiptapMark[] | undefined);
    }
    case "paragraph": {
      const inline = serializeInlineContent(node.content ?? [], context).trimEnd();
      return context.inListItem || context.suppressBlockFormatting ? inline : inline;
    }
    case "heading": {
      const inline = serializeInlineContent(node.content ?? [], context).trimEnd();
      if (context.inListItem || context.suppressBlockFormatting) return inline;
      const level = typeof node.attrs?.level === "number" ? Math.max(1, Math.min(6, node.attrs.level)) : 1;
      return inline ? `${"#".repeat(level)} ${inline}` : `${"#".repeat(level)}`;
    }
    case "bulletList":
      return (node.content ?? [])
        .map((child) => serializeListItem(child, "- ", context))
        .filter((value) => value.length > 0)
        .join("\n");
    case "orderedList": {
      const start = typeof node.attrs?.start === "number" ? node.attrs.start : 1;
      return (node.content ?? [])
        .map((child, index) => serializeListItem(child, `${start + index}. `, context))
        .filter((value) => value.length > 0)
        .join("\n");
    }
    case "taskList":
      return (node.content ?? [])
        .map((child) => {
          const checked = Boolean(child.attrs?.checked);
          return serializeListItem(child, checked ? "- [x] " : "- [ ] ", context);
        })
        .filter((value) => value.length > 0)
        .join("\n");
    case "listItem":
      return serializeListItem(node, "- ", context);
    case "taskItem": {
      const checked = Boolean(node.attrs?.checked);
      return serializeListItem(node, checked ? "- [x] " : "- [ ] ", context);
    }
    case "blockquote": {
      const inner = serializeBlocks(node.content ?? [], {
        ...context,
        inListItem: false,
        suppressBlockFormatting: false,
      });
      return inner
        .split("\n")
        .map((line) => (line.length > 0 ? `> ${line}` : ">"))
        .join("\n");
    }
    case "codeBlock": {
      const language = typeof node.attrs?.language === "string" ? node.attrs.language.trim() : "";
      const text = (node.content ?? [])
        .map((child) => (child.type === "text" ? child.text ?? "" : serializeMarkdownNode(child, context)))
        .join("");
      return `\`\`\`${language}\n${text}\n\`\`\``;
    }
    case "horizontalRule":
      return "---";
    case "image": {
      const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
      const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
      return src ? `![${alt.replace(/]/g, "\\]")}](${src})` : "";
    }
    case "detailsSummary":
      return serializeInlineContent(node.content ?? [], context).trim();
    case "detailsContent":
      return serializeBlocks(node.content ?? [], {
        ...context,
        inListItem: false,
        suppressBlockFormatting: false,
      });
    case "details": {
      const summaryNode = (node.content ?? []).find((child) => child.type === "detailsSummary");
      const contentNode = (node.content ?? []).find((child) => child.type === "detailsContent");
      const summary = summaryNode ? serializeMarkdownNode(summaryNode, context).trim() : "";
      const body = contentNode ? serializeMarkdownNode(contentNode, context).trim() : "";
      if (summary && body) {
        return `${DETAILS_FENCE_OPEN}\n${summary}\n\n${body}\n${DETAILS_FENCE_CLOSE}`;
      }
      return summary || body;
    }
    case "doc":
      return serializeBlocks(node.content ?? [], context);
    default:
      if (node.content && node.content.length > 0) {
        if (context.inListItem || isTextBlockType(node.type)) {
          return serializeInlineContent(node.content, context);
        }
        return serializeBlocks(node.content, context);
      }
      return "";
  }
};

export const serializeTiptapContentToMarkdown = (
  content: JSONContent,
  options?: { suppressBlockFormatting?: boolean }
): string => {
  if (!content) return "";

  const normalized =
    content.type === "doc"
      ? content
      : {
          type: "doc",
          content: [content],
        };

  return normalizeMarkdown(
    serializeMarkdownNode(normalized, {
      indentLevel: 0,
      inListItem: false,
      suppressBlockFormatting: Boolean(options?.suppressBlockFormatting),
    })
  );
};

export const serializeTiptapNodeToMarkdown = (node: ProseMirrorNode): string => {
  return serializeTiptapContentToMarkdown(node.toJSON() as JSONContent);
};

export const serializeTiptapSliceToMarkdown = (slice: Slice): string => {
  const contentNodes = slice.content.toJSON() as JSONContent[];
  const singleTextBlockPartialSelection =
    contentNodes.length === 1 &&
    isTextBlockType(contentNodes[0]?.type) &&
    (slice.openStart > 0 || slice.openEnd > 0);

  return serializeTiptapContentToMarkdown(
    {
      type: "doc",
      content: contentNodes,
    },
    { suppressBlockFormatting: singleTextBlockPartialSelection }
  );
};

const headingPattern = /^(#{1,3})\s+(.+)$/;
const taskPattern = /^- \[([ xX])\]\s+(.*)$/;
const bulletPattern = /^- (?!\[[ xX]\]\s)(.+)$/;
const orderedPattern = /^(\d+)\.\s+(.*)$/;
const imagePattern = /^!\[(.*)\]\((.+)\)$/;

const hasTopLevelIndent = (line: string): boolean => /^\s+/.test(line);

const createInlineContent = (text: string): JSONContent[] | undefined => {
  if (!text) return undefined;
  const parts = text.split("\n");
  const content: JSONContent[] = [];
  parts.forEach((part, index) => {
    if (index > 0) {
      content.push({ type: "hardBreak" });
    }
    if (part.length > 0) {
      content.push({ type: "text", text: part });
    }
  });
  return content.length > 0 ? content : undefined;
};

const createParagraphBlock = (lines: string[]): JSONContent => ({
  type: "paragraph",
  content: createInlineContent(lines.join("\n")),
});

const createParagraphBlocksFromText = (text: string): JSONContent[] => {
  const groups = normalizeMarkdownInput(text)
    .split(/\n{2,}/)
    .map((group) => group.split("\n").map((line) => line.trimEnd()))
    .filter((group) => group.some((line) => line.trim().length > 0));
  return groups.map((group) => createParagraphBlock(group));
};

const isRecognizedTopLevelMarkdownLine = (line: string, allowDetails: boolean): boolean => {
  if (!line.trim()) return false;
  if (allowDetails && line === DETAILS_FENCE_OPEN) return true;
  if (hasTopLevelIndent(line)) return false;
  return (
    headingPattern.test(line) ||
    taskPattern.test(line) ||
    bulletPattern.test(line) ||
    orderedPattern.test(line) ||
    imagePattern.test(line)
  );
};

const looksLikeSupportedMarkdown = (markdown: string): boolean => {
  return normalizeMarkdownInput(markdown)
    .split("\n")
    .some((line) => isRecognizedTopLevelMarkdownLine(line, true));
};

const parseDetailsBlocksFromMarkdown = (markdown: string, sourceFormat: "markdown-v1-compat" | "markdown-v2"): JSONContent | null => {
  const normalized = normalizeMarkdownInput(markdown);
  if (!normalized) return null;

  if (sourceFormat === "markdown-v2") {
    const lines = normalized.split("\n");
    if (lines[0] !== DETAILS_FENCE_OPEN || lines[lines.length - 1] !== DETAILS_FENCE_CLOSE) {
      return null;
    }
    const innerLines = lines.slice(1, -1);
    if (innerLines.some((line) => line === DETAILS_FENCE_OPEN)) {
      return null;
    }
    const summary = innerLines[0]?.trim() ?? "";
    if (!summary || innerLines[1] !== "") {
      return null;
    }
    const bodyText = innerLines.slice(2).join("\n").trim();
    if (!bodyText) return null;
    return {
      type: "details",
      attrs: { open: true },
      content: [
        {
          type: "detailsSummary",
          content: createInlineContent(summary),
        },
        {
          type: "detailsContent",
          content: createParagraphBlocksFromText(bodyText),
        },
      ],
    };
  }

  const lines = normalized.split("\n");
  const separatorIndex = lines.findIndex((line) => line.trim() === "");
  if (separatorIndex <= 0 || separatorIndex >= lines.length - 1) {
    return null;
  }
  const summaryLines = lines.slice(0, separatorIndex);
  const bodyLines = lines.slice(separatorIndex + 1);
  if (summaryLines.length !== 1) return null;

  const summary = summaryLines[0].trim();
  const body = bodyLines.join("\n").trim();
  if (!summary || summary.length > 60 || !body) return null;
  if (
    isRecognizedTopLevelMarkdownLine(summary, true) ||
    looksLikeSupportedMarkdown(body)
  ) {
    return null;
  }

  return {
    type: "details",
    attrs: { open: true },
    content: [
      {
        type: "detailsSummary",
        content: createInlineContent(summary),
      },
      {
        type: "detailsContent",
        content: createParagraphBlocksFromText(body),
      },
    ],
  };
};

const parseMarkdownToResult = (markdown: string): MarkdownParseResult => {
  const normalized = normalizeMarkdownInput(markdown);
  if (!normalized) {
    return { kind: "fallback", reason: "looks-like-plain-text" };
  }

  const detailsV2 = parseDetailsBlocksFromMarkdown(normalized, "markdown-v2");
  if (detailsV2) {
    return {
      kind: "parsed",
      format: "markdown-v2",
      content: { type: "doc", content: [detailsV2] },
    };
  }

  if (!looksLikeSupportedMarkdown(normalized)) {
    const detailsV1 = parseDetailsBlocksFromMarkdown(normalized, "markdown-v1-compat");
    if (detailsV1) {
      return {
        kind: "parsed",
        format: "markdown-v1-compat",
        content: { type: "doc", content: [detailsV1] },
      };
    }
    return { kind: "fallback", reason: "looks-like-plain-text" };
  }

  const lines = normalized.split("\n");
  const blocks: JSONContent[] = [];
  let index = 0;

  const consumeParagraph = () => {
    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) break;
      if (isRecognizedTopLevelMarkdownLine(line, true)) break;
      if (hasTopLevelIndent(line)) {
        return false;
      }
      paragraphLines.push(line);
      index += 1;
    }
    if (paragraphLines.length > 0) {
      blocks.push(createParagraphBlock(paragraphLines));
    }
    return paragraphLines.length > 0;
  };

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line === DETAILS_FENCE_OPEN) {
      let endIndex = index + 1;
      while (endIndex < lines.length && lines[endIndex] !== DETAILS_FENCE_CLOSE) {
        endIndex += 1;
      }
      if (endIndex >= lines.length) {
        return { kind: "fallback", reason: "ambiguous-details" };
      }
      const detailsNode = parseDetailsBlocksFromMarkdown(lines.slice(index, endIndex + 1).join("\n"), "markdown-v2");
      if (!detailsNode) {
        return { kind: "fallback", reason: "ambiguous-details" };
      }
      blocks.push(detailsNode);
      index = endIndex + 1;
      continue;
    }

    if (hasTopLevelIndent(line)) {
      return { kind: "fallback", reason: "unsupported-structure" };
    }

    const headingMatch = line.match(headingPattern);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        attrs: { level: headingMatch[1].length },
        content: createInlineContent(headingMatch[2].trim()),
      });
      index += 1;
      continue;
    }

    if (taskPattern.test(line)) {
      const taskItems: JSONContent[] = [];
      while (index < lines.length) {
        const currentLine = lines[index];
        const match = currentLine.match(taskPattern);
        if (!match || hasTopLevelIndent(currentLine)) break;
        taskItems.push({
          type: "taskItem",
          attrs: { checked: match[1].toLowerCase() === "x" },
          content: [
            {
              type: "paragraph",
              content: createInlineContent(match[2].trim()),
            },
          ],
        });
        index += 1;
      }
      blocks.push({ type: "taskList", content: taskItems });
      continue;
    }

    if (bulletPattern.test(line)) {
      const items: JSONContent[] = [];
      while (index < lines.length) {
        const currentLine = lines[index];
        const match = currentLine.match(bulletPattern);
        if (!match || hasTopLevelIndent(currentLine)) break;
        items.push({
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: createInlineContent(match[1].trim()),
            },
          ],
        });
        index += 1;
      }
      blocks.push({ type: "bulletList", content: items });
      continue;
    }

    if (orderedPattern.test(line)) {
      const items: JSONContent[] = [];
      let start = 1;
      while (index < lines.length) {
        const currentLine = lines[index];
        const match = currentLine.match(orderedPattern);
        if (!match || hasTopLevelIndent(currentLine)) break;
        if (items.length === 0) {
          start = Number(match[1]);
        }
        items.push({
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: createInlineContent(match[2].trim()),
            },
          ],
        });
        index += 1;
      }
      blocks.push({ type: "orderedList", attrs: { start }, content: items });
      continue;
    }

    const imageMatch = line.match(imagePattern);
    if (imageMatch) {
      blocks.push({
        type: "image",
        attrs: {
          alt: imageMatch[1],
          src: imageMatch[2],
        },
      });
      index += 1;
      continue;
    }

    if (!consumeParagraph()) {
      return { kind: "fallback", reason: "unsupported-structure" };
    }
  }

  if (blocks.length === 0) {
    return { kind: "fallback", reason: "looks-like-plain-text" };
  }

  return {
    kind: "parsed",
    format: "generic-markdown",
    content: {
      type: "doc",
      content: blocks,
    },
  };
};

export const parseMarkdownToTiptapContent = (markdown: string): JSONContent | null => {
  const result = parseMarkdownToResult(markdown);
  return result.kind === "parsed" ? result.content : null;
};

/**
 * 段落・リスト・チェックボックスを含むテキスト抽出（改行保持）。
 * taskItem は `[ ]` / `[x]` をプレフィックスしてカード上で視覚化する。
 */
export const getTiptapPlainText = (content: JSONContent): string => {
  const formatNode = (node: JSONContent, level = 0): string => {
    switch (node.type) {
      case "text":
        return node.text ?? "";
      case "hardBreak":
        return "\n";
      case "paragraph":
      case "heading":
        return joinChildren(node, (n) => formatNode(n, level)).trimEnd() + "\n";
      case "detailsSummary":
        return joinChildren(node, (n) => formatNode(n, level)).trimEnd() + "\n";
      case "detailsContent":
        return joinChildren(node, (n) => formatNode(n, level));
      case "details": {
        const joined = joinChildren(node, (n) => formatNode(n, level)).replace(/\n{3,}/g, "\n\n");
        return joined.endsWith("\n") ? joined : `${joined}\n`;
      }
      case "bulletList":
      case "orderedList":
      case "taskList":
        return (
          (node.content ?? []).map((child) => formatNode(child, level).trimEnd()).join("\n") + "\n"
        );
      case "listItem":
        return "  ".repeat(level) + "- " + joinChildren(node, (n) => formatNode(n, level + 1)).trim();
      case "taskItem": {
        const checked = (node as { attrs?: { checked?: boolean } }).attrs?.checked;
        const prefix = checked ? "[x] " : "[ ] ";
        const childrenText = (node.content ?? [])
          .map((child) => {
            const nextLevel =
              child.type === "taskList" || child.type === "bulletList" || child.type === "orderedList" ? level + 1 : 0;
            return formatNode(child, nextLevel);
          })
          .join("");

        const trimmed = childrenText.trim();
        if (!trimmed) return "";
        return "  ".repeat(level) + prefix + trimmed;
      }
      default:
        return joinChildren(node, (n) => formatNode(n, level));
    }
  };

  if (!content?.content || !Array.isArray(content.content)) return "";

  const raw = content.content.map((n) => formatNode(n, 0)).join("").trimEnd();
  return raw.replace(/\n{3,}/g, "\n\n");
};

/**
 * 本文からカードタイトルを導出する。
 * 先頭の非空行を採用し、task記法プレフィックスは除去する。
 */
export const deriveTitleFromBody = (content: JSONContent): string => {
  const plain = getTiptapPlainText(content);
  if (!plain.trim()) return "";

  const lines = plain.split(/\r\n|\r|\n/);
  for (const line of lines) {
    const normalized = line.replace(/^\s*\[(x| )\]\s*/i, "").trim();
    if (normalized.length > 0) {
      return clampText(normalized, MAX_TITLE_LENGTH);
    }
  }

  return "";
};

/**
 * ペーストされたテキストをタイトル（1行目）と本文（2行目以降）に分割する。
 */
export const splitPastedText = (text: string): { title: string; bodyLines: string[] } => {
  const lines = text.split(/\r\n|\r|\n/);
  const title = lines[0]?.trim() || "";
  const bodyLines = lines.slice(1);
  return { title, bodyLines };
};

export const deriveExcerptFromContent = (
  content: JSONContent,
  maxLength = DEFAULT_EXCERPT_LENGTH
): string => {
  if (!content.content || content.content.length === 0) return "";

  const text = getTiptapPlainText(content);
  return clampText(text, maxLength);
};

/**
 * 本文の初期値（空taskList 1行）
 */
export const buildDefaultBodyContent = (): JSONContent => {
  return {
    type: "doc",
    content: [
      {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { checked: false },
            content: [
              {
                type: "paragraph",
                content: [],
              },
            ],
          },
        ],
      },
    ],
  };
};
