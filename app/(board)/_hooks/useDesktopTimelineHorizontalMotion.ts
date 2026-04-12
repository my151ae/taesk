"use client";

import { useCallback, useEffect, useRef } from "react";

export type MotionIntent = "step";

export type AnimateToArgs = {
  container: HTMLDivElement;
  startLeft?: number;
  targetLeft: number;
  durationMs: number;
  onUpdate?: (nextLeft: number) => void;
  onComplete?: () => void;
};

export type DesktopTimelineHorizontalMotion = {
  isAnimatingRef: React.MutableRefObject<boolean>;
  animateTo: (args: AnimateToArgs) => void;
  cancel: () => void;
};

// ゆっくり始まる → 加速 → わずかに行き過ぎ → スッと収まる（スマホのスワイプページングに近い動き）
// ゆっくり動き出し → 加速 → 滑らかに減速してピタッと止まる（反動なし）
const easeInOutQuart = (x: number): number => {
  return x < 0.5 ? 8 * x * x * x * x : 1 - Math.pow(-2 * x + 2, 4) / 2;
};

export function useDesktopTimelineHorizontalMotion(): DesktopTimelineHorizontalMotion {
  const isAnimatingRef = useRef(false);
  const animationFrameRef = useRef<number | null>(null);
  const completionRef = useRef<(() => void) | null>(null);

  const cancel = useCallback(() => {
    if (animationFrameRef.current != null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    isAnimatingRef.current = false;
    completionRef.current = null;
  }, []);

  const animateTo = useCallback(
    ({ container, startLeft, targetLeft, durationMs, onUpdate, onComplete }: AnimateToArgs) => {
      cancel();

      const initialLeft = typeof startLeft === "number" ? startLeft : container.scrollLeft;
      if (Math.abs(initialLeft - targetLeft) < 1) {
        container.scrollLeft = targetLeft;
        onUpdate?.(targetLeft);
        onComplete?.();
        return;
      }

      const startTime = performance.now();
      isAnimatingRef.current = true;
      completionRef.current = onComplete ?? null;

      const step = (timestamp: number) => {
        const elapsed = timestamp - startTime;
        const progress = durationMs <= 0 ? 1 : Math.min(1, elapsed / durationMs);
        const eased = easeInOutQuart(progress);
        const nextLeft = initialLeft + (targetLeft - initialLeft) * eased;
        container.scrollLeft = nextLeft;
        onUpdate?.(nextLeft);

        if (progress >= 1) {
          container.scrollLeft = targetLeft;
          onUpdate?.(targetLeft);
          animationFrameRef.current = null;
          isAnimatingRef.current = false;
          const completion = completionRef.current;
          completionRef.current = null;
          completion?.();
          return;
        }

        animationFrameRef.current = window.requestAnimationFrame(step);
      };

      animationFrameRef.current = window.requestAnimationFrame(step);
    },
    [cancel],
  );

  useEffect(() => cancel, [cancel]);

  return {
    isAnimatingRef,
    animateTo,
    cancel,
  };
}
