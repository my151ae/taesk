# Playwright用「プログラマティックサインイン」実装計画（Option ②）

> 目的：認証は**有効のまま**、E2E開始時に**ログイン済みの状態（storageState）**を作成して全テストで再利用する。二重webServer不要／`NEXT_PUBLIC_BYPASS_AUTH`不要。

---

## 全体像

- **globalSetup** でログイン処理を1回だけ実行し、`playwright/.auth/user.json` に保存。
- 各テストは `use.storageState` を参照して**常にログイン済み**で開始。
- 認証方式は以下のどちらでも運用可能：
  - **A. Supabase Auth**: `signInWithPassword` を**テスト専用API**から呼び出す → `storageState` にCookie/LocalStorageを保存。
  - **B. NextAuth/OAuth**: UIフローを辿らず、**テスト専用API**でセッション発行（またはモックCredential）→ `storageState` に保存。

> 既存のフラキネス（Realtime干渉）は本計画の外だが、別途「テストボードの動的発行（Option A）」と併用すると恒久安定化が早い。

---

## ディレクトリ構成（提案）

```
/ (repo root)
├─ playwright.config.ts
├─ playwright/
│  └─ .auth/
│     └─ user.json          # globalSetupで生成
├─ tests/
│  ├─ .setup/
│  │  └─ auth-global-setup.ts
│  └─ e2e/
│     ├─ auth.spec.ts
│     └─ kanban.spec.ts
└─ app/ or src/  (Next.js)
   └─ app/api/__e2e__/
      ├─ login-as/route.ts  # 認証セッション生成
      └─ ensure-user/route.ts  # テストユーザーの作成（Supabase Adminなど）
```

---

## 実装手順（Step-by-Step）

### 1) Playwright 設定

**`playwright.config.ts`**（抜粋）
```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  // 並列度は現状の安定度に合わせて調整（CIはまず1推奨）
  workers: process.env.CI ? 1 : undefined,

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
    storageState: 'playwright/.auth/user.json',
    ...devices['Desktop Chrome'],
  },

  // ここで dev サーバ起動する場合は、従来の Bypass フラグは不要
  // webServer: { command: 'pnpm dev', url: 'http://localhost:3000', reuseExistingServer: !process.env.CI },

  globalSetup: require.resolve('./tests/.setup/auth-global-setup'),
});
```

> すでに dev サーバ起動をCI側で行っているなら `webServer` は不要。ローカルではUIモードから`setup`を単発実行してもOK。

---

### 2) テスト専用API（App側）

#### 2-1) 共通：強いガード
- **環境変数フラグ**と**シークレットヘッダ**の**両方**を満たすときのみ有効化。
- 例）`.env.local`：
```
E2E_ENABLED=true
E2E_SECRET=super-secret
```

**ヘルパ** `app/api/__e2e__/guards.ts`
```ts
import { NextRequest } from 'next/server';

export function assertE2EEnabled(req: NextRequest) {
  const enabled = process.env.E2E_ENABLED === 'true';
  const secret  = process.env.E2E_SECRET;
  const header  = req.headers.get('x-e2e-secret');
  if (!enabled || !secret || header !== secret) {
    throw new Error('E2E disabled');
  }
}
```

#### 2-2) Supabase版

**テストユーザー作成** `app/api/__e2e__/ensure-user/route.ts`
```ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertE2EEnabled } from '../guards';

export async function POST(req: NextRequest) {
  try {
    assertE2EEnabled(req);

    const { email, password } = await req.json();

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // 既存ならスキップ
    const existing = await supabaseAdmin.auth.admin.listUsers();
    if (existing.data.users?.some(u => u.email === email)) {
      return NextResponse.json({ created: false }, { status: 200 });
    }

    const created = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw created.error;

    return NextResponse.json({ created: true }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 401 });
  }
}
```

**サインイン & セッション保持** `app/api/__e2e__/login-as/route.ts`
```ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertE2EEnabled } from '../guards';

export async function POST(req: NextRequest) {
  try {
    assertE2EEnabled(req);
    const { email, password } = await req.json();

    // ドメイン＝アプリ本体と一致させる
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { detectSessionInUrl: false } }
    );

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;

    // セッションは通常 LocalStorage に保持されるため、
    // Playwright 側で storageState にも反映される（UI経由不要）
    // APIのレスポンスとして session を返す（後述のglobalSetupで localStorage へブリッジ）
    return NextResponse.json({ session: data.session }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 401 });
  }
}
```

> 備考：アプリが**Cookieベース**でセッションを発行している場合は、ここで `Set-Cookie` を返す。

#### 2-3) NextAuth版（Credential or テスト用セッション）
- NextAuthを利用中でUIフローが複雑な場合、**テスト専用Credential**を作成して `/api/__e2e__/login-as` で `signIn('credentials', ...)` 相当を実行し、**サーバが `Set-Cookie`** を返す方式が堅実。
- OAuthのみの場合は**テスト専用のバックドア**（上記ガード＋限定ユーザー）で `session` を直接生成して `Set-Cookie`。

---

### 3) globalSetup（Playwright）

