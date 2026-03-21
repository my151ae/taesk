"use client";

export type ShortcutScope = "board" | "modal";
export type ShortcutRegion = "timeline-card" | "cardmodal-title" | "cardmodal-editor";
export type ShortcutState = "active" | "readonly";

export type ShortcutDefinition = {
  id: string;
  scope: ShortcutScope;
  regions: ShortcutRegion[];
  keys: string[];
  label: string;
  priorityBand: number;
  displayOrder: number;
  visibleWhen?: (input: { state: ShortcutState }) => boolean;
};

export type ShortcutBarPayload = {
  scope: ShortcutScope;
  region: ShortcutRegion | null;
  contextLabel: string | null;
  items: ShortcutDefinition[];
};

export type ShortcutBarConfig = {
  maxVisibleItems?: number;
};

export const SHORTCUT_REGION_ATTRIBUTE = "data-shortcut-region";

const ACTIVE_ONLY = ({ state }: { state: ShortcutState }) => state === "active";

const CONTEXT_LABELS: Record<ShortcutRegion, string> = {
  "timeline-card": "タイムラインカード",
  "cardmodal-title": "カードタイトル",
  "cardmodal-editor": "カード本文",
};

const SHORTCUT_REGISTRY: ShortcutDefinition[] = [
  {
    id: "timeline-open-details",
    scope: "board",
    regions: ["timeline-card"],
    keys: ["Enter"],
    label: "詳細",
    priorityBand: 1,
    displayOrder: 10,
    visibleWhen: ACTIVE_ONLY,
  },
  {
    id: "timeline-toggle-complete",
    scope: "board",
    regions: ["timeline-card"],
    keys: ["Space"],
    label: "完了",
    priorityBand: 1,
    displayOrder: 20,
    visibleWhen: ACTIVE_ONLY,
  },
  {
    id: "timeline-create-next",
    scope: "board",
    regions: ["timeline-card"],
    keys: ["⇧", "Enter"],
    label: "次カード",
    priorityBand: 2,
    displayOrder: 30,
    visibleWhen: ACTIVE_ONLY,
  },
  {
    id: "timeline-open-menu",
    scope: "board",
    regions: ["timeline-card"],
    keys: ["Delete"],
    label: "メニュー",
    priorityBand: 4,
    displayOrder: 40,
    visibleWhen: ACTIVE_ONLY,
  },
  {
    id: "cardmodal-title-focus-body-column",
    scope: "modal",
    regions: ["cardmodal-title"],
    keys: ["↓"],
    label: "本文へ",
    priorityBand: 1,
    displayOrder: 10,
    visibleWhen: ACTIVE_ONLY,
  },
  {
    id: "cardmodal-title-focus-body-start",
    scope: "modal",
    regions: ["cardmodal-title"],
    keys: ["→"],
    label: "本文先頭",
    priorityBand: 1,
    displayOrder: 20,
    visibleWhen: ACTIVE_ONLY,
  },
  {
    id: "cardmodal-title-prepend-task",
    scope: "modal",
    regions: ["cardmodal-title"],
    keys: ["Enter"],
    label: "空チェック追加",
    priorityBand: 1,
    displayOrder: 30,
    visibleWhen: ACTIVE_ONLY,
  },
  {
    id: "cardmodal-title-undo",
    scope: "modal",
    regions: ["cardmodal-title"],
    keys: ["⌘", "Z"],
    label: "元に戻す",
    priorityBand: 2,
    displayOrder: 40,
    visibleWhen: ACTIVE_ONLY,
  },
  {
    id: "cardmodal-editor-focus-title-column",
    scope: "modal",
    regions: ["cardmodal-editor"],
    keys: ["↑"],
    label: "タイトルへ",
    priorityBand: 1,
    displayOrder: 10,
    visibleWhen: ACTIVE_ONLY,
  },
  {
    id: "cardmodal-editor-focus-title-end",
    scope: "modal",
    regions: ["cardmodal-editor"],
    keys: ["←"],
    label: "タイトル末尾",
    priorityBand: 1,
    displayOrder: 20,
    visibleWhen: ACTIVE_ONLY,
  },
  {
    id: "cardmodal-editor-undo",
    scope: "modal",
    regions: ["cardmodal-editor"],
    keys: ["⌘", "Z"],
    label: "元に戻す",
    priorityBand: 2,
    displayOrder: 30,
    visibleWhen: ACTIVE_ONLY,
  },
];

export function resolveShortcutBarPayload(input: {
  scope: ShortcutScope;
  region: ShortcutRegion;
  state: ShortcutState;
}): ShortcutBarPayload | null {
  const items = SHORTCUT_REGISTRY.filter((shortcut) => {
    if (shortcut.scope !== input.scope) return false;
    if (!shortcut.regions.includes(input.region)) return false;
    return shortcut.visibleWhen ? shortcut.visibleWhen({ state: input.state }) : true;
  }).sort((left, right) => {
    if (left.priorityBand !== right.priorityBand) {
      return left.priorityBand - right.priorityBand;
    }
    if (left.displayOrder !== right.displayOrder) {
      return left.displayOrder - right.displayOrder;
    }
    return SHORTCUT_REGISTRY.indexOf(left) - SHORTCUT_REGISTRY.indexOf(right);
  });

  if (items.length === 0) return null;

  return {
    scope: input.scope,
    region: input.region,
    contextLabel: CONTEXT_LABELS[input.region],
    items,
  };
}

export function createEmptyShortcutBarPayload(scope: ShortcutScope): ShortcutBarPayload {
  return {
    scope,
    region: null,
    contextLabel: null,
    items: [],
  };
}

export function sliceShortcutItems<T>(items: T[], maxVisibleItems: number): {
  visibleItems: T[];
  overflowCount: number;
} {
  const safeMax = Math.max(0, maxVisibleItems);
  if (items.length <= safeMax) {
    return { visibleItems: items, overflowCount: 0 };
  }
  return {
    visibleItems: items.slice(0, safeMax),
    overflowCount: items.length - safeMax,
  };
}

export function getShortcutRegionFromTarget(target: EventTarget | null): ShortcutRegion | null {
  if (!(target instanceof Element)) return null;
  const attributeValue = target.closest(`[${SHORTCUT_REGION_ATTRIBUTE}]`)?.getAttribute(SHORTCUT_REGION_ATTRIBUTE);
  return isShortcutRegion(attributeValue) ? attributeValue : null;
}

function isShortcutRegion(value: string | null | undefined): value is ShortcutRegion {
  return value === "timeline-card" || value === "cardmodal-title" || value === "cardmodal-editor";
}
