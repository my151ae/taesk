'use client';

import { useEditor, EditorContent, JSONContent } from '@tiptap/react';
import { EditorState, Selection, TextSelection, Transaction } from '@tiptap/pm/state';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import Placeholder from '@tiptap/extension-placeholder';
import Image from '@tiptap/extension-image';
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

type TiptapEditorProps = {
    initialContent?: JSONContent | null;
    onChange?: (content: JSONContent) => void;
    placeholder?: string;
    editable?: boolean;
    boardId?: string;
    cardId?: string;
    onEditorError?: (message: string | null) => void;
    onRegisterImagePasteHandler?: ((handler: ((files: File[]) => Promise<void>) | null) => void);
    onRegisterFocusBodyHandler?: ((handler: (() => void) | null) => void);
    onRequestFocusTitle?: () => void;
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
    onRegisterImagePasteHandler,
    onRegisterFocusBodyHandler,
    onRequestFocusTitle,
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
        while (node && node.parentElement) {
            node = node.parentElement;
            if (!node) return null;
            const style = window.getComputedStyle(node);
            const overflowY = style.overflowY;
            if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
                return node;
            }
        }
        return null;
    }, []);

    const getLineScrollAmount = useCallback((element: HTMLElement): number => {
        const style = window.getComputedStyle(element);
        const lineHeight = Number.parseFloat(style.lineHeight);
        if (Number.isFinite(lineHeight) && lineHeight > 0) {
            return lineHeight;
        }
        return 24;
    }, []);

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
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return false;
                if (!event.isTrusted) return false;

                const scrollContainer = findScrollableAncestor(view.dom as HTMLElement);
                if (!scrollContainer) return false;
                const lineStep = getLineScrollAmount(view.dom as HTMLElement);
                const beforeTop = scrollContainer.scrollTop;

                const { state } = view;
                if (event.key === 'ArrowUp' && state.selection.empty) {
                    if (scrollContainer.scrollTop <= 1) {
                        event.preventDefault();
                        onRequestFocusTitle?.();
                        return true;
                    }

                    const startPos = Selection.atStart(state.doc).from;
                    if (state.selection.from === startPos) {
                        event.preventDefault();
                        scrollContainer.scrollTop = Math.max(0, scrollContainer.scrollTop - lineStep);
                        return true;
                    }
                }

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
            if (isUpdatingRef.current) return;
            const currentDoc = editor.state.doc;
            if (lastAppliedDocRef.current && currentDoc.eq(lastAppliedDocRef.current)) return;
            if (lastEmittedDocRef.current && currentDoc.eq(lastEmittedDocRef.current)) return;
            lastEmittedDocRef.current = currentDoc;
            if (onChange) {
                onChange(editor.getJSON());
            }
        },
        autofocus: 'start',
        onCreate: ({ editor }) => {
            lastAppliedDocRef.current = editor.state.doc;
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

    useEffect(() => {
        if (!onRegisterFocusBodyHandler) return;
        if (!editor) {
            onRegisterFocusBodyHandler(null);
            return;
        }

        onRegisterFocusBodyHandler(() => {
            const view = editor.view;
            const dom = view.dom as HTMLElement;
            view.focus();
            const placeCursorToVisibleBody = () => {
                const rect = dom.getBoundingClientRect();
                const scrollContainer = findScrollableAncestor(dom);
                const containerRect = scrollContainer?.getBoundingClientRect() ?? rect;
                const coords = {
                    left: rect.left + 24,
                    top: Math.max(rect.top + 8, containerRect.top + 8),
                };
                const resolved = view.posAtCoords(coords);
                const fallbackPos = Selection.atStart(view.state.doc).from;
                const nextPos = typeof resolved?.pos === 'number' ? resolved.pos : fallbackPos;
                const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, nextPos));
                view.dispatch(tr);
            };
            placeCursorToVisibleBody();
            window.requestAnimationFrame(placeCursorToVisibleBody);
        });

        return () => {
            onRegisterFocusBodyHandler(null);
        };
    }, [editor, onRegisterFocusBodyHandler]);

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
