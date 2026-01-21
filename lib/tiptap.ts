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

/**
 * Recursively extracts plain text from Tiptap JSONContent.
 * Handles nested structures like lists, blockquotes, etc.
 */
export const getTiptapPlainText = (content: JSONContent): string => {
    const parts: string[] = [];

    const traverse = (node: JSONContent) => {
        if (node.text) {
            parts.push(node.text);
        }
        if (node.content && Array.isArray(node.content)) {
            node.content.forEach(traverse);
        }
    };

    if (content.content && Array.isArray(content.content)) {
        content.content.forEach(traverse);
    }

    return parts.join(" ").replace(/\s+/g, " ").trim();
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
    // Logic changed: do not put title in content
    return {
        type: 'doc',
        content: [
            {
                type: 'paragraph',
                content: []
            }
        ]
    };
};
