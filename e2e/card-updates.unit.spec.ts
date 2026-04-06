import { expect, test } from "@playwright/test";

import { applyCardUpdate } from "../app/(board)/_utils/card-updates";
import type { TimelineResponse } from "../app/(board)/_utils/timeline-helpers";
import type { Card } from "../lib/supabase";

const createTimelineResponse = (): TimelineResponse => ({
  days: [
    {
      key: "2026-04-02",
      label: "Today 04/02 (Thu)",
      isoDate: "2026-04-02",
    },
  ],
  events: [],
  abBuckets: {
    "2026-04-02_a": [],
    "2026-04-02_b": [],
  },
  overdue: [],
  serverNow: "2026-04-02T03:00:00.000Z",
  startOffset: 0,
  range: 1,
});

const createCard = (overrides: Partial<Card> = {}): Card => ({
  id: "card-1",
  title: "Completed overdue card",
  checklist: null,
  content: { type: "doc", content: [] },
  excerpt: null,
  list_id: "list-1",
  board_id: "board-1",
  position: 1,
  user_id: "user-1",
  tags: ["urgent"],
  due_date: "2026-03-31T00:00:00.000Z",
  due_start: null,
  due_end: null,
  start_reminder_enabled: false,
  start_reminder_minutes: 0,
  end_reminder_enabled: false,
  end_reminder_minutes: 0,
  due_bucket: "a",
  due_bucket_position: 100,
  duration: 60,
  checked: false,
  assigned_to: null,
  assignee_id: null,
  assignee_ids: null,
  short_id: "C1",
  id_short: 1,
  slug: "completed-overdue-card",
  created_at: "2026-03-30T00:00:00.000Z",
  updated_at: "2026-03-30T00:00:00.000Z",
  ...overrides,
});

test.describe("applyCardUpdate", () => {
  test("期限切れカードを完了にしても検索元の overdue 集合から消さない", async () => {
    const prev = createTimelineResponse();

    const next = applyCardUpdate(prev, createCard({ checked: true }), "UPDATE");

    expect(next.overdue).toHaveLength(1);
    expect(next.overdue[0]?.card_id).toBe("card-1");
    expect(next.overdue[0]?.checked).toBe(true);
  });

  test("trashed card の realtime UPDATE は active view に再投入しない", async () => {
    const prev = applyCardUpdate(createTimelineResponse(), createCard({
      due_date: "2026-04-02T00:00:00.000Z",
      due_bucket: "b",
    }), "INSERT");

    const next = applyCardUpdate(prev, createCard({
      due_date: "2026-04-02T00:00:00.000Z",
      due_bucket: "b",
      deleted_at: "2026-04-07T00:00:00.000Z",
      purge_after_at: "2026-05-07T00:00:00.000Z",
    }), "UPDATE");

    expect(next.events).toHaveLength(0);
    expect(next.abBuckets["2026-04-02_b"]).toHaveLength(0);
    expect(next.overdue).toHaveLength(0);
  });
});
