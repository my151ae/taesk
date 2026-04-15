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
    expect(parsed.resolvedState.primaryPanelMode).toBe("overdue");
    expect(parsed.resolvedState.mainPanelMode).toBe("timeline");
    expect(parsed.resolvedState.date).toBeNull();
  });

  test("search timeline round-trip preserves q without forcing list", async () => {
    const params = serializeBoardUiStateToSearchParams({
      state: {
        primaryPanelMode: "search",
        mainPanelMode: "timeline",
        date: "2026-03-31",
        tag: null,
        searchQuery: "meeting",
        showChecked: true,
        showUnchecked: true,
      },
    });

    expect(params.toString()).toBe("pp=search&mp=timeline&date=2026-03-31&q=meeting");

    const parsed = parseBoardUiStateFromSearchParams(params, defaults);
    expect(parsed.parseResult).toEqual({ ok: true });
    expect(parsed.resolvedState.primaryPanelMode).toBe("search");
    expect(parsed.resolvedState.mainPanelMode).toBe("timeline");
    expect(parsed.resolvedState.date).toBe("2026-03-31");
    expect(parsed.resolvedState.searchQuery).toBe("meeting");
  });

  test("search list round-trip preserves q and drops date", async () => {
    const params = serializeBoardUiStateToSearchParams({
      state: {
        primaryPanelMode: "search",
        mainPanelMode: "list",
        date: "2026-03-31",
        tag: null,
        searchQuery: "meeting",
        showChecked: true,
        showUnchecked: true,
      },
    });

    expect(params.toString()).toBe("pp=search&mp=list&q=meeting");

    const parsed = parseBoardUiStateFromSearchParams(params, defaults);
    expect(parsed.parseResult).toEqual({ ok: true });
    expect(parsed.resolvedState.primaryPanelMode).toBe("search");
    expect(parsed.resolvedState.mainPanelMode).toBe("list");
    expect(parsed.resolvedState.date).toBeNull();
    expect(parsed.resolvedState.searchQuery).toBe("meeting");
  });

  test("tags round-trip preserves tag on both timeline and list modes", async () => {
    const timelineParams = serializeBoardUiStateToSearchParams({
      state: {
        primaryPanelMode: "tags",
        mainPanelMode: "timeline",
        date: "2026-03-31",
        tag: "Memo",
        searchQuery: "",
        showChecked: true,
        showUnchecked: true,
      },
    });
    expect(timelineParams.toString()).toBe("pp=tags&mp=timeline&date=2026-03-31&tag=Memo");

    const listParams = serializeBoardUiStateToSearchParams({
      state: {
        primaryPanelMode: "tags",
        mainPanelMode: "list",
        date: "2026-03-31",
        tag: "Memo",
        searchQuery: "",
        showChecked: true,
        showUnchecked: true,
      },
    });
    expect(listParams.toString()).toBe("pp=tags&mp=list&tag=Memo");

    const parsed = parseBoardUiStateFromSearchParams(listParams, defaults);
    expect(parsed.parseResult).toEqual({ ok: true });
    expect(parsed.resolvedState.primaryPanelMode).toBe("tags");
    expect(parsed.resolvedState.mainPanelMode).toBe("list");
    expect(parsed.resolvedState.tag).toBe("Memo");
  });

  test("tags round-trip preserves checked/unchecked filters", async () => {
    const params = serializeBoardUiStateToSearchParams({
      state: {
        primaryPanelMode: "tags",
        mainPanelMode: "timeline",
        date: "2026-03-31",
        tag: "Memo",
        searchQuery: "",
        showChecked: false,
        showUnchecked: true,
      },
    });

    expect(params.toString()).toBe("pp=tags&mp=timeline&date=2026-03-31&tag=Memo&checked=0");

    const parsed = parseBoardUiStateFromSearchParams(params, defaults);
    expect(parsed.parseResult).toEqual({ ok: true });
    expect(parsed.resolvedState.primaryPanelMode).toBe("tags");
    expect(parsed.resolvedState.showChecked).toBe(false);
    expect(parsed.resolvedState.showUnchecked).toBe(true);
  });

  test("trash round-trip preserves pp without extra params", async () => {
    const params = serializeBoardUiStateToSearchParams({
      state: {
        primaryPanelMode: "trash",
        mainPanelMode: "list",
        date: "2026-03-31",
        tag: "Memo",
        searchQuery: "meeting",
        showChecked: true,
        showUnchecked: true,
      },
    });

    expect(params.toString()).toBe("pp=trash&mp=list");

    const parsed = parseBoardUiStateFromSearchParams(params, defaults);
    expect(parsed.parseResult).toEqual({ ok: true });
    expect(parsed.resolvedState.primaryPanelMode).toBe("trash");
    expect(parsed.resolvedState.mainPanelMode).toBe("list");
    expect(parsed.resolvedState.date).toBeNull();
    expect(parsed.resolvedState.tag).toBeNull();
    expect(parsed.resolvedState.searchQuery).toBe("");
  });

  test("completed round-trip preserves pp without extra params", async () => {
    const params = serializeBoardUiStateToSearchParams({
      state: {
        primaryPanelMode: "completed",
        mainPanelMode: "timeline",
        date: "2026-03-31",
        tag: "Memo",
        searchQuery: "meeting",
        showChecked: true,
        showUnchecked: true,
      },
    });

    expect(params.toString()).toBe("pp=completed&mp=timeline&date=2026-03-31");

    const parsed = parseBoardUiStateFromSearchParams(params, defaults);
    expect(parsed.parseResult).toEqual({ ok: true });
    expect(parsed.resolvedState.primaryPanelMode).toBe("completed");
    expect(parsed.resolvedState.mainPanelMode).toBe("timeline");
    expect(parsed.resolvedState.tag).toBeNull();
    expect(parsed.resolvedState.searchQuery).toBe("");
  });

  test("normalize drops params that do not belong to the current panel mode", async () => {
    const normalized = normalizeBoardUiState(
      {
        primaryPanelMode: "none",
        mainPanelMode: "list",
        date: "2026-03-31",
        tag: "Memo",
        searchQuery: "meeting",
      },
      defaults,
    );

    expect(normalized.primaryPanelMode).toBe("none");
    expect(normalized.mainPanelMode).toBe("list");
    expect(normalized.date).toBeNull();
    expect(normalized.tag).toBeNull();
    expect(normalized.searchQuery).toBe("");
  });

  test("legacy view query is invalid", async () => {
    const parsed = parseBoardUiStateFromSearchParams(new URLSearchParams("view=timeline"), defaults);
    expect(parsed.parseResult).toEqual({ ok: false, code: "LEGACY_QUERY", detail: "view" });
  });

  test("missing mp is invalid", async () => {
    const parsed = parseBoardUiStateFromSearchParams(new URLSearchParams("pp=overdue"), defaults);
    expect(parsed.parseResult).toEqual({ ok: false, code: "MISSING_MP" });
  });

  test("timeline-nav is invalid pp", async () => {
    const parsed = parseBoardUiStateFromSearchParams(
      new URLSearchParams("pp=timeline-nav&mp=timeline"),
      defaults,
    );
    expect(parsed.parseResult).toEqual({ ok: false, code: "INVALID_PP" });
  });

  test("unknown param is invalid", async () => {
    const parsed = parseBoardUiStateFromSearchParams(
      new URLSearchParams("pp=overdue&mp=timeline&lp=overdue"),
      defaults,
    );
    expect(parsed.parseResult).toEqual({ ok: false, code: "UNKNOWN_PARAM", detail: "lp" });
  });

  test("invalid checked flag is invalid", async () => {
    const parsed = parseBoardUiStateFromSearchParams(
      new URLSearchParams("pp=tags&mp=timeline&checked=yes"),
      defaults,
    );
    expect(parsed.parseResult).toEqual({ ok: false, code: "INVALID_CHECKED" });
  });

  test("invalid unchecked flag is invalid", async () => {
    const parsed = parseBoardUiStateFromSearchParams(
      new URLSearchParams("pp=tags&mp=timeline&unchecked=no"),
      defaults,
    );
    expect(parsed.parseResult).toEqual({ ok: false, code: "INVALID_UNCHECKED" });
  });
});
