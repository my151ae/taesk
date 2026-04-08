import { expect, test } from "@playwright/test";

import {
  buildCompletedGroupsResetKey,
  buildCompletedResultsGroups,
  buildCompletedTimeText,
  buildCompletedMonthKeyJst,
  COMPLETED_UNDATED_GROUP_KEY,
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

  test("completed time text は JST 基準で表示する", async () => {
    expect(buildCompletedTimeText("2026-03-31T15:30:00.000Z")).toBe("完了 4/1(水) 00:30");
  });

  test("completed results は月別と完了日時なしにグループ化する", async () => {
    const groups = buildCompletedResultsGroups([
      {
        kind: "event",
        badgeLabel: "T",
        timeText: "完了 4/3",
        item: {
          card_id: "card-3",
          title: "April 3",
          checked: true,
          checked_at: "2026-04-03T03:00:00.000Z",
          checklist: null,
          content: null,
          excerpt: null,
          short_id: "c3",
        },
      },
      {
        kind: "event",
        badgeLabel: "T",
        timeText: "完了 4/1",
        item: {
          card_id: "card-2",
          title: "April 1",
          checked: true,
          checked_at: "2026-03-31T15:30:00.000Z",
          checklist: null,
          content: null,
          excerpt: null,
          short_id: "c2",
        },
      },
      {
        kind: "event",
        badgeLabel: "T",
        timeText: "完了 3/10",
        item: {
          card_id: "card-1",
          title: "March",
          checked: true,
          checked_at: "2026-03-10T03:00:00.000Z",
          checklist: null,
          content: null,
          excerpt: null,
          short_id: "c1",
        },
      },
      {
        kind: "event",
        badgeLabel: "T",
        timeText: "完了日時なし",
        item: {
          card_id: "card-0",
          title: "Undated",
          checked: true,
          checked_at: null,
          checklist: null,
          content: null,
          excerpt: null,
          short_id: "c0",
        },
      },
    ]);

    expect(groups).toHaveLength(3);
    expect(groups[0]?.key).toBe("2026/04");
    expect(groups[0]?.kind).toBe("month");
    expect(groups[0]?.count).toBe(2);
    expect(groups[1]?.key).toBe("2026/03");
    expect(groups[1]?.kind).toBe("month");
    expect(groups[1]?.count).toBe(1);
    expect(groups[2]?.key).toBe(COMPLETED_UNDATED_GROUP_KEY);
    expect(groups[2]?.kind).toBe("undated");
    expect(groups[2]?.count).toBe(1);
  });

  test("completed reset key は current month と group contents から安定生成する", async () => {
    const groups = buildCompletedResultsGroups([
      {
        kind: "event",
        badgeLabel: "T",
        timeText: "完了 4/3",
        item: {
          card_id: "card-3",
          title: "April 3",
          checked: true,
          checked_at: "2026-04-03T03:00:00.000Z",
          checklist: null,
          content: null,
          excerpt: null,
          short_id: "c3",
        },
      },
      {
        kind: "event",
        badgeLabel: "T",
        timeText: "完了日時なし",
        item: {
          card_id: "card-0",
          title: "Undated",
          checked: true,
          checked_at: null,
          checklist: null,
          content: null,
          excerpt: null,
          short_id: "c0",
        },
      },
    ]);

    expect(buildCompletedGroupsResetKey("2026/04", groups)).toBe(
      "2026/04::2026/04:card-3|__undated__:card-0",
    );
  });
});
