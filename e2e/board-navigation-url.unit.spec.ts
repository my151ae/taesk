import { expect, test } from "@playwright/test";

import {
  normalizeBoardUiState,
  parseBoardUiStateFromSearchParams,
  serializeBoardUiStateToSearchParams,
} from "../app/(board)/_hooks/useTimelineUrlState";

const defaults = {
  timelineRange: 2,
  listWindow: { before: 15, after: 15 },
};

test.describe("board navigation canonical url helpers", () => {
  test("canonical round-trip for tags preserves lp/rp/tag/checked state", async () => {
    const params = serializeBoardUiStateToSearchParams({
      state: {
        leftPanelMode: "tags",
        rightPanelMode: "list",
        date: null,
        tag: "Memo",
        searchQuery: "",
        showChecked: true,
        showUnchecked: false,
      },
    });

    expect(params.toString()).toBe("lp=tags&rp=list&tag=Memo&checked=1&unchecked=0");

    const parsed = parseBoardUiStateFromSearchParams(params, defaults);
    expect(parsed.parseResult).toEqual({ ok: true });
    expect(parsed.resolvedState.leftPanelMode).toBe("tags");
    expect(parsed.resolvedState.rightPanelMode).toBe("list");
    expect(parsed.resolvedState.tag).toBe("Memo");
    expect(parsed.resolvedState.showChecked).toBe(true);
    expect(parsed.resolvedState.showUnchecked).toBe(false);
  });

  test("lp=overdue without rp defaults to overdue timeline", async () => {
    const parsed = parseBoardUiStateFromSearchParams(new URLSearchParams("lp=overdue"), defaults);

    expect(parsed.parseResult).toEqual({ ok: true });
    expect(parsed.resolvedState.leftPanelMode).toBe("overdue");
    expect(parsed.resolvedState.rightPanelMode).toBe("timeline");
  });

  test("normalize drops conflicting q in tags context", async () => {
    const normalized = normalizeBoardUiState(
      {
        leftPanelMode: "tags",
        rightPanelMode: "list",
        tag: "Memo",
        searchQuery: "meeting",
      },
      defaults,
    );

    expect(normalized.leftPanelMode).toBe("tags");
    expect(normalized.rightPanelMode).toBe("list");
    expect(normalized.tag).toBe("Memo");
    expect(normalized.searchQuery).toBe("");
  });

  test("normalize rewrites search timeline to search list", async () => {
    const normalized = normalizeBoardUiState(
      {
        leftPanelMode: "search",
        rightPanelMode: "timeline",
        searchQuery: "meeting",
      },
      defaults,
    );

    expect(normalized.leftPanelMode).toBe("search");
    expect(normalized.rightPanelMode).toBe("list");
    expect(normalized.searchQuery).toBe("meeting");
  });

  test("legacy view query is invalid", async () => {
    const parsed = parseBoardUiStateFromSearchParams(new URLSearchParams("view=timeline"), defaults);
    expect(parsed.parseResult).toEqual({ ok: false, code: "LEGACY_QUERY", detail: "view" });
  });

  test("invalid checked value is invalid", async () => {
    const parsed = parseBoardUiStateFromSearchParams(
      new URLSearchParams("lp=tags&rp=list&tag=Memo&checked=abc"),
      defaults,
    );
    expect(parsed.parseResult).toEqual({ ok: false, code: "INVALID_CHECKED" });
  });

  test("none timeline is normalized to timeline-nav timeline", async () => {
    const normalized = normalizeBoardUiState(
      {
        leftPanelMode: "none",
        rightPanelMode: "timeline",
      },
      defaults,
    );

    expect(normalized.leftPanelMode).toBe("timeline-nav");
    expect(normalized.rightPanelMode).toBe("timeline");
  });
});
