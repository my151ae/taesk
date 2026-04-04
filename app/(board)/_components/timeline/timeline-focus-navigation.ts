"use client";

export type TimelineArrowKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

export type TimelineFocusCandidate = {
  order: number;
  centerX: number;
  centerY: number;
  focusPart?: string;
};

const HORIZONTAL_THRESHOLD_PX = 10;
const VERTICAL_THRESHOLD_PX = 10;
const ANY_FOCUS_ITEM_SELECTOR = "[data-focus-group][data-focus-part]";
const ARROW_NAVIGABLE_FOCUS_GROUP_PARTS = {
  header: ["control"],
  toolbar: ["control"],
  timeline: ["card"],
  bucket: ["section-button", "card", "add-button"],
  sidebar: ["rail-button"],
} as const;
const ARROW_NAVIGATION_SOURCE_PARTS = {
  header: ["control"],
  toolbar: ["control"],
  timeline: ["card"],
  bucket: ["section-button", "card", "add-button"],
  sidebar: ["rail-button"],
} as const;
type ArrowNavigableFocusGroup = keyof typeof ARROW_NAVIGABLE_FOCUS_GROUP_PARTS;

function isArrowKey(value: string): value is TimelineArrowKey {
  return value === "ArrowUp" || value === "ArrowDown" || value === "ArrowLeft" || value === "ArrowRight";
}

function isVisibleElement(element: HTMLElement) {
  if (element.hasAttribute("disabled")) return false;
  if (element.offsetParent === null && element.getClientRects().length === 0) return false;

  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  let current: HTMLElement | null = element.parentElement;
  while (current) {
    const style = window.getComputedStyle(current);
    const clipsX = ["hidden", "clip", "auto", "scroll"].includes(style.overflowX) || ["hidden", "clip", "auto", "scroll"].includes(style.overflow);
    const clipsY = ["hidden", "clip", "auto", "scroll"].includes(style.overflowY) || ["hidden", "clip", "auto", "scroll"].includes(style.overflow);

    if (clipsX || clipsY) {
      const parentRect = current.getBoundingClientRect();
      const horizontallyVisible = rect.right > parentRect.left && rect.left < parentRect.right;
      const verticallyVisible = rect.bottom > parentRect.top && rect.top < parentRect.bottom;

      if ((clipsX && !horizontallyVisible) || (clipsY && !verticallyVisible)) {
        return false;
      }
    }

    current = current.parentElement;
  }

  return true;
}

function isTextEditingTarget(target: HTMLElement) {
  const tagName = target.tagName;
  return tagName === "INPUT" || tagName === "TEXTAREA" || target.isContentEditable;
}

function isArrowNavigableFocusGroup(value?: string | null): value is ArrowNavigableFocusGroup {
  return value === "header" || value === "toolbar" || value === "timeline" || value === "bucket" || value === "sidebar";
}

function buildPartsSelector(focusGroup: ArrowNavigableFocusGroup, parts: readonly string[]) {
  return parts
    .map((part) => `[data-focus-group="${focusGroup}"][data-focus-part="${part}"]`)
    .join(", ");
}

function buildCrossGroupCardSelector() {
  return [
    '[data-focus-group="timeline"][data-focus-part="card"]',
    '[data-focus-group="bucket"][data-focus-part="card"]',
    '[data-focus-group="bucket"][data-focus-part="add-button"]',
    '[data-focus-group="sidebar"][data-focus-part="rail-button"]',
  ]
    .join(", ");
}

function buildCrossGroupVerticalSelector() {
  return [
    '[data-focus-group="header"][data-focus-part="control"]',
    '[data-focus-group="toolbar"][data-focus-part="control"]',
    '[data-focus-group="sidebar"][data-focus-part="rail-button"]',
    '[data-focus-group="timeline"][data-focus-part="card"]',
    '[data-focus-group="bucket"][data-focus-part="section-button"]',
    '[data-focus-group="bucket"][data-focus-part="card"]',
    '[data-focus-group="bucket"][data-focus-part="add-button"]',
  ].join(", ");
}

function getFocusPartPriority(focusPart?: string) {
  if (focusPart === "card") return 0;
  if (focusPart === "section-button") return 150;
  if (focusPart === "add-button") return 300;
  return 75;
}

function findSidebarShell(container: HTMLElement) {
  return container.querySelector('[data-testid="desktop-sidebar-shell"]');
}

function isInSidebarShell(element: HTMLElement, container: HTMLElement) {
  const sidebarShell = findSidebarShell(container);
  return Boolean(sidebarShell instanceof HTMLElement && sidebarShell.contains(element));
}

function buildFocusItemSelector(focusGroup: ArrowNavigableFocusGroup) {
  return buildPartsSelector(focusGroup, ARROW_NAVIGABLE_FOCUS_GROUP_PARTS[focusGroup]);
}

function buildHorizontalSelector(focusGroup: ArrowNavigableFocusGroup) {
  if (focusGroup === "timeline" || focusGroup === "bucket") {
    return buildCrossGroupCardSelector();
  }
  return buildFocusItemSelector(focusGroup);
}

