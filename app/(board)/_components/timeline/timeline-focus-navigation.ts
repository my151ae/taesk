"use client";

export type TimelineArrowKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

export type TimelineFocusCandidate = {
  order: number;
  centerX: number;
  centerY: number;
};

const HORIZONTAL_THRESHOLD_PX = 10;
const ANY_FOCUS_ITEM_SELECTOR = "[data-focus-group][data-focus-part]";
const ARROW_NAVIGABLE_FOCUS_GROUP_PARTS = {
  timeline: ["card"],
  bucket: ["section-button", "card"],
} as const;
type ArrowNavigableFocusGroup = keyof typeof ARROW_NAVIGABLE_FOCUS_GROUP_PARTS;

function isArrowKey(value: string): value is TimelineArrowKey {
  return value === "ArrowUp" || value === "ArrowDown" || value === "ArrowLeft" || value === "ArrowRight";
}

function isVisibleElement(element: HTMLElement) {
  return !element.hasAttribute("disabled") && (element.offsetParent !== null || element.getClientRects().length > 0);
}

function isTextEditingTarget(target: HTMLElement) {
  const tagName = target.tagName;
  return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT" || target.isContentEditable;
}

function isArrowNavigableFocusGroup(value?: string | null): value is ArrowNavigableFocusGroup {
  return value === "timeline" || value === "bucket";
}

function buildFocusItemSelector(focusGroup: ArrowNavigableFocusGroup) {
  return ARROW_NAVIGABLE_FOCUS_GROUP_PARTS[focusGroup]
    .map((part) => `[data-focus-group="${focusGroup}"][data-focus-part="${part}"]`)
    .join(", ");
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
    const step = key === "ArrowUp" ? -1 : 1;
    const nextIndex = currentIndex + step;
    if (nextIndex < 0 || nextIndex >= candidates.length) {
      return null;
    }
    return nextIndex;
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

    const score = (dx * dx) + (dy * dy * 4);
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

  const activeItem = activeElement.closest(ANY_FOCUS_ITEM_SELECTOR);
  if (!(activeItem instanceof HTMLElement)) return;

  const container = event.currentTarget;
  if (!(container instanceof HTMLElement) || !container.contains(activeItem)) return;

  const focusGroup = activeItem.dataset.focusGroup;
  if (!isArrowNavigableFocusGroup(focusGroup)) return;
  const selector = buildFocusItemSelector(focusGroup);
  const allowedParts = ARROW_NAVIGABLE_FOCUS_GROUP_PARTS[focusGroup] as readonly string[];
  const activePart = activeItem.dataset.focusPart;
  if (!activePart || !allowedParts.includes(activePart)) return;

  event.preventDefault();
  event.stopPropagation();

  const candidates = Array.from(container.querySelectorAll(selector))
    .filter((element): element is HTMLElement => element instanceof HTMLElement)
    .filter(isVisibleElement)
    .map((element, order) => {
      const rect = element.getBoundingClientRect();
      return {
        element,
        candidate: {
          order,
          centerX: rect.left + rect.width / 2,
          centerY: rect.top + rect.height / 2,
        },
      };
    });

  if (!candidates.length) return;

  const currentIndex = candidates.findIndex(({ element }) => element === activeItem);
  const nextIndex = resolveNextTimelineCardIndex({
    key: event.key,
    currentIndex,
    candidates: candidates.map(({ candidate }) => candidate),
  });

  if (nextIndex == null) return;

  const nextElement = candidates[nextIndex]?.element;
  if (!nextElement || nextElement === activeItem) return;
  nextElement.focus();
  nextElement.scrollIntoView({ block: "nearest", inline: "nearest" });
}
