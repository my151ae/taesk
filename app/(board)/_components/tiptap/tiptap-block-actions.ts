"use client";

import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  EditorState,
  NodeSelection,
  Selection,
  TextSelection,
  Transaction,
} from "@tiptap/pm/state";
import { buildDefaultBodyContent } from "@/lib/tiptap";
import type { BlockNodeType } from "@/app/(board)/_components/tiptap/tiptap-block-menu";

export type MoveBlockDirection = "up" | "down";

export type ResolvedBlockTarget = {
  pos: number;
  nodeType: BlockNodeType;
  node: ProseMirrorNode;
  depth: number;
  topLevelIndex: number | null;
  parentListPos: number | null;
  parentListNode: ProseMirrorNode | null;
  itemIndex: number | null;
};

export function getNodeChildren(node: ProseMirrorNode): ProseMirrorNode[] {
  const children: ProseMirrorNode[] = [];
  node.forEach((child) => {
    children.push(child);
  });
  return children;
}

export function getTopLevelOffset(children: ProseMirrorNode[], endIndex: number): number {
  return children.slice(0, endIndex).reduce((total, child) => total + child.nodeSize, 0);
}

export function splitListAroundItem(
  listNode: ProseMirrorNode,
  itemIndex: number,
  insertedParagraph: ProseMirrorNode,
  mode: "before" | "after",
): ProseMirrorNode[] {
  const children = getNodeChildren(listNode);
  const beforeEnd = mode === "before" ? itemIndex : itemIndex + 1;
  const afterStart = mode === "before" ? itemIndex : itemIndex + 1;
  const beforeItems = children.slice(0, beforeEnd);
  const afterItems = children.slice(afterStart);
  const nextNodes: ProseMirrorNode[] = [];

  if (beforeItems.length > 0) {
    nextNodes.push(listNode.copy(Fragment.fromArray(beforeItems)));
  }
  nextNodes.push(insertedParagraph);
  if (afterItems.length > 0) {
    nextNodes.push(listNode.copy(Fragment.fromArray(afterItems)));
  }

  return nextNodes;
}

function clampSelectionPos(doc: ProseMirrorNode, pos: number): number {
  return Math.max(0, Math.min(pos, doc.content.size));
}

function findSelectionNear(
  doc: ProseMirrorNode,
  searchPos: number,
  direction: 1 | -1,
): Selection {
  const resolved = doc.resolve(clampSelectionPos(doc, searchPos));
  return Selection.findFrom(resolved, direction, true) ?? Selection.atStart(doc);
}

function setSelectionForAction(
  tr: Transaction,
  searchPos: number,
  direction: 1 | -1 = 1,
): Transaction {
  const selection = findSelectionNear(tr.doc, searchPos, direction);
  return tr.setSelection(selection).scrollIntoView();
}

function createDefaultDoc(state: EditorState): ProseMirrorNode {
  return state.schema.nodeFromJSON(buildDefaultBodyContent());
}

export function canMoveBlock(
  state: EditorState,
  target: ResolvedBlockTarget,
  direction: MoveBlockDirection,
): boolean {
  const delta = direction === "up" ? -1 : 1;

  if (target.parentListNode && target.itemIndex != null) {
    const nextIndex = target.itemIndex + delta;
    return nextIndex >= 0 && nextIndex < target.parentListNode.childCount;
  }

  if (target.topLevelIndex != null) {
    const nextIndex = target.topLevelIndex + delta;
    return nextIndex >= 0 && nextIndex < state.doc.childCount;
  }

  return false;
}

