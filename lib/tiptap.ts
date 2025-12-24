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
            type: "heading",
            attrs: { level: 1 },
            content: []
        },
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
    if (!content.content || content.content.length === 0) return "";

    // Look for the first heading
    const firstHeading = content.content.find(node => node.type === 'heading');
    if (firstHeading) {
        const text = getTiptapPlainText({ content: [firstHeading] });
        return clampText(text, MAX_TITLE_LENGTH);
    }

    // Fallback to first paragraph
    const firstPara = content.content.find(node => node.type === 'paragraph');
    if (firstPara) {
        const text = getTiptapPlainText({ content: [firstPara] });
        return clampText(text, MAX_TITLE_LENGTH);
    }

    return "";
};

export const deriveExcerptFromContent = (
    content: JSONContent,
    maxLength = DEFAULT_EXCERPT_LENGTH
): string => {
    if (!content.content || content.content.length === 0) return "";

    // Skip the first node (assumed title/heading) if there are multiple nodes
    const nodesToConsider = content.content.length > 1 ? content.content.slice(1) : [];
    if (nodesToConsider.length === 0) return "";

    const text = getTiptapPlainText({ content: nodesToConsider });
    return clampText(text, maxLength);
};

export const ensureTitleBlock = (content: JSONContent): JSONContent => {
    if (!content.content || content.content.length === 0) {
        return EMPTY_DOC;
    }

    const first = content.content[0];
    if (first.type !== 'heading' || first.attrs?.level !== 1) {
        return {
            ...content,
            content: [
                { type: 'heading', attrs: { level: 1 }, content: [] },
                ...content.content
            ]
        };
    }

    return content;
};

export const buildContentFromTitle = (title: string): JSONContent => {
    const normalized = title.replace(/\s+/g, " ").trim();
    return {
        type: 'doc',
        content: [
            {
                type: 'heading',
                attrs: { level: 1 },
                content: normalized ? [{ type: 'text', text: clampText(normalized, MAX_TITLE_LENGTH) }] : []
            },
            {
                type: 'paragraph',
                content: []
            }
        ]
    };
};