**`tests/.setup/auth-global-setup.ts`**
```ts
import { request, FullConfig } from '@playwright/test';
import fs from 'node:fs/promises';

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
const E2E_SECRET = process.env.E2E_SECRET!;

const TEST_USER = {
  email: process.env.E2E_USER_EMAIL || 'e2e@example.com',
  password: process.env.E2E_USER_PASSWORD || 'P@ssw0rd!'
};

export default async function globalSetup(_cfg: FullConfig) {
  const ctx = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { 'x-e2e-secret': E2E_SECRET } });

  // 1) テストユーザーを確実に用意
  await ctx.post('/api/__e2e__/ensure-user', { data: TEST_USER });

  // 2) サインイン
  const loginRes = await ctx.post('/api/__e2e__/login-as', { data: TEST_USER });
  const { session } = await loginRes.json();

  // --- Supabaseのように LocalStorage を使う場合 ---
  // storageState は Cookie + LocalStorage を含む。LocalStorage を確実に入れるには、
  // ドメイン配下の一時ページにアクセスして localStorage に書き込む。
  const tmp = await ctx.get('/'); // placeholder: UI contextでの注入に差し替え可

  // 3) 現在の状態を保存
  await ctx.storageState({ path: 'playwright/.auth/user.json' });
  await ctx.dispose();
}
```

> 注：アプリが**Cookieベース**なら上記で十分。**LocalStorage/SessionStorageベース**の場合は、必要に応じて `browser.newContext()` + `page.evaluate(() => localStorage.setItem(...))` で**直接書き込んでから** `storageState` を保存するヘルパに差し替え可。

---

### 4) テストでの利用

- すべてのE2Eでログイン前提なら、何も変更不要（`storageState`が効く）。
- 「未ログインケース」を含むファイルだけ、明示的に Storage をリセット：

```ts
// tests/e2e/auth.spec.ts
import { test, expect } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } }); // このファイルは未ログイン前提

test('should redirect to login when not authenticated', async ({ page }) => {
  await page.goto('/protected');
  await expect(page).toHaveURL(/\/login/);
});
```

---

## セキュリティ & 運用

- **テスト専用APIは本番で無効化**（`E2E_ENABLED=false`）。
- **シークレットヘッダ必須**（`x-e2e-secret`）。CIでは**Secret**として安全に注入。
- **サービスロールキーはサーバ側のみ**で使用（クライアントに露出させない）。
- **期限切れ**：`user.json` は長期保存せず、**毎回生成**（CI）/ UIモードでは手動更新でも可。
- **並列**：同一アカウントの多重ログインがNGな場合、`e2e+{worker}@example.com` を**ワーカー数だけ**用意し、`testInfo.workerIndex` で切替。

---

## 検証チェックリスト（Doneの定義）

- [ ] `pnpm dev` 起動 → `npx playwright test --project=setup` 実行で `playwright/.auth/user.json` が生成される（任意の簡易`setup`プロジェクトを使う場合）。
- [ ] `npx playwright test` 実行で、**auth系以外の全テストがログイン済みでスタート**。
- [ ] `auth.spec.ts`（未ログイン想定）は `test.use({ storageState: { cookies: [], origins: [] } })` で独立して通る。
- [ ] CI（workers:1 から開始）で成功率 95% 以上。

---

## 既存課題との整合

- **Authテスト失敗**：`NEXT_PUBLIC_BYPASS_AUTH` を廃止し、`storageState` に切替えるため影響解消。
- **Realtime干渉**：本計画外。別ドキュメントの「Option A：テストボード動的生成」を並行実装推奨。
- **DnDテスト**：上記のデータ分離が入れば有効化可能。Playwrightの `locator.dragTo` / `mouse.move(...,{steps})` の併用を推奨。

---

## 作業タスク（割当可能な粒度）

- [ ] `app/api/__e2e__/guards.ts` 実装
- [ ] `app/api/__e2e__/ensure-user/route.ts` 実装（Supabase Admin or NextAuth）
- [ ] `app/api/__e2e__/login-as/route.ts` 実装
- [ ] `tests/.setup/auth-global-setup.ts` 実装
- [ ] `playwright.config.ts` に `globalSetup` と `storageState` 追記
- [ ] `auth.spec.ts`（未ログイン前提）に `test.use({ storageState: { cookies: [], origins: [] } })` を追加
- [ ] CIシークレット設定：`E2E_SECRET` / （必要なら）`E2E_USER_EMAIL` / `E2E_USER_PASSWORD`
- [ ] ドキュメント更新：ローカル手順（UIモードでの手動setup実行方法を含む）

---

## ロール別（並列）運用オプション

**`tests/fixtures/roles.ts`（例）**
```ts
import { test as base, Browser } from '@playwright/test';

export const test = base.extend<{}>({
  storageState: async ({ browser }, use, testInfo) => {
    const idx = testInfo.workerIndex;
    const statePath = `playwright/.auth/user-${idx}.json`;
    // 初回だけ生成するロジック（省略）
    await use(statePath);
  }
});
```

---

## 付録：SessionStorage実装を使っている場合

- Playwrightの `storageState` は **Cookies + LocalStorage** が対象。
- 認証トークンを **SessionStorage** に入れている場合は、`page.evaluate()` + `context.addInitScript()` で**明示的に保存/復元**するスニペットを `globalSetup` に追加。

```ts
// 保存
const sessionStorageJson = await page.evaluate(() => JSON.stringify(sessionStorage));
fs.writeFileSync('playwright/.auth/session.json', sessionStorageJson);

// 復元
const session = JSON.parse(fs.readFileSync('playwright/.auth/session.json', 'utf-8'));
await context.addInitScript((storage) => {
  for (const [k, v] of Object.entries(storage as Record<string,string>)) {
    window.sessionStorage.setItem(k, v as string);
  }
}, session);
```

---

### 参考コード置き場（作成予定）
- `tests/.setup/auth-global-setup.ts` の「Cookieベース」「LocalStorageベース」2パターン
- `__e2e__/login-as` のSupabase版／NextAuth版

> このファイルだけでClaudeCodeが着手できるよう、差分PRテンプレと雛形も後続で提供可能です。
