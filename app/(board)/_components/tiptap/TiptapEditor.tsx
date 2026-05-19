'use client';

import { useEditor, EditorContent, JSONContent, type Editor } from '@tiptap/react';
import { Extension } from '@tiptap/core';
import { EditorState, Plugin, PluginKey, Selection, TextSelection, Transaction } from '@tiptap/pm/state';
import { DOMSerializer, Fragment, Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import StarterKit from '@tiptap/starter-kit';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import Placeholder from '@tiptap/extension-placeholder';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import { Details, DetailsSummary, DetailsContent } from '@tiptap/extension-details';
import styles from './TiptapEditor.module.css';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { ClipboardEvent as ReactClipboardEvent, MouseEvent as ReactMouseEvent, RefObject } from 'react';
import { buildDefaultBodyContent, parseMarkdownToTiptapContent, serializeTiptapSliceToMarkdown } from '@/lib/tiptap';
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
    getNodeChildren,
    type MoveBlockDirection,
    type ResolvedBlockTarget,
} from '@/app/(board)/_components/tiptap/tiptap-block-actions';
import {
    clearExpandedHiddenRunsMeta,
    TaskCompletionVisibility,
    getTaskCompletionState,
    isTaskItemHandleVisible,
    setTaskCompletionVisibilityMeta,
    taskCompletionVisibilityPluginKey,
} from '@/app/(board)/_components/tiptap/TaskCompletionVisibility';

const CHILD_CARD_LINK_PLACEHOLDER = "__TAESK_CHILD_CARD_LINK__";
const cardLinkMetaPluginKey = new PluginKey<{ metaByShortId: Record<string, string> }>("cardLinkMeta");

const setCardLinkMeta = (tr: Transaction, metaByShortId: Record<string, string>) =>
    tr.setMeta(cardLinkMetaPluginKey, { metaByShortId });

