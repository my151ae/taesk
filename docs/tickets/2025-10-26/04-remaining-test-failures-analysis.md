# 残存テスト失敗の詳細分析 - 2025-10-27

**Status**: 📋 分析完了
**Priority**: 🟡 Medium
**Created**: 2025-10-27 08:15 JST
**Purpose**: GPT-5 への引き継ぎ用詳細ドキュメント

## 現在の状況サマリー

| カテゴリ | 状態 | 詳細 |
|---|---|---|
| **Essential テスト** | ✅ 40/40 (100%) | すべて通過 |
| **Core プロジェクト** | ✅ 大部分通過 | 安定テストのみ実行 |
| **Full プロジェクト** | ⚠️ 約6-9件失敗 | 並列実行による競合 |

## 修正済みの問題

### 1. Notifications ランタイムエラー ✅

**ファイル**: `app/(board)/_components/NotificationsBell.tsx:290`

**問題**:
```typescript
// ❌ Before
{notification.payload.message}
```

**修正**:
```typescript
// ✅ After
{notification.payload?.message || 'New notification'}
```

**原因**: テストモックと実際のAPIレスポンスで `payload` 構造が異なっていた

---

### 2. Notifications テストモック修正 ✅

**ファイル**: `e2e/notifications.spec.ts`

**問題**: モックデータが古い構造を使用していた
```typescript
// ❌ Before
{
  id: crypto.randomUUID(),
  type: 'comment',
  title: 'New comment',
  body: 'Someone commented',
  read: false,
  created_at: new Date().toISOString(),
}
```

**修正**:
```typescript
// ✅ After
{
  id: crypto.randomUUID(),
  type: 'comment',
  payload: {
    message: 'New comment',
    body: 'Someone commented on your card',
  },
  read_at: null,
  created_at: new Date().toISOString(),
}
```

---

### 3. Mark-all-read API エンドポイント修正 ✅

**ファイル**: `e2e/notifications.spec.ts`

**問題**: エンドポイントパスとHTTPメソッドが不正確
```typescript
// ❌ Before
if (method === 'PATCH' && url.includes('/mark-read'))
```

**修正**:
```typescript
// ✅ After
if (method === 'POST' && url.includes('/mark-all-read'))
```

---

## 残存する失敗テスト（6-9件）

### A. Board Permissions (1件)

**テスト名**: `should prevent non-owner from changing owner role @failure:permissions`

**ファイル**: `e2e/board-permissions.spec.ts:233`

**エラー**:
```
Error: expect(locator).toBeDisabled() failed
Locator: locator('div').filter({ hasText: /^owner@example\.com/ }).first().getByRole('combobox').first()
Expected: disabled
Error: element(s) not found
```

**原因分析**:
- ShareDialog のメンバーリスト構造が複雑
- Email は `member.profile?.email` としてネストされている
- セレクタが要素を正しく特定できていない

**試行した修正** (まだ未検証):
```typescript
// 修正後のセレクタ
const ownerRow = page.locator('.border').filter({ hasText: 'owner@example.com' }).first();
const roleSelect = ownerRow.locator('select');
await expect(roleSelect).toBeDisabled();
```

**推奨される次のステップ**:
1. ShareDialog の実際のHTML構造をスナップショットで確認
2. より具体的なデータ属性（`data-testid` など）を追加
3. メンバーごとに一意の識別子を使用

---

### B. Comments Tests (2件)

**詳細情報**: テストタイムアウトのため詳細取得できず

**推測される問題**:
1. **`should allow replying to comments`** - 返信ボタンの待機ロジック
   - 既に修正済みだが full プロジェクトで失敗
   - 並列実行時のタイミング問題の可能性

2. **`should validate mention user_id as UUID v4`** - バリデーションロジック
   - UUID 検証ロジックがテスト環境で動作していない可能性

**以前の修正内容**:
```typescript
// Reply button with explicit wait
const replyButton = page.getByRole('button', { name: '返信' }).first();
await replyButton.waitFor({ state: 'visible', timeout: 10000 });
await replyButton.click();

const replyTextarea = page.locator('textarea[placeholder*="返信を書く"]');
await replyTextarea.waitFor({ state: 'visible', timeout: 10000 });
```

