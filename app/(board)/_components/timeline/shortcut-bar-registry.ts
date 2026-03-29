"use client";

export type ShortcutScope = "board" | "modal" | "context-menu";
export type ShortcutRegion = "sidebar" | "main-panel" | "modal-title" | "modal-body" | "shortcuts-modal";
export type ShortcutSection = "overdue" | "search";
export type ShortcutView = "timeline" | "list";
export type ShortcutPart = "card" | "checkbox" | "title" | "editor";
export type ShortcutState = "active" | "editing" | "readonly" | "dragging" | "menu-open";
export type LegacyShortcutContext = "timeline-card" | "cardmodal-title" | "cardmodal-editor";
export type ShortcutCapabilities = {
  canUndo?: boolean | null;
  canRedo?: boolean | null;
  canIndent?: boolean | null;
  canOutdent?: boolean | null;
};

export type ShortcutContextDescriptor = {
  scope?: ShortcutScope;
  region: ShortcutRegion | null;
  section?: ShortcutSection | null;
  view?: ShortcutView | null;
  part?: ShortcutPart | null;
  state?: ShortcutState;
  legacyContext?: LegacyShortcutContext | null;
  capabilities?: ShortcutCapabilities | null;
};

export type ShortcutDefinition = {
  id: string;
  scope: ShortcutScope;
  regions?: ShortcutRegion[];
  sections?: ShortcutSection[];
  views?: ShortcutView[];
  parts?: ShortcutPart[];
  legacyContexts?: LegacyShortcutContext[];
  keys: string[];
  label: string;
  priorityBand: number;
  displayOrder: number;
  visibleWhen?: (input: { state: ShortcutState; descriptor: ShortcutContextDescriptor }) => boolean;
  enabledWhen?: (input: { state: ShortcutState; descriptor: ShortcutContextDescriptor }) => boolean;
};

export type ShortcutBarItem = ShortcutDefinition & {
  enabled: boolean;
};

export type ShortcutBarPayload = {
  scope: ShortcutScope;
  region: ShortcutRegion | null;
  section: ShortcutSection | null;
  view: ShortcutView | null;
  part: ShortcutPart | null;
  contextLabel: string | null;
  items: ShortcutBarItem[];
};

export type ShortcutBarConfig = {
  maxVisibleItems?: number;
};

export const SHORTCUT_SCOPE_ATTRIBUTE = "data-shortcut-scope";
export const SHORTCUT_REGION_ATTRIBUTE = "data-shortcut-region";
export const SHORTCUT_SECTION_ATTRIBUTE = "data-shortcut-section";
export const SHORTCUT_VIEW_ATTRIBUTE = "data-shortcut-view";
export const SHORTCUT_PART_ATTRIBUTE = "data-shortcut-part";
export const SHORTCUT_LEGACY_CONTEXT_ATTRIBUTE = "data-shortcut-context";

const ACTIVE_ONLY = ({ state }: { state: ShortcutState }) => state === "active";
const CAN_UNDO = ({ descriptor }: { descriptor: ShortcutContextDescriptor }) => Boolean(descriptor.capabilities?.canUndo);
const CAN_REDO = ({ descriptor }: { descriptor: ShortcutContextDescriptor }) => Boolean(descriptor.capabilities?.canRedo);
const CAN_INDENT = ({ descriptor }: { descriptor: ShortcutContextDescriptor }) => Boolean(descriptor.capabilities?.canIndent);
const CAN_OUTDENT = ({ descriptor }: { descriptor: ShortcutContextDescriptor }) => Boolean(descriptor.capabilities?.canOutdent);

const SCOPE_ORDER: Record<ShortcutScope, number> = {
  board: 1,
  modal: 2,
  "context-menu": 3,
};

const REGION_ORDER: Record<ShortcutRegion, number> = {
  sidebar: 1,
  "main-panel": 2,
  "modal-title": 3,
  "modal-body": 4,
  "shortcuts-modal": 5,
};

const SECTION_ORDER: Record<ShortcutSection, number> = {
  overdue: 1,
  search: 2,
};

