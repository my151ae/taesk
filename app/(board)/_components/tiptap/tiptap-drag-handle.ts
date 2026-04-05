import type { VirtualElement } from '@floating-ui/dom';
import type { EditorView } from '@tiptap/pm/view';
import type { EditorState } from '@tiptap/pm/state';
import type { BlockNodeType } from '@/app/(board)/_components/tiptap/tiptap-block-menu';
import type { ResolvedBlockTarget } from '@/app/(board)/_components/tiptap/tiptap-block-actions';
import { isTopLevelTaskItemHandleVisible } from '@/app/(board)/_components/tiptap/TaskCompletionVisibility';

export type DragHandleRenderTarget = {
  pos: number;
  blockPos: number;
  nodeType: BlockNodeType;
  rect: DOMRect;
};

export type DragHandleMenuTarget = {
  renderTarget: DragHandleRenderTarget;
  resolvedTarget: ResolvedBlockTarget;
};

export function cloneDomRect(rect: DOMRect | DOMRectReadOnly): DOMRect {
  return new DOMRect(rect.x, rect.y, rect.width, rect.height);
}

export function createVirtualElementFromRectRef(rectRef: { current: DOMRect | null }): VirtualElement {
  return {
    getBoundingClientRect: () => rectRef.current ?? new DOMRect(0, 0, 0, 0),
  };
}

export function shouldShowDragHandleForTarget(state: EditorState, target: ResolvedBlockTarget): boolean {
  if (target.nodeType === 'taskItem') {
    return isTopLevelTaskItemHandleVisible(state, target.pos);
  }

  return true;
}

export function getDragHandleAnchorRect(view: EditorView, target: ResolvedBlockTarget): DOMRect | null {
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
        return cloneDomRect(row.getBoundingClientRect());
      }
      return cloneDomRect(taskItem.getBoundingClientRect());
    }
  }

  return cloneDomRect(nodeDom.getBoundingClientRect());
}

export function applyDragHandleMetadata(element: HTMLElement, target: DragHandleMenuTarget | null): void {
  if (!target) {
    element.setAttribute('aria-hidden', 'true');
    element.style.pointerEvents = 'none';
    element.removeAttribute('data-block-node-type');
    element.removeAttribute('data-block-pos');
    element.removeAttribute('data-block-start-pos');
    return;
  }

  element.removeAttribute('aria-hidden');
  element.style.pointerEvents = 'auto';
  element.dataset.blockNodeType = target.renderTarget.nodeType;
  element.dataset.blockPos = String(target.renderTarget.pos);
  element.dataset.blockStartPos = String(target.renderTarget.blockPos);
}