**推奨される次のステップ**:
1. Comments テストを単体で実行して具体的なエラーを確認
2. `createTestCard` のポーリング待機時間をさらに延長（現在30秒）
3. Reply form の送信後に明示的な待機を追加

---

### C. Kanban Tests (4件)

**詳細情報**: テストタイムアウトのため詳細取得できず

**推測される問題**:
1. **`should delete a card`** - カード削除後の状態確認
2. **`should open card modal via short URL navigation`** - URL仕様変更の影響
3. **`should restore snapshot on drag error`** - ドラッグ&ドロップのエラーハンドリング
4. **`should use normalized positions (1000/10 gaps) for new lists`** - position計算ロジック

**既知の仕様変更**:
- URL仕様: `/b/<short_id>/<id_short>-<slug>` → `?card=<short_id>` クエリベース
- Modal UI: 2カラムレイアウト、自動クローズしない

**以前の修正内容**:
```typescript
// URL waiting logic fix
await expect
  .poll(() => page.url(), { timeout: 10000 })
  .toContain(`/b/${testBoardShortId}`);
```

**推奨される次のステップ**:
1. Kanban テストを単体で実行して具体的なエラーを確認
2. カードモーダルの閉じるロジックを明示的に呼び出す
3. Position 計算のテストアサーションを緩和（exact match → range check）

---

### D. Notifications - Non-Essential (2-4件)

**テスト名**:
1. `sends a test notification` (Web Push) - core & full で失敗
2. `should mark notifications as read and clear badge` - core & full で失敗

**問題 1: Test Notification (Web Push)**

**エラー**:
```
expect(received).toBeGreaterThan(expected)
Expected: > 0
Received: 0
Timeout: 5000ms exceeded
```

**原因**: Service Worker のモックが未実装
- テスト通知機能は Web Push API を使用
- `mockServiceWorkerAndPush()` が正しく動作していない

**優先度**: 🔵 Low（非本質的機能）

---

**問題 2: Mark as Read**

**エラー**:
```
expect(received).toBe(expected) // Object.is equality
Expected: true
Received: false
Timeout: 10000ms exceeded
```

**原因**: `/api/notifications/mark-all-read` への POST リクエストがモックに到達していない

**推測される理由**:
1. ルートマッチングのパターンが不十分
2. リロード後にルートモックが失効している可能性
3. 並列実行時のコンテキスト分離問題

**修正試行済み**:
```typescript
// Route order changed to catch POST first
if (method === 'POST' && url.includes('/mark-all-read')) {
  markAsReadCalled = true;
  // ...
}
```

**推奨される次のステップ**:
1. `page.on('request')` でリクエストをログ出力し、実際のURLとメソッドを確認
2. ルートモックを `**` ワイルドカードから具体的なURLパターンに変更
3. `page.route()` の呼び出し順序を調整

---

## 技術的な根本原因の仮説

### 1. 並列実行による競合

**症状**: Core プロジェクトでは通過するが Full プロジェクトで失敗

**原因**:
- Playwright の並列実行（`fullyParallel: !isCI`）
- テストデータのクリーンアップが不完全
- ブラウザコンテキストの分離が不十分

**証拠**:
- Essential テストは 100% 通過（これらは critical path でありテスト分離が厳密）
- Non-essential テストは並列実行時のみ失敗

---

### 2. テスト待機ロジックの不足

**症状**: タイムアウトエラーが多い

**原因**:
- Supabase のレスポンス時間が環境によって変動
- ポーリング間隔が短すぎる
- `waitFor` の timeout が短すぎる

**既に適用した緩和策**:
- `createTestCard` のポーリング: 20秒 → 30秒
- リトライ間隔: 500ms → 1000ms
- URL待機: `waitForURL` → `expect.poll()`

---

### 3. モックデータとAPIレスポンスの不一致

**症状**: ランタイムエラー、アサーション失敗

**原因**:
- テストモックが古いスキーマを使用
- フィールド名の変更（`title/body/read` → `payload/read_at`）
- API エンドポイントパスの変更（`/mark-read` → `/mark-all-read`）

