import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export type TaskItemVisibility = 'visible' | 'hidden';

export type HiddenRunAnchor = {
  taskListPos: number;
  runStartPos: number;
  runEndPos: number;
  hiddenRunLength: number;
};

export type HiddenRunAnchorKind = 'taskItem' | 'taskList';

export type ToggleableHiddenRunMeta = HiddenRunAnchor & {
  runKey: string;
  anchorPos: number;
  anchorNodePos: number;
  anchorKind: HiddenRunAnchorKind;
  isExpanded: boolean;
};

type CompletedRunMeta = HiddenRunAnchor;

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
  expandedRunAnchors: HiddenRunAnchor[];
  itemMetaByPos: Map<number, TaskItemCompletionMeta>;
  listMetaByPos: Map<number, TaskListCompletionMeta>;
  toggleableRuns: ToggleableHiddenRunMeta[];
  currentlyHiddenRuns: ToggleableHiddenRunMeta[];
  decorations: DecorationSet;
};

export type ToggleExpandedHiddenRunInput = HiddenRunAnchor;

type TaskCompletionMetaUpdate = {
  showCompletedLines?: boolean;
  toggleExpandedHiddenRun?: ToggleExpandedHiddenRunInput;
  clearExpandedHiddenRuns?: boolean;
};

type TaskItemVisitResult = TaskItemCompletionMeta & {
  childTaskListsChecked: boolean;
};

type TaskListVisitResult = {
  allTaskItemsChecked: boolean;
};

export const taskCompletionVisibilityPluginKey = new PluginKey<TaskCompletionPluginState>('taskCompletionVisibility');

function createHiddenRunKey(anchor: HiddenRunAnchor): string {
  return [
    anchor.taskListPos,
    anchor.runStartPos,
    anchor.runEndPos,
    anchor.hiddenRunLength,
  ].join(':');
}

function sameHiddenRunAnchor(left: HiddenRunAnchor, right: HiddenRunAnchor): boolean {
  return left.taskListPos === right.taskListPos &&
    left.runStartPos === right.runStartPos &&
    left.runEndPos === right.runEndPos &&
    left.hiddenRunLength === right.hiddenRunLength;
}

function mapHiddenRunAnchor(anchor: HiddenRunAnchor, transaction: Transaction): HiddenRunAnchor {
  return {
    taskListPos: transaction.mapping.map(anchor.taskListPos, 1),
    runStartPos: transaction.mapping.map(anchor.runStartPos, 1),
    runEndPos: transaction.mapping.map(anchor.runEndPos, 1),
    hiddenRunLength: anchor.hiddenRunLength,
  };
}

function extractCompletedRuns(directItems: TaskItemCompletionMeta[], taskListPos: number): CompletedRunMeta[] {
  const completedRuns: CompletedRunMeta[] = [];
  let runStart: number | null = null;
  let runEnd: number | null = null;
  let runLength = 0;

  for (const meta of directItems) {
    if (meta.subtreeComplete) {
      if (runStart == null) {
        runStart = meta.pos;
        runLength = 0;
      }
      runEnd = meta.pos;
      runLength += 1;
      continue;
    }

    if (runStart != null && runEnd != null && runLength > 0) {
      completedRuns.push({
        taskListPos,
        runStartPos: runStart,
        runEndPos: runEnd,
        hiddenRunLength: runLength,
      });
    }
    runStart = null;
    runEnd = null;
    runLength = 0;
  }

  if (runStart != null && runEnd != null && runLength > 0) {
    completedRuns.push({
      taskListPos,
      runStartPos: runStart,
      runEndPos: runEnd,
      hiddenRunLength: runLength,
    });
  }

  return completedRuns;
}

function resolveExpandedRunAnchor(
  mappedAnchor: HiddenRunAnchor,
  completedRuns: CompletedRunMeta[],
): HiddenRunAnchor | null {
  const candidates = completedRuns.filter((candidate) => candidate.taskListPos === mappedAnchor.taskListPos);
  if (!candidates.length) return null;

  const exactMatches = candidates.filter((candidate) =>
    candidate.runStartPos === mappedAnchor.runStartPos &&
    candidate.runEndPos === mappedAnchor.runEndPos,
  );
  if (exactMatches.length === 1) {
    return exactMatches[0];
  }
  if (exactMatches.length > 1) {
    return null;
  }

  const overlapping = candidates.filter((candidate) =>
    candidate.runStartPos <= mappedAnchor.runEndPos &&
    candidate.runEndPos >= mappedAnchor.runStartPos,
  );
  if (!overlapping.length) return null;
  if (overlapping.length === 1) {
    return overlapping[0];
  }

  const lengthMatches = overlapping.filter((candidate) => candidate.hiddenRunLength === mappedAnchor.hiddenRunLength);
  if (lengthMatches.length === 1) {
    return lengthMatches[0];
  }

  return null;
}

