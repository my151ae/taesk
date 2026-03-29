'use client';

import { useEditor, EditorContent, JSONContent, type Editor } from '@tiptap/react';
import { EditorState, Selection, TextSelection, Transaction } from '@tiptap/pm/state';
import { DOMSerializer, Fragment, Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import Placeholder from '@tiptap/extension-placeholder';
import Image from '@tiptap/extension-image';
import { Details, DetailsSummary, DetailsContent } from '@tiptap/extension-details';
import styles from './TiptapEditor.module.css';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ClipboardEvent as ReactClipboardEvent, RefObject } from 'react';
import { parseMarkdownToTiptapContent, serializeTiptapSliceToMarkdown } from '@/lib/tiptap';
import {
    CARD_IMAGE_MAX_BYTES,
    applySignedUrlsToContent,
    collectImageStoragePaths,
    isSupportedCardImageMimeType,
} from '@/lib/tiptap-images';
import {
    BlockActionMenu,
    getBlockActionItems,
    type BlockActionType,
    type BlockNodeType,
} from '@/app/(board)/_components/tiptap/tiptap-block-menu';
import {
    extractImageFilesFromClipboard,
    extractImageFilesFromClipboardHtml,
    parseErrorMessage,
} from '@/app/(board)/_components/tiptap/tiptap-image-paste';
import {
    buildMoveBlockTransaction,
    buildDeleteBlockTransaction,
    buildDuplicateBlockTransaction,
    buildInsertParagraphAfterBlockTransaction,
    buildInsertParagraphBeforeBlockTransaction,
    canMoveBlock,
    createToggleDetailsSelection,
    createUnsetDetailsSelection,
    type MoveBlockDirection,
    type ResolvedBlockTarget,
} from '@/app/(board)/_components/tiptap/tiptap-block-actions';

export type FocusTitleRequest = {
    mode?: 'column' | 'end';
    column?: number;
};

export type BodyEditorBridge = {
    focusBody: (offset?: number | null) => void;
};

export type BodyEditorShortcutState = {
    canUndo: boolean;
    canRedo: boolean;
    canIndent: boolean;
    canOutdent: boolean;
};

type RenderableBlockActionTarget = {
    pos: number;
    blockPos: number;
    nodeType: BlockNodeType;
    rect: DOMRect | null;
};

type TiptapEditorProps = {
    initialContent?: JSONContent | null;
    onChange?: (content: JSONContent) => void;
    placeholder?: string;
    editable?: boolean;
    boardId?: string;
    cardId?: string;
    onEditorError?: (message: string | null) => void;
    onRegisterBodyBridge?: ((bridge: BodyEditorBridge | null) => void);
    onRequestFocusTitle?: (request: FocusTitleRequest) => void;
    onShortcutStateChange?: (state: BodyEditorShortcutState) => void;
    'data-autofocus'?: boolean;
    containerRef?: RefObject<HTMLDivElement>;
};

