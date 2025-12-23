import { JSONContent } from "@tiptap/react";
import { BlockNoteDocument, getDocumentPlainText } from "./blocknote";

export const DEFAULT_EXCERPT_LENGTH = 160;
const MAX_TITLE_LENGTH = 255;

const clampText = (value: string, max: number) => {
    if (!Number.isFinite(max) || max <= 0) return value;
    return value.slice(0, max);
};

export const normalizeContent = (value: unknown): JSONContent => {
    // If it's an array, it's legacy BlockNote content - ignore and return empty doc
    if (Array.isArray(value)) {
        return {
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
    }
    // If it's an object and has 'type': 'doc', it's Tiptap
    if (value && typeof value === 'object' && 'type' in value && (value as any).type === 'doc') {
        return value as JSONContent;
    }
    // Default fallback (single empty paragraph)
    return {
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
};

export const getTiptapPlainText = (content: JSONContent): string => {
    if (!content.content) return "";
    return content.content
        .map(node => {
            if (node.content) {
                return node.content.map(c => c.text || "").join("");
            }
            return "";
        })
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
};


export const deriveTitleFromContent = (content: JSONContent): string => {
    if (!content.content || content.content.length === 0) return "";

    // Look for the first heading
    const firstHeading = content.content.find(node => node.type === 'heading');
    if (firstHeading && firstHeading.content) {
        const text = firstHeading.content.map(c => c.text).join("");
        return clampText(text, MAX_TITLE_LENGTH);
    }

    // Fallback to first paragraph
    const firstPara = content.content.find(node => node.type === 'paragraph');
    if (firstPara && firstPara.content) {
        const text = firstPara.content.map(c => c.text).join("");
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

    const text = nodesToConsider
        .map(node => {
            if (node.content) {
                return node.content.map(c => c.text || "").join("");
            }
            return "";
        })
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

    return clampText(text, maxLength);
};

export const ensureTitleBlock = (content: JSONContent): JSONContent => {
    // Logic to ensure the first block is a Heading 1
    // This is a bit complex in Tiptap JSON, might be easier to enforce in Editor setup (configure StarterKit heading)
    // For now, checks if first block is H1, if not, prepends/converts.

    if (!content.content) {
        return {
            type: 'doc',
            content: [
                { type: 'heading', attrs: { level: 1 }, content: [] },
                { type: 'paragraph', content: [] }
            ]
        }
    }

    const first = content.content[0];
    if (first.type !== 'heading' || first.attrs?.level !== 1) {
        // If not H1, convert or prepend? 
        // Simplest: Prepend an empty H1
        return {
            ...content,
            content: [
                { type: 'heading', attrs: { level: 1 }, content: [] },
                ...content.content
            ]
        }
    }

    return content;
};
