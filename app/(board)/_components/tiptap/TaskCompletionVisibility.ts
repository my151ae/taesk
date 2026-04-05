import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export type TaskItemVisibility = 'visible' | 'hidden';

export type TaskItemCompletionMeta = {
  pos: number;
  nodeSize: number;
  selfChecked: boolean;
  allNestedTaskItemsChecked: boolean;
  subtreeComplete: boolean;
  visibility: TaskItemVisibility;
  hiddenRunStart: boolean;
  hiddenRunLength: number;
  isTopLevel: boolean;
};

export type TaskListCompletionMeta = {
  pos: number;
  nodeSize: number;
  trailingHiddenRunLength: number;
};

export type TaskCompletionPluginState = {
  showCompletedLines: boolean;
  itemMetaByPos: Map<number, TaskItemCompletionMeta>;
  listMetaByPos: Map<number, TaskListCompletionMeta>;
  decorations: DecorationSet;
};

type TaskCompletionMetaUpdate = {
  showCompletedLines?: boolean;
};

export const taskCompletionVisibilityPluginKey = new PluginKey<TaskCompletionPluginState>('taskCompletionVisibility');

const buildTaskCompletionPluginState = (
  doc: ProseMirrorNode,
  showCompletedLines: boolean,
): TaskCompletionPluginState => {
  const itemMetaByPos = new Map<number, TaskItemCompletionMeta>();
  const listMetaByPos = new Map<number, TaskListCompletionMeta>();

  const visitTaskItem = (node: ProseMirrorNode, pos: number, isTopLevel: boolean): TaskItemCompletionMeta => {
    let allNestedTaskItemsChecked = true;

    node.forEach((child, offset) => {
      if (child.type.name !== 'taskList') return;
      const childPos = pos + offset + 1;
      const childListMeta = visitTaskList(child, childPos, false);
      allNestedTaskItemsChecked = allNestedTaskItemsChecked && childListMeta.allTaskItemsChecked;
    });

    const selfChecked = Boolean(node.attrs?.checked);
    const subtreeComplete = selfChecked && allNestedTaskItemsChecked;
    const visibility: TaskItemVisibility = !showCompletedLines && subtreeComplete ? 'hidden' : 'visible';
    const meta: TaskItemCompletionMeta = {
      pos,
      nodeSize: node.nodeSize,
      selfChecked,
      allNestedTaskItemsChecked,
      subtreeComplete,
      visibility,
      hiddenRunStart: false,
      hiddenRunLength: 0,
      isTopLevel,
    };
    itemMetaByPos.set(pos, meta);
    return meta;
  };

  const visitTaskList = (node: ProseMirrorNode, pos: number, directChildrenAreTopLevel: boolean): { allTaskItemsChecked: boolean } => {
    const directChildItems: TaskItemCompletionMeta[] = [];
    let allTaskItemsChecked = true;

    node.forEach((child, offset) => {
      if (child.type.name !== 'taskItem') return;
      const childPos = pos + offset + 1;
      const meta = visitTaskItem(child, childPos, directChildrenAreTopLevel);
      directChildItems.push(meta);
      allTaskItemsChecked = allTaskItemsChecked && meta.subtreeComplete;
    });

    let trailingHiddenRunLength = 0;
    for (const meta of directChildItems) {
      if (meta.visibility === 'hidden') {
        trailingHiddenRunLength += 1;
        continue;
      }

      if (trailingHiddenRunLength > 0) {
        meta.hiddenRunStart = true;
        meta.hiddenRunLength = trailingHiddenRunLength;
        trailingHiddenRunLength = 0;
      }
    }

    listMetaByPos.set(pos, {
      pos,
      nodeSize: node.nodeSize,
      trailingHiddenRunLength,
    });

    return { allTaskItemsChecked };
  };

  doc.forEach((child, offset) => {
    if (child.type.name !== 'taskList') return;
    const childPos = offset;
    visitTaskList(child, childPos, true);
  });

  const decorations = DecorationSet.create(
    doc,
    [
      ...Array.from(itemMetaByPos.values()).map((meta) => {
        const attributes: Record<string, string> = {
          'data-completion-visibility': meta.visibility,
          'data-subtree-complete': meta.subtreeComplete ? 'true' : 'false',
        };

        if (meta.hiddenRunStart && meta.hiddenRunLength > 0) {
          attributes['data-hidden-run-start'] = 'true';
          attributes['data-hidden-run-length'] = String(meta.hiddenRunLength);
        }

        return Decoration.node(meta.pos, meta.pos + meta.nodeSize, attributes);
      }),
      ...Array.from(listMetaByPos.values())
        .filter((meta) => meta.trailingHiddenRunLength > 0)
        .map((meta) =>
          Decoration.node(meta.pos, meta.pos + meta.nodeSize, {
            'data-hidden-run-start': 'true',
            'data-hidden-run-length': String(meta.trailingHiddenRunLength),
          }),
        ),
    ],
  );

  return {
    showCompletedLines,
    itemMetaByPos,
    listMetaByPos,
    decorations,
  };
};

export const getTaskCompletionState = (state: EditorState): TaskCompletionPluginState | null =>
  taskCompletionVisibilityPluginKey.getState(state) ?? null;

export const getTaskItemMetaAtPos = (state: EditorState, pos: number): TaskItemCompletionMeta | null =>
  getTaskCompletionState(state)?.itemMetaByPos.get(pos) ?? null;

export const isTaskItemHiddenAtPos = (state: EditorState, pos: number): boolean =>
  getTaskItemMetaAtPos(state, pos)?.visibility === 'hidden';

export const isTopLevelTaskItemHandleVisible = (state: EditorState, pos: number): boolean => {
  const meta = getTaskItemMetaAtPos(state, pos);
  return Boolean(meta?.isTopLevel && meta.visibility === 'visible');
};

export const setTaskCompletionVisibilityMeta = (transaction: Transaction, showCompletedLines: boolean): Transaction =>
  transaction.setMeta(taskCompletionVisibilityPluginKey, { showCompletedLines } satisfies TaskCompletionMetaUpdate);

export const TaskCompletionVisibility = Extension.create<{ showCompletedLines: boolean }>({
  name: 'taskCompletionVisibility',

  addOptions() {
    return {
      showCompletedLines: false,
    };
  },

  addProseMirrorPlugins() {
    const initialShowCompletedLines = this.options.showCompletedLines;

    return [
      new Plugin<TaskCompletionPluginState>({
        key: taskCompletionVisibilityPluginKey,
        state: {
          init: (_, state) => buildTaskCompletionPluginState(state.doc, initialShowCompletedLines),
          apply: (transaction, pluginState, _oldState, newState) => {
            const meta = transaction.getMeta(taskCompletionVisibilityPluginKey) as TaskCompletionMetaUpdate | undefined;
            const nextShowCompletedLines = typeof meta?.showCompletedLines === 'boolean'
              ? meta.showCompletedLines
              : pluginState.showCompletedLines;

            if (!transaction.docChanged && nextShowCompletedLines === pluginState.showCompletedLines) {
              return pluginState;
            }

            return buildTaskCompletionPluginState(newState.doc, nextShowCompletedLines);
          },
        },
        props: {
          decorations: (state) => taskCompletionVisibilityPluginKey.getState(state)?.decorations ?? null,
        },
      }),
    ];
  },
});
