import { expect, test } from "@playwright/test";
import {
  resolveNextTimelineCardIndex,
  type TimelineFocusCandidate,
} from "../app/(board)/_components/timeline/timeline-focus-navigation";

test.describe("timeline-focus-navigation", () => {
  test("ArrowUp / ArrowDown はカード順で移動先を決める", async () => {
    const candidates: TimelineFocusCandidate[] = [
      { order: 0, centerX: 100, centerY: 100 },
      { order: 1, centerX: 100, centerY: 200 },
      { order: 2, centerX: 100, centerY: 300 },
    ];

    expect(resolveNextTimelineCardIndex({
      key: "ArrowUp",
      currentIndex: 1,
      candidates,
    })).toBe(0);

    expect(resolveNextTimelineCardIndex({
      key: "ArrowDown",
      currentIndex: 1,
      candidates,
    })).toBe(2);

    expect(resolveNextTimelineCardIndex({
      key: "ArrowUp",
      currentIndex: 0,
      candidates,
    })).toBeNull();
  });

  test("ArrowLeft / ArrowRight は最も近い横方向カードを選ぶ", async () => {
    const candidates: TimelineFocusCandidate[] = [
      { order: 0, centerX: 100, centerY: 100 },
      { order: 1, centerX: 260, centerY: 110 },
      { order: 2, centerX: 420, centerY: 300 },
      { order: 3, centerX: 20, centerY: 95 },
    ];

    expect(resolveNextTimelineCardIndex({
      key: "ArrowRight",
      currentIndex: 0,
      candidates,
    })).toBe(1);

    expect(resolveNextTimelineCardIndex({
      key: "ArrowLeft",
      currentIndex: 0,
      candidates,
    })).toBe(3);
  });

  test("横方向しきい値未満の候補は ArrowLeft / ArrowRight で無視する", async () => {
    const candidates: TimelineFocusCandidate[] = [
      { order: 0, centerX: 100, centerY: 100 },
      { order: 1, centerX: 105, centerY: 102 },
      { order: 2, centerX: 113, centerY: 104 },
    ];

    expect(resolveNextTimelineCardIndex({
      key: "ArrowRight",
      currentIndex: 0,
      candidates,
    })).toBe(2);
  });
});