const VIEW_ORDER: Record<ShortcutView, number> = {
  timeline: 1,
  list: 2,
};

const PART_ORDER: Record<ShortcutPart, number> = {
  card: 1,
  checkbox: 2,
  title: 3,
  editor: 4,
};

const SCOPE_LABELS: Record<ShortcutScope, string> = {
  board: "Board",
  modal: "Modal",
  "context-menu": "Context menu",
};

const REGION_LABELS: Record<ShortcutRegion, string> = {
  sidebar: "Sidebar",
  "main-panel": "Main panel",
  "modal-title": "Card title",
  "modal-body": "Card body",
  "shortcuts-modal": "Shortcuts modal",
};

const SECTION_LABELS: Record<ShortcutSection, string> = {
  overdue: "Overdue",
  search: "Search",
};

const VIEW_LABELS: Record<ShortcutView, string> = {
  timeline: "Timeline",
  list: "List",
};

const PART_LABELS: Record<ShortcutPart, string> = {
  card: "Card",
  checkbox: "Checkbox",
  title: "Title",
  editor: "Editor",
};

const LEGACY_CONTEXT_ALIASES: Record<LegacyShortcutContext, ShortcutContextDescriptor> = {
  "timeline-card": {
    scope: "board",
    region: "main-panel",
    view: "timeline",
    part: "card",
    legacyContext: "timeline-card",
  },
  "cardmodal-title": {
    scope: "modal",
    region: "modal-title",
    part: "title",
    legacyContext: "cardmodal-title",
  },
  "cardmodal-editor": {
    scope: "modal",
    region: "modal-body",
    part: "editor",
    legacyContext: "cardmodal-editor",
  },
};

