# 0300 テスト失敗の分析と現状

**作成日**: 2025-10-22
**目的**: UI変更（2カラムモーダル + マルチアサイニー）に伴うE2Eテストの失敗を分析し、修正計画を立てる

---

## 📊 現在の状況

### 変更内容（直近のコミット）
1. **CardModal を 2カラムレイアウトに変更**
   - 左カラム: カード詳細（タイトル、説明、タグ、期限、優先度、メンバー）
   - 右カラム: コメント（独立スクロール）
   - タブUIを廃止

2. **マルチアサイニー機能の実装**
   - `assignee_id` (単一) → `assignee_ids` (配列) に移行
   - Trello スタイルのメンバーチップUI

3. **Save ボタンの挙動変更**
   - **旧**: Save → モーダル自動で閉じる
   - **新**: Save → モーダルは開いたまま（Escape で閉じる）

---

## 🔴 失敗しているテスト

### Shard 2 (kanban.spec.ts): 8 passed, **6 failed**

1. ✅ **line 326: "should edit a card"** - **修正済み・合格**
   - 問題: "Edit Card" テキストが見つからない
   - 原因: タイトルがあると `{title}` を表示し、"Edit Card" は表示されない
   - 修正: アサーションを削除 + Save後に Escape で閉じる + 待ち時間を1500msに増加
   - 結果: ✅ 合格

2. ✅ **line 402: "should delete a card"** - **修正済み・合格**
   - 問題: 同上（"Edit Card" テキスト）
   - 修正: 自動的に修正された
   - 結果: ✅ 合格

3. ❌ **line 448: "should assign and clear card members (multi-assignee)"** - **未解決**
   - **問題**: `assignee_ids` が空配列のまま（保存されていない）
   - **期待値**: `["f6baf5d0-ac5b-491a-aa47-3bc5c05243f2"]`
   - **実際値**: `[]`
   - **原因候補**:
     1. メンバードロップダウンのクリックがブロックされている（オーバーレイの問題）
     2. Save ボタンが押されていない or 保存前にモーダルが閉じている
     3. UI のメンバー選択ロジックが正しく動作していない
   - **試した修正**:
     - `{ force: true }` でクリックを強制
     - Save ボタンを明示的にクリック → 1500ms 待機 → Escape
     - **結果**: まだ失敗（`assignee_ids` が保存されない）

4. ❌ **line 593: "should persist data after page reload"**
   - 未調査（time: line 326 の修正の影響で連鎖失敗の可能性）

5. ❌ **line 755: "should render full card page on direct navigation"**
   - 未調査（同上）

6. ❌ **line 785: "should normalize URL when slug is incorrect"**
   - 未調査（同上）

---

### Shard 3 (phase3-comments.spec.ts): 3 passed, **6 failed**, 5 skipped

1. ❌ **line 92: "should show Comments tab in card modal via ?card= route"**
   - **問題**: カードタイトルが見つからない
   - **エラー**: `locator('text="Test Card 1761120936868"').first()` - element not found
   - **原因**: `createTestCard` ヘルパーが新UIに対応していない
   - **修正内容**:
     - 旧: 入力フィールドにタイトルを入力 → Enter
     - 新: "+ Add Card" ボタン → 自動で "New Card" 作成 → タイトルは "New Card" 固定
   - **結果**: 修正済みだが、まだテストしていない

2. ❌ **line 108: "should preserve card modal state on reload with ?card= query"**
   - 未調査（同上の連鎖失敗）

3. ❌ **line 126: "should create a comment successfully"**
   - 未調査（同上）

4. ❌ **line 145: "should edit and delete own comment"**
   - 未調査（同上）

5. ❌ **line 177: "should allow replying to comments"**
   - 未調査（同上）

6. ❌ **line 210: "should sync comments across multiple browser contexts"**
   - 未調査（同上）

---

## 🔍 根本原因の分析

### 1. UI変更への追従不足
- **"Edit Card" テキスト問題**: タイトル表示ロジックの変更
  - **修正**: ✅ 完了
- **Save ボタンの挙動変更**: モーダルが自動で閉じなくなった
  - **修正**: ✅ 完了（Escape を追加）

