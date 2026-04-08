import { expect, test } from "@playwright/test";

import { resolveCheckedAtMutation } from "../lib/server/card-checked-at";

test.describe("resolveCheckedAtMutation", () => {
  test("false から true への遷移で checked_at を設定する", async () => {
    expect(
      resolveCheckedAtMutation({
        currentChecked: false,
        nextChecked: true,
        nowIso: "2026-04-08T12:34:56.000Z",
      }),
    ).toBe("2026-04-08T12:34:56.000Z");
  });

  test("true のまま別更新しても checked_at を変えない", async () => {
    expect(
      resolveCheckedAtMutation({
        currentChecked: true,
        nextChecked: true,
        nowIso: "2026-04-08T12:34:56.000Z",
      }),
    ).toBeUndefined();
  });

  test("再オープン時は checked_at を null に戻す", async () => {
    expect(
      resolveCheckedAtMutation({
        currentChecked: true,
        nextChecked: false,
        nowIso: "2026-04-08T12:34:56.000Z",
      }),
    ).toBeNull();
  });

  test("再完了時は新しい checked_at を返す", async () => {
    expect(
      resolveCheckedAtMutation({
        currentChecked: false,
        nextChecked: true,
        nowIso: "2026-04-09T09:00:00.000Z",
      }),
    ).toBe("2026-04-09T09:00:00.000Z");
  });
});