function buildTaskCompletionPluginState(
  doc: ProseMirrorNode,
  showCompletedLines: boolean,
  expandedRunAnchors: HiddenRunAnchor[],
): TaskCompletionPluginState {
  const itemMetaByPos = new Map<number, TaskItemCompletionMeta>();
  const listMetaByPos = new Map<number, TaskListCompletionMeta>();
  const directItemsByTaskListPos = new Map<number, TaskItemCompletionMeta[]>();

  const visitTaskItem = (node: ProseMirrorNode, pos: number, isTopLevel: boolean): TaskItemVisitResult => {
    let allNestedTaskItemsChecked = true;

    node.forEach((child, offset) => {
      if (child.type.name !== 'taskList') return;
      const childPos = pos + offset + 1;
      const childListMeta = visitTaskList(child, childPos, false);
      allNestedTaskItemsChecked = allNestedTaskItemsChecked && childListMeta.allTaskItemsChecked;
    });

    const selfChecked = Boolean(node.attrs?.checked);
    const subtreeComplete = selfChecked && allNestedTaskItemsChecked;
    const meta: TaskItemVisitResult = {
      pos,
      nodeSize: node.nodeSize,
      selfChecked,
      allNestedTaskItemsChecked,
      subtreeComplete,
      visibility: 'visible',
      hiddenRunStart: false,
      hiddenRunLength: 0,
      isTopLevel,
      childTaskListsChecked: allNestedTaskItemsChecked,
    };
    itemMetaByPos.set(pos, meta);
    return meta;
  };

  const visitTaskList = (node: ProseMirrorNode, pos: number, directChildrenAreTopLevel: boolean): TaskListVisitResult => {
    const directChildItems: TaskItemCompletionMeta[] = [];
    let allTaskItemsChecked = true;

    node.forEach((child, offset) => {
      if (child.type.name !== 'taskItem') return;
      const childPos = pos + offset + 1;
      const meta = visitTaskItem(child, childPos, directChildrenAreTopLevel);
      directChildItems.push(meta);
      allTaskItemsChecked = allTaskItemsChecked && meta.subtreeComplete;
    });

    directItemsByTaskListPos.set(pos, directChildItems);
    listMetaByPos.set(pos, {
      pos,
      nodeSize: node.nodeSize,
      trailingHiddenRunLength: 0,
    });

    return { allTaskItemsChecked };
  };

  doc.forEach((child, offset) => {
    if (child.type.name !== 'taskList') return;
    visitTaskList(child, offset, true);
  });

  const completedRuns = Array.from(directItemsByTaskListPos.entries()).flatMap(([taskListPos, directItems]) =>
    extractCompletedRuns(directItems, taskListPos),
  );

  const resolvedExpandedRunAnchors = expandedRunAnchors
    .map((anchor) => resolveExpandedRunAnchor(anchor, completedRuns))
    .filter((anchor): anchor is HiddenRunAnchor => anchor != null)
    .filter((anchor, index, list) => list.findIndex((candidate) => sameHiddenRunAnchor(candidate, anchor)) === index);

  const expandedRunKeys = new Set(resolvedExpandedRunAnchors.map((anchor) => createHiddenRunKey(anchor)));
  const toggleableRuns: ToggleableHiddenRunMeta[] = [];
  const currentlyHiddenRuns: ToggleableHiddenRunMeta[] = [];

  for (const [taskListPos, directItems] of directItemsByTaskListPos.entries()) {
    const runs = extractCompletedRuns(directItems, taskListPos);
    const listMeta = listMetaByPos.get(taskListPos);

    for (const meta of directItems) {
      meta.visibility = 'visible';
      meta.hiddenRunStart = false;
      meta.hiddenRunLength = 0;
    }
    if (listMeta) {
      listMeta.trailingHiddenRunLength = 0;
    }

    for (const run of runs) {
      const runKey = createHiddenRunKey(run);
      const isExpanded = expandedRunKeys.has(runKey);
      const runStartIndex = directItems.findIndex((item) => item.pos === run.runStartPos);
      const runEndIndex = directItems.findIndex((item) => item.pos === run.runEndPos);
      if (runStartIndex === -1 || runEndIndex === -1) continue;

      let anchorPos = run.runStartPos;
      let anchorNodePos = run.runStartPos;
      let anchorKind: HiddenRunAnchorKind = 'taskItem';

      if (!showCompletedLines && !isExpanded) {
        for (let itemIndex = runStartIndex; itemIndex <= runEndIndex; itemIndex += 1) {
          directItems[itemIndex].visibility = 'hidden';
        }

        const nextVisible = directItems.slice(runEndIndex + 1).find((item) => item.visibility === 'visible');
        if (nextVisible) {
          nextVisible.hiddenRunStart = true;
          nextVisible.hiddenRunLength = run.hiddenRunLength;
          anchorPos = nextVisible.pos;
          anchorNodePos = nextVisible.pos;
          anchorKind = 'taskItem';
        } else if (listMeta) {
          listMeta.trailingHiddenRunLength = run.hiddenRunLength;
          anchorPos = run.runStartPos;
          anchorNodePos = taskListPos;
          anchorKind = 'taskList';
        }
      }

      const runMeta: ToggleableHiddenRunMeta = {
        ...run,
        runKey,
        anchorPos,
        anchorNodePos,
        anchorKind,
        isExpanded,
      };

      toggleableRuns.push(runMeta);
      if (!showCompletedLines && !isExpanded) {
        currentlyHiddenRuns.push(runMeta);
      }
    }
  }

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
    expandedRunAnchors: resolvedExpandedRunAnchors,
    itemMetaByPos,
    listMetaByPos,
    toggleableRuns,
    currentlyHiddenRuns,
    decorations,
  };
}

