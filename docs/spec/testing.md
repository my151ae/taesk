# Testing Guide (Timeline 版)

Timeline ボード移行後の Playwright 運用ルールをまとめます。全テストは **JSON レポート必須**、**単一ワーカー (PW_WORKERS=1)**、**Next.js dev サーバーを手動起動しない** という前提で実施します。

---

## 1. 基本ポリシー

- `npx playwright test --reporter=json` を常に使用し、`PLAYWRIGHT_JSON_OUTPUT_NAME` で出力先を `test-results/` 以下に指定する。
- `PW_WORKERS=1` を徹底。並列実行は禁止。`scripts/test-all-batches.sh` もシリアル実行。
- 認証状態は `playwright/.auth/user.json` に保存。失効時のみ削除して再ログインする。
- `npm run dev` や `NODE_ENV=test npm run dev` を直接叩かない。Playwright の `webServer.command` のみが Next.js dev サーバーを起動してよい。
- テストログ (`test-results/logs/*` / `test-results/batches/*.json`) は `docs/tickets/<date>` に貼り付け、失敗時は原因と再実行結果を記録する。

---

## 2. 推奨 `playwright.config.ts`

`playwright.config.ts` が SSOT です。設定を変更する場合は必ずそこを更新してください。

**最低限の要件**（運用ルールと一致させる）:
- `workers: 1`（`PW_WORKERS=1` の単一ワーカー運用）
- reporter は **JSON を必ず生成**（`PLAYWRIGHT_JSON_OUTPUT_NAME` を `test-results/` 配下へ）
- `webServer.command` は `NODE_ENV=test npm run dev`（Playwright 経由のみ許可）
- 成果物は `test-results/` 配下（`outputDir` は `test-results/artifacts` など）

---

## 3. 実行前チェック

1. `lsof -i :3000` で Next.js dev server が残っていないか確認。残っていたら `pkill -f 'node .*next dev'` → `pkill -f 'playwright test'` を順番に実行。
2. 直前の `test:all-split` が停止していた場合は `ps -Ao pid,ppid,pgid,command | grep test-all-batches` で孤立プロセスを掃除。
3. `.env.test` を最新値に更新（Supabase URL/Key、E2E ユーザー等）。
4. `playwright/.auth/user.json` を削除して再ログインした場合は README / docs/tickets に必ず記録する。

---

## 4. スクリプト一覧

`package.json`（Timeline 更新後）の主要スクリプト:

```json
{
  "test": "playwright test --project=core --grep @e2e:essential",
  "test:e2e": "playwright test",
  "test:auth": "playwright test e2e/auth.spec.ts --project=core",
  "test:timeline": "playwright test e2e/timeline.spec.ts --project=core",
  "test:reorder": "playwright test e2e/reorder-api.spec.ts --project=core",
  "test:comments": "playwright test e2e/comments.spec.ts --project=core",
  "test:notifications": "playwright test e2e/notifications.spec.ts --project=core",
  "test:permissions": "playwright test e2e/board-permissions.spec.ts --project=core",
  "test:rls": "playwright test e2e/rls.spec.ts --project=core",
  "test:summary": "cat test-results/playwright-report.json | jq '.stats'",
  "test:failed": "bash scripts/test-rerun-failed.sh",
  "test:all-split": "bash scripts/test-all-batches.sh"
}
```

- `test:timeline` は Timeline ビュー専用 spec を単体で実行。
- その他の `test:*` スクリプトはバッチ実行時と同じ `--project=core` を使用。
- 重い spec はタグで再分割して回す。現状は `test:comments:modal` / `test:comments:crud` / `test:comments:mentions` と `test:permissions:ui` / `test:permissions:api` を優先する。
- Team-first 権限モデル移行後は、permissions 系で `TEAM_MEMBERSHIP_REQUIRED`、`LAST_BOARD_OWNER_TRANSFER_REQUIRED`、pending board access の消化を重点確認する。

---

## 5. バッチ実行 (`npm run test:all-split`)

`scripts/test-all-batches.sh` が以下 7 バッチを順番に実行し、`test-results/batches/<timestamp>-<batch>.json` を生成します。

| 順番 | バッチ名 | コマンド | 主な検証内容 |
| --- | --- | --- | --- |
| 1 | `auth` | `npm run test:auth` | Supabase OAuth, session refresh |
| 2 | `timeline` | `npm run test:timeline` | Today/Tomorrow レンダリング、A/B リスト、`dumpClientMetrics('timeline')` |
| 3 | `comments` | `npm run test:comments` | CardModal コメント、@mentions、Realtime |
| 4 | `notifications` | `npm run test:notifications` | NotificationSettings、Web Push、quiet hours |
| 5 | `reorder` | `npm run test:reorder` | 並び替えAPIのバリデーション（DUPLICATE_POSITION 等） |
| 6 | `permissions` | `npm run test:permissions` | ShareDialog、role 変更、RBAC |
| 7 | `rls` | `npm run test:rls` | RLS policy 整合性 |