function resolveActiveNavigationItem(element: HTMLElement) {
  const focusGroup = element.dataset.focusGroup;
  if (!isArrowNavigableFocusGroup(focusGroup)) return null;

  const selector = buildPartsSelector(focusGroup, ARROW_NAVIGATION_SOURCE_PARTS[focusGroup]);
  const navigableItem = element.closest(selector);
  if (!(navigableItem instanceof HTMLElement)) return null;

  return {
    focusGroup,
    selector,
    activeItem: navigableItem,
  };
}

export function resolveNextTimelineCardIndex({
  key,
  currentIndex,
  candidates,
}: {
  key: TimelineArrowKey;
  currentIndex: number;
  candidates: TimelineFocusCandidate[];
}) {
  if (currentIndex < 0 || currentIndex >= candidates.length) return null;

  if (key === "ArrowUp" || key === "ArrowDown") {
    const current = candidates[currentIndex];
    if (!current) return null;

    let bestIndex: number | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    candidates.forEach((candidate, index) => {
      if (index === currentIndex) return;
      const dx = candidate.centerX - current.centerX;
      const dy = candidate.centerY - current.centerY;
      const isValid = key === "ArrowUp" ? dy < -VERTICAL_THRESHOLD_PX : dy > VERTICAL_THRESHOLD_PX;
      if (!isValid) return;

      const score = (dy * dy) + (dx * dx * 4) + getFocusPartPriority(candidate.focusPart);
      if (score < bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });

    return bestIndex;
  }

  const current = candidates[currentIndex];
  if (!current) return null;

  let bestIndex: number | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  candidates.forEach((candidate, index) => {
    if (index === currentIndex) return;
    const dx = candidate.centerX - current.centerX;
    const dy = candidate.centerY - current.centerY;
    const isValid = key === "ArrowLeft" ? dx < -HORIZONTAL_THRESHOLD_PX : dx > HORIZONTAL_THRESHOLD_PX;
    if (!isValid) return;

    const score = (dx * dx) + (dy * dy * 4) + getFocusPartPriority(candidate.focusPart);
    if (score < bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestIndex;
}

export function handleTimelineCardArrowFocus(event: React.KeyboardEvent<HTMLElement>) {
  if (!isArrowKey(event.key)) return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.closest('[role="menu"], [data-arrow-skip="true"]')) return;
  if (isTextEditingTarget(target)) return;

  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement)) return;

  const activeFocusItem = activeElement.closest(ANY_FOCUS_ITEM_SELECTOR);
  if (!(activeFocusItem instanceof HTMLElement)) return;

  const resolvedActiveItem = resolveActiveNavigationItem(activeFocusItem);
  if (!resolvedActiveItem) return;

  const { focusGroup, activeItem } = resolvedActiveItem;

  const container = event.currentTarget;
  if (!(container instanceof HTMLElement) || !container.contains(activeItem)) return;

  if (focusGroup === "sidebar" && event.key === "ArrowRight") {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const selector =
    event.key === "ArrowUp" || event.key === "ArrowDown"
      ? buildCrossGroupVerticalSelector()
      : buildHorizontalSelector(focusGroup);

  const candidates = Array.from(container.querySelectorAll(selector))
    .filter((element): element is HTMLElement => element instanceof HTMLElement)
    .filter((element) => (
      event.key === "ArrowUp" || event.key === "ArrowDown"
        ? isInSidebarShell(element, container) === isInSidebarShell(activeItem, container)
        : true
    ))
    .filter(isVisibleElement)
    .map((element, order) => {
      const rect = element.getBoundingClientRect();
      return {
        element,
        candidate: {
          order,
          centerX: rect.left + rect.width / 2,
          centerY: rect.top + rect.height / 2,
          focusPart: element.dataset.focusPart,
        },
      };
    });

  if (!candidates.length) return;

  const currentIndex = candidates.findIndex(({ element }) => element === activeItem);
  let nextIndex: number | null;

  if (currentIndex >= 0) {
    nextIndex = resolveNextTimelineCardIndex({
      key: event.key,
      currentIndex,
      candidates: candidates.map(({ candidate }) => candidate),
    });
  } else {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

    const activeRect = activeItem.getBoundingClientRect();
    const syntheticCandidates: TimelineFocusCandidate[] = [
      {
        order: -1,
        centerX: activeRect.left + activeRect.width / 2,
        centerY: activeRect.top + activeRect.height / 2,
      },
      ...candidates.map(({ candidate }) => candidate),
    ];

    const resolvedIndex = resolveNextTimelineCardIndex({
      key: event.key,
      currentIndex: 0,
      candidates: syntheticCandidates,
    });
    nextIndex = resolvedIndex == null ? null : resolvedIndex - 1;
  }

  if (nextIndex == null) return;

  const nextElement = candidates[nextIndex]?.element;
  if (!nextElement || nextElement === activeItem) return;
  nextElement.focus();
  nextElement.scrollIntoView({ block: "nearest", inline: "nearest" });
}
