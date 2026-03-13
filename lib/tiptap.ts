import type { JSONContent } from "@tiptap/react";

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
