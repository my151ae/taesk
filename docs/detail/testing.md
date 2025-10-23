# Testing Guide（正式版）

Taesk の Playwright テスト運用を **JSON レポート常時出力**・**タグ分割**・**CI／ローカル差分最小化**の方針に沿って整理したガイドです。`docs/tickets/2025-10-23/01-testing-strategy-tags.md` と内容を同期させています。

---

## 1. 基本ポリシー

- **JSON レポーターは常時出力**し、`PLAYWRIGHT_JSON_OUTPUT_NAME` でファイル名を切替可能。
- **CI** は `workers=1` / `retries=2`。ローカルは `workers` 未指定（必要なら `PW_WORKERS`）、`retries=0`。
- **レポーター**: CI は JSON のみ、ローカルは `list` + JSON + HTML（`open: 'never'`）。
- **認証**: `globalSetup` で正規ログインし、`playwright/.auth/user.json` を共有。`NEXT_PUBLIC_BYPASS_AUTH` は使用しない。
- **タグ運用**: `@e2e:essential`（最小経路）、`@feature:*`（機能別）、`@failure:*`（異常系）、`@phase3`、`@wip`。

---

## 2. 推奨 `playwright.config.ts`

```ts
import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

const isCI = !!process.env.CI;
const jsonOutput = process.env.PLAYWRIGHT_JSON_OUTPUT_NAME ?? 'playwright-report.json';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: !isCI,
  workers: process.env.PW_WORKERS ? Number(process.env.PW_WORKERS) : (isCI ? 1 : undefined),
  retries: isCI ? 2 : 0,

  reporter: isCI
    ? [['json', { outputFile: jsonOutput }]]
    : [['list'], ['json', { outputFile: jsonOutput }], ['html', { open: 'never' }]],

  use: {
    baseURL: 'http://localhost:3000',
    trace: isCI ? 'on-first-retry' : 'retain-on-failure',
    screenshot: 'only-on-failure',
    storageState: 'playwright/.auth/user.json',
    ...devices['Desktop Chrome'],
  },

  globalSetup: require.resolve('./e2e/.setup/auth-global-setup'),

  webServer: {
    command: 'NODE_ENV=test npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !isCI,
  },
});
```

> ※ 現在の `playwright.config.ts` が HTML レポータや `workers: 1` 固定になっている場合は、上記へ寄せて整合を取ってください。

---

## 3. 必須ファイルと事前準備

- `.env.test` をルートに配置（`dotenv.config` が自動読込）。
- `E2E_ENABLED=true` / Supabase keys など必要値を設定。
- `playwright/.auth/user.json` は `globalSetup` が自動生成（テスト前に削除しない）。

---

## 4. テスト実行パターン

| モード | コマンド例 | 用途 |
|---|---|---|
| **Essential** | `npx playwright test --project=core --grep @e2e:essential` | PR ゲート（CI） |
| Feature別 | `npx playwright test --project=core --grep @feature:lists` | 機能回帰 |
| Failure系 | `npx playwright test --project=core --grep @failure:` | 異常系検証 |
| 全体回帰 | `npx playwright test --project=full` | main/nightly |
| 直近失敗 | `npx playwright test --last-failed` | 再実行 |
| 変更分のみ | `npx playwright test --only-changed` | 修正差分確認 |

JSON 出力の確認:

```bash
npx playwright test --reporter=json > playwright-report.json
cat playwright-report.json | jq '.stats'
```

HTML レポート（ローカル補助）:

```bash
npx playwright show-report --host 127.0.0.1 --port 9323
```

---

## 5. タグ命名とファイル構成

- `e2e/kanban.spec.ts` … `@feature:lists` を中心に必須シナリオを保持。
- `e2e/reorder-api.spec.ts` … API 異常系は `@failure:reorder` などを付与。
- `e2e/comments.spec.ts`（旧 `phase3-comments`） … `@feature:comments` / `@failure:comments`。
- `e2e/notifications.spec.ts`（旧 `phase3-webpush`）。
- `e2e/invites.spec.ts`（旧 `phase3-invite`）。
- 追加予定: `board-permissions.spec.ts`（ShareDialog）。

---

## 6. Appendix A — 不足カバレッジ計画

1. **コメントの @メンション**（`comments.spec.ts`）
   - 候補表示 → 選択 → UUID 埋め込み（`@e2e:essential`）。
   - 不正 UUID は 400 + トースト（`@failure:comments`）。
2. **In-app 通知**（`notifications.spec.ts`）
   - 未読数インクリメント、既読でバッジ減少（`@e2e:essential`）。
   - API 失敗時のリカバリ（`@failure:notifications`）。
3. **ボード権限管理**（`board-permissions.spec.ts` 新規）
   - Member→Editor への昇格、Viewer 制限、メンバー削除。
   - 権限不足 403 の UI 表示（`@failure:permissions`）。

実装順序推奨: リネーム → コメント → 通知 → 権限 → Essential タグ見直し。

---

## 7. 運用チェックリスト

- [ ] `playwright.config.ts` が本ガイドと整合。
- [ ] CI が JSON レポートを保存し、`workers=1` / `retries=2` で動作。
- [ ] ローカルは `PW_WORKERS` で並列指定可能（既定は Playwright 任せ）。
- [ ] `.auth` を用いた正規ログインでテストが安定。
- [ ] タグの付与ルールが PR テンプレ / lint などで周知されている。

---

最終更新: 2025-10-23
