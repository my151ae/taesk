# Testing Guide

Taesk の E2E テストは Playwright を使用し、Supabase 認証を事前にセットアップしてから各シナリオを実行します。本ドキュメントは 2025-10-15 時点の構成に基づいています。

## 基本ルール

- **必ず JSON レポーターを使用**: `npx playwright test --reporter=json > playwright-report.json`
- **レポート解析はプログラムで**: Python や Node.js スクリプトで JSON を読み取り、成功/失敗の内訳を確認
- **`NODE_ENV=test` で dev サーバーを起動**: Playwright が自動起動する `npm run dev`
- **Supabase 認証をバイパスしない**: グローバルセットアップで正式にサインインし、`playwright/.auth/user.json` を利用

## 設定ファイル

`playwright.config.ts` の主要ポイント:

```typescript
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

- `globalSetup`: Supabase へメール+パスワードでサインインし、トークンを `playwright/.auth/user.json` に保存
- `storageState`: すべてのテストで同じセッションを再利用
- `workers`: CI は安定性優先で 1、本地は 4

## コマンド例

```bash
# JSON レポートを生成
npx playwright test --reporter=json > playwright-report.json

# Python でサマリーを表示
python3 - <<'PY'
import json
from pathlib import Path
report = json.loads(Path('playwright-report.json').read_text())
totals = {'passed': 0, 'failed': 0, 'skipped': 0}
for project in report.get('suites', []):
    for suite in project.get('suites', []):
        for spec in suite.get('specs', []):
            for test in spec.get('tests', []):
                for result in test.get('results', []):
                    status = result.get('status')
                    totals[status if status in totals else 'failed'] += 1
print(totals)
PY
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
