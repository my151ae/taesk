# Testing Guide（正式版）

Taesk の Playwright テスト運用を **JSON レポート常時出力**・**タグ分割**・**CI／ローカル差分最小化**の方針に沿って整理したガイドです。`docs/tickets/2025-10-23/01-testing-strategy-tags.md` と内容を同期させています。

---

## 1. 基本ポリシー

- **JSON レポーターは常時出力**し、`PLAYWRIGHT_JSON_OUTPUT_NAME` でファイル名を切替可能（ファイル名のみを指定した場合でも `test-results/` 配下に保存）。
- **CI** は `workers=1` / `retries=2`。ローカルは `workers` 未指定（必要なら `PW_WORKERS`）、`retries=0`。
- **レポーター**: CI は JSON のみ、ローカルは `list` + JSON + HTML（`open: 'never'`）。
- **認証**: `globalSetup` で正規ログインし、`playwright/.auth/user.json` を共有。`NEXT_PUBLIC_BYPASS_AUTH` は使用しない。
- **タグ運用**: `@e2e:essential`（最小経路）、`@feature:*`（機能別）、`@failure:*`（異常系）、`@phase3`、`@wip`。

---

## 2. 推奨 `playwright.config.ts`

```ts
import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: '.env.test' });

const isCI = !!process.env.CI;
const workers = process.env.PW_WORKERS
  ? Number(process.env.PW_WORKERS)
  : (isCI ? 1 : undefined);
const defaultJsonOutput = path.join('test-results', 'playwright-report.json');
const jsonOutput = process.env.PLAYWRIGHT_JSON_OUTPUT_NAME ?? defaultJsonOutput;

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
  "test": "playwright test --project=core --grep @e2e:essential --reporter=list --reporter=json",
  "test:e2e": "playwright test",
  "test:auth": "playwright test e2e/auth.spec.ts --project=core --reporter=list --reporter=json",
  "test:kanban": "playwright test e2e/kanban.spec.ts --project=core --reporter=list --reporter=json",
  "test:reorder": "playwright test e2e/reorder-api.spec.ts --project=core --reporter=list --reporter=json",
  "test:comments": "playwright test e2e/comments.spec.ts --project=core --reporter=list --reporter=json",
  "test:notifications": "playwright test e2e/notifications.spec.ts --project=core --reporter=list --reporter=json",
  "test:permissions": "playwright test e2e/board-permissions.spec.ts --project=core --reporter=list --reporter=json",
  "test:rls": "playwright test e2e/rls.spec.ts --project=core --reporter=list --reporter=json",
  "test:feature:boards": "playwright test --project=core --grep @feature:boards --reporter=list --reporter=json",
  "test:feature:lists": "playwright test --project=core --grep @feature:lists --reporter=list --reporter=json",
  "test:feature:comments": "playwright test --project=core --grep @feature:comments --reporter=list --reporter=json",
  "test:feature:notifications": "playwright test --project=core --grep @feature:notifications --reporter=list --reporter=json",
  "test:failure": "playwright test --project=core --grep @failure: --reporter=list --reporter=json",
  "test:full": "playwright test --project=full --reporter=list --reporter=json",
  "test:summary": "cat test-results/playwright-report.json | jq '.stats'",
  "test:failed": "bash scripts/test-rerun-failed.sh",
  "test:all-split": "bash scripts/test-all-batches.sh"
}
```

**新機能**:
- **ファイル別テスト**: `test:auth`, `test:kanban`, `test:comments` など、各テストファイルを個別に実行可能
- **バッチ実行**: `test:all-split` で全テストをファイル単位で順次実行し、結果を集約（タイムアウト対策）
- `test:failed` は直前の JSON レポートから `status: "unexpected"` が含まれる spec を抽出し、対象ファイルだけを `--reporter=json` で再実行します。`scripts/test-rerun-failed.sh` を直接呼び出すことで、レポートファイルや出力先を `--report`, `--output`, `--project` オプションで上書きできます。

### コマンド例

| モード | コマンド | 用途 |
|---|---|---|
| **Essential** | `npm test` | PR ゲート（CI） |
| **全テスト（バッチ）** | `npm run test:all-split` | タイムアウト回避・ファイル別順次実行 |
| ファイル別 - 認証 | `npm run test:auth` | 認証テストのみ |
| ファイル別 - ボード | `npm run test:kanban` | ボード・リスト・カード CRUD |
| ファイル別 - 並替API | `npm run test:reorder` | 並び替えエンドポイント |
| ファイル別 - コメント | `npm run test:comments` | コメント・@メンション |
| ファイル別 - 通知 | `npm run test:notifications` | 通知機能 |
| ファイル別 - 権限 | `npm run test:permissions` | ボード権限 |
| ファイル別 - RLS | `npm run test:rls` | RLS ポリシー |
| Feature別（boards） | `npm run test:feature:boards` | ボード機能回帰（タグベース） |
| Feature別（lists） | `npm run test:feature:lists` | リスト機能回帰（タグベース） |
| Feature別（comments） | `npm run test:feature:comments` | コメント機能回帰（タグベース） |
| Feature別（notifications） | `npm run test:feature:notifications` | 通知機能回帰（タグベース） |
| Failure系 | `npm run test:failure` | 異常系検証 |
| 全体回帰 | `npm run test:full` | main/nightly（全テスト一括） |
| サマリー確認 | `npm run test:summary` | JSON統計表示 |

