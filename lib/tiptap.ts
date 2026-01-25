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
    return extractTitleTask(content).text;
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

/**
 * コンテンツの先頭にある taskItem からテキストと checked 状態を抽出する。
 */
export const extractTitleTask = (content: JSONContent): { text: string; checked: boolean } => {
    if (!content?.content || !Array.isArray(content.content)) return { text: "", checked: false };

    // doc -> taskList -> taskItem の構造を探す
    const firstNode = content.content[0];
    if (firstNode?.type === 'taskList' && Array.isArray(firstNode.content)) {
        const firstTaskItem = firstNode.content[0];
        if (firstTaskItem?.type === 'taskItem') {
            const checked = !!firstTaskItem.attrs?.checked;
            // taskItem の中の paragraph からテキストを抽出
            // getTiptapPlainText は [] などの記号を付与するため、ここでは使わず
            // ネストされたノードの text を結合する独自の方法または正規表現除去を行う
            const paragraph = firstTaskItem.content?.find(node => node.type === 'paragraph');
            let text = "";
            if (paragraph) {
                // プレーンテキストのみを取得（記号を含ませない）
                text = (paragraph.content ?? [])
                    .map(n => n.type === 'text' ? (n.text ?? '') : '')
                    .join('')
                    .trim();
            }

            // 保険：万が一記号が含まれていた場合は除去
            text = text.replace(/^\s*\[(x| )\]\s*/i, '');

            return { text, checked };
        }
    }

    // フォールバック: taskList 構造でなくても、最初に見つかるテキストをタイトルとする
    for (const node of content.content) {
        // node 単位でのプレーンテキスト取得
        const text = getTiptapPlainText({ type: 'doc', content: [node] })
            .trim()
            .replace(/^\s*\[(x| )\]\s*/i, ''); // 記号除去

        if (text) {
            return { text, checked: false };
        }
    }

    return { text: "", checked: false };
};

/**
 * 先頭の taskItem を更新する（差分がある場合のみ）。
 */
export const setTitleTask = (
    content: JSONContent,
    updates: { text?: string; checked?: boolean }
): { content: JSONContent; changed: boolean } => {
    if (!content?.content || !Array.isArray(content.content)) return { content, changed: false };

    let changed = false;
    const newContent = JSON.parse(JSON.stringify(content)) as JSONContent;
    const firstNode = newContent.content![0];

    if (firstNode?.type === 'taskList' && Array.isArray(firstNode.content)) {
        const firstTaskItem = firstNode.content[0];
        if (firstTaskItem?.type === 'taskItem') {
            // Check status update
            if (updates.checked !== undefined) {
                const oldChecked = !!firstTaskItem.attrs?.checked;
                if (oldChecked !== updates.checked) {
                    firstTaskItem.attrs = { ...firstTaskItem.attrs, checked: updates.checked };
                    changed = true;
                }
            }

            // Text update
            if (updates.text !== undefined) {
                const currentText = extractTitleTask(newContent).text;
                if (currentText !== updates.text) {
                    const paragraph = firstTaskItem.content?.find(node => node.type === 'paragraph');
                    if (paragraph) {
                        paragraph.content = updates.text ? [{ type: 'text', text: updates.text }] : [];
                        changed = true;
                    }
                }
            }
        }
    } else if (firstNode?.type === 'paragraph' && updates.text !== undefined) {
        // 構造化前でもタイトルの同期だけは通す
        const currentText = (firstNode.content ?? [])
            .map((n: any) => n.text ?? '')
            .join('');
        if (currentText !== updates.text) {
            firstNode.content = updates.text ? [{ type: 'text', text: updates.text }] : [];
            changed = true;
        }
    }

    return { content: newContent, changed };
};

/**
 * モーダル展開時や保存時に構造を補足する。
 * ただし「空なら何もしない」合意に基づき、空テキストの場合は paragraph を許容する。
 */
export const ensureTitleTask = (
    content: JSONContent,
    fallbackTitle = "",
    fallbackChecked = false
): { content: JSONContent; changed: boolean } => {
    if (!content?.content || !Array.isArray(content.content)) {
        return { content: buildContentFromTitle(fallbackTitle), changed: true };
    }

    const firstNode = content.content[0];
    const current = extractTitleTask(content);

    // すでにタスクリスト構造がある場合は、そのまま（内容は setTitleTask 等で同期される）
    if (firstNode?.type === 'taskList') {
        return { content, changed: false };
    }

    // タスクリスト構造がない場合かつ、テキストがある場合はタスク化（補正）
    const nodeText = firstNode ? getTiptapPlainText({ type: 'doc', content: [firstNode] }).trim() : "";
    const textToUse = nodeText || fallbackTitle;

    if (textToUse === "") {
        // 全くテキストがない場合は、paragraph のまま（合意：空なら何もしない）
        return { content, changed: false };
    }

    // テキストがあるのに taskList でない場合は、taskList(taskItem) に変換して補正
    const titleTask = {
        type: 'taskList',
        content: [
            {
                type: 'taskItem',
                attrs: { checked: fallbackChecked },
                content: [
                    {
                        type: 'paragraph',
                        content: [{ type: 'text', text: textToUse }]
                    }
                ]
            }
        ]
    };

    const newContent: JSONContent = {
        ...content,
        content: [
            titleTask,
            ...(content.content.slice(1))
        ]
    };

    return { content: newContent, changed: true };
};

export const deriveExcerptFromContent = (
    content: JSONContent,
    maxLength = DEFAULT_EXCERPT_LENGTH
): string => {
    if (!content.content || content.content.length === 0) return "";

    const text = getTiptapPlainText(content);
    return clampText(text, maxLength);
};

export const ensureTitleBlock = (content: JSONContent): JSONContent => {
    return ensureTitleTask(content).content;
};

export const buildContentFromTitle = (title: string): JSONContent => {
    // 合意仕様: 空なら paragraph、文字があれば taskItem
    if (!title.trim()) {
        return {
            type: 'doc',
            content: [{ type: 'paragraph', content: [] }]
        };
    }

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
                                content: [{ type: 'text', text: title }]
                            }
                        ]
                    }
                ]
            }
        ]
    };
};