export default function TiptapEditor({
    initialContent,
    onChange,
    placeholder = "Type '/' for commands…",
    editable = true,
    boardId,
    cardId,
    onEditorError,
    onRegisterBodyBridge,
    onRequestFocusTitle,
    onShortcutStateChange,
    'data-autofocus': dataAutofocus,
    containerRef
}: TiptapEditorProps) {
    // Use a ref to track if we're silently updating content to avoid trigger loops
    const isUpdatingRef = useRef(false);
    const lastAppliedDocRef = useRef<ProseMirrorNode | null>(null);
    const lastEmittedDocRef = useRef<ProseMirrorNode | null>(null);
    const signedUrlRequestIdRef = useRef(0);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const [menuTarget, setMenuTarget] = useState<RenderableBlockActionTarget | null>(null);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isImageUploadInFlight, setIsImageUploadInFlight] = useState(false);
    const [layoutVersion, setLayoutVersion] = useState(0);
    const [renderableBlocks, setRenderableBlocks] = useState<RenderableBlockActionTarget[]>([]);

    const closeBlockMenu = useCallback(() => {
        setIsMenuOpen(false);
        setMenuTarget(null);
    }, []);

    const invalidateLayout = useCallback(() => {
        setLayoutVersion((current) => current + 1);
    }, []);

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

    const getLeadingTextSelection = useCallback((state: EditorState): Selection | null => {
        const leadingSelection = Selection.atStart(state.doc);
        if (!('empty' in leadingSelection) || !leadingSelection.empty) return null;
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

    const isSelectionInLeadingTaskItemState = useCallback((state: EditorState): boolean => {
        if (!state.selection.empty) return false;
        const { $from, $to } = state.selection;
        if (!$from.parent.isTextblock || !$to.parent.isTextblock) return false;

        for (let depth = $from.depth; depth > 0; depth -= 1) {
            const node = $from.node(depth);
            if (node.type.name !== 'taskItem') continue;
            if (depth < 2) return false;
            const parentList = $from.node(depth - 1);
            const docNode = $from.node(depth - 2);
            if (parentList.type.name !== 'taskList' || docNode.type.name !== 'doc') {
                return false;
            }
            return $from.index(depth - 2) === 0 && $from.index(depth - 1) === 0;
        }

        return false;
    }, []);

    const setSelectionAtDocStart = useCallback((state: EditorState, dispatch: (tr: Transaction) => void): void => {
        const tr = state.tr.setSelection(Selection.atStart(state.doc)).scrollIntoView();
        dispatch(tr);
    }, []);

    const runListIndentCommand = useCallback((currentEditor: Editor | null, direction: 'indent' | 'outdent'): boolean => {
        if (!currentEditor) return false;
        const itemTypes = ['taskItem', 'listItem'] as const;

        for (const itemType of itemTypes) {
            const command =
                direction === 'indent'
                    ? currentEditor.chain().focus().sinkListItem(itemType).run()
                    : currentEditor.chain().focus().liftListItem(itemType).run();
            if (command) {
                return true;
            }
        }

        return false;
    }, []);

    const canRunListIndentCommand = useCallback((currentEditor: Editor | null, direction: 'indent' | 'outdent'): boolean => {
        if (!currentEditor) return false;
        const itemTypes = ['taskItem', 'listItem'] as const;

        return itemTypes.some((itemType) =>
            direction === 'indent'
                ? currentEditor.can().chain().focus().sinkListItem(itemType).run()
                : currentEditor.can().chain().focus().liftListItem(itemType).run()
        );
    }, []);

    const emitShortcutState = useCallback((currentEditor: Editor | null) => {
        if (!onShortcutStateChange) return;
        if (!currentEditor || !editable) {
            onShortcutStateChange({
                canUndo: false,
                canRedo: false,
                canIndent: false,
                canOutdent: false,
            });
            return;
        }

        onShortcutStateChange({
            canUndo: currentEditor.can().chain().focus().undo().run(),
            canRedo: currentEditor.can().chain().focus().redo().run(),
            canIndent: canRunListIndentCommand(currentEditor, 'indent'),
            canOutdent: canRunListIndentCommand(currentEditor, 'outdent'),
        });
    }, [canRunListIndentCommand, editable, onShortcutStateChange]);

    const resolveBlockTargetAtPos = useCallback((state: EditorState, pos: number): ResolvedBlockTarget | null => {
        const clampedPos = Math.max(0, Math.min(pos, state.doc.content.size));
        const $pos = state.doc.resolve(clampedPos);

        for (let depth = $pos.depth; depth > 0; depth -= 1) {
            const node = $pos.node(depth);
            if (node.type.name === 'detailsContent') {
                return null;
            }

            if (node.type.name === 'detailsSummary' && depth >= 2) {
                const detailsNode = $pos.node(depth - 1);
                const detailsParent = $pos.node(depth - 2);
                if (detailsNode.type.name === 'details' && detailsParent.type.name === 'doc') {
                    return {
                        pos: $pos.before(depth - 1),
                        nodeType: 'details',
                        node: detailsNode,
                        depth: depth - 1,
                        topLevelIndex: $pos.index(depth - 2),
                        parentListPos: null,
                        parentListNode: null,
                        itemIndex: null,
                    };
                }
                return null;
            }

            if (node.type.name === 'details' && depth >= 1 && $pos.node(depth - 1).type.name === 'doc') {
                return {
                    pos: $pos.before(depth),
                    nodeType: 'details',
                    node,
                    depth,
                    topLevelIndex: $pos.index(depth - 1),
                    parentListPos: null,
                    parentListNode: null,
                    itemIndex: null,
                };
            }

            if ((node.type.name === 'taskItem' || node.type.name === 'listItem') && depth >= 2) {
                const parentList = $pos.node(depth - 1);
                const grandParent = $pos.node(depth - 2);
                if (
                    (parentList.type.name === 'taskList' || parentList.type.name === 'bulletList' || parentList.type.name === 'orderedList') &&
                    grandParent.type.name === 'doc'
                ) {
                    return {
                        pos: $pos.before(depth),
                        nodeType: node.type.name as BlockNodeType,
                        node,
                        depth,
                        topLevelIndex: null,
                        parentListPos: $pos.before(depth - 1),
                        parentListNode: parentList,
                        itemIndex: $pos.index(depth - 1),
                    };
                }
                return null;
            }

            if ((node.type.name === 'paragraph' || node.type.name === 'heading') && $pos.node(depth - 1).type.name === 'doc') {
                return {
                    pos: $pos.before(depth),
                    nodeType: node.type.name as BlockNodeType,
                    node,
                    depth,
                    topLevelIndex: $pos.index(0),
                    parentListPos: null,
                    parentListNode: null,
                    itemIndex: null,
                };
            }
        }

        return null;
    }, []);

    const applyBlockActionTransactionToView = useCallback((view: Editor['view'], transaction: Transaction | null): boolean => {
        if (!transaction) return false;
        view.dispatch(transaction);
        onChange?.(transaction.doc.toJSON() as JSONContent);
        view.focus();
        closeBlockMenu();
        return true;
    }, [closeBlockMenu, onChange]);

    const getBlockTargetRect = useCallback((view: Editor['view'], pos: number): DOMRect | null => {
        const nodeDom = view.nodeDOM(pos);
        if (!(nodeDom instanceof HTMLElement)) {
            return null;
        }
        if (nodeDom.dataset.type === 'details') {
            const summary = nodeDom.querySelector(':scope > summary');
            if (summary instanceof HTMLElement) {
                return summary.getBoundingClientRect();
            }
        }
        return nodeDom.getBoundingClientRect();
    }, []);

    const getBlockTargetAtPos = useCallback((view: Editor['view'], state: EditorState, pos: number): RenderableBlockActionTarget | null => {
        const target = resolveBlockTargetAtPos(state, pos);
        if (!target) return null;
        const rect = getBlockTargetRect(view, target.pos);
        return {
            pos,
            blockPos: target.pos,
            nodeType: target.nodeType,
            rect,
        };
    }, [getBlockTargetRect, resolveBlockTargetAtPos]);

    const emitDocChange = useCallback((nextEditor: Editor, nextDoc: ProseMirrorNode) => {
        if (isUpdatingRef.current) return;
        if (lastAppliedDocRef.current && nextDoc.eq(lastAppliedDocRef.current)) return;
        if (lastEmittedDocRef.current && nextDoc.eq(lastEmittedDocRef.current)) return;
        lastEmittedDocRef.current = nextDoc;
        onChange?.(nextEditor.getJSON());
    }, [onChange]);

    const emitForcedDocChange = useCallback((nextEditor: Editor, nextDoc: ProseMirrorNode) => {
        if (isUpdatingRef.current) return;
        lastEmittedDocRef.current = nextDoc;
        onChange?.(nextDoc.toJSON() as JSONContent);
    }, [onChange]);

    const insertDetailsAtSelection = useCallback((nextEditor: Editor) => {
        const inserted = nextEditor
            .chain()
            .focus()
            .setDetails()
            .run();

        if (inserted) {
            emitForcedDocChange(nextEditor, nextEditor.state.doc);
        }
    }, [emitForcedDocChange]);

    const unsetActiveDetails = useCallback((nextEditor: Editor) => {
        const removed = nextEditor.chain().focus().unsetDetails().run();
        if (removed) {
            emitForcedDocChange(nextEditor, nextEditor.state.doc);
        }
    }, [emitForcedDocChange]);

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

        setIsImageUploadInFlight(true);
        closeBlockMenu();

        try {
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
        } finally {
            setIsImageUploadInFlight(false);
        }
    }, [boardId, cardId, closeBlockMenu, onEditorError, onChange]);

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
                class: 'prose prose-slate max-w-none focus:outline-none pl-10 pr-4 pt-3 pb-3',
                ...(dataAutofocus ? { 'data-autofocus': 'true' } : {}),
            },
            handleKeyDown: (view, event) => {
                if (event.key === 'Tab') {
                    runListIndentCommand(editor, event.shiftKey ? 'outdent' : 'indent');
                    event.preventDefault();
                    event.stopPropagation();
                    return true;
                }

                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' && event.key !== 'ArrowLeft') return false;
                if (!event.isTrusted || event.isComposing) return false;

                const { state } = view;
                const isMoveShortcut =
                    (event.metaKey || event.ctrlKey) &&
                    event.shiftKey &&
                    (event.key === 'ArrowUp' || event.key === 'ArrowDown');

                if (isMoveShortcut) {
                    const target = resolveBlockTargetAtPos(state, state.selection.from);
                    if (!target) return false;

                    const direction: MoveBlockDirection = event.key === 'ArrowUp' ? 'up' : 'down';
                    const transaction = buildMoveBlockTransaction(state, target, direction);
                    if (!transaction) return false;

                    event.preventDefault();
                    event.stopPropagation();
                    return applyBlockActionTransactionToView(view, transaction);
                }

                if (!state.selection.empty) return false;

                if (event.key === 'ArrowUp' && isSelectionInFirstTextLineState(view, state)) {
                    const scrollTop = findScrollableAncestor(view.dom as HTMLElement)?.scrollTop;
                    if ((typeof scrollTop !== 'number' || scrollTop <= 1) && onRequestFocusTitle) {
                        event.preventDefault();
                        event.stopPropagation();
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
                        event.stopPropagation();
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
            emitShortcutState(editor);
            invalidateLayout();
        },
        onTransaction: ({ editor, transaction }) => {
            if (!transaction.docChanged) return;
            emitDocChange(editor, editor.state.doc);
            emitShortcutState(editor);
            invalidateLayout();
        },
        onSelectionUpdate: ({ editor }) => {
            emitShortcutState(editor);
            invalidateLayout();
        },
        autofocus: dataAutofocus ? 'start' : false,
        onCreate: ({ editor }) => {
            lastAppliedDocRef.current = editor.state.doc;
            emitShortcutState(editor);
            invalidateLayout();
        },
    });

    const applyBlockActionTransaction = useCallback((nextEditor: Editor | null, transaction: Transaction | null): boolean => {
        if (!nextEditor) return false;
        return applyBlockActionTransactionToView(nextEditor.view, transaction);
    }, [applyBlockActionTransactionToView]);

    const insertParagraphBeforeBlock = useCallback((targetPos: number): boolean => {
        if (!editor) return false;
        const { state } = editor.view;
        const target = resolveBlockTargetAtPos(state, targetPos);
        if (!target) return false;
        const transaction = buildInsertParagraphBeforeBlockTransaction(state, target);
        return applyBlockActionTransaction(editor, transaction);
    }, [applyBlockActionTransaction, editor, resolveBlockTargetAtPos]);

    const insertParagraphAfterBlock = useCallback((targetPos: number): boolean => {
        if (!editor) return false;
        const { state } = editor.view;
        const target = resolveBlockTargetAtPos(state, targetPos);
        if (!target) return false;
        const transaction = buildInsertParagraphAfterBlockTransaction(state, target);
        return applyBlockActionTransaction(editor, transaction);
    }, [applyBlockActionTransaction, editor, resolveBlockTargetAtPos]);

    const duplicateBlock = useCallback((targetPos: number): boolean => {
        if (!editor) return false;
        const { state } = editor.view;
        const target = resolveBlockTargetAtPos(state, targetPos);
        if (!target) return false;
        const transaction = buildDuplicateBlockTransaction(state, target);
        return applyBlockActionTransaction(editor, transaction);
    }, [applyBlockActionTransaction, editor, resolveBlockTargetAtPos]);

    const moveBlock = useCallback((targetPos: number, direction: MoveBlockDirection): boolean => {
        if (!editor) return false;
        const { state } = editor.view;
        const target = resolveBlockTargetAtPos(state, targetPos);
        if (!target) return false;
        const transaction = buildMoveBlockTransaction(state, target, direction);
        return applyBlockActionTransaction(editor, transaction);
    }, [applyBlockActionTransaction, editor, resolveBlockTargetAtPos]);

    const deleteBlock = useCallback((targetPos: number): boolean => {
        if (!editor) return false;
        const { state } = editor.view;
        const target = resolveBlockTargetAtPos(state, targetPos);
        if (!target) return false;
        const transaction = buildDeleteBlockTransaction(state, target);
        return applyBlockActionTransaction(editor, transaction);
    }, [applyBlockActionTransaction, editor, resolveBlockTargetAtPos]);

    const toggleBlockAsDetails = useCallback((targetPos: number): boolean => {
        if (!editor) return false;
        const { state, dispatch } = editor.view;
        const target = resolveBlockTargetAtPos(state, targetPos);
        if (!target) return false;
        const selection = createToggleDetailsSelection(state, target);
        if (!selection) return false;
        dispatch(state.tr.setSelection(selection));
        insertDetailsAtSelection(editor);
        editor.view.focus();
        closeBlockMenu();
        return true;
    }, [closeBlockMenu, editor, insertDetailsAtSelection, resolveBlockTargetAtPos]);

    const unsetDetailsAtTarget = useCallback((targetPos: number): boolean => {
        if (!editor) return false;
        const { state, dispatch } = editor.view;
        const target = resolveBlockTargetAtPos(state, targetPos);
        if (!target) return false;
        const selection = createUnsetDetailsSelection(state, target);
        if (!selection) return false;
        dispatch(state.tr.setSelection(selection));
        unsetActiveDetails(editor);
        editor.view.focus();
        closeBlockMenu();
        return true;
    }, [closeBlockMenu, editor, resolveBlockTargetAtPos, unsetActiveDetails]);

    const suppressBlockUi = !editable || isImageUploadInFlight || !editor;

    useEffect(() => {
        emitShortcutState(editor);
    }, [editor, emitShortcutState]);

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

    useEffect(() => {
        if (!onRegisterBodyBridge) return;
        if (!editor) {
            onRegisterBodyBridge(null);
            return;
        }

        onRegisterBodyBridge({
            focusBody: (offset?: number | null) => focusBody(offset),
        });

        return () => {
            onRegisterBodyBridge(null);
        };
    }, [editor, focusBody, onRegisterBodyBridge]);

    const handleCopyCapture = useCallback((event: ReactClipboardEvent<HTMLDivElement>) => {
        if (!editor || !event.clipboardData || !editor.isEditable) return;
        if (editor.state.selection.empty) return;

        const root = rootRef.current;
        if (!root) return;

        const target = event.target;
        if (target instanceof HTMLElement && target instanceof HTMLInputElement) {
            return;
        }

        const selection = window.getSelection();
        const anchorNode = selection?.anchorNode ?? null;
        const focusNode = selection?.focusNode ?? null;
        const isInsideEditor = [anchorNode, focusNode].some((node) => node instanceof Node && editor.view.dom.contains(node));
        const isInsideContainer =
            (target instanceof Node && root.contains(target)) ||
            (anchorNode instanceof Node && root.contains(anchorNode));

        if (!isInsideEditor || !isInsideContainer) return;

        const slice = editor.state.selection.content();
        const markdown = serializeTiptapSliceToMarkdown(slice);
        if (!markdown.trim()) return;

        const serializer =
            editor.view.someProp('clipboardSerializer', (value) => value) ??
            DOMSerializer.fromSchema(editor.schema);
        const wrapper = document.createElement('div');
        wrapper.appendChild(serializer.serializeFragment(slice.content, { document }));

        event.clipboardData.setData('text/plain', markdown);
        const html = wrapper.innerHTML;
        if (html) {
            event.clipboardData.setData('text/html', html);
        }
        event.preventDefault();
    }, [editor]);

    const applyParsedMarkdownPaste = useCallback((content: JSONContent): boolean => {
        if (!editor) return false;

        const { state, dispatch } = editor.view;
        const contentNodes = content.type === 'doc' ? content.content ?? [] : [content];
        if (contentNodes.length === 0) return false;

        let fragment: Fragment;
        try {
            fragment = Fragment.fromArray(contentNodes.map((node) => editor.schema.nodeFromJSON(node)));
        } catch {
            return false;
        }

        const insertFrom = state.selection.from;
        const insertedSize = fragment.size;
        const tr = state.tr.replaceSelection(new Slice(fragment, 0, 0));
        const selectionPos = Math.min(insertFrom + insertedSize, tr.doc.content.size);
        const nextSelection = Selection.near(tr.doc.resolve(selectionPos), -1);
        const nextTr = tr.setSelection(nextSelection).scrollIntoView();
        dispatch(nextTr);
        onChange?.(nextTr.doc.toJSON() as JSONContent);
        editor.view.focus();
        return true;
    }, [editor, onChange]);

    const handleMarkdownPasteCapture = useCallback((event: ReactClipboardEvent<HTMLDivElement>) => {
        if (!editor || !editor.isEditable || !event.clipboardData) return false;

        const text = event.clipboardData.getData('text/plain');
        if (!text.trim()) return false;

        if (text.trimStart().startsWith(':::details') && isSelectionInLeadingTaskItemState(editor.state)) {
            return false;
        }

        const parsedContent = parseMarkdownToTiptapContent(text);
        if (!parsedContent) return false;

        const applied = applyParsedMarkdownPaste(parsedContent);
        if (!applied) return false;

        event.preventDefault();
        event.stopPropagation();
        return true;
    }, [applyParsedMarkdownPaste, editor, isSelectionInLeadingTaskItemState]);

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

    const handlePasteCapture = useCallback((event: ReactClipboardEvent<HTMLDivElement>) => {
        const directImageFiles = extractImageFilesFromClipboard(event.clipboardData);
        const htmlImageFiles =
            directImageFiles.length === 0
                ? extractImageFilesFromClipboardHtml(event.clipboardData?.getData('text/html') ?? '')
                : [];

        if (directImageFiles.length > 0 || htmlImageFiles.length > 0) {
            handleImagePasteCapture(event);
            return;
        }

        handleMarkdownPasteCapture(event);
    }, [handleImagePasteCapture, handleMarkdownPasteCapture]);

    // 外部からの本文差し替えだけを取り込み、ローカル編集中の prop 反映では再初期化しない。
    // 画像付き本文は signed URL の再取得で doc が毎回変わり得るため、ここで setContent すると
    // 入力中の selection が飛びやすい。
    useEffect(() => {
        if (!editor) return;

        const lastAppliedDoc = lastAppliedDocRef.current;
        if (lastAppliedDoc && !editor.state.doc.eq(lastAppliedDoc)) {
            return;
        }

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
        if (suppressBlockUi) {
            closeBlockMenu();
        }
    }, [closeBlockMenu, suppressBlockUi]);

    useEffect(() => {
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || !isMenuOpen) return;
            event.preventDefault();
            event.stopPropagation();
            closeBlockMenu();
        };

        document.addEventListener('keydown', handleEscape, true);
        return () => {
            document.removeEventListener('keydown', handleEscape, true);
        };
    }, [closeBlockMenu, isMenuOpen]);

    useEffect(() => {
        if (!editor) return;

        const root = rootRef.current;
        const scrollParent = findScrollableAncestor(root);
        const handleLayoutChange = () => {
            invalidateLayout();
        };

        window.addEventListener('resize', handleLayoutChange);
        scrollParent?.addEventListener('scroll', handleLayoutChange, { passive: true });

        return () => {
            window.removeEventListener('resize', handleLayoutChange);
            scrollParent?.removeEventListener('scroll', handleLayoutChange);
        };
    }, [editor, findScrollableAncestor, invalidateLayout, layoutVersion]);

    // Update editable state
    useEffect(() => {
        if (editor && editor.isEditable !== editable) {
            editor.setEditable(editable);
        }
    }, [editor, editable]);

    useLayoutEffect(() => {
        if (!editor || suppressBlockUi) {
            setRenderableBlocks([]);
            return;
        }

        const measureBlocks = () => {
            const nextTargets: RenderableBlockActionTarget[] = [];
            editor.state.doc.descendants((node, pos) => {
                if (
                    node.type.name !== 'details' &&
                    node.type.name !== 'paragraph' &&
                    node.type.name !== 'heading' &&
                    node.type.name !== 'taskItem' &&
                    node.type.name !== 'listItem'
                ) {
                    return true;
                }

                const target = getBlockTargetAtPos(editor.view, editor.state, pos + 1);
                if (!target?.rect) {
                    return node.type.name === 'taskItem' || node.type.name === 'listItem' || node.type.name === 'details' ? false : true;
                }

                const isDuplicate = nextTargets.some((candidate) => candidate.blockPos === target.blockPos && candidate.nodeType === target.nodeType);
                if (!isDuplicate) {
                    nextTargets.push(target);
                }

                return node.type.name === 'taskItem' || node.type.name === 'listItem' || node.type.name === 'details' ? false : true;
            });
            setRenderableBlocks(nextTargets);
        };

        measureBlocks();
    }, [editor, getBlockTargetAtPos, layoutVersion, suppressBlockUi]);

    const assignRootRef = useCallback((node: HTMLDivElement | null) => {
        if (rootRef.current === node) {
            if (containerRef) {
                (containerRef as { current: HTMLDivElement | null }).current = node;
            }
            return;
        }

        rootRef.current = node;
        if (containerRef) {
            (containerRef as { current: HTMLDivElement | null }).current = node;
        }
        invalidateLayout();
    }, [containerRef, invalidateLayout]);

    if (!editor) {
        return null;
    }

    const rootRect = rootRef.current?.getBoundingClientRect() ?? null;
    const resolvedMenuTarget = menuTarget ? resolveBlockTargetAtPos(editor.state, menuTarget.pos) : null;
    const menuItems = menuTarget
        ? getBlockActionItems(menuTarget.nodeType, {
            canMoveUp: resolvedMenuTarget ? canMoveBlock(editor.state, resolvedMenuTarget, 'up') : false,
            canMoveDown: resolvedMenuTarget ? canMoveBlock(editor.state, resolvedMenuTarget, 'down') : false,
        })
        : [];

    const menuAnchor = (() => {
        if (!editor || !menuTarget) return null;
        return getBlockTargetAtPos(editor.view, editor.state, menuTarget.pos);
    })();

    const menuTop = menuAnchor?.rect && rootRect ? Math.max(menuAnchor.rect.top - rootRect.top, 4) : 0;
    const menuLeft = 44;

    const handleBlockAction = (action: BlockActionType) => {
        if (!menuTarget) return;
        if (typeof window !== 'undefined') {
            (window as typeof window & {
                __TAESK_LAST_BLOCK_ACTION__?: {
                    action: BlockActionType;
                    menuTargetPos: number;
                    menuTargetNodeType: BlockNodeType;
                    resolvedTargetPos: number | null;
                    resolvedNodeType: BlockNodeType | null;
                };
            }).__TAESK_LAST_BLOCK_ACTION__ = {
                action,
                menuTargetPos: menuTarget.pos,
                menuTargetNodeType: menuTarget.nodeType,
                resolvedTargetPos: resolvedMenuTarget?.pos ?? null,
                resolvedNodeType: resolvedMenuTarget?.nodeType ?? null,
            };
        }
        switch (action) {
            case 'move-up':
                moveBlock(menuTarget.pos, 'up');
                break;
            case 'move-down':
                moveBlock(menuTarget.pos, 'down');
                break;
            case 'insert-above':
                insertParagraphBeforeBlock(menuTarget.pos);
                break;
            case 'insert-below':
                insertParagraphAfterBlock(menuTarget.pos);
                break;
            case 'duplicate':
                duplicateBlock(menuTarget.pos);
                break;
            case 'delete':
                deleteBlock(menuTarget.pos);
                break;
            case 'toggle-details':
                toggleBlockAsDetails(menuTarget.pos);
                break;
            case 'unset-details':
                unsetDetailsAtTarget(menuTarget.pos);
                break;
        }
        closeBlockMenu();
    };

    return (
        <div
            ref={assignRootRef}
            className={`w-full bg-white dark:bg-gray-800 rounded-lg cursor-text ${styles.editor}`}
            onClick={(event) => {
                if (event.target === event.currentTarget) {
                    editor.chain().focus().run();
                }
            }}
            onCopyCapture={handleCopyCapture}
            onPasteCapture={handlePasteCapture}
        >
            {renderableBlocks.map((target, index) => {
                if (!target.rect || !rootRect) return null;
                return (
                    <button
                        key={`${target.blockPos}-${target.nodeType}`}
                        type="button"
                        tabIndex={-1}
                        aria-label="ブロックメニューを開く"
                        data-testid="tiptap-block-handle"
                        data-block-index={index}
                        data-block-node-type={target.nodeType}
                        data-block-pos={target.pos}
                        data-block-start-pos={target.blockPos}
                        className={styles.blockActionHandle}
                        style={{ top: Math.max(target.rect.top - rootRect.top, 4), left: 12 }}
                        onMouseDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                        }}
                        onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setMenuTarget(target);
                            setIsMenuOpen(true);
                        }}
                    >
                        <span className={styles.blockActionHandleDots}>⋮⋮</span>
                    </button>
                );
            })}
            <EditorContent editor={editor} />
            {isMenuOpen && menuTarget && menuAnchor?.rect && rootRect ? (
                <BlockActionMenu
                    top={menuTop}
                    left={menuLeft}
                    items={menuItems}
                    onClose={closeBlockMenu}
                    onSelect={handleBlockAction}
                />
            ) : null}
        </div>
    );
}
