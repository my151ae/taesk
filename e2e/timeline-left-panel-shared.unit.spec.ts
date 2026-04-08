import { expect, test } from "@playwright/test";

import {
  buildCompletedMonthKeyJst,
  getIncrementalVisibilityState,
  SIDEBAR_INCREMENT_PAGE_SIZE,
} from "../app/(board)/_components/timeline/TimelineLeftPanelShared";

test.describe("TimelineLeftPanelShared helpers", () => {
  test("incremental visibility は 20 件ずつ増加する", async () => {
    const initial = getIncrementalVisibilityState({
      total: 55,
      visibleCount: SIDEBAR_INCREMENT_PAGE_SIZE,
    });
    expect(initial.sliceEnd).toBe(20);
    expect(initial.canLoadMore).toBe(true);
    expect(initial.nextVisibleCount).toBe(40);

    const second = getIncrementalVisibilityState({
      total: 55,
      visibleCount: initial.nextVisibleCount,
    });
    expect(second.sliceEnd).toBe(40);
    expect(second.canLoadMore).toBe(true);
    expect(second.nextVisibleCount).toBe(60);
  });

  test("総件数が page size 以下のとき footer を出さない状態になる", async () => {
    const state = getIncrementalVisibilityState({
      total: 12,
      visibleCount: SIDEBAR_INCREMENT_PAGE_SIZE,
    });
    expect(state.sliceEnd).toBe(12);
    expect(state.canLoadMore).toBe(false);
  });

  test("completed month key は JST 基準で YYYY/MM を返す", async () => {
    expect(buildCompletedMonthKeyJst("2026-03-31T15:30:00.000Z")).toBe("2026/04");
    expect(buildCompletedMonthKeyJst("2026-04-30T14:59:59.000Z")).toBe("2026/04");
  });

  test("checked_at が null のとき month key は null", async () => {
    expect(buildCompletedMonthKeyJst(null)).toBeNull();
  });
});
