'use client';

import { Extension, useEditor, EditorContent, JSONContent } from '@tiptap/react';
import { TextSelection, Plugin, PluginKey, EditorState, Transaction } from '@tiptap/pm/state';
import type { Selection } from '@tiptap/pm/state';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import Placeholder from '@tiptap/extension-placeholder';
import Image from '@tiptap/extension-image';
import styles from './TiptapEditor.module.css';
import { useCallback, useEffect, useRef } from 'react';
import type { ClipboardEvent as ReactClipboardEvent, RefObject } from 'react';
import { ensureTitleTask } from '@/lib/tiptap';
import {
    CARD_IMAGE_MAX_BYTES,
    applySignedUrlsToContent,
    cardImageExtensionFromMimeType,
    collectImageStoragePaths,
    isSupportedCardImageMimeType,
} from '@/lib/tiptap-images';

/**
 * 先頭ブロックが空でないテキストを持つ場合、自動的に taskItem に変換する拡張
 */
const AutoTaskFirstLine = Extension.create({
    name: 'autoTaskFirstLine',

    addOptions() {
        return {
            enabled: true,
        };
    },

    addGlobalAttributes() {
        return [];
    },

    addProseMirrorPlugins() {
        return [
            new Plugin({
                key: new PluginKey('autoTaskFirstLine'),
                appendTransaction: (transactions: readonly Transaction[], oldState: EditorState, newState: EditorState) => {
                    // 安全ガード: newState がない場合は何もしない
                    if (!newState || !newState.doc) return;

                    // 変更がない、またはメタフラグがある場合はスキップ
                    if (!transactions.some(tr => tr.docChanged) || transactions.some(tr => tr.getMeta('autoTaskFirstLine'))) {
                        return;
                    }

                    const { doc, schema } = newState;
                    const firstNode = doc.firstChild;

                    // 先頭が taskList 構造でない場合のみ変換対象
                    if (firstNode && firstNode.type.name !== 'taskList') {
                        const textContent = firstNode.textContent.trim();

                        // 合意A: 空なら何もしない
                        if (textContent !== "") {
                            // 厳密仕様B: 先頭ブロックの内容を抽出し、taskItem(paragraph) に変換
                            const tr = newState.tr;

                            const newTaskItem = schema.nodes.taskItem.create(
                                { checked: false },
                                [schema.nodes.paragraph.create({}, schema.text(textContent))]
                            );
                            const newTaskList = schema.nodes.taskList.create({}, [newTaskItem]);

                            // 先頭ブロックを置換
                            tr.replaceWith(0, firstNode.nodeSize, newTaskList);

                            // メタフラグ付与と履歴除外
                            tr.setMeta('autoTaskFirstLine', true);
                            tr.setMeta('addToHistory', false);

                            // セレクションの復元（入力した文字の直後にカーソルを置く）
                            try {
                                const endOfFirstBlock = tr.doc.firstChild!.nodeSize - 1;
                                tr.setSelection(TextSelection.near(tr.doc.resolve(endOfFirstBlock), -1));
                            } catch (e) {
                                // ignore
                            }

                            return tr;
                        }
                    }
                },
            }),
        ];
    },
});

type TiptapEditorProps = {
    initialContent?: JSONContent | null;
    onChange?: (content: JSONContent) => void;
    placeholder?: string;
    editable?: boolean;
    boardId?: string;
    cardId?: string;
    onEditorError?: (message: string | null) => void;
    onRegisterImagePasteHandler?: ((handler: ((files: File[]) => Promise<void>) | null) => void);
    'data-autofocus'?: boolean;
    containerRef?: RefObject<HTMLDivElement>;
};

type PasteTaskContext = {
    isTitleTask: boolean;
    taskListDepth: number;
};

const resolvePasteTaskContext = (selection: Selection): PasteTaskContext => {
    const $pos = selection.$from;

    let isInsideTask = false;
    let taskDepth = 0;

    for (let d = $pos.depth; d > 0; d--) {
        if ($pos.node(d)?.type.name === 'taskItem') {
            isInsideTask = true;
            taskDepth = d;
            break;
        }
    }

    const taskListDepth = taskDepth > 0 ? taskDepth - 1 : 0;
    const isFirstTaskInTaskList =
        isInsideTask &&
        taskListDepth > 0 &&
        $pos.node(taskListDepth).type.name === 'taskList' &&
        $pos.index(taskListDepth) === 0;

    const isTitleTask =
        isFirstTaskInTaskList &&
        taskListDepth === 1 &&
        $pos.index(0) === 0;

    return {
        isTitleTask,
        taskListDepth,
    };
};

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
    try {
        const body = await response.json() as { error?: { message?: unknown } };
        if (typeof body?.error?.message === 'string' && body.error.message.trim()) {
            return body.error.message;
        }
    } catch {
        // ignore parse error
    }
    return fallback;
}

