'use client';

import { useEditor, EditorContent, JSONContent, type Editor } from '@tiptap/react';
import { EditorState, Selection, TextSelection, Transaction } from '@tiptap/pm/state';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import Placeholder from '@tiptap/extension-placeholder';
import Image from '@tiptap/extension-image';
import { Details, DetailsSummary, DetailsContent } from '@tiptap/extension-details';
import styles from './TiptapEditor.module.css';
import { useCallback, useEffect, useRef } from 'react';
import type { ClipboardEvent as ReactClipboardEvent, RefObject } from 'react';
import {
    CARD_IMAGE_MAX_BYTES,
    applySignedUrlsToContent,
    cardImageExtensionFromMimeType,
    collectImageStoragePaths,
    isSupportedCardImageMimeType,
} from '@/lib/tiptap-images';

export type FocusTitleRequest = {
    mode: 'end';
} | {
    mode: 'column';
    column?: number;
};

export type BodyEditorBridge = {
    focusBody: (offset?: number | null) => void;
    insertDetails: () => void;
    unsetDetails: () => void;
};

type DetailsContext = {
    insideDetails: boolean;
    hasDetails: boolean;
};

type TiptapEditorProps = {
    initialContent?: JSONContent | null;
    onChange?: (content: JSONContent) => void;
    placeholder?: string;
    editable?: boolean;
    boardId?: string;
    cardId?: string;
    onEditorError?: (message: string | null) => void;
    onRegisterFocusBodyHandler?: ((handler: (() => void) | null) => void);
    onRegisterPrependTaskHandler?: ((handler: (() => void) | null) => void);
    onRegisterBodyBridge?: ((bridge: BodyEditorBridge | null) => void);
    onRequestFocusTitle?: (request: FocusTitleRequest) => void;
    onDetailsContextChange?: (context: DetailsContext) => void;
    'data-autofocus'?: boolean;
    containerRef?: RefObject<HTMLDivElement>;
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
    onRegisterFocusBodyHandler,
    onRegisterPrependTaskHandler,
    onRegisterBodyBridge,
    onRequestFocusTitle,
    onDetailsContextChange,
    'data-autofocus': dataAutofocus,
    containerRef
}: TiptapEditorProps) {
    // Use a ref to track if we're silently updating content to avoid trigger loops
    const isUpdatingRef = useRef(false);
    const lastAppliedDocRef = useRef<ProseMirrorNode | null>(null);
    const lastEmittedDocRef = useRef<ProseMirrorNode | null>(null);
    const signedUrlRequestIdRef = useRef(0);

    const findScrollableAncestor = useCallback((start: HTMLElement | null): HTMLElement | null => {
        let node: HTMLElement | null = start;
        while (node) {
            if (node.parentElement === null) return null;
            const style = window.getComputedStyle(node);
            const overflowY = style.overflowY;
            if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
                return node;
            }
            node = node.parentElement;
        }
        return null;
    }, []);

    const getLineScrollAmount = useCallback((element: HTMLElement): number => {
        const paragraphElement = element.querySelector('.ProseMirror p, p') as HTMLElement | null;
        const baseElement = paragraphElement ?? element;
        const style = window.getComputedStyle(element);
        const paragraphStyle = window.getComputedStyle(baseElement);
        const lineHeight = Number.parseFloat(paragraphStyle.lineHeight);
        if (Number.isFinite(lineHeight) && lineHeight > 0) {
            return lineHeight;
        }
        const fontSize = Number.parseFloat(paragraphStyle.fontSize || style.fontSize);
        if (Number.isFinite(fontSize) && fontSize > 0) {
            return fontSize * 1.4;
        }
        return 24;
    }, []);

    const getLeadingTextSelection = useCallback((state: EditorState): TextSelection | null => {
        const leadingSelection = Selection.atStart(state.doc);
        if (!(leadingSelection instanceof TextSelection)) return null;
        if (!leadingSelection.$from.parent.isTextblock) return null;
        return leadingSelection;
    }, []);

    const isSelectionInFirstTextLineState = useCallback((view: {
        coordsAtPos: (pos: number) => { top: number };
    }, state: EditorState): boolean => {
        if (state.doc.childCount === 0 || !state.selection.empty) return false;
        const { $from, $to } = state.selection;
        if (!$from.parent.isTextblock || !$to.parent.isTextblock) return false;
        const leadingSelection = getLeadingTextSelection(state);
        if (!leadingSelection) return false;

        // 先頭行判定: doc から現在テキストブロック直前まで、すべて「先頭子」であること。
        for (let depth = 0; depth < $from.depth; depth += 1) {
            if ($from.index(depth) !== 0 || $to.index(depth) !== 0) {
                return false;
            }
        }
        try {
            const currentCoords = view.coordsAtPos(state.selection.from);
            const leadingCoords = view.coordsAtPos(leadingSelection.from);
            return Math.abs(currentCoords.top - leadingCoords.top) <= 1;
        } catch {
            return false;
        }
    }, [getLeadingTextSelection]);

    const setSelectionAtDocStart = useCallback((state: EditorState, dispatch: (tr: Transaction) => void): void => {
        const tr = state.tr.setSelection(Selection.atStart(state.doc)).scrollIntoView();
        dispatch(tr);
    }, []);

    const emitDocChange = useCallback((nextEditor: Editor, nextDoc: ProseMirrorNode) => {
        if (isUpdatingRef.current) return;
        if (lastAppliedDocRef.current && nextDoc.eq(lastAppliedDocRef.current)) return;
        if (lastEmittedDocRef.current && nextDoc.eq(lastEmittedDocRef.current)) return;
        lastEmittedDocRef.current = nextDoc;
        onChange?.(nextEditor.getJSON());
    }, [onChange]);

    const notifyDetailsContext = useCallback((nextEditor: Editor | null) => {
        if (!onDetailsContextChange) return;
        const insideDetails = (() => {
            if (!nextEditor) return false;
            const { $from } = nextEditor.state.selection;
            for (let depth = $from.depth; depth >= 0; depth -= 1) {
                if ($from.node(depth).type.name === 'details') {
                    return true;
                }
            }
            return false;
        })();
        let hasDetails = false;
        nextEditor?.state.doc.descendants((node) => {
            if (node.type.name === 'details') {
                hasDetails = true;
                return false;
            }
            return true;
        });
        onDetailsContextChange({
            insideDetails,
            hasDetails,
        });
    }, [onDetailsContextChange]);

    const insertDetailsAtSelection = useCallback((nextEditor: Editor) => {
        const inserted = nextEditor
            .chain()
            .focus()
            .setDetails()
            .run();

        if (inserted) {
            emitDocChange(nextEditor, nextEditor.state.doc);
            notifyDetailsContext(nextEditor);
        }
    }, [emitDocChange, notifyDetailsContext]);

    const unsetActiveDetails = useCallback((nextEditor: Editor) => {
        const removed = nextEditor.chain().focus().unsetDetails().run();
        if (removed) {
            emitDocChange(nextEditor, nextEditor.state.doc);
            notifyDetailsContext(nextEditor);
        }
    }, [emitDocChange, notifyDetailsContext]);


    const setCursorInLeadingTextblockWithOffset = useCallback((state: EditorState, dispatch: (tr: Transaction) => void, rawOffset: number): boolean => {
        const leadingSelection = getLeadingTextSelection(state);
        if (!leadingSelection) return false;
        const textLength = leadingSelection.$from.parent.textContent.length;
        const offset = Math.max(0, Math.min(rawOffset, textLength));
        const position = leadingSelection.from + offset;
        const tr = state.tr.setSelection(TextSelection.create(state.doc, position)).scrollIntoView();
        dispatch(tr);
        return true;
    }, [getLeadingTextSelection]);

    const scrollByOneLineInView = useCallback((view: { dom: Element }, direction: 'up' | 'down'): boolean => {
        const scrollContainer = findScrollableAncestor(view.dom as HTMLElement);
        if (!scrollContainer) return false;
        const lineStep = getLineScrollAmount(view.dom as HTMLElement);
        const delta = direction === 'up' ? -lineStep : lineStep;
        scrollContainer.scrollBy({ top: delta });
        return true;
    }, [findScrollableAncestor, getLineScrollAmount]);

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

            tr = tr.replaceSelectionWith(imageNode, false);

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
            Details.configure({
                persist: true,
            }),
            DetailsSummary,
            DetailsContent,
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
            handleKeyDown: (view, event) => {
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' && event.key !== 'ArrowLeft') return false;
                if (!event.isTrusted || event.isComposing) return false;

                const { state } = view;
                if (!state.selection.empty) return false;

                if (event.key === 'ArrowUp' && isSelectionInFirstTextLineState(view, state)) {
                    const scrollTop = findScrollableAncestor(view.dom as HTMLElement)?.scrollTop;
                    if ((typeof scrollTop !== 'number' || scrollTop <= 1) && onRequestFocusTitle) {
                        event.preventDefault();
                        onRequestFocusTitle({
                            mode: 'column',
                            column: state.selection.$from.parentOffset,
                        });
                        return true;
                    }
                    if (typeof scrollTop === 'number' && scrollTop > 1) {
                        event.preventDefault();
                        scrollByOneLineInView(view, 'up');
                        return true;
                    }
                }

                if (event.key === 'ArrowLeft') {
                    if (isSelectionInFirstTextLineState(view, state) && view.endOfTextblock('left') && onRequestFocusTitle) {
                        event.preventDefault();
                        onRequestFocusTitle({ mode: 'end' });
                        return true;
                    }
                    return false;
                }

                const scrollContainer = findScrollableAncestor(view.dom as HTMLElement);
                if (!scrollContainer) return false;
                const lineStep = getLineScrollAmount(view.dom as HTMLElement);
                const beforeTop = scrollContainer.scrollTop;

                // ブラウザ既定のキャレット追従が「1画面ジャンプ」になるケースを1行に抑制
                window.requestAnimationFrame(() => {
                    const afterTop = scrollContainer.scrollTop;
                    const delta = afterTop - beforeTop;
                    if (Math.abs(delta) <= lineStep * 1.5) return;
                    scrollContainer.scrollTop = beforeTop + Math.sign(delta) * lineStep;
                });
                return false;
            },
        },
        onUpdate: ({ editor }) => {
            emitDocChange(editor, editor.state.doc);
            notifyDetailsContext(editor);
        },
        onTransaction: ({ editor, transaction }) => {
            if (!transaction.docChanged) return;
            emitDocChange(editor, editor.state.doc);
            notifyDetailsContext(editor);
        },
        onSelectionUpdate: ({ editor }) => {
            notifyDetailsContext(editor);
        },
        autofocus: 'start',
        onCreate: ({ editor }) => {
            lastAppliedDocRef.current = editor.state.doc;
            notifyDetailsContext(editor);
        },
    });

    const prependTask = useCallback(() => {
        if (!editor) return;
        const { state, dispatch } = editor.view;
        const { doc, schema } = state;

        let tr = state.tr;
        const firstChild = doc.firstChild;

        if (firstChild && firstChild.type.name === 'taskList') {
            // すでに先頭が taskList なら、その最初にタスク項目を挿入
            const taskItem = schema.nodes.taskItem.createAndFill({}, [
                schema.nodes.paragraph.create()
            ]);
            if (taskItem) {
                tr = tr.insert(1, taskItem);
            }
        } else {
            // 先頭が taskList でないなら、新しい taskList を先頭に挿入
            const newTaskItem = schema.nodes.taskItem.createAndFill({}, [
                schema.nodes.paragraph.create()
            ]);
            const taskList = schema.nodes.taskList.create({}, [newTaskItem as ProseMirrorNode]);
            tr = tr.insert(0, taskList);
        }

        // 挿入した項目の先頭にフォーカスを移動
        const newDoc = tr.doc;
        const leadingSelection = Selection.atStart(newDoc);
        tr = tr.setSelection(leadingSelection).scrollIntoView();
        
        dispatch(tr);
        editor.view.focus();
    }, [editor]);

    const focusBody = useCallback((offset?: number | null) => {
        if (!editor) return;
        const view = editor.view;
        view.focus();
        const { state, dispatch } = view;
        if (typeof offset === 'number' && Number.isFinite(offset)) {
            if (setCursorInLeadingTextblockWithOffset(state, dispatch, offset)) return;
        }
        setSelectionAtDocStart(state, dispatch);
    }, [editor, setCursorInLeadingTextblockWithOffset, setSelectionAtDocStart]);

    const insertDetails = useCallback(() => {
        if (!editor) return;
        insertDetailsAtSelection(editor);
    }, [editor, insertDetailsAtSelection]);

    const unsetDetailsNode = useCallback(() => {
        if (!editor) return;
        unsetActiveDetails(editor);
    }, [editor, unsetActiveDetails]);

    useEffect(() => {
        if (!onRegisterFocusBodyHandler) return;
        if (!editor) {
            onRegisterFocusBodyHandler(null);
            return;
        }

        onRegisterFocusBodyHandler(() => {
            focusBody();
        });

        return () => {
            onRegisterFocusBodyHandler(null);
        };
    }, [editor, focusBody, onRegisterFocusBodyHandler]);

    useEffect(() => {
        if (!onRegisterPrependTaskHandler) return;
        if (!editor) {
            onRegisterPrependTaskHandler(null);
            return;
        }

        onRegisterPrependTaskHandler(prependTask);

        return () => {
            onRegisterPrependTaskHandler(null);
        };
    }, [editor, prependTask, onRegisterPrependTaskHandler]);

    useEffect(() => {
        if (!onRegisterBodyBridge) return;
        if (!editor) {
            onRegisterBodyBridge(null);
            return;
        }

        onRegisterBodyBridge({
            focusBody: (offset?: number | null) => focusBody(offset),
            insertDetails,
            unsetDetails: unsetDetailsNode,
        });

        return () => {
            onRegisterBodyBridge(null);
        };
    }, [
        editor,
        findScrollableAncestor,
        focusBody,
        insertDetails,
        onRegisterBodyBridge,
        setCursorInLeadingTextblockWithOffset,
        unsetDetailsNode,
    ]);

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

    useEffect(() => {
        notifyDetailsContext(editor);
    }, [editor, notifyDetailsContext]);

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
            onClick={(event) => {
                if (event.target === event.currentTarget) {
                    editor.chain().focus().run();
                }
            }}
            onPasteCapture={handleImagePasteCapture}
        >
            <EditorContent editor={editor} />
        </div>
    );
}
