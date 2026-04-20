import { expect, test } from "@playwright/test";

import {
  INCREMENTAL_PANEL_SECTION_KEYS,
  SIDEBAR_SECTION_KEYS,
} from "../app/(board)/_components/timeline/sidebar-section-types";

test.describe("sidebar section types", () => {
  test("section key 一覧は shared contract を維持する", async () => {
    expect(SIDEBAR_SECTION_KEYS).toEqual([
      "overdue",
      "completed",
      "notifications",
      "search",
      "parents",
      "tags",
      "trash",
    ]);
  });

  test("incremental paging 対象キーは shell key と別契約で維持する", async () => {
    expect(INCREMENTAL_PANEL_SECTION_KEYS).toEqual([
      "completed",
      "search",
      "parents",
      "tags",
      "trash",
    ]);
  });
});