失敗バッチがあった場合は **そのバッチのみ再実行** → 成功後に `test:all-split` を再開。`comments` バッチの Flaky（`Unexpected end of JSON input`）は `docs/tickets/` に再実行ログを残してから続行する。

---

## 6. JSON レポート解析

- `npm run test:summary` で JSON の `.stats` を抽出。
- 失敗ケース（`unexpected`）を掘る場合は `scripts/test-rerun-failed.sh`（spec 抽出+再実行）や `jq` で参照する。
- バッチログ (`test-results/logs/batch-execution-*.log`) と合わせて `docs/tickets/<date>` に貼り付ける。
- `jq` が使えない環境では `tail -20 report.json | grep -E '"(expected|unexpected|skipped|flaky)"'` で最低限の統計を表示。

---

## 7. Spec 一覧とタグ

| ファイル | タグ | 目的 |
| --- | --- | --- |
| `auth.spec.ts` | `@e2e:essential` | ログイン/ログアウト、セッション復元 |
| `timeline.spec.ts` | `@feature:timeline`, `@e2e:essential` | Timeline ボードの Today/Tomorrow/A/B、メトリクス送信 |
| `comments.spec.ts` | `@feature:comments` | CardModal コメント、返信、@mentions |
| `notifications.spec.ts` | `@feature:notifications`, `@failure:notifications` | NotificationSettings、Web Push、quiet hours |
| `reorder-api.spec.ts` | `@feature:lists`, `@failure:validation` | 並び替え API、DUPLICATE_POSITION/UNKNOWN_ID など |
| `board-permissions.spec.ts` | `@feature:permissions` | ShareDialog、role 変更、Team switcher / Board selector |
| `rls.spec.ts` | `@e2e:essential` | Supabase RLS ポリシー |

### タグ指針

- `@e2e:essential` … CI 必須（auth / timeline / rls）。
- `@feature:*` … 機能単位の回帰テスト。
- `@failure:*` … 異常系。API バリデーションや quiet hours など。
- `@phase3`, `@wip` … CI 除外。コミット前に必ず削除。

### Team-first 追加観点

- Team 未所属ユーザーへ `board_members` を直接付与できないこと
- Team invite 受諾時に pending board access が idempotent に消化されること
- Team member 削除時に Board selector / Timeline から access が即座に消えること
- 最後の Board owner を Team から外そうとした場合、owner 移譲が必要というエラーが返ること

---

## 8. Timeline 特有の検証ポイント

- `timeline.spec.ts` は Supabase へ直接カードを upsert し、Today/Tomorrow 列の描画と `dumpClientMetrics(page, ['timeline'])` を確認する。`due_*` カラムが存在しない場合は `test.skip`。
- DnD や CardModal 操作は `useSyncQueue` を経由するため、Playwright で `waitForResponse('/api/cards/')` を観測し、`syncQueue` に pending が残らないか確認する。
- コメント/通知テストは Timeline UI のヘッダーから開くコンポーネントを操作するため、`page.getByRole('button', { name: 'Share' })` など Timeline 固有のラベルへ更新済み。

### 8.1 CardModal 本文 block action の補足

- Tiptap / ProseMirror の本文 block action は見た目 DOM の `> p` / `> h2` 件数より、保存 JSON と handle metadata を優先して検証する。
- autosave は debounce を前提に `expect.poll` で待ち、固定 `waitForTimeout` を検証の主手段にしない。
- 詳細な切り分け手順と推奨 assertion は [`./tiptap-block-action-testing.md`](./tiptap-block-action-testing.md) を参照する。

---

## 9. ログの残し方

1. `npm run test:all-split` 実行 → `test-results/logs/batch-execution-<timestamp>.log` を `docs/tickets/<date>/XX-*.md` へ貼り付け。
2. `test-results/batches/<timestamp>-<batch>.json` を必要に応じて圧縮し添付。
3. Flaky や失敗時は `PLAYWRIGHT_JSON_OUTPUT_NAME=... npx playwright test e2e/<file>.spec.ts --project=core --reporter=json` のコマンドログを記録。

---

## 10. 参考

- `scripts/test-all-batches.sh` … バッチ実行スクリプト。ポート 3000 チェックや JSON 出力名の付与を一括で行う。
- `docs/tickets/2025-11-10/01-test-all-split-summary.md` … 最新の実行例とフォーマット。

Timeline ボードの運用では Playwright JSON レポートを唯一の情報源とし、`docs/tickets/` にログと結果を残すことを徹底してください。
