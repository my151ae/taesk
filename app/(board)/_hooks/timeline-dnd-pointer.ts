import type { DragEndEvent, DragMoveEvent } from "@dnd-kit/core";

type PointerLikeEvent = {
  delta?: { x: number; y: number };
  active: DragMoveEvent["active"] | DragEndEvent["active"];
  activatorEvent?: unknown;
};

export function extractClientPoint(evt: unknown): { x: number; y: number } | null {
  if (!evt || typeof evt !== "object") return null;
  if ("clientX" in evt && "clientY" in evt) {
    const x = (evt as { clientX?: unknown }).clientX;
    const y = (evt as { clientY?: unknown }).clientY;
    if (typeof x === "number" && typeof y === "number") return { x, y };
  }
  if ("touches" in evt || "changedTouches" in evt) {
    const anyEvt = evt as TouchEvent;
    const touch = anyEvt.touches?.[0] ?? anyEvt.changedTouches?.[0] ?? null;
    if (touch && typeof touch.clientX === "number" && typeof touch.clientY === "number") {
      return { x: touch.clientX, y: touch.clientY };
    }
  }
  return null;
}

export function resolvePointerClientY(
  event: PointerLikeEvent,
  latestPointer: { x: number; y: number } | null,
  dragStartPointer: { x: number; y: number } | null
): number | null {
  const latest = latestPointer;
  if (latest) return latest.y;
  const activeRect = event.active.rect.current;
  if (activeRect?.translated) {
    return activeRect.translated.top + (activeRect.translated.height ?? 0) / 2;
  }
  if (activeRect?.initial) {
    return activeRect.initial.top + (activeRect.initial.height ?? 0) / 2 + (event.delta?.y ?? 0);
  }
  const start = dragStartPointer;
  if (start) return start.y + (event.delta?.y ?? 0);

  const activator = event.activatorEvent as unknown;
  if (activator && typeof activator === "object" && "clientY" in activator) {
    const val = (activator as { clientY?: unknown }).clientY;
    if (typeof val === "number") {
      return val;
    }
  }
  return null;
}

export function resolvePointerClientX(
  event: PointerLikeEvent,
  latestPointer: { x: number; y: number } | null,
  dragStartPointer: { x: number; y: number } | null
): number | null {
  const latest = latestPointer;
  if (latest) return latest.x;
  const activeRect = event.active.rect.current;
  if (activeRect?.translated) {
    return activeRect.translated.left + (activeRect.translated.width ?? 0) / 2;
  }
  if (activeRect?.initial) {
    return activeRect.initial.left + (activeRect.initial.width ?? 0) / 2 + (event.delta?.x ?? 0);
  }
  const start = dragStartPointer;
  if (start) return start.x + (event.delta?.x ?? 0);
  return null;
}