export const getTaskCompletionState = (state: EditorState): TaskCompletionPluginState | null =>
  taskCompletionVisibilityPluginKey.getState(state) ?? null;

export const getTaskItemMetaAtPos = (state: EditorState, pos: number): TaskItemCompletionMeta | null =>
  getTaskCompletionState(state)?.itemMetaByPos.get(pos) ?? null;

export const getTaskCompletionCurrentlyHiddenRuns = (state: EditorState): ToggleableHiddenRunMeta[] =>
  getTaskCompletionState(state)?.currentlyHiddenRuns ?? [];

export const isTaskItemHiddenAtPos = (state: EditorState, pos: number): boolean =>
  getTaskItemMetaAtPos(state, pos)?.visibility === 'hidden';

export const isTopLevelTaskItemHandleVisible = (state: EditorState, pos: number): boolean => {
  const meta = getTaskItemMetaAtPos(state, pos);
  return Boolean(meta?.isTopLevel && meta.visibility === 'visible');
};

export const setTaskCompletionVisibilityMeta = (transaction: Transaction, showCompletedLines: boolean): Transaction =>
  transaction.setMeta(taskCompletionVisibilityPluginKey, { showCompletedLines } satisfies TaskCompletionMetaUpdate);

export const toggleExpandedHiddenRunMeta = (
  transaction: Transaction,
  hiddenRun: ToggleExpandedHiddenRunInput,
): Transaction =>
  transaction.setMeta(taskCompletionVisibilityPluginKey, { toggleExpandedHiddenRun: hiddenRun } satisfies TaskCompletionMetaUpdate);

export const clearExpandedHiddenRunsMeta = (transaction: Transaction): Transaction =>
  transaction.setMeta(taskCompletionVisibilityPluginKey, { clearExpandedHiddenRuns: true } satisfies TaskCompletionMetaUpdate);

export const buildTaskCompletionPluginStateForTest = (
  doc: ProseMirrorNode,
  showCompletedLines: boolean,
  expandedRunAnchors: HiddenRunAnchor[] = [],
): TaskCompletionPluginState => buildTaskCompletionPluginState(doc, showCompletedLines, expandedRunAnchors);

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
          init: (_, state) => buildTaskCompletionPluginState(state.doc, initialShowCompletedLines, []),
          apply: (transaction, pluginState, _oldState, newState) => {
            const meta = transaction.getMeta(taskCompletionVisibilityPluginKey) as TaskCompletionMetaUpdate | undefined;
            const nextShowCompletedLines = typeof meta?.showCompletedLines === 'boolean'
              ? meta.showCompletedLines
              : pluginState.showCompletedLines;

            let nextExpandedAnchors = transaction.docChanged
              ? pluginState.expandedRunAnchors.map((anchor) => mapHiddenRunAnchor(anchor, transaction))
              : [...pluginState.expandedRunAnchors];

            if (meta?.clearExpandedHiddenRuns) {
              nextExpandedAnchors = [];
            }

            if (meta?.toggleExpandedHiddenRun) {
              const nextAnchor = meta.toggleExpandedHiddenRun;
              const existingIndex = nextExpandedAnchors.findIndex((anchor) => sameHiddenRunAnchor(anchor, nextAnchor));
              if (existingIndex >= 0) {
                nextExpandedAnchors = nextExpandedAnchors.filter((_, index) => index !== existingIndex);
              } else {
                nextExpandedAnchors = [...nextExpandedAnchors, nextAnchor];
              }
            }

            if (
              !transaction.docChanged &&
              nextShowCompletedLines === pluginState.showCompletedLines &&
              nextExpandedAnchors.length === pluginState.expandedRunAnchors.length &&
              nextExpandedAnchors.every((anchor, index) => sameHiddenRunAnchor(anchor, pluginState.expandedRunAnchors[index]))
            ) {
              return pluginState;
            }

            return buildTaskCompletionPluginState(newState.doc, nextShowCompletedLines, nextExpandedAnchors);
          },
        },
        props: {
          decorations: (state) => taskCompletionVisibilityPluginKey.getState(state)?.decorations ?? null,
        },
      }),
    ];
  },
});
