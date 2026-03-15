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

const LIST_INDENT = "  ";

const isListNodeType = (type?: string) =>
  type === "bulletList" || type === "orderedList" || type === "taskList";

const isTextBlockType = (type?: string) => type === "paragraph" || type === "heading";

const normalizeMarkdown = (value: string): string =>
  value
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();

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
      if (summary && body) return `${summary}\n\n${body}`;
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
