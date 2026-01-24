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
            content: []
        }
    ],
};

export const normalizeContent = (value: unknown): JSONContent => {
    // If it's an array, it's legacy BlockNote content - return empty doc (as agreed to clear)
    if (Array.isArray(value)) {
        return EMPTY_DOC;
    }
    // If it's an object and has 'type': 'doc', it's Tiptap
    if (value && typeof value === 'object' && 'type' in value && (value as any).type === 'doc') {
        return value as JSONContent;
    }
    // Default fallback
    return EMPTY_DOC;
};

const joinChildren = (node: JSONContent, formatter: (n: JSONContent) => string) =>
    (node.content ?? []).map(formatter).join('');

/**
 * 段落・リスト・チェックボックスを含むテキスト抽出（改行保持）。
 * taskItem は `[ ]` / `[x]` をプレフィックスしてカード上で視覚化する。
 */
export const getTiptapPlainText = (content: JSONContent): string => {
    const formatNode = (node: JSONContent, level = 0): string => {
        switch (node.type) {
            case 'text':
                return node.text ?? '';
            case 'hardBreak':
                return '\n';
            case 'paragraph':
            case 'heading':
                return joinChildren(node, (n) => formatNode(n, level)).trimEnd() + '\n';
            case 'bulletList':
            case 'orderedList':
            case 'taskList':
                return (node.content ?? [])
                    .map((child) => formatNode(child, level).trimEnd())
                    .join('\n') + '\n';
            case 'listItem':
                return '  '.repeat(level) + '- ' + joinChildren(node, (n) => formatNode(n, level + 1)).trim();
            case 'taskItem': {
                const checked = (node as any).attrs?.checked;
                const prefix = checked ? '[x] ' : '[ ] ';
                // taskItem の直下にある paragraph は現在のレベル、
                // 入れ子の taskList は次のレベル (level + 1) として扱う
                const childrenText = (node.content ?? []).map((child) => {
                    const nextLevel = (child.type === 'taskList' || child.type === 'bulletList' || child.type === 'orderedList')
                        ? level + 1
                        : 0; // paragraph などのテキスト要素はインデント不要（プレフィックスに続くため）
                    return formatNode(child, nextLevel);
                }).join('');

                return '  '.repeat(level) + prefix + childrenText.trim();
            }
            default:
                return joinChildren(node, (n) => formatNode(n, level));
        }
    };

    if (!content?.content || !Array.isArray(content.content)) return '';

    const raw = content.content.map((n) => formatNode(n, 0)).join('').trimEnd();
    // 連続する空行を1行に圧縮
    return raw.replace(/\n{3,}/g, '\n\n');
};

export const deriveTitleFromContent = (content: JSONContent): string => {
    // Logic removed: title is now stored separately
    return "";
};

export const deriveExcerptFromContent = (
    content: JSONContent,
    maxLength = DEFAULT_EXCERPT_LENGTH
): string => {
    // Logic updated: consider all content (do not skip first block)
    if (!content.content || content.content.length === 0) return "";

    const text = getTiptapPlainText(content);
    return clampText(text, maxLength);
};

export const ensureTitleBlock = (content: JSONContent): JSONContent => {
    // Logic removed: do not enforce H1 or first block as title
    return content;
};

export const buildContentFromTitle = (_title: string): JSONContent => {
    // Default body starts with an unchecked task item
    return {
        type: 'doc',
        content: [
            {
                type: 'taskList',
                content: [
                    {
                        type: 'taskItem',
                        attrs: { checked: false },
                        content: [
                            {
                                type: 'paragraph',
                                content: []
                            }
                        ]
                    }
                ]
            }
        ]
    };
};
