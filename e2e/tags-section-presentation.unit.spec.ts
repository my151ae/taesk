import { expect, test } from "@playwright/test";

import { getTagsSectionPresentation } from "../app/(board)/_components/timeline/tags-section-presentation";

test.describe("tags section presentation", () => {
  test("未選択時は Tags と利用可能タグ数を返す", async () => {
    expect(
      getTagsSectionPresentation({
        selectedTag: null,
        tagSummariesCount: 7,
        tagResultsCount: 3,
      })
    ).toEqual({
      label: "Tags",
      count: 7,
      triggerLabel: "Tags",
    });
  });

  test("選択時は Tags と一致カード数と trigger label を返す", async () => {
    expect(
      getTagsSectionPresentation({
        selectedTag: "urgent",
        tagSummariesCount: 7,
        tagResultsCount: 3,
      })
    ).toEqual({
      label: "Tags",
      count: 3,
      triggerLabel: "#urgent",
    });
  });
});
