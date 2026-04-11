import { expect, test } from "@playwright/test";
import {
  ANCHOR_SWITCH_THRESHOLD,
  resolveDesktopTimelineAnchorIso,
  resolveDesktopTimelineWindowMetrics,
} from "../app/(board)/_components/timeline/desktopTimelineWindowing";
import {
  adaptDesktopWindowStateToViewportState,
  adaptMobileTimelineViewStateToViewportState,
  deriveTimelineViewportStateFromAnchor,
} from "../app/(board)/_components/timeline/timelineViewportState";
import {
  buildCalendarWindowRangeFromViewportState,
  buildDesktopTimelinePrefetchSpans,
  buildTimelinePrefetchSignature,
} from "../app/(board)/_hooks/useDesktopTimelineCoordinator";
import { resolveMobileTimelineViewportState } from "../app/(board)/_hooks/useMobileTimelineViewportState";

const buildDays = (count: number, startDay = 1) =>
  Array.from({ length: count }, (_, index) => {
    const day = String(startDay + index).padStart(2, "0");
    return {
      key: `2026-04-${day}`,
      label: `04/${day}`,
      isoDate: `2026-04-${day}`,
    };
  });

test.describe("timeline viewport helpers", () => {
  test("desktop window metrics keep render range overscanned around the viewport", async () => {
    const metrics = resolveDesktopTimelineWindowMetrics({
      scrollLeft: 960,
      viewportWidth: 1200,
      columnWidth: 240,
      loadedDayCount: 20,
      dayRange: 5,
      isInteractionActive: false,
    });

    expect(metrics.renderStartIndex).toBe(1);
    expect(metrics.renderEndIndex).toBe(12);
    expect(metrics.leftSpacerWidth).toBe(240);
    expect(metrics.rightSpacerWidth).toBe((20 - 12) * 240);
  });

  test("desktop anchor switches after the half-column threshold", async () => {
    const days = buildDays(4);

    expect(
      resolveDesktopTimelineAnchorIso({
        scrollLeft: 0,
        columnWidth: 240,
        loadedDays: days,
        threshold: ANCHOR_SWITCH_THRESHOLD,
      }),
    ).toBe("2026-04-01");

    expect(
      resolveDesktopTimelineAnchorIso({
        scrollLeft: 121,
        columnWidth: 240,
        loadedDays: days,
        threshold: ANCHOR_SWITCH_THRESHOLD,
      }),
    ).toBe("2026-04-02");
  });

  test("desktop and mobile adapters normalize to the shared viewport state", async () => {
    const days = buildDays(5);

    expect(
      adaptDesktopWindowStateToViewportState({
        anchorIso: "2026-04-03",
        windowStartIso: "2026-04-02",
        windowEndIso: "2026-04-04",
        nearLeftEdge: false,
        nearRightEdge: true,
        firstLoadedIso: "2026-04-01",
        lastLoadedIso: "2026-04-05",
      }),
    ).toEqual({
      anchorDayIso: "2026-04-03",
      windowStartIso: "2026-04-02",
      windowEndIso: "2026-04-04",
      nearLeadingEdge: false,
      nearTrailingEdge: true,
    });

    expect(
      adaptMobileTimelineViewStateToViewportState({
        days,
        anchorDayIso: "2026-04-03",
        eventsByDay: {},
        calendarEventsByDay: {},
        calendarAllDayByDay: {},
        abBuckets: {},
        overdue: [],
        indicatorTop: null,
        indicatorDayIso: null,
        activeDragCardId: null,
      }),
    ).toEqual({
      anchorDayIso: "2026-04-03",
      windowStartIso: "2026-04-02",
      windowEndIso: "2026-04-04",
      nearLeadingEdge: true,
      nearTrailingEdge: true,
    });
  });

  test("coordinator helpers derive stable prefetch spans and calendar range", async () => {
    const days = buildDays(8);
    const viewportState = deriveTimelineViewportStateFromAnchor({
      days,
      anchorDayIso: "2026-04-02",
      dayRange: 3,
    });

    const spans = buildDesktopTimelinePrefetchSpans({
      viewportState,
      loadedDays: days,
    });

    expect(spans).toEqual([
      {
        direction: "leading",
        startIso: "2026-03-25",
        endIso: "2026-03-31",
      },
    ]);
    expect(buildTimelinePrefetchSignature(spans[0]!)).toBe("leading:2026-03-25:2026-03-31");
    expect(buildCalendarWindowRangeFromViewportState(viewportState)).toEqual({
      windowStartIso: "2026-04-02",
      windowEndIso: "2026-04-04",
    });
  });

  test("mobile viewport resolver falls back to anchor-derived range and respects disabled state", async () => {
    const days = buildDays(6);

    expect(
      resolveMobileTimelineViewportState({
        enabled: false,
        days,
        anchorDayIso: "2026-04-03",
        dayRange: 3,
        eventsByDay: {},
        abBuckets: {},
        overdue: [],
        indicatorTop: null,
        indicatorDayIso: null,
      }),
    ).toEqual({
      anchorDayIso: null,
      windowStartIso: null,
      windowEndIso: null,
      nearLeadingEdge: false,
      nearTrailingEdge: false,
    });

    expect(
      resolveMobileTimelineViewportState({
        enabled: true,
        days,
        anchorDayIso: "2026-04-05",
        dayRange: 3,
        eventsByDay: {},
        abBuckets: {},
        overdue: [],
        indicatorTop: null,
        indicatorDayIso: null,
      }),
    ).toEqual({
      anchorDayIso: "2026-04-05",
      windowStartIso: "2026-04-04",
      windowEndIso: "2026-04-06",
      nearLeadingEdge: false,
      nearTrailingEdge: true,
    });
  });
});