### 2. カード作成フローの変更
- **旧フロー**: ボタンクリック → 入力フィールド表示 → タイトル入力 → Enter
- **新フロー**: ボタンクリック → "New Card" が自動作成
- **影響**: `createTestCard` ヘルパーが機能しなくなった
  - **修正**: ✅ ヘルパーを修正（"New Card" 固定タイトルを返す）

### 3. メンバー選択UIの問題 ⚠️ **未解決**
- **問題**: ドロップダウンからメンバーを選択しても `assignee_ids` に保存されない
- **可能性**:
  1. **UIのバグ**: CardModal の Save ロジックが `assignee_ids` を正しく保存していない
  2. **テストのタイミング**: クリック → Save → Escape の間隔が短すぎる
  3. **オーバーレイ問題**: ドロップダウンがオーバーレイでブロックされ、実際にはクリックされていない

---

## 📋 修正状況サマリー

| テスト | ファイル | 行 | 状態 | 備考 |
|--------|---------|-----|------|------|
| should edit a card | kanban.spec.ts | 326 | ✅ 合格 | "Edit Card" 削除 + Save → Escape |
| should delete a card | kanban.spec.ts | 402 | ✅ 合格 | 自動修正 |
| should assign and clear members | kanban.spec.ts | 448 | ❌ 失敗 | `assignee_ids` が保存されない |
| should persist data | kanban.spec.ts | 593 | ❌ 未調査 | - |
| should render full card page | kanban.spec.ts | 755 | ❌ 未調査 | - |
| should normalize URL | kanban.spec.ts | 785 | ❌ 未調査 | - |
| should show Comments tab | phase3-comments | 92 | ❌ 失敗 | createTestCard 修正済み |
| preserve card modal state | phase3-comments | 108 | ❌ 未調査 | - |
| create a comment | phase3-comments | 126 | ❌ 未調査 | - |
| edit and delete comment | phase3-comments | 145 | ❌ 未調査 | - |
| allow replying | phase3-comments | 177 | ❌ 未調査 | - |
| sync comments | phase3-comments | 210 | ❌ 未調査 | - |

**合格**: 2 / 12 (17%)
**残り**: 10 tests

---

## 🛠️ 修正コードの詳細

### 1. kanban.spec.ts: 326行 "should edit a card"

```typescript
// Before
await page.getByRole('button', { name: 'Save', exact: true }).click();
await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 2000 });

// After
await page.getByRole('button', { name: 'Save', exact: true }).click();
await page.waitForTimeout(1500); // Wait for save to complete
await page.keyboard.press('Escape'); // Close modal manually
await page.waitForTimeout(300);
await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 2000 });
```

### 2. kanban.spec.ts: 422行, 748行 "Edit Card" テキスト削除

```typescript
// Before
await expect(page.getByText('Edit Card')).toBeVisible();

// After
// Modal shows card title ("New Card"), not "Edit Card"
```

### 3. phase3-comments.spec.ts: 32-44行 createTestCard ヘルパー

```typescript
// Before
async function createTestCard(page: Page, listIndex: number, cardTitle: string): Promise<string> {
  const addCardButtons = page.locator('button:has-text("+ Add")');
  await addCardButtons.nth(listIndex).click();
  await page.fill('input[placeholder="Card title"]', cardTitle);
  await page.keyboard.press('Enter');
  // ...
}

// After
async function createTestCard(page: Page, listIndex: number, cardTitle: string): Promise<string> {
  const addCardButtons = page.locator('button:has-text("+ Add Card")');
  await addCardButtons.nth(listIndex).click();
  await page.waitForTimeout(1500);

  // Card is created with "New Card" title automatically
  const newCard = page.locator('text="New Card"').last();
  await expect(newCard).toBeVisible({ timeout: 5000 });

  return "New Card"; // Return fixed title
}
```

### 4. kanban.spec.ts: 480-491行 メンバー選択 ⚠️ **まだ動作しない**

```typescript
// Attempted fix (still failing)
await page.getByText('e2e.taesk.test@gmail.com').first().click({ force: true });
await page.waitForTimeout(500);

await page.getByRole('button', { name: 'Save', exact: true }).click();
await page.waitForTimeout(1500);

await page.keyboard.press('Escape');
await page.waitForTimeout(300);
```

---

## 🚧 未解決の問題

### 1. メンバー選択が保存されない ⚠️ **Critical**

**現象:**
- ドロップダウンでメンバーを選択
- Save ボタンをクリック
- Escape でモーダルを閉じる
- **結果**: `assignee_ids` が空配列のまま