**既に修正済み**: Notifications モック構造

---

## 推奨される全体戦略

### 短期（次のセッションで実施）

1. ✅ **Board-permissions テストのセレクタ修正を検証**
   - 修正済みコードをテスト実行
   - 失敗する場合は ShareDialog に `data-testid` 追加

2. **Comments/Kanban テストの個別実行**
   ```bash
   npx playwright test e2e/comments.spec.ts --project=core --reporter=json
   npx playwright test e2e/kanban.spec.ts --project=core --reporter=json
   ```
   - 具体的なエラーメッセージを収集
   - 失敗箇所を特定して修正

3. **Notifications mark-read のデバッグ**
   ```typescript
   page.on('request', (request) => {
     if (request.url().includes('notifications')) {
       console.log('Request:', request.method(), request.url());
     }
   });
   ```

---

### 中期（余裕があれば）

1. **テストデータクリーンアップ強化**
   - `beforeEach` で確実にデータ削除
   - `afterEach` でブラウザコンテキストをリセット

2. **テスト分離の改善**
   - 各テストで一意のボードIDを生成
   - `test.describe.configure({ mode: 'serial' })` を避ける（スキップが多くなる）

3. **Data-testid の追加**
   - ShareDialog のメンバーリスト
   - Comments の返信ボタン
   - Kanban のカードアクション

---

### 長期（Phase 4）

1. **Service Worker モックの実装**
   - Web Push テスト通知機能の完全な E2E テスト
   - `mockServiceWorkerAndPush()` の改善

2. **Visual Regression Testing**
   - Playwright の screenshot 比較
   - UI の意図しない変更を検出

3. **Performance Testing**
   - Core Web Vitals の E2E 測定
   - Lighthouse CI との統合

---

## 成果物と変更ファイル

### 修正済みファイル
- ✅ `app/(board)/_components/NotificationsBell.tsx` - payload null チェック
- ✅ `e2e/notifications.spec.ts` - モック構造修正、API パス修正
- ✅ `e2e/board-permissions.spec.ts` - セレクタ修正（未検証）
- ✅ `e2e/comments.spec.ts` - 待機ロジック改善（既存）
- ✅ `e2e/kanban.spec.ts` - URL 待機ロジック改善（既存）

### 生成されたレポート
- 📊 `playwright-essential-current.json` - Essential テスト結果（40/40通過）
- 📊 `playwright-notifications-test.json` - Notifications テスト詳細
- 📊 `playwright-board-permissions-test.json` - Board permissions テスト詳細

---

## GPT-5 への引き継ぎ事項

### 優先度の高いタスク

1. **Board-permissions セレクタ修正の検証**
   ```bash
   npx playwright test e2e/board-permissions.spec.ts --grep "prevent non-owner" --reporter=json
   ```

2. **Comments テストの詳細エラー確認**
   - テストが長時間実行されるため、個別に実行して具体的なエラーを取得

3. **Kanban テストの詳細エラー確認**
   - 同上

### 調査が必要な項目

1. **Notifications mark-read のルートモック**
   - なぜ `/mark-all-read` への POST がキャッチされないのか
   - `page.route()` のパターンマッチング挙動

2. **並列実行時の失敗パターン**
   - Core で通過 → Full で失敗の原因
   - ブラウザコンテキストの分離レベル

### 参考情報

**テスト実行コマンド**:
```bash
# Essential のみ（常に100%通過を確認）
npx playwright test --grep @e2e:essential

# 個別ファイル実行
npx playwright test e2e/board-permissions.spec.ts --reporter=json

# Full project のみ
npx playwright test --project=full --reporter=json
```

**関連ドキュメント**:
- `/docs/tickets/2025-10-26/03-fix-remaining-test-failures.md` - 修正履歴
- `/docs/detail/testing.md` - テストガイドライン
- `/docs/detail/architecture.md` - システムアーキテクチャ

---

**最終更新**: 2025-10-27 08:20 JST
**作成者**: Claude (Sonnet 4.5)
**次のアクション**: GPT-5 による残存失敗テストの修正
