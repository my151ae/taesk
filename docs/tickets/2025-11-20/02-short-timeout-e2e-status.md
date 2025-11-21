# 01 - 分割実行テスト状況（短タイムアウト）

## 実行方針
- Timeline 仕様へ未対応の spec を切り出し、`PWTEST_TIMEOUT=20000` (20s) で短期収束。
- 各 spec ごとに `PW_WORKERS=1` / JSON レポート (`PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/batches/20251120-*-short.json`) を必ず出力。
- Playwright webServer が Next.js dev サーバーを起動するため、実行前に `pkill -f 'node .*next dev'` → `lsof -i :3000` でポート整理。

## 実行コマンド

```bash
# comments
PW_WORKERS=1 PWTEST_TIMEOUT=20000 \
PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/batches/20251120-comments-short.json \
npx playwright test e2e/comments.spec.ts --project=core --reporter=json

# notifications（max 1 failure）
PW_WORKERS=1 PWTEST_TIMEOUT=20000 \
PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/batches/20251120-notifications-short.json \
npx playwright test e2e/notifications.spec.ts --project=core --timeout=20000 --max-failures=1 --reporter=json

# permissions（max 1 failure）
PW_WORKERS=1 PWTEST_TIMEOUT=20000 \
PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/batches/20251120-permissions-short.json \
npx playwright test e2e/board-permissions.spec.ts --project=core --timeout=20000 --max-failures=1 --reporter=json
```

## 結果サマリー

| Spec | 状態 | Test File | Status | Notes |
| :--- | :--- | :--- |
| `e2e/comments.spec.ts` | ❌ Failed | `TimeoutError` waiting for `[data-testid="ab-card-*"]`. Cards are not appearing in the Timeline view as expected by the test. |
| `e2e/notifications.spec.ts` | ✅ Passed | Fixed by updating locators to use `data-testid`. |
| `e2e/board-permissions.spec.ts` | ❌ Failed | Share dialog tests failing. `should display ShareDialog`, `should remove board member`, etc. |

## 状況整理とTODO

1. **Comments spec**  
   - `loadBoard` を Timeline 用に刷新（例: `[data-testid="timeline-event"]` もしくは `[data-testid="ab-card-*"]` を待機）。  
   - Kanban 固有操作（リストハードコード、`cardOpenButton-` など）を Timeline の DOM (`data-testid="timeline-event"`, `CardModal` 経由) に合わせて全面改修。

2. **Notifications spec**  
   - Timeline ヘッダーではボタンラベルが「Notification Settings」から変更されているため、`getByRole` ターゲットを実際の UI 文言 or `data-testid` (`test id` 付与を検討) へ差し替え。  
   - 以降のステップも Timeline UI に合わせて DOM/待機を確認する。

3. **Permissions spec**  
   - ShareDialog のトリガーコンポーネントが Timeline ヘッダーに移動している。`page.getByRole('button', { name: 'Share' })` 等、現行ラベルと一致するロケータへ更新。  
   - モーダル内のメンバーリスト取得も Kanban 前提が残っていないか確認・修正。

4. **共通**  
   - 各 spec 修正後に再び短タイムアウトで個別実行 → `docs/tickets/2025-11-20` へ継続記録。  
   - Timeline DOM を安定参照できる `data-testid` を必要箇所に追加検討（NotificationSettings ボタン、BoardHeader の Share ボタン、Timeline column など）。

次アクションは Comments → Notifications → Permissions の順で DOM 更新とテスト修正に着手する。JSON レポートはすべて `test-results/batches/20251120-*-short.json` に保存済み。***