export function buildInsertParagraphBeforeBlockTransaction(
  state: EditorState,
  target: ResolvedBlockTarget,
): Transaction {
  const paragraph = state.schema.nodes.paragraph.create();
  let tr = state.tr;
  let selectionPos = target.pos + 1;

  if (target.parentListNode && target.parentListPos != null && target.itemIndex != null) {
    const replacement = splitListAroundItem(target.parentListNode, target.itemIndex, paragraph, "before");
    tr = tr.replaceWith(
      target.parentListPos,
      target.parentListPos + target.parentListNode.nodeSize,
      Fragment.fromArray(replacement),
    );
    const beforeItemsCount = target.itemIndex;
    const beforeListSize =
      beforeItemsCount > 0
        ? target.parentListNode.copy(
            Fragment.fromArray(getNodeChildren(target.parentListNode).slice(0, beforeItemsCount)),
          ).nodeSize
        : 0;
    selectionPos = target.parentListPos + beforeListSize + 1;
  } else if (target.topLevelIndex != null) {
    const children = getNodeChildren(state.doc);
    const nextChildren = [
      ...children.slice(0, target.topLevelIndex),
      paragraph,
      ...children.slice(target.topLevelIndex),
    ];
    tr = state.tr.replaceWith(0, state.doc.content.size, Fragment.fromArray(nextChildren));
    selectionPos = getTopLevelOffset(nextChildren, target.topLevelIndex) + 1;
  } else {
    tr = tr.insert(target.pos, paragraph);
  }

  return setSelectionForAction(tr, selectionPos, 1);
}

export function buildInsertParagraphAfterBlockTransaction(
  state: EditorState,
  target: ResolvedBlockTarget,
): Transaction {
  const paragraph = state.schema.nodes.paragraph.create();
  let tr = state.tr;
  let selectionPos = target.pos + target.node.nodeSize + 1;

  if (target.parentListNode && target.parentListPos != null && target.itemIndex != null) {
    const replacement = splitListAroundItem(target.parentListNode, target.itemIndex, paragraph, "after");
    tr = tr.replaceWith(
      target.parentListPos,
      target.parentListPos + target.parentListNode.nodeSize,
      Fragment.fromArray(replacement),
    );
    const beforeItemsCount = target.itemIndex + 1;
    const beforeListSize =
      beforeItemsCount > 0
        ? target.parentListNode.copy(
            Fragment.fromArray(getNodeChildren(target.parentListNode).slice(0, beforeItemsCount)),
          ).nodeSize
        : 0;
    selectionPos = target.parentListPos + beforeListSize + 1;
  } else if (target.topLevelIndex != null) {
    const children = getNodeChildren(state.doc);
    const nextChildren = [
      ...children.slice(0, target.topLevelIndex + 1),
      paragraph,
      ...children.slice(target.topLevelIndex + 1),
    ];
    tr = state.tr.replaceWith(0, state.doc.content.size, Fragment.fromArray(nextChildren));
    selectionPos = getTopLevelOffset(nextChildren, target.topLevelIndex + 1) + 1;
  } else {
    tr = tr.insert(target.pos + target.node.nodeSize, paragraph);
  }

  return setSelectionForAction(tr, selectionPos, 1);
}

export function buildDuplicateBlockTransaction(
  state: EditorState,
  target: ResolvedBlockTarget,
): Transaction {
  const clonedNode = target.node.type.create(target.node.attrs, target.node.content, target.node.marks);
  let tr = state.tr;
  let selectionPos = target.pos + target.node.nodeSize + 1;

  if (target.parentListNode && target.parentListPos != null && target.itemIndex != null) {
    const children = getNodeChildren(target.parentListNode);
    const nextChildren = [
      ...children.slice(0, target.itemIndex + 1),
      clonedNode,
      ...children.slice(target.itemIndex + 1),
    ];
    tr = tr.replaceWith(
      target.parentListPos,
      target.parentListPos + target.parentListNode.nodeSize,
      target.parentListNode.copy(Fragment.fromArray(nextChildren)),
    );
  } else if (target.topLevelIndex != null) {
    const children = getNodeChildren(state.doc);
    const nextChildren = [
      ...children.slice(0, target.topLevelIndex + 1),
      clonedNode,
      ...children.slice(target.topLevelIndex + 1),
    ];
    tr = state.tr.replaceWith(0, state.doc.content.size, Fragment.fromArray(nextChildren));
    selectionPos = getTopLevelOffset(nextChildren, target.topLevelIndex + 1) + 1;
  } else {
    tr = tr.insert(target.pos + target.node.nodeSize, clonedNode);
  }

  return setSelectionForAction(tr, selectionPos, 1);
}