**デバッグ方法:**
1. ✅ ブラウザで手動テスト → 正常に動作するか確認
2. ✅ DevTools でネットワークリクエストを確認 → Save 時に正しいデータが送信されているか
3. ❌ CardModal の Save ロジックを確認 → `assignee_ids` の保存処理
4. ❌ テストのスクリーンショットを確認 → ドロップダウンが実際に開いているか

**次のステップ:**
- **Option A**: 手動でブラウザテストして、UIが正しく動作しているか確認
- **Option B**: CardModal のコードを確認して、`assignee_ids` の保存処理を検証
- **Option C**: テストを一時スキップ（`.skip()`）して、他のテストを優先

---

## 📊 テスト実行の運用改善

### 問題点
- ルートに `playwright-report-*.json` が散乱
- 古いレポートの管理ルールが不明確

### 解決策 ✅ **実装完了**

#### 1. `playwright.config.ts` の修正
```typescript
// Output directories
outputDir: 'test-results',

// Reporters - use html by default, json when specified via CLI
reporter: process.env.PLAYWRIGHT_JSON_OUTPUT_NAME
  ? [['json', { outputFile: process.env.PLAYWRIGHT_JSON_OUTPUT_NAME }]]
  : 'html',
```

#### 2. `package.json` にスクリプト追加
```json
"test:e2e:report": "PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/$(date +%Y-%m-%d-%H%M%S)/report.json playwright test"
```

#### 3. 使用方法
```bash
# JSON レポートをタイムスタンプ付きフォルダに保存
npm run test:e2e:report

# 特定のテストのみ実行
PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/$(date +%Y-%m-%d-%H%M%S)/report.json npx playwright test --grep "should edit a card"

# 通常の HTML レポート（デフォルト）
npm run test:e2e
```

#### 4. 整理ルール
- **最新**: `test-results/latest/` （シンボリックリンク or 最新フォルダ）
- **アーカイブ**: `test-results/YYYY-MM-DD-HHMMSS/`
- **削除**: 7日以上前のフォルダは手動削除 or CI で自動削除

---

## 🎯 今後の計画

### 優先度1: 残りのテスト修正
- [ ] **メンバー選択の問題を解決** (Critical)
  - 手動テスト or UIコード確認
- [ ] phase3-comments.spec.ts の残り5テストを確認
- [ ] kanban.spec.ts の残り3テストを確認

### 優先度2: 0302 実装 (Web Push 送信ロジック)
- テスト修正が長引く場合は、先に実装を優先
- ビジネス価値: ⭐⭐⭐⭐⭐ (高)
- 工数: 2-3時間

### 優先度3: 0303-0304 実装
- 0303: 通知設定バックエンド (2-3h)
- 0304: Web Push E2E + ドキュメント (1-2h)

---

## 📝 メモ

### 実行ログ
- **2025-10-22 17:14**: Shard 2/4 実行 → 12 passed, 2 failed
- **2025-10-22 17:30**: Shard 2/4 再実行 → 8 passed, 6 failed (悪化)
- **2025-10-22 17:45**: 個別テスト実行:
  - "should edit a card" → ✅ 合格
  - "should delete a card" → ✅ 合格
  - "should assign and clear members" → ❌ 失敗

### 技術的な学び
1. **Save ボタンの挙動**: 新UIでは Save 後もモーダルが開いたまま
2. **カード作成フロー**: 入力フィールドが廃止され、即座に "New Card" が作成される
3. **並行実行の問題**: 複数テストを並行実行すると競合が発生しやすい → `--workers=1` を推奨

### コンテキスト切り替えのコスト
- テスト修正に **1時間以上** 消費
- 0302 実装を開始していれば、すでに完了していた可能性あり
- **教訓**: ビジネス価値の高い実装を優先し、テストは後回しにする判断も必要

---

## ✅ アクション

**次に実行すること:**
1. **Option A**: メンバー選択の問題を手動で確認 → UIバグなら修正 → テスト再実行
2. **Option B**: メンバー選択テストを `.skip()` → 残りのテストを修正 → 0302 実装へ
3. **Option C**: テスト修正を一時停止 → **0302 実装を優先** → テストは後日修正

**推奨**: **Option C** - 0302 実装を優先し、ビジネス価値を最大化
