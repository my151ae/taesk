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
const workers = process.env.PW_WORKERS
  ? Number(process.env.PW_WORKERS)
  : (isCI ? 1 : undefined);
const jsonOutput = process.env.PLAYWRIGHT_JSON_OUTPUT_NAME ?? 'playwright-report.json';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: !isCI,
  forbidOnly: !!process.env.CI,
  retries: isCI ? 2 : 0,
  workers,
  outputDir: 'test-results',
  reporter: isCI
    ? [['json', { outputFile: jsonOutput }]]
    : [['list'], ['json', { outputFile: jsonOutput }], ['html', { open: 'never' }]],
  globalSetup: require.resolve('./e2e/.setup/auth-global-setup'),
  use: {
    baseURL: 'http://localhost:3000',
    trace: isCI ? 'on-first-retry' : 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    storageState: 'playwright/.auth/user.json',
  },
  projects: [
    {
      name: 'core',
      grepInvert: /@phase3|@wip/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'full',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'NODE_ENV=test npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !isCI,
  },
});
```

> ※ `projects` により `core`（@phase3/@wip除外）と `full`（全テスト）を使い分けます。`devices` 設定は各プロジェクトの `use` 内に配置。

---

## 3. 必須ファイルと事前準備

- `.env.test` をルートに配置（`dotenv.config` が自動読込）。
- `E2E_ENABLED=true` / Supabase keys など必要値を設定。
- `playwright/.auth/user.json` は `globalSetup` が自動生成（テスト前に削除しない）。

---

## 4. テスト実行パターン

### package.json スクリプト（推奨）

```json
{
  "test": "playwright test --project=core --grep @e2e:essential",
  "test:e2e": "playwright test",
  "test:feature:boards": "playwright test --project=core --grep @feature:boards",
  "test:feature:lists": "playwright test --project=core --grep @feature:lists",
  "test:feature:comments": "playwright test --project=core --grep @feature:comments",
  "test:feature:notifications": "playwright test --project=core --grep @feature:notifications",
  "test:failure": "playwright test --project=core --grep @failure:",
  "test:full": "playwright test --project=full",
  "test:summary": "cat playwright-report.json | jq '.stats'"
}
```

### コマンド例

| モード | コマンド | 用途 |
|---|---|---|
| **Essential** | `npm test` | PR ゲート（CI） |
| Feature別（boards） | `npm run test:feature:boards` | ボード機能回帰 |
| Feature別（lists） | `npm run test:feature:lists` | リスト機能回帰 |
| Feature別（comments） | `npm run test:feature:comments` | コメント機能回帰 |
| Feature別（notifications） | `npm run test:feature:notifications` | 通知機能回帰 |
| Failure系 | `npm run test:failure` | 異常系検証 |
| 全体回帰 | `npm run test:full` | main/nightly |
| サマリー確認 | `npm run test:summary` | JSON統計表示 |

### HTML レポート（ローカル補助）

```bash
npx playwright show-report --host 127.0.0.1 --port 9323
```

### JSON レポート解析（test-summary.js）

テスト結果の統計と失敗詳細（`issues` 配列含む）を見やすく表示：

```bash
# デフォルト（playwright-report.json を読み取り）
npm run test:summary

# カスタムレポートファイル指定
node test-summary.js path/to/custom-report.json

# 環境変数で指定
PLAYWRIGHT_JSON_OUTPUT_NAME=custom-report.json node test-summary.js
```

**出力内容**:
- ✅ 統計（Passed / Failed / Skipped / Flaky / Duration）
- ❌ 失敗テスト詳細（ファイル、行番号、タグ）
- ⚠️ バリデーションエラーの `issues` 配列（`DUPLICATE_POSITION`, `UNKNOWN_ID`, `CROSS_BOARD` など）

---

## 5. タグ命名とテストファイル構成

### ファイル一覧（2025-10-23 時点）

| ファイル | タグ | テスト数 | 説明 |
|---|---|---|---|
| **auth.spec.ts** | `@e2e:essential` | 5 | 認証・セッション管理 |
| **kanban.spec.ts** | `@feature:boards` | 37 | ボード・リスト・カード CRUD、D&D |
| **reorder-api.spec.ts** | `@feature:lists`, `@failure:validation` | 11 | リスト/カード並び替え API、異常系（DUPLICATE_POSITION, UNKNOWN_ID, CROSS_BOARD） |
| **comments.spec.ts** | `@feature:comments`, `@e2e:essential` | 8 | コメント CRUD、返信、@メンション |
| **notifications.spec.ts** | `@feature:notifications`, `@failure:notifications` | 6 | Web Push、In-app通知、バッジ |
| **board-permissions.spec.ts** | `@feature:boards`, `@failure:permissions` | 5 | ShareDialog、メンバー管理 |
| **invites.spec.ts** | `@phase3` | 5（スキップ） | 招待機能（未実装） |
| **rls.spec.ts** | `@e2e:essential` | 6 | RLS ポリシー検証 |

### 主要タグ

- **`@e2e:essential`**: CI必須の最小セット（認証、基本CRUD、セキュリティ、@メンション、通知バッジ）
- **`@feature:boards`**: ボード機能（Kanban、権限管理）
- **`@feature:lists`**: リスト並び替えAPI
- **`@feature:comments`**: コメント機能
- **`@feature:notifications`**: 通知機能
- **`@failure:*`**: 異常系テスト（validation、permissions、notificationsなど）
- **`@phase3`**: 未実装機能（スキップ対象）
- **`@wip`**: 作業中テスト（CI除外）

---

## 6. テストカバレッジ概要

### 実装済み機能（2025-10-23）

✅ **認証・セッション** (auth.spec.ts)
- Google OAuth リダイレクト、エラーハンドリング

✅ **ボード・リスト・カード** (kanban.spec.ts)
- CRUD操作、ドラッグ&ドロップ、オフライン同期、URL正規化

✅ **リスト/カード並び替え API** (reorder-api.spec.ts)
- トランザクション更新、重複ID検証、UUID形式検証

✅ **コメント機能** (comments.spec.ts)
- コメント投稿・編集・削除、返信機能
- **@メンション**: タイプアヘッド、UUID v4検証、リアルタイム同期

✅ **通知機能** (notifications.spec.ts)
- Web Push設定、Quiet Hours、テスト通知送信
- **In-app通知**: 未読バッジ表示、既読マーク、空状態ハンドリング

✅ **ボード権限管理** (board-permissions.spec.ts)
- ShareDialog表示、メンバーロール変更、メンバー削除
- オーナーロール保護、権限エラーハンドリング

✅ **RLS セキュリティ** (rls.spec.ts)
- Row Level Security ポリシー検証、マイグレーション確認

### 未実装機能（@phase3）

⏸️ **招待機能** (invites.spec.ts)
- 招待リンク生成、既存ユーザー招待（実装待ち）

---

## 7. 運用チェックリスト

- [ ] `playwright.config.ts` が本ガイドと整合。
- [ ] CI が JSON レポートを保存し、`workers=1` / `retries=2` で動作。
- [ ] ローカルは `PW_WORKERS` で並列指定可能（既定は Playwright 任せ）。
- [ ] `.auth` を用いた正規ログインでテストが安定。
- [ ] タグの付与ルールが PR テンプレ / lint などで周知されている。

---

最終更新: 2025-10-23