const extractCardShortIdFromHref = (href: string | null | undefined): string | null => {
    if (!href) return null;
    const match = href.match(/\/c\/([^/?#]+)(?:[/?#]|$)/);
    return match?.[1] ?? null;
};

const CardLinkMeta = Extension.create<{ metaByShortId: Record<string, string> }>({
    name: "cardLinkMeta",

    addOptions() {
        return { metaByShortId: {} };
    },

    addProseMirrorPlugins() {
        const initialMetaByShortId = this.options.metaByShortId;

        return [
            new Plugin({
                key: cardLinkMetaPluginKey,
                state: {
                    init: () => ({ metaByShortId: initialMetaByShortId }),
                    apply: (tr, previous) => {
                        const meta = tr.getMeta(cardLinkMetaPluginKey) as
                            | { metaByShortId?: Record<string, string> }
                            | undefined;
                        return meta?.metaByShortId ? { metaByShortId: meta.metaByShortId } : previous;
                    },
                },
                props: {
                    decorations: (state) => {
                        const pluginState = cardLinkMetaPluginKey.getState(state);
                        const metaByShortId = pluginState?.metaByShortId ?? {};
                        const decorations: Decoration[] = [];

                        state.doc.descendants((node, pos) => {
                            if (!node.isText) return;
                            const linkMark = node.marks.find((mark) => mark.type.name === "link");
                            const shortId = extractCardShortIdFromHref(linkMark?.attrs?.href);
                            if (!shortId) return;
                            const label = metaByShortId[shortId];
                            if (!label) return;

                            decorations.push(
                                Decoration.widget(
                                    pos + node.nodeSize,
                                    () => {
                                        const span = document.createElement("span");
                                        span.className = "taesk-card-link-meta";
                                        span.contentEditable = "false";
                                        span.textContent = label;
                                        return span;
                                    },
                                    { key: `card-link-meta-${shortId}-${pos}`, side: 1 }
                                )
                            );
                        });

                        return DecorationSet.create(state.doc, decorations);
                    },
                },
            }),
        ];
    },
});

export type FocusTitleRequest = {
    mode?: 'column' | 'end';
    column?: number;
};

export type BodyEditorBridge = {
    focusBody: (offset?: number | null) => void;
    insertLeadingParagraphAndFocus: () => boolean;
    clearExpandedHiddenRuns: () => void;
};

export type BodyEditorShortcutState = {
    canUndo: boolean;
    canRedo: boolean;
    canIndent: boolean;
    canOutdent: boolean;
};

type ActiveBlockMenuTarget = {
    blockPos: number;
    nodeType: BlockNodeType;
    fallbackAnchorRect: DOMRect | null;
};

type RenderableBlockActionTarget = {
    pos: number;
    blockPos: number;
    nodeType: BlockNodeType;
    rect: DOMRect | null;
};

type ActiveBlockHandle = {
    pos: number;
    blockPos: number;
    nodeType: BlockNodeType;
    rect: DOMRect;
    containerRect: DOMRect;
    reason: 'hover' | 'menu' | 'keyboard' | 'block-action' | 'scroll' | 'resize' | 'visibility';
};

type ChecklistProgress = {
    checked: number;
    total: number;
};

type TiptapEditorProps = {
    initialContent?: JSONContent | null;
    onChange?: (content: JSONContent) => void;
    placeholder?: string;
    editable?: boolean;
    showCompletedLines?: boolean;
    boardId?: string;
    cardId?: string;
    cardLinkMetaByShortId?: Record<string, string>;
    onOpenCardLink?: (shortId: string) => void;
    onEditorError?: (message: string | null) => void;
    onRegisterBodyBridge?: ((bridge: BodyEditorBridge | null) => void);
    onRequestFocusTitle?: (request: FocusTitleRequest) => void;
    onShortcutStateChange?: (state: BodyEditorShortcutState) => void;
    shortcutStateEnabled?: boolean;
    onChecklistProgressChange?: (progress: ChecklistProgress) => void;
    'data-autofocus'?: boolean;
    containerRef?: RefObject<HTMLDivElement>;
};

function TiptapEditor({
    initialContent,
    onChange,
    placeholder = "Type '/' for commands…",
    editable = true,
    showCompletedLines = false,
    boardId,
    cardId,
    cardLinkMetaByShortId = {},
    onOpenCardLink,
    onEditorError,
    onRegisterBodyBridge,
    onRequestFocusTitle,
    onShortcutStateChange,
    shortcutStateEnabled = true,
    onChecklistProgressChange,
    'data-autofocus': dataAutofocus,
    containerRef
}: TiptapEditorProps) {
    const BLOCK_ACTION_HANDLE_HEIGHT = 28;

    // Use a ref to track if we're silently updating content to avoid trigger loops
    const isUpdatingRef = useRef(false);
    const lastAppliedDocRef = useRef<ProseMirrorNode | null>(null);
    const lastEmittedDocRef = useRef<ProseMirrorNode | null>(null);
    const signedUrlRequestIdRef = useRef(0);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const shortcutFrameRef = useRef<number | null>(null);
    const lastShortcutStateRef = useRef<BodyEditorShortcutState | null>(null);
    const measureFrameRef = useRef<number | null>(null);
    const pendingMeasureRef = useRef<{
        pos: number;
        reason: ActiveBlockHandle['reason'];
    } | null>(null);
    const activeBlockHandleRef = useRef<ActiveBlockHandle | null>(null);
    const isMenuOpenRef = useRef(false);
    const lastChecklistProgressRef = useRef<ChecklistProgress | null>(null);
    const [menuTarget, setMenuTarget] = useState<ActiveBlockMenuTarget | null>(null);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isImageUploadInFlight, setIsImageUploadInFlight] = useState(false);
    const [activeBlockHandle, setActiveBlockHandle] = useState<ActiveBlockHandle | null>(null);

    const closeBlockMenu = useCallback(() => {
        isMenuOpenRef.current = false;
        setIsMenuOpen(false);
        setMenuTarget(null);
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
                ? currentEditor.can().sinkListItem(itemType)
                : currentEditor.can().liftListItem(itemType)
        );
    }, []);

    const statesEqual = (left: BodyEditorShortcutState | null, right: BodyEditorShortcutState) => (
        left?.canUndo === right.canUndo &&
        left?.canRedo === right.canRedo &&
        left?.canIndent === right.canIndent &&
        left?.canOutdent === right.canOutdent
    );

    const emitShortcutState = useCallback((currentEditor: Editor | null, force = false) => {
        if (!onShortcutStateChange) return;
        if (!currentEditor || !editable || !shortcutStateEnabled) {
            const emptyState = {
                canUndo: false,
                canRedo: false,
                canIndent: false,
                canOutdent: false,
            };
            if (force || !statesEqual(lastShortcutStateRef.current, emptyState)) {
                lastShortcutStateRef.current = emptyState;
                onShortcutStateChange(emptyState);
            }
            return;
        }

        const nextState = {
            canUndo: currentEditor.can().undo(),
            canRedo: currentEditor.can().redo(),
            canIndent: canRunListIndentCommand(currentEditor, 'indent'),
            canOutdent: canRunListIndentCommand(currentEditor, 'outdent'),
        };
        if (!force && statesEqual(lastShortcutStateRef.current, nextState)) return;
        lastShortcutStateRef.current = nextState;
        onShortcutStateChange(nextState);
    }, [canRunListIndentCommand, editable, onShortcutStateChange, shortcutStateEnabled]);

    const scheduleShortcutState = useCallback((currentEditor: Editor | null, force = false) => {
        if (shortcutFrameRef.current != null) return;
        shortcutFrameRef.current = window.requestAnimationFrame(() => {
            shortcutFrameRef.current = null;
            emitShortcutState(currentEditor, force);
        });
    }, [emitShortcutState]);

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
                        parentListIndex: null,
                        itemIndex: null,
                        isTopLevelListItem: false,
                    };
                }
                continue;
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
                    parentListIndex: null,
                    itemIndex: null,
                    isTopLevelListItem: false,
                };
            }

            if ((node.type.name === 'taskItem' || node.type.name === 'listItem') && depth >= 2) {
                const parentList = $pos.node(depth - 1);
                const listParent = depth >= 2 ? $pos.node(depth - 2) : null;
                if (parentList.type.name === 'taskList' || parentList.type.name === 'bulletList' || parentList.type.name === 'orderedList') {
                    const isTopLevelListItem = listParent?.type.name === 'doc';
                    return {
                        pos: $pos.before(depth),
                        nodeType: node.type.name as BlockNodeType,
                        node,
                        depth,
                        topLevelIndex: null,
                        parentListPos: $pos.before(depth - 1),
                        parentListNode: parentList,
                        parentListIndex: isTopLevelListItem ? $pos.index(depth - 2) : null,
                        itemIndex: $pos.index(depth - 1),
                        isTopLevelListItem,
                    };
                }
                continue;
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
                    parentListIndex: null,
                    itemIndex: null,
                    isTopLevelListItem: false,
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

    const cloneDomRect = useCallback((rect: DOMRect | DOMRectReadOnly): DOMRect => {
        return new DOMRect(rect.x, rect.y, rect.width, rect.height);
    }, []);

    const getTextAlignedRect = useCallback((element: HTMLElement): DOMRect => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const paddingTop = Number.parseFloat(style.paddingTop || '0');
        const paddingBottom = Number.parseFloat(style.paddingBottom || '0');
        const lineHeight = Number.parseFloat(style.lineHeight || '');
        const contentHeight = Math.max(0, rect.height - paddingTop - paddingBottom);
        const alignedHeight =
            Number.isFinite(lineHeight) && lineHeight > 0
                ? Math.min(lineHeight, contentHeight || lineHeight)
                : contentHeight || rect.height;

        return new DOMRect(
            rect.x,
            rect.y + paddingTop,
            rect.width,
            alignedHeight,
        );
    }, []);

    const getBlockTargetRect = useCallback((view: Editor['view'], target: ResolvedBlockTarget): DOMRect | null => {
        const nodeDom = view.nodeDOM(target.pos);
        if (!(nodeDom instanceof HTMLElement)) {
            return null;
        }

        if (target.nodeType === 'details') {
            const summary = nodeDom.querySelector(':scope > summary');
            if (summary instanceof HTMLElement) {
                return cloneDomRect(summary.getBoundingClientRect());
            }
        }

        if (target.nodeType === 'taskItem') {
            const taskItem = nodeDom.matches('li[data-type="taskItem"]')
                ? nodeDom
                : nodeDom.closest('li[data-type="taskItem"]');
            if (taskItem instanceof HTMLElement) {
                const row = taskItem.querySelector(':scope > div');
                if (row instanceof HTMLElement) {
                    const textBlock = row.querySelector(':scope > p, :scope > h1, :scope > h2, :scope > h3, :scope > summary');
                    if (textBlock instanceof HTMLElement) {
                        const textRect = getTextAlignedRect(textBlock);
                        return new DOMRect(
                            textRect.left,
                            textRect.top,
                            textRect.width,
                            textRect.height,
                        );
                    }
                    return cloneDomRect(row.getBoundingClientRect());
                }
                return cloneDomRect(taskItem.getBoundingClientRect());
            }
        }

        if (target.nodeType === 'listItem') {
            const listItem = nodeDom.matches('li')
                ? nodeDom
                : nodeDom.closest('li');
            if (listItem instanceof HTMLElement) {
                const textBlock = listItem.querySelector(':scope > p, :scope > h1, :scope > h2, :scope > h3, :scope > summary');
                if (textBlock instanceof HTMLElement) {
                    const textRect = getTextAlignedRect(textBlock);
                    return new DOMRect(
                        textRect.left,
                        textRect.top,
                        textRect.width,
                        textRect.height,
                    );
                }
                return cloneDomRect(listItem.getBoundingClientRect());
            }
        }

        if (
            target.nodeType === 'paragraph' ||
            target.nodeType === 'heading' ||
            target.nodeType === 'details'
        ) {
            return getTextAlignedRect(nodeDom);
        }

        return cloneDomRect(nodeDom.getBoundingClientRect());
    }, [cloneDomRect, getTextAlignedRect]);

    const getBlockTargetAtPos = useCallback((view: Editor['view'], state: EditorState, pos: number): RenderableBlockActionTarget | null => {
        const target = resolveBlockTargetAtPos(state, pos);
        if (!target) return null;

        if (target.nodeType === 'taskItem' && !isTaskItemHandleVisible(state, target.pos)) {
            return null;
        }

        const rect = getBlockTargetRect(view, target);
        return {
            pos,
            blockPos: target.pos,
            nodeType: target.nodeType,
            rect,
        };
    }, [getBlockTargetRect, resolveBlockTargetAtPos]);

    const sameRect = (left: DOMRect | null | undefined, right: DOMRect | null | undefined): boolean => {
        if (!left || !right) return left === right;
        return (
            Math.abs(left.top - right.top) < 0.5 &&
            Math.abs(left.left - right.left) < 0.5 &&
            Math.abs(left.width - right.width) < 0.5 &&
            Math.abs(left.height - right.height) < 0.5
        );
    };

    const sameActiveBlockHandle = (left: ActiveBlockHandle | null, right: ActiveBlockHandle | null): boolean => {
        if (!left || !right) return left === right;
        return (
            left.pos === right.pos &&
            left.blockPos === right.blockPos &&
            left.nodeType === right.nodeType &&
            sameRect(left.rect, right.rect) &&
            sameRect(left.containerRect, right.containerRect)
        );
    };

    const emitChecklistProgress = useCallback((doc: ProseMirrorNode) => {
        if (!onChecklistProgressChange) return;
        const nextProgress: ChecklistProgress = { checked: 0, total: 0 };

        doc.descendants((node) => {
            if (node.type.name === 'taskItem') {
                nextProgress.total += 1;
                if (node.attrs?.checked === true) {
                    nextProgress.checked += 1;
                }
                return true;
            }

            if (node.type.name === 'paragraph') {
                const match = node.textContent.match(/^\s*\[([ xX])\]\s+\S/);
                if (match) {
                    nextProgress.total += 1;
                    if (match[1].toLowerCase() === 'x') {
                        nextProgress.checked += 1;
                    }
                }
            }
            return true;
        });

        const previous = lastChecklistProgressRef.current;
        if (previous?.checked === nextProgress.checked && previous.total === nextProgress.total) return;
        lastChecklistProgressRef.current = nextProgress;
        onChecklistProgressChange(nextProgress);
    }, [onChecklistProgressChange]);

    const resolveRenderableBlockTarget = useCallback((state: EditorState, target: Pick<RenderableBlockActionTarget, 'pos' | 'blockPos' | 'nodeType'> | null): ResolvedBlockTarget | null => {
        if (!target) return null;

        const candidates = Array.from(new Set([
            target.pos,
            Math.max(0, Math.min(target.blockPos + 1, state.doc.content.size)),
            target.blockPos,
        ]));

        for (const candidatePos of candidates) {
            const resolvedTarget = resolveBlockTargetAtPos(state, candidatePos);
            if (resolvedTarget && resolvedTarget.nodeType === target.nodeType) {
                return resolvedTarget;
            }
        }

        for (const candidatePos of candidates) {
            const resolvedTarget = resolveBlockTargetAtPos(state, candidatePos);
            if (resolvedTarget) {
                return resolvedTarget;
            }
        }

        return null;
    }, [resolveBlockTargetAtPos]);

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
            Link.configure({
                autolink: false,
                linkOnPaste: false,
                openOnClick: false,
                HTMLAttributes: {
                    class: 'taesk-card-link',
                },
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
            TaskCompletionVisibility.configure({
                showCompletedLines,
            }),
            CardLinkMeta.configure({
                metaByShortId: cardLinkMetaByShortId,
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

                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' && event.key !== 'ArrowLeft' && event.key !== 'Backspace') return false;
                if (!event.isTrusted || event.isComposing) return false;

                const { state } = view;
                const isMoveShortcut =
                    (event.metaKey || event.ctrlKey) &&
                    !event.altKey &&
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

                if (event.key === 'Backspace') {
                    if (isSelectionInFirstTextLineState(view, state) && state.selection.$from.parentOffset === 0 && onRequestFocusTitle) {
                        const target = resolveBlockTargetAtPos(state, state.selection.from);
                        const isEmptyLeadingParagraph =
                            target?.nodeType === 'paragraph' &&
                            target.topLevelIndex === 0 &&
                            target.parentListNode == null &&
                            state.selection.$from.parent.textContent.length === 0;

                        if (isEmptyLeadingParagraph) {
                            const transaction = buildDeleteBlockTransaction(state, target);
                            applyBlockActionTransactionToView(view, transaction);
                        }

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
            handleClick: (view, pos, event) => {
                const target = event.target instanceof Element ? event.target : null;
                const link = target?.closest('a');
                if (link instanceof HTMLAnchorElement) {
                    const href = link.getAttribute('href') || '';
                    const match = link.href.match(/\/c\/([^/?#]+)(?:[/?#]|$)/);
                    if (
                        match &&
                        (href.startsWith('/c/') ||
                            href.includes('/c/') ||
                            (typeof window !== 'undefined' && link.href.includes(window.location.host + '/c/')))
                    ) {
                        const shortId = match[1];
                        event.preventDefault();
                        event.stopPropagation();
                        onOpenCardLink?.(shortId);
                        return true;
                    }
                }
                return false;
            },
        },
        onTransaction: ({ editor, transaction }) => {
            const hasTaskCompletionMeta = transaction.getMeta(taskCompletionVisibilityPluginKey) != null;
            if (transaction.docChanged) {
                emitDocChange(editor, editor.state.doc);
                emitChecklistProgress(editor.state.doc);
            }
            if (transaction.docChanged || transaction.selectionSet || hasTaskCompletionMeta) {
                scheduleShortcutState(editor);
            }
        },
        onSelectionUpdate: ({ editor }) => {
            scheduleShortcutState(editor);
        },
        autofocus: dataAutofocus ? 'start' : false,
        onCreate: ({ editor }) => {
            lastAppliedDocRef.current = editor.state.doc;
            emitChecklistProgress(editor.state.doc);
            scheduleShortcutState(editor, true);
        },
    });

    const setActiveBlockHandleIfChanged = useCallback((nextHandle: ActiveBlockHandle | null) => {
        if (sameActiveBlockHandle(activeBlockHandleRef.current, nextHandle)) return;
        activeBlockHandleRef.current = nextHandle;
        setActiveBlockHandle(nextHandle);
    }, []);

    const measureActiveBlockAtPos = useCallback((pos: number, reason: ActiveBlockHandle['reason']): ActiveBlockHandle | null => {
        if (!editor) return null;
        const root = rootRef.current;
        if (!root) return null;

        const target = getBlockTargetAtPos(editor.view, editor.state, pos);
        if (!target?.rect) return null;

        return {
            pos: target.pos,
            blockPos: target.blockPos,
            nodeType: target.nodeType,
            rect: cloneDomRect(target.rect),
            containerRect: cloneDomRect(root.getBoundingClientRect()),
            reason,
        };
    }, [cloneDomRect, editor, getBlockTargetAtPos]);

    const scheduleActiveBlockMeasure = useCallback((pos: number, reason: ActiveBlockHandle['reason']) => {
        pendingMeasureRef.current = { pos, reason };
        if (measureFrameRef.current != null) return;

        measureFrameRef.current = window.requestAnimationFrame(() => {
            measureFrameRef.current = null;
            const pending = pendingMeasureRef.current;
            pendingMeasureRef.current = null;
            if (!pending) return;
            setActiveBlockHandleIfChanged(measureActiveBlockAtPos(pending.pos, pending.reason));
        });
    }, [measureActiveBlockAtPos, setActiveBlockHandleIfChanged]);

    const remeasureCurrentBlock = useCallback((reason: ActiveBlockHandle['reason']) => {
        const current = activeBlockHandleRef.current;
        const target = menuTarget ?? current;
        if (!target || !editor) return;
        scheduleActiveBlockMeasure(Math.max(0, Math.min(target.blockPos + 1, editor.state.doc.content.size)), reason);
    }, [editor, menuTarget, scheduleActiveBlockMeasure]);

    const getBlockPosFromPointerTarget = useCallback((target: EventTarget | null): number | null => {
        if (!editor || !(target instanceof Element)) return null;
        const editorDom = editor.view.dom;
        if (!editorDom.contains(target)) return null;

        const blockElement = target.closest(
            'li[data-type="taskItem"], li, div[data-type="details"], summary, p, h1, h2, h3'
        );
        if (!(blockElement instanceof HTMLElement) || !editorDom.contains(blockElement)) return null;

        try {
            const pos = editor.view.posAtDOM(blockElement, 0);
            return Number.isFinite(pos) ? pos : null;
        } catch {
            return null;
        }
    }, [editor]);

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

    const convertListItemToChildCard = useCallback(async (target: ResolvedBlockTarget): Promise<boolean> => {
        if (!editor || !boardId || !cardId) return false;
        if (!target.parentListNode || target.parentListPos == null || target.itemIndex == null) return false;
        if (target.nodeType !== "listItem" && target.nodeType !== "taskItem") return false;
        const parentListNode = target.parentListNode;
        const parentListPos = target.parentListPos;
        const itemIndex = target.itemIndex;

        const firstTextBlock = Array.from({ length: target.node.childCount }, (_, index) => target.node.child(index))
            .find((child) => child.type.name === "paragraph" || child.type.name === "heading");
        const title = (firstTextBlock?.textContent ?? "").trim();
        if (!title) {
            onEditorError?.("空の行は子カード化できません");
            return false;
        }

        const childContentNodes: ProseMirrorNode[] = [];
        target.node.forEach((child) => {
            if (child !== firstTextBlock) {
                childContentNodes.push(child);
            }
        });
        const childContent = childContentNodes.length > 0
            ? {
                type: "doc",
                content: childContentNodes.map((node) => node.toJSON()),
            }
            : buildDefaultBodyContent();

        const buildLinkedParentTransaction = (href: string): Transaction => {
            const linkMark = editor.state.schema.marks.link?.create({
                href,
                class: "taesk-card-link",
            });
            const linkedText = linkMark
                ? editor.state.schema.text(title, [linkMark])
                : editor.state.schema.text(`${title} ↗`);
            const paragraph = editor.state.schema.nodes.paragraph.create(null, linkedText);
            const replacementItem = target.node.type.create(
                target.nodeType === "taskItem" ? { ...(target.node.attrs ?? {}), checked: false } : target.node.attrs,
                Fragment.fromArray([paragraph]),
            );
            const listChildren = getNodeChildren(parentListNode);
            const nextListChildren = [
                ...listChildren.slice(0, itemIndex),
                replacementItem,
                ...listChildren.slice(itemIndex + 1),
            ];
            return editor.state.tr.replaceWith(
                parentListPos,
                parentListPos + parentListNode.nodeSize,
                parentListNode.copy(Fragment.fromArray(nextListChildren)),
            );
        };

        const placeholderTransaction = buildLinkedParentTransaction(CHILD_CARD_LINK_PLACEHOLDER);

        onEditorError?.(null);
        try {
            const response = await fetch(`/api/boards/${boardId}/cards/${cardId}/convert-body-list-item`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    title,
                    child_content: childContent,
                    parent_content: placeholderTransaction.doc.toJSON(),
                }),
            });
            const body = await response.json().catch(() => null) as {
                card?: { short_id?: string | null };
                error?: { message?: string };
            } | null;
            if (!response.ok) {
                throw new Error(body?.error?.message || "子カード化に失敗しました");
            }

            const childHref = body?.card?.short_id ? `/c/${body.card.short_id}` : CHILD_CARD_LINK_PLACEHOLDER;
            const transaction = buildLinkedParentTransaction(childHref);
            applyBlockActionTransaction(editor, transaction);
            return true;
        } catch (error) {
            onEditorError?.(error instanceof Error ? error.message : "子カード化に失敗しました");
            return false;
        }
    }, [applyBlockActionTransaction, boardId, cardId, editor, onEditorError]);

    const suppressBlockUi = !editable || isImageUploadInFlight || !editor;

    useEffect(() => {
        scheduleShortcutState(editor, true);
    }, [editor, scheduleShortcutState, shortcutStateEnabled]);

    useEffect(() => {
        return () => {
            if (shortcutFrameRef.current != null) {
                window.cancelAnimationFrame(shortcutFrameRef.current);
            }
            if (measureFrameRef.current != null) {
                window.cancelAnimationFrame(measureFrameRef.current);
            }
        };
    }, []);

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

    const insertLeadingParagraphAndFocus = useCallback((): boolean => {
        if (!editor || !editor.isEditable) return false;

        const paragraph = editor.schema.nodes.paragraph?.create();
        if (!paragraph) return false;

        const { state, dispatch } = editor.view;
        const tr = state.tr.insert(0, paragraph);
        tr.setSelection(Selection.atStart(tr.doc));
        tr.scrollIntoView();

        dispatch(tr);
        emitForcedDocChange(editor, tr.doc);
        editor.view.focus();
        return true;
    }, [editor, emitForcedDocChange]);

    const clearExpandedHiddenRuns = useCallback(() => {
        if (!editor) return;
        editor.view.dispatch(clearExpandedHiddenRunsMeta(editor.state.tr));
        remeasureCurrentBlock('visibility');
    }, [editor, remeasureCurrentBlock]);

    useEffect(() => {
        if (!onRegisterBodyBridge) return;
        if (!editor) {
            onRegisterBodyBridge(null);
            return;
        }

        onRegisterBodyBridge({
            focusBody: (offset?: number | null) => focusBody(offset),
            insertLeadingParagraphAndFocus,
            clearExpandedHiddenRuns,
        });

        return () => {
            onRegisterBodyBridge(null);
        };
    }, [clearExpandedHiddenRuns, editor, focusBody, insertLeadingParagraphAndFocus, onRegisterBodyBridge]);

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
            emitChecklistProgress(nextDoc);
        };

        void hydrateContent();

        return () => {
            cancelled = true;
        };
    }, [initialContent, editor, boardId, cardId, emitChecklistProgress, onEditorError]);

    useEffect(() => {
        if (suppressBlockUi) {
            closeBlockMenu();
            setActiveBlockHandleIfChanged(null);
        }
    }, [closeBlockMenu, setActiveBlockHandleIfChanged, suppressBlockUi]);

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
            remeasureCurrentBlock('scroll');
        };

        window.addEventListener('resize', handleLayoutChange);
        scrollParent?.addEventListener('scroll', handleLayoutChange, { passive: true });

        return () => {
            window.removeEventListener('resize', handleLayoutChange);
            scrollParent?.removeEventListener('scroll', handleLayoutChange);
        };
    }, [editor, findScrollableAncestor, remeasureCurrentBlock]);

    // Update editable state
    useEffect(() => {
        if (editor && editor.isEditable !== editable) {
            editor.setEditable(editable);
        }
    }, [editor, editable]);

    useEffect(() => {
        if (!editor) return;
        const pluginState = getTaskCompletionState(editor.state);
        if (pluginState?.showCompletedLines === showCompletedLines) return;
        editor.view.dispatch(setTaskCompletionVisibilityMeta(editor.state.tr, showCompletedLines));
        remeasureCurrentBlock('visibility');
    }, [editor, remeasureCurrentBlock, showCompletedLines]);

    useEffect(() => {
        if (!editor) return;
        editor.view.dispatch(setCardLinkMeta(editor.state.tr, cardLinkMetaByShortId));
    }, [cardLinkMetaByShortId, editor]);

    useEffect(() => {
        if (!editor) return;

        const root = rootRef.current;
        const editorDom = editor.view.dom;
        if (!root) return;

        const observer = typeof ResizeObserver !== 'undefined'
            ? new ResizeObserver(() => {
                remeasureCurrentBlock('resize');
            })
            : null;

        observer?.observe(root);
        if (editorDom instanceof HTMLElement) {
            observer?.observe(editorDom);
        }

        return () => {
            observer?.disconnect();
        };
    }, [editor, remeasureCurrentBlock]);

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
        if (editor) {
            scheduleActiveBlockMeasure(editor.state.selection.from, 'keyboard');
        }
    }, [containerRef, editor, scheduleActiveBlockMeasure]);

    if (!editor) {
        return null;
    }

    const resolvedMenuTarget = menuTarget
        ? resolveRenderableBlockTarget(editor.state, activeBlockHandle ?? {
            pos: Math.max(0, Math.min(menuTarget.blockPos + 1, editor.state.doc.content.size)),
            blockPos: menuTarget.blockPos,
            nodeType: menuTarget.nodeType,
        })
        : null;
    const menuAnchorRect = activeBlockHandle?.rect ?? menuTarget?.fallbackAnchorRect ?? null;
    const menuContainerRect = activeBlockHandle?.containerRect ?? null;
    const menuItems = menuTarget
        ? getBlockActionItems(menuTarget.nodeType, {
            canMoveUp: resolvedMenuTarget ? canMoveBlock(editor.state, resolvedMenuTarget, 'up') : false,
            canMoveDown: resolvedMenuTarget ? canMoveBlock(editor.state, resolvedMenuTarget, 'down') : false,
        })
        : [];

    const handleBlockAction = (action: BlockActionType) => {
        if (!menuTarget || !resolvedMenuTarget) return;
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
                menuTargetPos: resolvedMenuTarget.pos,
                menuTargetNodeType: menuTarget.nodeType,
                resolvedTargetPos: resolvedMenuTarget?.pos ?? null,
                resolvedNodeType: resolvedMenuTarget?.nodeType ?? null,
            };
        }
        switch (action) {
            case 'move-up': {
                const transaction = buildMoveBlockTransaction(editor.state, resolvedMenuTarget, 'up');
                applyBlockActionTransaction(editor, transaction);
                break;
            }
            case 'move-down': {
                const transaction = buildMoveBlockTransaction(editor.state, resolvedMenuTarget, 'down');
                applyBlockActionTransaction(editor, transaction);
                break;
            }
            case 'insert-above': {
                const transaction = buildInsertParagraphBeforeBlockTransaction(editor.state, resolvedMenuTarget);
                applyBlockActionTransaction(editor, transaction);
                break;
            }
            case 'insert-below': {
                const transaction = buildInsertParagraphAfterBlockTransaction(editor.state, resolvedMenuTarget);
                applyBlockActionTransaction(editor, transaction);
                break;
            }
            case 'duplicate': {
                const transaction = buildDuplicateBlockTransaction(editor.state, resolvedMenuTarget);
                applyBlockActionTransaction(editor, transaction);
                break;
            }
            case 'delete': {
                const transaction = buildDeleteBlockTransaction(editor.state, resolvedMenuTarget);
                applyBlockActionTransaction(editor, transaction);
                break;
            }
            case 'convert-child-card': {
                void convertListItemToChildCard(resolvedMenuTarget);
                break;
            }
            case 'toggle-details': {
                const selection = createToggleDetailsSelection(editor.state, resolvedMenuTarget);
                if (!selection) break;
                editor.view.dispatch(editor.state.tr.setSelection(selection));
                insertDetailsAtSelection(editor);
                editor.view.focus();
                closeBlockMenu();
                break;
            }
            case 'unset-details': {
                const selection = createUnsetDetailsSelection(editor.state, resolvedMenuTarget);
                if (!selection) break;
                editor.view.dispatch(editor.state.tr.setSelection(selection));
                unsetActiveDetails(editor);
                editor.view.focus();
                closeBlockMenu();
                break;
            }
        }
        remeasureCurrentBlock('block-action');
        closeBlockMenu();
    };

    const handlePointerMove = (event: ReactMouseEvent<HTMLDivElement>) => {
        if (suppressBlockUi || isMenuOpenRef.current) return;
        const eventTarget = event.target instanceof Element ? event.target : null;
        if (eventTarget?.closest('[data-testid="tiptap-block-handle"], [data-testid="tiptap-block-menu"]')) {
            return;
        }
        const blockPos = getBlockPosFromPointerTarget(event.target);
        if (blockPos != null) {
            scheduleActiveBlockMeasure(blockPos, 'hover');
            return;
        }
        const coords = { left: event.clientX, top: event.clientY };
        const result = editor.view.posAtCoords(coords);
        if (!result) return;
        scheduleActiveBlockMeasure(result.pos, 'hover');
    };

    const handlePointerLeave = () => {
        if (isMenuOpenRef.current) return;
        setActiveBlockHandleIfChanged(null);
    };

    const handleEditorClick = (event: ReactMouseEvent<HTMLDivElement>) => {
        const target = event.target instanceof Element ? event.target : null;
        const link = target?.closest('a');
        if (link instanceof HTMLAnchorElement) {
            const href = link.getAttribute('href') || '';
            const match = link.href.match(/\/c\/([^/?#]+)(?:[/?#]|$)/);
            if (match && (href.startsWith('/c/') || href.includes('/c/') || (typeof window !== 'undefined' && link.href.includes(window.location.host + '/c/')))) {
                const shortId = match[1];
                event.preventDefault();
                event.stopPropagation();
                onOpenCardLink?.(shortId);
                return;
            }
        }

        if (event.target === event.currentTarget) {
            editor.chain().focus().run();
        }
    };

    return (
        <div
            ref={assignRootRef}
            className={`w-full bg-white dark:bg-gray-800 rounded-lg cursor-text ${styles.editor}`}
            data-show-completed-lines={showCompletedLines ? 'true' : 'false'}
            onClick={handleEditorClick}
            onCopyCapture={handleCopyCapture}
            onPasteCapture={handlePasteCapture}
            onMouseMove={handlePointerMove}
            onMouseLeave={handlePointerLeave}
        >
            {activeBlockHandle ? (
                <button
                    key={`${activeBlockHandle.blockPos}-${activeBlockHandle.nodeType}`}
                    type="button"
                    tabIndex={-1}
                    aria-label="ブロックメニューを開く"
                    data-testid="tiptap-block-handle"
                    data-block-index={0}
                    data-block-node-type={activeBlockHandle.nodeType}
                    data-block-pos={activeBlockHandle.pos}
                    data-block-start-pos={activeBlockHandle.blockPos}
                    className={styles.blockActionHandle}
                    style={{
                        top: Math.max(
                            activeBlockHandle.rect.top -
                                activeBlockHandle.containerRect.top +
                                (activeBlockHandle.nodeType === 'heading'
                                    ? Math.max((activeBlockHandle.rect.height - BLOCK_ACTION_HANDLE_HEIGHT) / 2, 0)
                                    : 0),
                            4,
                        ),
                        left: Math.max(activeBlockHandle.rect.left - activeBlockHandle.containerRect.left - BLOCK_ACTION_HANDLE_HEIGHT, 4),
                    }}
                    onMouseDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                    }}
                    onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setMenuTarget({
                            blockPos: activeBlockHandle.blockPos,
                            nodeType: activeBlockHandle.nodeType,
                            fallbackAnchorRect: cloneDomRect(activeBlockHandle.rect),
                        });
                        isMenuOpenRef.current = true;
                        setIsMenuOpen(true);
                    }}
                    onMouseMove={(event) => {
                        event.stopPropagation();
                    }}
                    onMouseEnter={() => {
                        setActiveBlockHandleIfChanged(activeBlockHandle);
                    }}
                >
                    <span className={styles.blockActionHandleDots}>⋮⋮</span>
                </button>
            ) : null}
            <EditorContent editor={editor} />
            {isMenuOpen && menuAnchorRect && menuContainerRect ? (
                <BlockActionMenu
                    anchorRect={menuAnchorRect}
                    containerRect={menuContainerRect}
                    items={menuItems}
                    onClose={closeBlockMenu}
                    onSelect={handleBlockAction}
                />
            ) : null}
        </div>
    );
}

export default memo(TiptapEditor);