export const SHORTCUT_REGISTRY: ShortcutDefinition[] = [
  {
    id: "board-sidebar-card-open-details",
    scope: "board",
    regions: ["sidebar"],
    sections: ["overdue", "search"],
    parts: ["card"],
    keys: ["Enter"],
    label: "詳細",
    priorityBand: 1,
    displayOrder: 10,
    visibleWhen: ACTIVE_ONLY,
  },
  {
    id: "board-sidebar-card-toggle-complete",
    scope: "board",
    regions: ["sidebar"],
    sections: ["overdue", "search"],
    parts: ["card"],
    keys: ["Space"],
    label: "完了",
    priorityBand: 1,
    displayOrder: 20,
    visibleWhen: ACTIVE_ONLY,
  },
  {
    id: "board-sidebar-card-open-menu",
    scope: "board",
    regions: ["sidebar"],
    sections: ["overdue", "search"],
    parts: ["card"],
    keys: ["Delete"],
    label: "メニュー",
    priorityBand: 4,
    displayOrder: 30,
    visibleWhen: ACTIVE_ONLY,
  },
  {
    id: "board-main-timeline-open-details",
    scope: "board",
    regions: ["main-panel"],
    views: ["timeline"],
    parts: ["card"],
    legacyContexts: ["timeline-card"],
    keys: ["Enter"],
    label: "詳細",
    priorityBand: 1,
    displayOrder: 10,
    visibleWhen: ACTIVE_ONLY,
  },
  {
    id: "board-main-timeline-toggle-complete",
    scope: "board",
    regions: ["main-panel"],
    views: ["timeline"],
    parts: ["card"],
    legacyContexts: ["timeline-card"],
    keys: ["Space"],
    label: "完了",
    priorityBand: 1,
    displayOrder: 20,
    visibleWhen: ACTIVE_ONLY,
  },
  {
    id: "board-main-timeline-create-next",
    scope: "board",
    regions: ["main-panel"],
    views: ["timeline"],
    parts: ["card"],
    legacyContexts: ["timeline-card"],
    keys: ["⇧", "Enter"],
    label: "カード追加",
    priorityBand: 2,
    displayOrder: 30,
    visibleWhen: ACTIVE_ONLY,
  },
  {
    id: "board-main-timeline-open-menu",
    scope: "board",
    regions: ["main-panel"],
    views: ["timeline"],
    parts: ["card"],
    legacyContexts: ["timeline-card"],
    keys: ["Delete"],
    label: "メニュー",
    priorityBand: 4,
    displayOrder: 40,
    visibleWhen: ACTIVE_ONLY,
  },
  {
    id: "board-main-list-open-details",
    scope: "board",
    regions: ["main-panel"],
    views: ["list"],
    parts: ["card"],
    keys: ["Enter"],
    label: "詳細",
    priorityBand: 1,
    displayOrder: 10,
    visibleWhen: ACTIVE_ONLY,
  },
  {
    id: "board-main-list-toggle-complete",
    scope: "board",
    regions: ["main-panel"],
    views: ["list"],
    parts: ["card"],
    keys: ["Space"],
    label: "完了",
    priorityBand: 1,
    displayOrder: 20,
    visibleWhen: ACTIVE_ONLY,
  },
  {
    id: "modal-title-focus-body-column",
    scope: "modal",
    regions: ["modal-title"],
    parts: ["title"],
    legacyContexts: ["cardmodal-title"],
    keys: ["↓"],
    label: "本文へ",
    priorityBand: 1,
    displayOrder: 10,
    visibleWhen: ACTIVE_ONLY,
  },
  {
    id: "modal-title-focus-body-start",
    scope: "modal",
    regions: ["modal-title"],
    parts: ["title"],
    legacyContexts: ["cardmodal-title"],
    keys: ["→"],
    label: "本文先頭",
    priorityBand: 1,
    displayOrder: 20,
    visibleWhen: ACTIVE_ONLY,
  },
  {
    id: "modal-title-undo",
    scope: "modal",
    regions: ["modal-title"],
    parts: ["title"],
    legacyContexts: ["cardmodal-title"],
    keys: ["⌘", "Z"],
    label: "元に戻す",
    priorityBand: 2,
    displayOrder: 30,
    visibleWhen: ACTIVE_ONLY,
  },
  {
    id: "modal-title-redo",
    scope: "modal",
    regions: ["modal-title"],
    parts: ["title"],
    legacyContexts: ["cardmodal-title"],
    keys: ["⌘", "⇧", "Z"],
    label: "やり直す",
    priorityBand: 2,
    displayOrder: 40,
    visibleWhen: ACTIVE_ONLY,
  },
  {
    id: "modal-title-close",
    scope: "modal",
    regions: ["modal-title"],
    parts: ["title"],
    legacyContexts: ["cardmodal-title"],
    keys: ["Esc"],
    label: "閉じる",
    priorityBand: 2,
    displayOrder: 50,
    visibleWhen: ACTIVE_ONLY,
  },
  {
    id: "modal-body-focus-title-column",
    scope: "modal",
    regions: ["modal-body"],
    parts: ["editor"],
    legacyContexts: ["cardmodal-editor"],
    keys: ["↑"],
    label: "タイトルへ",
    priorityBand: 1,
    displayOrder: 10,
    visibleWhen: ACTIVE_ONLY,
  },
  {
    id: "modal-body-focus-title-end",
    scope: "modal",
    regions: ["modal-body"],
    parts: ["editor"],
    legacyContexts: ["cardmodal-editor"],
    keys: ["←"],
    label: "タイトル末尾",
    priorityBand: 1,
    displayOrder: 20,
    visibleWhen: ACTIVE_ONLY,
  },
  {
    id: "modal-body-undo",
    scope: "modal",
    regions: ["modal-body"],
    parts: ["editor"],
    legacyContexts: ["cardmodal-editor"],
    keys: ["⌘", "Z"],
    label: "元に戻す",
    priorityBand: 2,
    displayOrder: 30,
    visibleWhen: ACTIVE_ONLY,
    enabledWhen: CAN_UNDO,
  },
  {
    id: "modal-body-redo",
    scope: "modal",
    regions: ["modal-body"],
    parts: ["editor"],
    legacyContexts: ["cardmodal-editor"],
    keys: ["⌘", "⇧", "Z"],
    label: "やり直す",
    priorityBand: 2,
    displayOrder: 40,
    visibleWhen: ACTIVE_ONLY,
    enabledWhen: CAN_REDO,
  },
  {
    id: "modal-body-indent",
    scope: "modal",
    regions: ["modal-body"],
    parts: ["editor"],
    legacyContexts: ["cardmodal-editor"],
    keys: ["Tab"],
    label: "インデント",
    priorityBand: 2,
    displayOrder: 50,
    visibleWhen: ACTIVE_ONLY,
    enabledWhen: CAN_INDENT,
  },
  {
    id: "modal-body-outdent",
    scope: "modal",
    regions: ["modal-body"],
    parts: ["editor"],
    legacyContexts: ["cardmodal-editor"],
    keys: ["⇧", "Tab"],
    label: "アウトデント",
    priorityBand: 2,
    displayOrder: 60,
    visibleWhen: ACTIVE_ONLY,
    enabledWhen: CAN_OUTDENT,
  },
  {
    id: "modal-body-close",
    scope: "modal",
    regions: ["modal-body"],
    parts: ["editor"],
    legacyContexts: ["cardmodal-editor"],
    keys: ["Esc"],
    label: "閉じる",
    priorityBand: 2,
    displayOrder: 70,
    visibleWhen: ACTIVE_ONLY,
  },
  {
    id: "shortcuts-modal-close",
    scope: "modal",
    regions: ["shortcuts-modal"],
    keys: ["Esc"],
    label: "閉じる",
    priorityBand: 1,
    displayOrder: 10,
    visibleWhen: ACTIVE_ONLY,
  },
];

