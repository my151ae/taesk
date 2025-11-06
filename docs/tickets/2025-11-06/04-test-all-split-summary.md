# 2025-11-06 E2E テスト実行サマリー

- 実行コマンド: `npm run test:all-split`
- 実行時刻: 2025-11-06 16:31 JST 開始 / 約 12 分（CLI 停止は 10 分タイムアウト）
- 生成ログ: `test-results/logs/batch-execution-20251106-163143.log`

## 集計

| 状態 | 件数 |
| ---- | ---- |
| ✅ Passed | 49 |
| ❌ Failed | 12 |
| ⚠️ Flaky | 1 |
| ⏭️ Skipped | 15 |

Playwright JSON レポートは `test-results/batches/20251106-163143-*.json` に保存済み。

## 失敗シナリオ

### Kanban バッチ
- `should assign and clear card members (multi-assignee)` — `e2e/kanban.spec.ts:471`
  - エラー: メンバー候補ボタンのクリック待機がタイムアウト (`page.getByRole('button', { name: /e2e.taesk.test@gmail.com/i })`)
  - レポート: `test-results/batches/20251106-163143-kanban.json`

### Comments バッチ
すべて `test-results/batches/20251106-163143-comments.json` に記録。

- `should show Comments tab in card modal via ?card= route` — `comments.spec.ts:211`
- `should preserve card modal state on reload with ?card= query` — `comments.spec.ts:224`
- `should create a comment successfully` — `comments.spec.ts:238`
- `should edit and delete own comment` — `comments.spec.ts:256`
- `should support @mentions with TipTap editor @e2e:essential @feature:comments` — `comments.spec.ts:332`
- `should filter members by name when typing after @ @feature:comments` — `comments.spec.ts:419`
- `should save mentions as <@id> format but display as @name @feature:comments` — `comments.spec.ts:478`
- `should support full-width ＠ trigger @e2e:essential @feature:comments` — `comments.spec.ts:569`
- `should sync comments across multiple browser contexts` — `comments.spec.ts:679`
- `should load comments modal within performance budget @e2e:essential` — `comments.spec.ts:756`
- `should not redundantly fetch members on modal reopen @e2e:essential` — `comments.spec.ts:802`

主因は `openCardModalViaQuery` 内の `page.goto(...?card=<shortId>)` が `load` 待機でタイムアウトする点。ボード生成後の URL 遷移が完了しない挙動を要調査。

### Flaky
- `should support mixed full-width and half-width triggers @feature:comments` — `comments.spec.ts:631`
  - 1 回目失敗後にリトライ成功。改善余地あり。

## 補足
- JSON レポート／トレースなどの成果物は `test-results/` 以下に集約済み。
- ルート直下の旧レポートは `test-results/archive/20251106-163049-root-json/` に退避済み。
- `PLAYWRIGHT_JSON_OUTPUT_NAME` を指定せず実行した場合も `test-results/` 配下へ出力されるように環境を統一済み。