export function buildMoveBlockTransaction(
  state: EditorState,
  target: ResolvedBlockTarget,
  direction: MoveBlockDirection,
): Transaction | null {
  if (!canMoveBlock(state, target, direction)) {
    return null;
  }

  const delta = direction === "up" ? -1 : 1;

  if (target.parentListNode && target.parentListPos != null && target.itemIndex != null) {
    const children = getNodeChildren(target.parentListNode);
    const nextIndex = target.itemIndex + delta;
    const nextChildren = [...children];
    const [movedChild] = nextChildren.splice(target.itemIndex, 1);
    nextChildren.splice(nextIndex, 0, movedChild);

    const tr = state.tr.replaceWith(
      target.parentListPos,
      target.parentListPos + target.parentListNode.nodeSize,
      target.parentListNode.copy(Fragment.fromArray(nextChildren)),
    );
    const selectionPos = target.parentListPos + getTopLevelOffset(nextChildren, nextIndex) + 2;
    return setSelectionForAction(tr, selectionPos, 1);
  }

  if (target.topLevelIndex != null) {
    const children = getNodeChildren(state.doc);
    const nextIndex = target.topLevelIndex + delta;
    const nextChildren = [...children];
    const [movedChild] = nextChildren.splice(target.topLevelIndex, 1);
    nextChildren.splice(nextIndex, 0, movedChild);

    const tr = state.tr.replaceWith(0, state.doc.content.size, Fragment.fromArray(nextChildren));
    const selectionPos = getTopLevelOffset(nextChildren, nextIndex) + 1;
    return setSelectionForAction(tr, selectionPos, 1);
  }

  return null;
}

export function buildDeleteBlockTransaction(
  state: EditorState,
  target: ResolvedBlockTarget,
): Transaction {
  let tr = state.tr;

  if (target.parentListNode && target.parentListPos != null && target.itemIndex != null) {
    const children = getNodeChildren(target.parentListNode);
    const nextChildren = [...children.slice(0, target.itemIndex), ...children.slice(target.itemIndex + 1)];
    if (nextChildren.length === 0) {
      tr = tr.delete(target.parentListPos, target.parentListPos + target.parentListNode.nodeSize);
    } else {
      tr = tr.replaceWith(
        target.parentListPos,
        target.parentListPos + target.parentListNode.nodeSize,
        target.parentListNode.copy(Fragment.fromArray(nextChildren)),
      );
    }
  } else if (target.topLevelIndex != null) {
    const children = getNodeChildren(state.doc);
    const nextChildren = [...children.slice(0, target.topLevelIndex), ...children.slice(target.topLevelIndex + 1)];
    tr = state.tr.replaceWith(0, state.doc.content.size, Fragment.fromArray(nextChildren));
  } else {
    tr = tr.delete(target.pos, target.pos + target.node.nodeSize);
  }

  if (tr.doc.childCount === 0) {
    const defaultDoc = createDefaultDoc(state);
    const resetTr = state.tr.replaceWith(0, state.doc.content.size, defaultDoc.content);
    return setSelectionForAction(resetTr, 1, 1);
  }

  return setSelectionForAction(tr, target.pos, 1);
}

export function createToggleDetailsSelection(
  state: EditorState,
  target: ResolvedBlockTarget,
): NodeSelection | null {
  if (target.nodeType === "details") return null;
  return NodeSelection.create(state.doc, target.pos);
}

export function createUnsetDetailsSelection(
  state: EditorState,
  target: ResolvedBlockTarget,
): TextSelection | null {
  if (target.nodeType !== "details") return null;
  return TextSelection.create(state.doc, Math.min(target.pos + 2, state.doc.content.size));
}