### HTML レポート（ローカル補助）

```bash
npx playwright show-report --host 127.0.0.1 --port 9323
```

### JSON レポート解析（test-summary.js）

テスト結果の統計と失敗詳細（`issues` 配列含む）を見やすく表示：

```bash
# デフォルト（test-results/playwright-report.json を読み取り）
npm run test:summary

# カスタムレポートファイル指定
node test-summary.js path/to/custom-report.json

# 環境変数で指定
# ファイル名のみ指定しても test-results/custom-report.json として保存・読み込みされる
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

## 7. テスト安定化のベストプラクティス（2025-10-28更新）

### ✅ 実装済みの安定化策

#### 1. **一意ボードによるテスト分離**
```typescript
// 各テストで独立したボードを作成
test.beforeEach(async ({ page }) => {
  testBoardId = crypto.randomUUID();
  testBoardName = `Test-${testBoardId.slice(0, 8)}`;
  // ... ボード作成
});

test.afterEach(async () => {
  // テスト後にクリーンアップ（CASCADE削除）
  await supabase.from('boards').delete().eq('id', testBoardId);
});
```

**効果**: テスト間のデータ競合を完全に排除。

#### 2. **Realtime の無効化（テスト環境）**
```bash
# .env.test
NEXT_PUBLIC_DISABLE_REALTIME=true
```

```typescript
// KanbanBoardClient.tsx
if (process.env.NEXT_PUBLIC_DISABLE_REALTIME === 'true') {
  console.log('[Realtime] Disabled via NEXT_PUBLIC_DISABLE_REALTIME flag');
  setRealtimeStatus('disconnected');
  return;
}
```

**効果**: クロステスト干渉を防止。

#### 3. **精密なセレクタ**
```typescript
// ❌ 二重マッチングの危険性
const lists = page.locator('[data-testid^="list-"]');
// → `list-${id}` と `list-${id}-dropzone` の両方にマッチ

// ✅ コンテナのみにマッチ
const lists = page.locator('[data-type="list"]');
```

**効果**: 期待値との不一致を防止。

#### 4. **Drag エラー時のロールバック**
```typescript
// KanbanBoardClient.tsx - handleDragEnd
const previousData: BoardData = {
  lists: [...boardData.lists],
  cards: [...boardData.cards],
};

// ... D&D処理

try {
  await syncToSupabase(newData);
} catch (error) {
  // 失敗時に元の状態に復元
  updateData(previousData);
  console.error('Sync failed, rolled back:', error);
}
```

**効果**: API失敗時に UI が壊れない。

#### 5. **Position 正規化（1000/10 ルール）**
```typescript
// initializeDefaultLists & handleAddList
const START_POSITION = 1000;
const GAP = 10;
const position = START_POSITION + (boardData.lists.length * GAP);
// → 1000, 1010, 1020, ...
```

**効果**: 予測可能な位置値、ドラッグ＆ドロップの安定性向上。

### セレクタガイドライン

| 用途 | 推奨セレクタ | 理由 |
|------|------------|------|
| リストコンテナ | `[data-type="list"]` | dropzone を除外 |
| 特定リスト | `[data-testid="list-${id}"]` | ID指定で一意 |
| リストタイトル入力 | `[data-testid="list-title-input-${id}"]` | 編集中の状態を検証 |
| カード | `[data-testid="card-${id}"]` | カード固有ID |

---

## 8. 運用チェックリスト

- [x] `playwright.config.ts` が本ガイドと整合。
- [x] CI が JSON レポートを保存し、`workers=1` / `retries=2` で動作。
- [x] ローカルは `PW_WORKERS` で並列指定可能（既定は Playwright 任せ）。
- [x] `.auth` を用いた正規ログインでテストが安定。
- [x] タグの付与ルールが PR テンプレ / lint などで周知されている。
- [x] 一意ボード作成によりテスト分離を実現。
- [x] Realtime 無効化でクロステスト干渉を防止。
- [x] セレクタは `[data-type="list"]` などの精密なものを使用。
- [x] Drag エラー時のロールバック実装済み。
- [x] Position 正規化（1000/10）実装済み。

---

最終更新: 2025-10-28
