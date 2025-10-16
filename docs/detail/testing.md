# Testing Guide

Taesk の E2E テストは Playwright を使用し、Supabase 認証を事前にセットアップしてから各シナリオを実行します。本ドキュメントは 2025-10-15 時点の構成に基づいています。

## 基本ルール

- **必ず JSON レポーターを使用**: `npx playwright test --reporter=json > playwright-report.json`
- **レポート解析はプログラムで**: Python や Node.js スクリプトで JSON を読み取り、成功/失敗の内訳を確認
- **`NODE_ENV=test` で dev サーバーを起動**: Playwright が自動起動する `npm run dev`
- **Supabase 認証をバイパスしない**: グローバルセットアップで正式にサインインし、`playwright/.auth/user.json` を利用

## 環境変数の設定

テスト実行には `.env.test` ファイルが必要です。以下の内容を含めてください:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=replace-with-your-supabase-service-role-key
E2E_ENABLED=true
E2E_SECRET=redacted-e2e-secret
E2E_USER_EMAIL=e2e.taesk.test@gmail.com
E2E_USER_PASSWORD=replace-with-local-test-password
```

**重要**: `playwright.config.ts` は起動時に自動的に `.env.test` を読み込みます。手動で環境変数を設定する必要はありません。

## 設定ファイル

`playwright.config.ts` の主要ポイント:

```typescript
import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

// Load .env.test before running tests
dotenv.config({ path: '.env.test' });

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  workers: process.env.CI ? 1 : 4,
  reporter: 'html', // CLI で --reporter=json を指定して上書きする
  globalSetup: require.resolve('./e2e/.setup/auth-global-setup'),
  use: {
    baseURL: 'http://localhost:3000',
    storageState: 'playwright/.auth/user.json',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'NODE_ENV=test npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});
```

- **`dotenv.config()`**: テスト実行前に `.env.test` を自動読み込み
- `globalSetup`: Supabase へメール+パスワードでサインインし、トークンを `playwright/.auth/user.json` に保存
- `storageState`: すべてのテストで同じセッションを再利用
- `workers`: CI は安定性優先で 1、本地は 4

## コマンド例

```bash
# JSON レポートを生成
npx playwright test --reporter=json > playwright-report.json

# jq でサマリーを表示（推奨）
cat playwright-report.json | jq '.stats'
# Output:
# {
#   "expected": 34,
#   "skipped": 0,
#   "unexpected": 0,
#   "flaky": 0
# }

# jq がない場合: tail + grep を使用
tail -20 playwright-report.json | grep -E '"(expected|unexpected|skipped|flaky)"'
# Output:
#     "expected": 34,
#     "skipped": 0,
#     "unexpected": 0,
#     "flaky": 0
```

## テスト分離戦略

`e2e/kanban.spec.ts` では **各テストごとにユニークなボードを作成** して干渉を防ぎます。

```typescript
test.beforeEach(async ({ page }) => {
  testBoardId = crypto.randomUUID();
  testBoardName = `Test-${testBoardId.slice(0, 8)}`;
  testBoardShortId = await createUniqueBoardShortId();
  testBoardIdShort = await getNextBoardIdShort();
  testBoardSlug = slugifyBoardName(testBoardName);

  await supabase.from('boards').insert({
    id: testBoardId,
    name: testBoardName,
    user_id: TEST_USER_ID,
    is_test_board: true,
    short_id: testBoardShortId,
    id_short: testBoardIdShort,
    slug: testBoardSlug,
  });

  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: /Board ▼/ }).click();
  await page.getByRole('button', { name: testBoardName }).click();
  await page.waitForURL(`**${testBoardCanonicalPath}`);
  await page.waitForTimeout(1500); // Realtime 受信準備
});

test.afterEach(async () => {
  await supabase.from('boards').delete().eq('id', testBoardId);
});
```

ポイント:
- `is_test_board: true` を必ず付与（デフォルトリスト自動生成を防止）
- `page.waitForURL` と `waitForTimeout` で Realtime の遅延を吸収
- 片付けは `afterEach` で実施（CASCADE により lists/cards も削除）

## ドラッグ & ドロップ

@dnd-kit は連続した `mousemove` が必要なため、Playwright の `page.mouse` API を使用して段階的に移動します。

```typescript
async function dragAndDrop(page: Page, source: Locator, target: Locator) {
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error('Source or target not visible');

  const startX = sourceBox.x + sourceBox.width / 2;
  const startY = sourceBox.y + sourceBox.height / 2;
  const endX = targetBox.x + targetBox.width / 2;
  const endY = targetBox.y + targetBox.height / 2;
  const midX = (startX + endX) / 2;
  const midY = (startY + endY) / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.waitForTimeout(250);
  await page.mouse.move(midX, midY, { steps: 10 });
  await page.mouse.move(endX, endY, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(500);
}
```

## ボード URL の検証

2025-10-15 時点では `updateURL` が canonical URL へ一度の遷移で更新するため、テストも canonical への到達のみ確認します。

```typescript
await page.getByRole('button', { name: `${testBoardName} ▼` }).click();
await page.getByRole('button', { name: defaultBoard!.name }).click();
await page.waitForURL(`**${defaultBoardCanonicalPath}`);
expect(new URL(page.url()).pathname).toBe(defaultBoardCanonicalPath);
```

## レポートの添付ファイル

失敗時は `test-results/<spec>/error-context.md` にページスナップショットが生成されます。`playwright-report.json` の `attachments` フィールドからパスを取得し、原因調査に活用してください。

---

最新更新日: 2025-10-15 / テスト総数: 34