export function resolveShortcutBarPayload(input: ShortcutContextDescriptor): ShortcutBarPayload | null {
  const descriptor = normalizeShortcutDescriptor(input);
  if (!descriptor.scope || !descriptor.region) return null;

  const items = SHORTCUT_REGISTRY
    .filter((shortcut) => matchesShortcutDefinition(shortcut, descriptor))
    .sort(compareShortcutDefinitions)
    .map((shortcut) => ({
      ...shortcut,
      enabled: shortcut.enabledWhen ? shortcut.enabledWhen({ state: descriptor.state ?? "active", descriptor }) : true,
    }));
  if (items.length === 0) return null;

  return {
    scope: descriptor.scope,
    region: descriptor.region,
    section: descriptor.section ?? null,
    view: descriptor.view ?? null,
    part: descriptor.part ?? null,
    contextLabel: getShortcutContextLabel(descriptor),
    items,
  };
}

export function normalizeShortcutDescriptor(input: ShortcutContextDescriptor | null | undefined): ShortcutContextDescriptor {
  if (!input) {
    return {
      scope: "board",
      region: null,
      section: null,
      view: null,
      part: null,
      state: "active",
      legacyContext: null,
      capabilities: null,
    };
  }

  const aliasDescriptor = input.legacyContext ? LEGACY_CONTEXT_ALIASES[input.legacyContext] : null;
  return {
    scope: input.scope ?? aliasDescriptor?.scope ?? "board",
    region: input.region ?? aliasDescriptor?.region ?? null,
    section: input.section ?? aliasDescriptor?.section ?? null,
    view: input.view ?? aliasDescriptor?.view ?? null,
    part: input.part ?? aliasDescriptor?.part ?? null,
    state: input.state ?? "active",
    legacyContext: input.legacyContext ?? aliasDescriptor?.legacyContext ?? null,
    capabilities: input.capabilities ?? null,
  };
}

export function getSortedShortcutDefinitions(): ShortcutDefinition[] {
  return [...SHORTCUT_REGISTRY].sort(compareShortcutDefinitions);
}

export function createEmptyShortcutBarPayload(scope: ShortcutScope): ShortcutBarPayload {
  return {
    scope,
    region: null,
    section: null,
    view: null,
    part: null,
    contextLabel: null,
    items: [],
  };
}