function extractImageFilesFromClipboard(clipboardData: DataTransfer | null): File[] {
    return Array.from(clipboardData?.items ?? [])
        .filter((item) => item.kind === 'file')
        .map((item) => item.getAsFile())
        .filter((file): file is File => !!file && file.type.startsWith('image/'));
}

function extractImageFilesFromClipboardHtml(html: string): File[] {
    if (!html || typeof html !== 'string') return [];
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const imageSources = Array.from(doc.querySelectorAll('img'))
        .map((element) => element.getAttribute('src') ?? '')
        .filter((value) => value.startsWith('data:image/'));

    const files: File[] = [];
    imageSources.forEach((source, index) => {
        const match = source.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=]+)$/i);
        if (!match) return;
        const mimeType = match[1].toLowerCase();
        if (!isSupportedCardImageMimeType(mimeType)) return;

        const extension = cardImageExtensionFromMimeType(mimeType) ?? 'img';
        try {
            const binary = atob(match[2]);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            files.push(new File([bytes], `pasted-html-${Date.now()}-${index}.${extension}`, { type: mimeType }));
        } catch {
            // ignore malformed data url
        }
    });

    return files;
}

export default function TiptapEditor({
    initialContent,
    onChange,
    placeholder = "Type '/' for commands…",
    editable = true,
    boardId,
    cardId,
    onEditorError,
    onRegisterImagePasteHandler,
    'data-autofocus': dataAutofocus,
    containerRef
}: TiptapEditorProps) {
    // Use a ref to track if we're silently updating content to avoid trigger loops
    const isUpdatingRef = useRef(false);
    const lastAppliedDocRef = useRef<ProseMirrorNode | null>(null);
    const lastEmittedDocRef = useRef<ProseMirrorNode | null>(null);
    const signedUrlRequestIdRef = useRef(0);

    const uploadAndInsertImages = useCallback(async (
        view: { state: EditorState; dispatch: (tr: Transaction) => void },
        imageFiles: File[],
    ) => {
        if (!boardId || !cardId) {
            onEditorError?.('画像貼り付けはこの画面では利用できません。');
            return;
        }

        const imageType = view.state.schema.nodes.image;
        if (!imageType) {
            onEditorError?.('画像ノードが初期化されていません。');
            return;
        }

        for (const file of imageFiles) {
            const mimeType = file.type.trim().toLowerCase();
            if (!isSupportedCardImageMimeType(mimeType)) {
                onEditorError?.('画像形式は PNG / JPEG / WebP のみ対応しています。');
                continue;
            }

            if (!Number.isFinite(file.size) || file.size > CARD_IMAGE_MAX_BYTES) {
                onEditorError?.('画像サイズは 10MB 以下にしてください。');
                continue;
            }

            const formData = new FormData();
            formData.append('file', file);

            const response = await fetch(`/api/boards/${boardId}/cards/${cardId}/images`, {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                const message = await parseErrorMessage(response, '画像のアップロードに失敗しました。');
                onEditorError?.(message);
                continue;
            }

            const body = await response.json() as { storagePath?: unknown; signedUrl?: unknown };
            if (typeof body.storagePath !== 'string' || typeof body.signedUrl !== 'string') {
                onEditorError?.('画像アップロード応答が不正です。');
                continue;
            }

            const { state, dispatch } = view;
            let tr = state.tr;
            const imageNode = imageType.create({
                src: body.signedUrl,
                storagePath: body.storagePath,
                alt: file.name || 'pasted image',
            });

            // 画像貼り付けは貼り付け位置に依存せず同一挙動に統一する:
            // 先頭が taskList の場合は本文先頭（先頭 taskList 直後）へ挿入する。
            const firstNode = tr.doc.firstChild;
            if (firstNode && firstNode.type.name === 'taskList') {
                tr = tr.insert(firstNode.nodeSize, imageNode);
            } else {
                tr = tr.replaceSelectionWith(imageNode, false);
            }

            tr = tr.scrollIntoView();
            dispatch(tr);
            onEditorError?.(null);

            // カスタム paste 分岐では onUpdate 取りこぼし時にも autosave を確実に走らせる
            if (onChange) {
                onChange(tr.doc.toJSON() as JSONContent);
            }
        }
    }, [boardId, cardId, onEditorError, onChange]);

    const editor = useEditor({
        immediatelyRender: false,
        extensions: [
            StarterKit.configure({
                // The History extension is enabled by default
                heading: {
                    levels: [1, 2, 3]
                }
            }),
            TaskList,
            TaskItem.configure({
                nested: true,
            }),
            Image.extend({
                addAttributes() {
                    return {
                        ...this.parent?.(),
                        storagePath: {
                            default: null,
                            parseHTML: (element) => element.getAttribute('data-storage-path'),
                            renderHTML: (attributes) => {
                                const value = attributes.storagePath;
                                if (typeof value !== 'string' || !value) return {};
                                return { 'data-storage-path': value };
                            },
                        },
                    };
                },
            }),
            AutoTaskFirstLine,
            Placeholder.configure({
                placeholder: ({ node }) => {
                    if (node.type.name === 'heading') {
                        return `H${node.attrs.level ?? 1}`;
                    }
                    if (node.type.name === 'paragraph') {
                        return placeholder;
                    }
                    return '';
                },
                showOnlyCurrent: true,
            }),
        ],
        content: initialContent || { type: 'doc', content: [] },
        editorProps: {
            attributes: {
                class: 'prose prose-slate max-w-none focus:outline-none pl-6 pr-4 pt-3 pb-3',
                ...(dataAutofocus ? { 'data-autofocus': 'true' } : {}),
            },
            handlePaste: (view, event, slice) => {
                const text = event.clipboardData?.getData('text/plain');
                if (text && (text.includes('\n') || text.includes('\r'))) {
                    const lines = text.split(/\r\n|\r|\n/);
                    const firstLine = lines[0];
                    const bodyLines = lines.slice(1);

                    const { state, dispatch } = view;
                    const { selection, schema } = state;
                    const taskContext = resolvePasteTaskContext(selection);

                    if (taskContext.isTitleTask && bodyLines.length > 0) {
                        const html = event.clipboardData?.getData('text/html') ?? '';
                        // HTML に画像を含む貼り付けは既定の HTML paste に委譲し、画像欠落を避ける
                        if (/<img[\s>]/i.test(html)) {
                            return false;
                        }

                        console.log('[Tiptap] multiline paste in title task detected, escaping body lines out of title taskList');

                        let tr = state.tr;

                        // 1行目を現在位置へ挿入（選択範囲を置換）
                        tr = tr.insertText(firstLine, selection.from, selection.to);

                        // 2行目以降は「タイトル taskItem 直後」ではなく
                        // 先頭 taskList の直後（本文）へ挿入する
                        // 1行目挿入後の selection.to から解決し直すと安全
                        const $newPos = tr.doc.resolve(tr.mapping.map(selection.to));
                        const insertPos = $newPos.after(taskContext.taskListDepth);

                        const newParagraphs = bodyLines.map(line =>
                            schema.nodes.paragraph.create({}, line ? schema.text(line) : [])
                        );

                        tr = tr.insert(insertPos, newParagraphs);
                        dispatch(tr);

                        // カスタム paste 分岐では onUpdate 取りこぼし時にも autosave を確実に走らせる
                        if (onChange) {
                            onChange(tr.doc.toJSON() as JSONContent);
                        }
                        return true;
                    }

                    // リスト外の場合や1行のみの場合は標準挙動に任せる
                    return false;
                }
                return false;
            }
        },
        onUpdate: ({ editor }) => {
            if (isUpdatingRef.current) return;
            const currentDoc = editor.state.doc;
            if (lastAppliedDocRef.current && currentDoc.eq(lastAppliedDocRef.current)) return;
            if (lastEmittedDocRef.current && currentDoc.eq(lastEmittedDocRef.current)) return;
            lastEmittedDocRef.current = currentDoc;
            if (onChange) {
                onChange(editor.getJSON());
            }
        },
        autofocus: 'start', // 'start' に設定して初期化時に先頭へフォーカス
        onCreate: ({ editor }) => {
            // 補正：先頭行をタイトルタスクに強制
            const currentContent = editor.getJSON();
            const { content: correctedContent, changed } = ensureTitleTask(currentContent);
            if (changed) {
                isUpdatingRef.current = true;
                editor.commands.setContent(correctedContent, { emitUpdate: false });
                isUpdatingRef.current = false;
            }
            lastAppliedDocRef.current = editor.state.doc;

            // 初期フォーカス位置を「1行目（タイトル行）の末尾」に設定
            if (editor.state && editor.state.doc.firstChild) {
                const firstNode = editor.state.doc.firstChild;
                // TextSelection.near を使用して、1行目の末尾（ノードの内側）にフォーカス
                // 1 + content.size はタイトル行の末尾の内部位置
                const endOfFirstBlock = 1 + firstNode.content.size;
                const tr = editor.state.tr.setSelection(
                    TextSelection.near(editor.state.doc.resolve(Math.min(endOfFirstBlock, editor.state.doc.content.size)), -1)
                );
                editor.view.dispatch(tr);
            }
        },
    });

    useEffect(() => {
        if (!onRegisterImagePasteHandler) return;
        if (!editor) {
            onRegisterImagePasteHandler(null);
            return;
        }

        onRegisterImagePasteHandler((files: File[]) => uploadAndInsertImages(editor.view, files));

        return () => {
            onRegisterImagePasteHandler(null);
        };
    }, [editor, onRegisterImagePasteHandler, uploadAndInsertImages]);

    const handleImagePasteCapture = useCallback((event: ReactClipboardEvent<HTMLDivElement>) => {
        const directImageFiles = extractImageFilesFromClipboard(event.clipboardData);
        const htmlImageFiles =
            directImageFiles.length === 0
                ? extractImageFilesFromClipboardHtml(event.clipboardData?.getData('text/html') ?? '')
                : [];
        const imageFiles = directImageFiles.length > 0 ? directImageFiles : htmlImageFiles;
        if (imageFiles.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        if (!editor) {
            onEditorError?.('画像エディタの初期化が完了していません。');
            return;
        }
        void uploadAndInsertImages(editor.view, imageFiles).catch((error) => {
            console.error('[Tiptap] image paste failed', error);
            onEditorError?.('画像の貼り付けに失敗しました。');
        });
    }, [editor, onEditorError, uploadAndInsertImages]);

    // Handle external updates to initialContent
    // Note: Deep comparison might be expensive, so we trust React key="" or explicit reset
    // But CardModal updates content based on prop change (switching cards).
    useEffect(() => {
        if (!editor) return;

        const requestId = ++signedUrlRequestIdRef.current;
        let cancelled = false;

        const hydrateContent = async () => {
            const nextContent = initialContent ?? { type: 'doc', content: [] };
            let hydratedContent = nextContent;

            const paths = collectImageStoragePaths(nextContent);
            if (paths.length > 0 && boardId && cardId) {
                try {
                    const response = await fetch(`/api/boards/${boardId}/cards/${cardId}/images/sign`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ paths }),
                    });

                    if (response.ok) {
                        const body = await response.json() as { urls?: Record<string, string> };
                        const nextUrls = body?.urls && typeof body.urls === 'object' ? body.urls : {};
                        hydratedContent = applySignedUrlsToContent(nextContent, nextUrls).content;
                        onEditorError?.(null);
                    } else {
                        const message = await parseErrorMessage(response, '画像URLの再取得に失敗しました。');
                        onEditorError?.(message);
                    }
                } catch (error) {
                    console.error('[Tiptap] failed to hydrate image signed URLs', error);
                    onEditorError?.('画像URLの再取得に失敗しました。');
                }
            }

            if (cancelled || requestId !== signedUrlRequestIdRef.current) return;

            let nextDoc: ProseMirrorNode | null = null;
            try {
                nextDoc = editor.schema.nodeFromJSON(hydratedContent);
            } catch {
                return;
            }

            lastAppliedDocRef.current = nextDoc;
            if (!editor.state.doc.eq(nextDoc)) {
                isUpdatingRef.current = true;
                editor.commands.setContent(hydratedContent, { emitUpdate: false });
                isUpdatingRef.current = false;
            }
        };

        void hydrateContent();

        return () => {
            cancelled = true;
        };
    }, [initialContent, editor, boardId, cardId, onEditorError]);

    // Update editable state
    useEffect(() => {
        if (editor && editor.isEditable !== editable) {
            editor.setEditable(editable);
        }
    }, [editor, editable]);

    if (!editor) {
        return null;
    }

    return (
        <div
            ref={containerRef}
            className={`w-full bg-white dark:bg-gray-800 rounded-lg cursor-text ${styles.editor}`}
            onClick={() => editor.chain().focus().run()}
            onPasteCapture={handleImagePasteCapture}
        >
            <EditorContent editor={editor} />
        </div>
    );
}
