import type { DragMoveEvent } from '@dnd-kit/core';
import type { RefObject } from 'react';

export type DragAutoScrollState = {
  raf: number | null;
  velocityPxPerSecond: number;
  el: HTMLDivElement | null;
  lastTimestamp: number | null;
};

export function createDragAutoScrollState(): DragAutoScrollState {
  return {
    raf: null,
    velocityPxPerSecond: 0,
    el: null,
    lastTimestamp: null,
  };
}

export function stopAutoScroll(state: DragAutoScrollState) {
  state.velocityPxPerSecond = 0;
  state.el = null;
  state.lastTimestamp = null;
  if (state.raf != null) {
    cancelAnimationFrame(state.raf);
    state.raf = null;
  }
}

export function ensureAutoScrollLoop(args: {
  state: DragAutoScrollState;
  hasActiveDrag: () => boolean;
}) {
  const { state, hasActiveDrag } = args;
  if (state.raf != null) return;

  const tick = (now: number) => {
    if (!hasActiveDrag() || !state.el || state.velocityPxPerSecond === 0) {
      state.raf = null;
      state.lastTimestamp = null;
      return;
    }

    const last = state.lastTimestamp ?? now;
    const deltaMs = Math.max(0, Math.min(64, now - last));
    state.lastTimestamp = now;

    const maxTop = Math.max(0, state.el.scrollHeight - state.el.clientHeight);
    const deltaPx = (state.velocityPxPerSecond * deltaMs) / 1000;
    state.el.scrollTop = Math.max(0, Math.min(maxTop, state.el.scrollTop + deltaPx));
    state.raf = requestAnimationFrame(tick);
  };

  state.raf = requestAnimationFrame(tick);
}

export function updateAutoScroll(args: {
  event: DragMoveEvent;
  state: DragAutoScrollState;
  resolvePointer: (event: DragMoveEvent) => { x: number | null; y: number | null };
  timelineScrollRef: RefObject<HTMLDivElement>;
  findAbScrollContainerAtPointer: (x: number, y: number) => HTMLDivElement | null;
  isPointerInAbColumn: (x: number) => boolean;
  hasActiveDrag: () => boolean;
}) {
  const {
    event,
    state,
    resolvePointer,
    timelineScrollRef,
    findAbScrollContainerAtPointer,
    isPointerInAbColumn,
    hasActiveDrag,
  } = args;

  const { x: pointerX, y: pointerY } = resolvePointer(event);
  if (pointerX == null || pointerY == null) {
    stopAutoScroll(state);
    return;
  }

  const { visualTop, visualTimeline, visualAb } = (() => {
    if (typeof document === 'undefined') {
      return { visualTop: null, visualTimeline: null, visualAb: null };
    }
    const top = document.elementFromPoint(pointerX, pointerY) as HTMLElement | null;
    return {
      visualTop: top,
      visualTimeline: top?.closest?.('[data-dnd="timeline-column"]') ?? null,
      visualAb: top?.closest?.('[data-dnd="ab-bucket"]') ?? null,
    };
  })();

  const hoveredAbEl = (() => {
    if (typeof document === 'undefined') {
      return findAbScrollContainerAtPointer(pointerX, pointerY);
    }
    const match = visualTop?.closest?.('[data-ab-scroll-container="true"]') as HTMLDivElement | null | undefined;
    return match ?? findAbScrollContainerAtPointer(pointerX, pointerY);
  })();
  const pointerInAbColumn = hoveredAbEl ? true : isPointerInAbColumn(pointerX);

  const timelineEl = timelineScrollRef.current;
  const hoveredTimelineEl = (() => {
    if (!timelineEl) return null;
    if (typeof document !== 'undefined') {
      const top = document.elementFromPoint(pointerX, pointerY);
      if (top && timelineEl.contains(top)) return timelineEl;
    }
    const rect = timelineEl.getBoundingClientRect();
    if (
      pointerX >= rect.left &&
      pointerX <= rect.right &&
      pointerY >= rect.top &&
      pointerY <= rect.bottom
    ) {
      return timelineEl;
    }
    return null;
  })();

  const targetEl =
    visualTimeline
      ? timelineEl
      : visualAb
        ? hoveredAbEl
        : hoveredAbEl ?? (pointerInAbColumn ? null : hoveredTimelineEl) ?? null;

  if (!targetEl) {
    stopAutoScroll(state);
    return;
  }

  const rect = targetEl.getBoundingClientRect();
  const threshold = Math.max(24, rect.height * 0.2);
  const topZone = rect.top + threshold;
  const bottomZone = rect.bottom - threshold;

  let velocityPxPerSecond = 0;
  const maxSpeedPxPerSecond = 240;
  const deadZoneRatio = 0.10;

  if (pointerY < topZone) {
    const intensity = Math.min(1, (topZone - pointerY) / threshold);
    if (intensity > deadZoneRatio) {
      const t = (intensity - deadZoneRatio) / (1 - deadZoneRatio);
      const eased = 1 - (1 - t) * (1 - t);
      velocityPxPerSecond = -maxSpeedPxPerSecond * eased;
    }
  } else if (pointerY > bottomZone) {
    const intensity = Math.min(1, (pointerY - bottomZone) / threshold);
    if (intensity > deadZoneRatio) {
      const t = (intensity - deadZoneRatio) / (1 - deadZoneRatio);
      const eased = 1 - (1 - t) * (1 - t);
      velocityPxPerSecond = maxSpeedPxPerSecond * eased;
    }
  }

  const isScrollable = targetEl.scrollHeight > targetEl.clientHeight + 1;
  const canScrollUp = targetEl.scrollTop > 0;
  const canScrollDown = targetEl.scrollTop + targetEl.clientHeight < targetEl.scrollHeight - 1;
  if (
    !isScrollable ||
    (velocityPxPerSecond < 0 && !canScrollUp) ||
    (velocityPxPerSecond > 0 && !canScrollDown)
  ) {
    velocityPxPerSecond = 0;
  }

  state.el = targetEl;
  state.velocityPxPerSecond = velocityPxPerSecond;
  if (velocityPxPerSecond !== 0) {
    ensureAutoScrollLoop({ state, hasActiveDrag });
  } else {
    stopAutoScroll(state);
  }
}