export function formatShortcutKeyLabel(key: string): string {
  return key;
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

export function getShortcutContextFromTarget(target: EventTarget | null): ShortcutContextDescriptor | null {
  if (!(target instanceof Element)) return null;

  const scopedElement = target.closest(`[${SHORTCUT_SCOPE_ATTRIBUTE}], [${SHORTCUT_LEGACY_CONTEXT_ATTRIBUTE}]`);
  if (!(scopedElement instanceof Element)) return null;

  const legacyContext = readLegacyContext(scopedElement.getAttribute(SHORTCUT_LEGACY_CONTEXT_ATTRIBUTE));
  const descriptor = normalizeShortcutDescriptor({
    scope: readScope(scopedElement.getAttribute(SHORTCUT_SCOPE_ATTRIBUTE)) ?? undefined,
    region: readRegion(scopedElement.getAttribute(SHORTCUT_REGION_ATTRIBUTE)),
    section: readSection(scopedElement.getAttribute(SHORTCUT_SECTION_ATTRIBUTE)),
    view: readView(scopedElement.getAttribute(SHORTCUT_VIEW_ATTRIBUTE)),
    part: readPart(scopedElement.getAttribute(SHORTCUT_PART_ATTRIBUTE)),
    legacyContext,
  });

  return descriptor.region || descriptor.legacyContext ? descriptor : null;
}

export function buildShortcutDataAttributes(descriptor: ShortcutContextDescriptor): Record<string, string> {
  const normalized = normalizeShortcutDescriptor(descriptor);
  const attributes: Record<string, string> = {
    [SHORTCUT_SCOPE_ATTRIBUTE]: normalized.scope ?? "board",
  };

  if (normalized.region) {
    attributes[SHORTCUT_REGION_ATTRIBUTE] = normalized.region;
  }
  if (normalized.section) {
    attributes[SHORTCUT_SECTION_ATTRIBUTE] = normalized.section;
  }
  if (normalized.view) {
    attributes[SHORTCUT_VIEW_ATTRIBUTE] = normalized.view;
  }
  if (normalized.part) {
    attributes[SHORTCUT_PART_ATTRIBUTE] = normalized.part;
  }
  if (normalized.legacyContext) {
    attributes[SHORTCUT_LEGACY_CONTEXT_ATTRIBUTE] = normalized.legacyContext;
  }

  return attributes;
}

export function getShortcutContextLabel(input: ShortcutContextDescriptor | ShortcutRegion): string {
  if (typeof input === "string") {
    return REGION_LABELS[input];
  }

  const descriptor = normalizeShortcutDescriptor(input);
  if (descriptor.region === "modal-title") return "カードタイトル";
  if (descriptor.region === "modal-body") return "カード本文";
  if (descriptor.region === "shortcuts-modal") return "ショートカット一覧";
  if (descriptor.region === "sidebar" && descriptor.section === "overdue") return "期限超過";
  if (descriptor.region === "sidebar" && descriptor.section === "search") return "検索";
  if (descriptor.region === "main-panel" && descriptor.view === "timeline") return "タイムライン";
  if (descriptor.region === "main-panel" && descriptor.view === "list") return "リスト";
  if (descriptor.region) return REGION_LABELS[descriptor.region];
  return "";
}

export function formatShortcutScope(scope: ShortcutScope): string {
  return SCOPE_LABELS[scope];
}

export function formatShortcutRegions(regions?: ShortcutRegion[]): string {
  if (!regions?.length) return "";
  return regions.map((region) => REGION_LABELS[region]).join(" / ");
}

export function formatShortcutSections(sections?: ShortcutSection[]): string {
  if (!sections?.length) return "";
  return sections.map((section) => SECTION_LABELS[section]).join(" / ");
}

export function formatShortcutViews(views?: ShortcutView[]): string {
  if (!views?.length) return "";
  return views.map((view) => VIEW_LABELS[view]).join(" / ");
}

export function formatShortcutParts(parts?: ShortcutPart[]): string {
  if (!parts?.length) return "";
  return parts.map((part) => PART_LABELS[part]).join(" / ");
}

function matchesShortcutDefinition(shortcut: ShortcutDefinition, descriptor: ShortcutContextDescriptor): boolean {
  if (shortcut.scope !== descriptor.scope) return false;
  if (shortcut.regions?.length && !descriptor.region) return false;
  if (shortcut.regions?.length && descriptor.region && !shortcut.regions.includes(descriptor.region)) return false;
  if (shortcut.sections?.length && !descriptor.section) return false;
  if (shortcut.sections?.length && descriptor.section && !shortcut.sections.includes(descriptor.section)) return false;
  if (shortcut.views?.length && !descriptor.view) return false;
  if (shortcut.views?.length && descriptor.view && !shortcut.views.includes(descriptor.view)) return false;
  if (shortcut.parts?.length && !descriptor.part) return false;
  if (shortcut.parts?.length && descriptor.part && !shortcut.parts.includes(descriptor.part)) return false;
  if (shortcut.legacyContexts?.length && descriptor.legacyContext && !shortcut.legacyContexts.includes(descriptor.legacyContext)) {
    return false;
  }
  return shortcut.visibleWhen ? shortcut.visibleWhen({ state: descriptor.state ?? "active", descriptor }) : true;
}

function compareShortcutDefinitions(left: ShortcutDefinition, right: ShortcutDefinition): number {
  if (left.scope !== right.scope) {
    return SCOPE_ORDER[left.scope] - SCOPE_ORDER[right.scope];
  }

  const leftRegionOrder = minAxisOrder(left.regions, REGION_ORDER);
  const rightRegionOrder = minAxisOrder(right.regions, REGION_ORDER);
  if (leftRegionOrder !== rightRegionOrder) {
    return leftRegionOrder - rightRegionOrder;
  }

  const leftSectionOrder = minAxisOrder(left.sections, SECTION_ORDER);
  const rightSectionOrder = minAxisOrder(right.sections, SECTION_ORDER);
  if (leftSectionOrder !== rightSectionOrder) {
    return leftSectionOrder - rightSectionOrder;
  }

  const leftViewOrder = minAxisOrder(left.views, VIEW_ORDER);
  const rightViewOrder = minAxisOrder(right.views, VIEW_ORDER);
  if (leftViewOrder !== rightViewOrder) {
    return leftViewOrder - rightViewOrder;
  }

  const leftPartOrder = minAxisOrder(left.parts, PART_ORDER);
  const rightPartOrder = minAxisOrder(right.parts, PART_ORDER);
  if (leftPartOrder !== rightPartOrder) {
    return leftPartOrder - rightPartOrder;
  }

  if (left.priorityBand !== right.priorityBand) {
    return left.priorityBand - right.priorityBand;
  }

  if (left.displayOrder !== right.displayOrder) {
    return left.displayOrder - right.displayOrder;
  }

  return SHORTCUT_REGISTRY.indexOf(left) - SHORTCUT_REGISTRY.indexOf(right);
}

function minAxisOrder<T extends string>(values: T[] | undefined, orderMap: Record<T, number>): number {
  if (!values?.length) return Number.MAX_SAFE_INTEGER;
  return Math.min(...values.map((value) => orderMap[value]));
}

function readScope(value: string | null): ShortcutScope | null {
  return value === "board" || value === "modal" || value === "context-menu"
    ? value
    : null;
}

function readRegion(value: string | null): ShortcutRegion | null {
  return value === "sidebar" ||
    value === "main-panel" ||
    value === "modal-title" ||
    value === "modal-body" ||
    value === "shortcuts-modal"
    ? value
    : null;
}

function readSection(value: string | null): ShortcutSection | null {
  return value === "overdue" || value === "search" ? value : null;
}

function readView(value: string | null): ShortcutView | null {
  return value === "timeline" || value === "list" ? value : null;
}

function readPart(value: string | null): ShortcutPart | null {
  return value === "card" || value === "checkbox" || value === "title" || value === "editor" ? value : null;
}

function readLegacyContext(value: string | null): LegacyShortcutContext | null {
  return value === "timeline-card" || value === "cardmodal-title" || value === "cardmodal-editor" ? value : null;
}
