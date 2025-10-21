# Testing Guide

Taesk の E2E テストは Playwright を使用し、Supabase 認証を事前にセットアップしてから各シナリオを実行します。本ドキュメントは 2025-10-19 時点の構成に基づいています。

**最新情報（2025-10-19）**: Reorder API の E2E テストを追加し、合計テスト数が 50 件になりました。

## 基本ルール

- **`.env.test` ファイルが必須**: `playwright.config.ts` が起動時に自動読み込み（後述の「環境変数の設定」参照）
- **JSON レポーターで結果確認**: `npx playwright test --reporter=json > playwright-report.json`
- **レポート解析は `jq` コマンドで**: `cat playwright-report.json | jq '.stats'` でテスト結果を即座に確認（Python/Node.js 不要）
- **`NODE_ENV=test` で dev サーバーを起動**: Playwright が自動起動（`playwright.config.ts` で設定済み）
- **正式な Supabase 認証**: グローバルセットアップで自動サインインし、`playwright/.auth/user.json` にセッション保存

## 環境変数の設定（必須）

### `.env.test` ファイルの作成

テスト実行には **`.env.test` ファイルが必須**です。プロジェクトルートに以下の内容で作成してください：

```bash
# Supabase Configuration (本番環境と同じ)
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...  # 実際の anon key

# Supabase Service Role Key (テストユーザー作成に必要)
SUPABASE_SERVICE_ROLE_KEY=replace-with-your-supabase-service-role-key  # 実際の service role key

# E2E Testing Configuration
E2E_ENABLED=true
E2E_SECRET=redacted-e2e-secret  # 任意の秘密鍵
E2E_USER_EMAIL=e2e.taesk.test@gmail.com       # テスト用メールアドレス
E2E_USER_PASSWORD=replace-with-local-test-password            # テスト用パスワード
```

**重要なポイント**:
- ✅ `playwright.config.ts` が起動時に **自動的に** `.env.test` を読み込む（`dotenv.config({ path: '.env.test' })`）
- ✅ 手動で環境変数を設定する必要はありません
- ✅ `.env.test` は `.gitignore` に含まれているため Git にコミットされません
- ⚠️ `.env.example` をコピーして作成すると便利ですが、**実際の値に置き換える**必要があります

### 環境変数の取得方法

1. **Supabase URL & Anon Key**:
   - Supabase Dashboard → Settings → API → Project URL / anon public
2. **Service Role Key**:
   - Supabase Dashboard → Settings → API → service_role (⚠️ 秘密鍵、慎重に扱う)
3. **E2E_SECRET**:
   - 任意の文字列（例: `redacted-e2e-secret`）
4. **E2E_USER_EMAIL / PASSWORD**:
   - テスト用の認証情報（実在するメールアドレスである必要はありません）

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

## テスト実行方法

### 1. 前提条件の確認

```bash
# .env.test ファイルが存在することを確認
ls -la .env.test

# 存在しない場合は作成
cp .env.example .env.test
# → .env.test を編集して実際の値に置き換える
```

### 2. テストの実行

```bash
# すべてのテストを実行（JSON レポート生成）
npx playwright test --reporter=json > playwright-report.json

# 特定のテストファイルのみ実行
npx playwright test e2e/auth.spec.ts --reporter=json > playwright-report.json
npx playwright test e2e/kanban.spec.ts --reporter=json > playwright-report.json
npx playwright test e2e/reorder-api.spec.ts --reporter=json > playwright-report.json
```

### 3. テスト結果の確認

**推奨: `jq` コマンドを使用**

```bash
# jq でサマリーを表示
cat playwright-report.json | jq '.stats'

# 出力例（50 tests）:
# {
#   "expected": 50,
#   "skipped": 0,
#   "unexpected": 0,
#   "flaky": 0
# }
```

**`jq` がない場合: `tail` + `grep` を使用**

```bash
tail -20 playwright-report.json | grep -E '"(expected|unexpected|skipped|flaky)"'

# 出力例:
#     "expected": 50,
#     "skipped": 0,
#     "unexpected": 0,
#     "flaky": 0
```

**`jq` のインストール (推奨)**

```bash
# macOS
brew install jq

# Ubuntu/Debian
sudo apt-get install jq
```

### テスト成果物の管理

テスト実行により以下のファイルが生成されます（すべて `.gitignore` に含まれています）：

- `playwright-report.json` - テスト結果（JSON形式）
- `playwright/.auth/user.json` - 認証セッション（globalSetup で自動生成）
- `test-results/` - 失敗時のスクリーンショット・トレース
- `playwright-report/` - HTML レポート（`--reporter=html` 使用時）

これらのファイルはプロジェクトルートに生成されますが、Git には追跡されません。

### スキップされたテスト

**未実装機能のテストはスキップされています**（2025-10-21時点）：

| テストファイル | 機能 | スキップ理由 | 実装予定 |
|--------------|------|------------|---------|
| `e2e/phase3-invite.spec.ts` | メンバー招待機能 | Phase 3 未実装 | Phase 3 |

**詳細**:
- `phase3-invite.spec.ts` では `test.describe.skip()` を使用してテストスイート全体をスキップ
- ファイル内のコメントに未実装理由と有効化方法を記載
- 実装完了後、`.skip` を削除して有効化すること

**現在のテスト状況**:
- **全テスト数**: 50件
- **実行されるテスト**: 45件（phase3-invite.spec.tsの5件をスキップ）
- **期待される成功率**: 100%（45/45）

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
