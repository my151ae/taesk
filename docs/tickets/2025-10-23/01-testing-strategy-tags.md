# 01. テスト戦略（タグ分割）— 正式版

**目的**: CI とローカルの運用差を最小化しつつ、**タグ分割**で「最小必須」「機能別」「異常系」の 3 モードを切り替えられるようにする。**JSON レポートを標準**とし、ダッシュボード等の二次利用を容易にする。

---

## 決定事項（Single Source of Truth）

- **レポーター**: **JSON は常に出力**。ローカルでは補助として `list` と `html` を併用可（自動オープンはしない）。
- **retries**: **CI=2**, **Local=0**。
- **workers**: **CI=1**, **Local=既定（並列）**。環境変数 `PW_WORKERS` で上書き可。
- **認証**: **グローバルに `NEXT_PUBLIC_BYPASS_AUTH` は使わない**。グローバルセットアップで正規ログインし、`.auth` を使う。

上記に合わせた **`playwright.config.ts` 推奨例**（差分適用用）:

```ts
// playwright.config.ts
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

> **メモ**: 既存の `playwright.config.ts` が別挙動（例: HTML デフォルト、workers:1 固定、Local retries:1 等）になっている場合は、上記へ寄せるか、逆に本書の値を合わせてください。**本書は上記値を正**とします。

---

## タグ規約

| タグ | 用途 | 例 |
|---|---|---|
| `@e2e:essential` | CI 常時実行の最小セット | smoke、クリティカルフロー |
| `@feature:*` | 機能別（`lists`, `cards`, `notifications` など） | `@feature:lists` |
| `@failure:*` | 失敗時再現/異常系 | `@failure:network`, `@failure:validation` |
| `@phase3` | 未実装/将来予定の一時退避 | 招待機能 等 |
| `@wip` | 作業中で CI から一時除外 | 部分実装の途中 |

### 実行パターン

- **必須セット（CI デフォルト）**  
  ```bash
  npx playwright test --project=core --grep @e2e:essential
  ```

- **機能別**  
  ```bash
  npx playwright test --project=core --grep @feature:lists
  ```

- **異常系のみ**  
  ```bash
  npx playwright test --project=core --grep @failure:
  ```

- **フル回帰**（定期/手動）  
  ```bash
  npx playwright test --project=full
  ```

---

## JSON レポート運用

- **標準出力**: `playwright-report.json`（ファイル名は `PLAYWRIGHT_JSON_OUTPUT_NAME` で上書き可）  
  ```bash
  npx playwright test --reporter=json > playwright-report.json
  node test-summary.js
  # もしくは jq:
  cat playwright-report.json | jq '.stats'
  ```

- **HTML レポート**（ローカル補助。`reporter` に html を登録済みなら `show-report` が使えます）  
  ```bash
  npx playwright show-report --host 127.0.0.1 --port 9323
  ```

> **CI では JSON が必須**。HTML はオプション扱い（保存/公開の要不要はジョブ設計側で決定）。

---

## 推奨ディレクトリ/命名

- `e2e/` 直下に機能別ファイルを配置  
  - `kanban.spec.ts`（@feature:lists を含む）
  - `reorder-api.spec.ts`（API 異常系は `@failure:validation` 等を付与）
  - `comments.spec.ts`（旧 `phase3-comments.spec.ts` をリネーム）
  - `notifications.spec.ts`（旧 `phase3-webpush.spec.ts` をリネーム）
  - `invites.spec.ts`（旧 `phase3-invite.spec.ts` をリネーム）

---

## Appendix A. 不足カバレッジの追加計画（旧 02 の統合）

1) **@メンション（comments.spec.ts に追加）**  
   - タイプアヘッド: `@` → 部分一致 → Enter 決定  
   - UUID 検証: 送信 Payload の `user_id` が UUID v4 形式  
   - Realtime: 返信・編集の反映確認  
   - タグ: `@feature:comments` / `@e2e:essential`（P0 経路のみ）

2) **In-app 通知（notifications.spec.ts）**  
   - `NotificationsBell` の未読/既読  
   - 既読反映（バッジの消滅）  
   - タグ: `@feature:notifications` / 異常系は `@failure:notifications`

3) **ボード権限管理（board-permissions.spec.ts 新規）**  
   - `ShareDialog` 表示、role 変更、メンバー削除  
   - 招待リンク（未実装機能は `@phase3` で退避）  
   - タグ: `@feature:boards` / 重要経路は `@e2e:essential`

### 実行モードのガイド

- **Essential**: `--grep @e2e:essential`
- **Feature-wise**: `--grep @feature:<name>`
- **Failure-wise**: `--grep @failure:`
- **All**: `--project=full`

---

## 参考スニペット

**`package.json`**（例）
```jsonc
{
  "scripts": {
    "test": "playwright test --project=core --grep @e2e:essential",
    "test:feature:lists": "playwright test --project=core --grep @feature:lists",
    "test:failure": "playwright test --project=core --grep @failure:",
    "test:full": "playwright test --project=full",
    "test:summary": "node test-summary.js"
  }
}
```

**`test-summary.js`**（最小）
```js
const fs = require('fs');
const path = process.env.PLAYWRIGHT_JSON_OUTPUT_NAME || 'playwright-report.json';
const report = JSON.parse(fs.readFileSync(path, 'utf8'));
console.log(report.stats || report);
```

---

## 運用チェックリスト

- [ ] CI で `reporter=json` 出力が保存され、アーティファクト化される
- [ ] CI で `retries=2 / workers=1`
- [ ] Local で `retries=0 / workers=(既定またはPW_WORKERS)`
- [ ] `NEXT_PUBLIC_BYPASS_AUTH` をグローバルに使っていない（`.auth` で正規ログイン）
- [ ] タグ体系（`@e2e:essential` / `@feature:*` / `@failure:*` / `@phase3` / `@wip`）が lint/PR テンプレで案内される
