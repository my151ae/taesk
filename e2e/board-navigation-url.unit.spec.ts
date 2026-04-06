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
  test("empty query resolves to overdue timeline default", async () => {
    const parsed = parseBoardUiStateFromSearchParams(new URLSearchParams(), defaults);

    expect(parsed.parseResult).toEqual({ ok: true });
    expect(parsed.resolvedState.leftPanelMode).toBe("overdue");
    expect(parsed.resolvedState.rightPanelMode).toBe("timeline");
    expect(parsed.resolvedState.date).toBeNull();
  });

  test("search timeline round-trip preserves q without forcing list", async () => {
    const params = serializeBoardUiStateToSearchParams({
      state: {
        leftPanelMode: "search",
        rightPanelMode: "timeline",
        date: "2026-03-31",
        tag: null,
        searchQuery: "meeting",
        showChecked: true,
        showUnchecked: true,
      },
    });

    expect(params.toString()).toBe("lp=search&rp=timeline&date=2026-03-31&q=meeting");

    const parsed = parseBoardUiStateFromSearchParams(params, defaults);
    expect(parsed.parseResult).toEqual({ ok: true });
    expect(parsed.resolvedState.leftPanelMode).toBe("search");
    expect(parsed.resolvedState.rightPanelMode).toBe("timeline");
    expect(parsed.resolvedState.date).toBe("2026-03-31");
    expect(parsed.resolvedState.searchQuery).toBe("meeting");
  });

  test("search list round-trip preserves q and drops date", async () => {
    const params = serializeBoardUiStateToSearchParams({
      state: {
        leftPanelMode: "search",
        rightPanelMode: "list",
        date: "2026-03-31",
        tag: null,
        searchQuery: "meeting",
        showChecked: true,
        showUnchecked: true,
      },
    });

    expect(params.toString()).toBe("lp=search&rp=list&q=meeting");

    const parsed = parseBoardUiStateFromSearchParams(params, defaults);
    expect(parsed.parseResult).toEqual({ ok: true });
    expect(parsed.resolvedState.leftPanelMode).toBe("search");
    expect(parsed.resolvedState.rightPanelMode).toBe("list");
    expect(parsed.resolvedState.date).toBeNull();
    expect(parsed.resolvedState.searchQuery).toBe("meeting");
  });

  test("tags round-trip preserves tag on both timeline and list modes", async () => {
    const timelineParams = serializeBoardUiStateToSearchParams({
      state: {
        leftPanelMode: "tags",
        rightPanelMode: "timeline",
        date: "2026-03-31",
        tag: "Memo",
        searchQuery: "",
        showChecked: true,
        showUnchecked: true,
      },
    });
    expect(timelineParams.toString()).toBe("lp=tags&rp=timeline&date=2026-03-31&tag=Memo");

    const listParams = serializeBoardUiStateToSearchParams({
      state: {
        leftPanelMode: "tags",
        rightPanelMode: "list",
        date: "2026-03-31",
        tag: "Memo",
        searchQuery: "",
        showChecked: true,
        showUnchecked: true,
      },
    });
    expect(listParams.toString()).toBe("lp=tags&rp=list&tag=Memo");

    const parsed = parseBoardUiStateFromSearchParams(listParams, defaults);
    expect(parsed.parseResult).toEqual({ ok: true });
    expect(parsed.resolvedState.leftPanelMode).toBe("tags");
    expect(parsed.resolvedState.rightPanelMode).toBe("list");
    expect(parsed.resolvedState.tag).toBe("Memo");
  });

  test("trash round-trip preserves lp without extra params", async () => {
    const params = serializeBoardUiStateToSearchParams({
      state: {
        leftPanelMode: "trash",
        rightPanelMode: "list",
        date: "2026-03-31",
        tag: "Memo",
        searchQuery: "meeting",
        showChecked: true,
        showUnchecked: true,
      },
    });

    expect(params.toString()).toBe("lp=trash&rp=list");

    const parsed = parseBoardUiStateFromSearchParams(params, defaults);
    expect(parsed.parseResult).toEqual({ ok: true });
    expect(parsed.resolvedState.leftPanelMode).toBe("trash");
    expect(parsed.resolvedState.rightPanelMode).toBe("list");
    expect(parsed.resolvedState.date).toBeNull();
    expect(parsed.resolvedState.tag).toBeNull();
    expect(parsed.resolvedState.searchQuery).toBe("");
  });

  test("normalize drops params that do not belong to the current panel mode", async () => {
    const normalized = normalizeBoardUiState(
      {
        leftPanelMode: "none",
        rightPanelMode: "list",
        date: "2026-03-31",
        tag: "Memo",
        searchQuery: "meeting",
      },
      defaults,
    );

    expect(normalized.leftPanelMode).toBe("none");
    expect(normalized.rightPanelMode).toBe("list");
    expect(normalized.date).toBeNull();
    expect(normalized.tag).toBeNull();
    expect(normalized.searchQuery).toBe("");
  });

  test("legacy view query is invalid", async () => {
    const parsed = parseBoardUiStateFromSearchParams(new URLSearchParams("view=timeline"), defaults);
    expect(parsed.parseResult).toEqual({ ok: false, code: "LEGACY_QUERY", detail: "view" });
  });

  test("missing rp is invalid", async () => {
    const parsed = parseBoardUiStateFromSearchParams(new URLSearchParams("lp=overdue"), defaults);
    expect(parsed.parseResult).toEqual({ ok: false, code: "MISSING_RP" });
  });

  test("timeline-nav is invalid lp", async () => {
    const parsed = parseBoardUiStateFromSearchParams(
      new URLSearchParams("lp=timeline-nav&rp=timeline"),
      defaults,
    );
    expect(parsed.parseResult).toEqual({ ok: false, code: "INVALID_LP" });
  });
});
