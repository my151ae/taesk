# Testing Guide

## Overview

Taeskのテスト戦略とベストプラクティスをまとめたドキュメントです。

## E2E Tests (Playwright)

### テスト環境

```typescript
// playwright.config.ts
webServer: {
  command: 'NODE_ENV=test NEXT_PUBLIC_BYPASS_AUTH=true npm run dev',
  url: 'http://localhost:3000',
  reuseExistingServer: !process.env.CI,
}
```

- **認証バイパス**: `NEXT_PUBLIC_BYPASS_AUTH=true`でGoogle OAuth不要
- **テストユーザー**: `test@example.com` (UUID: `d7ab4718-0648-43ba-a1b6-19c826608c40`)
- **並列実行**: CIでは`workers: 1`（安定性優先）、ローカルでは`workers: 4`

### テスト分離戦略

#### 動的ボード生成

各テストで固有のボードを作成し、完全な分離を実現：

```typescript
test.describe('Taesk Kanban Board E2E Tests', () => {
  let testBoardId: string;
  let testBoardName: string;

  test.beforeEach(async ({ page }) => {
    // Generate unique board for this test
    testBoardId = crypto.randomUUID();
    testBoardName = `Test-${testBoardId.slice(0, 8)}`;

    // Create test board with is_test_board flag
    await supabase.from('boards').insert({
      id: testBoardId,
      name: testBoardName,
      user_id: TEST_USER_ID,
      is_test_board: true,  // IMPORTANT: Prevents default list auto-seeding
    });

    // Navigate and switch to test board
    await page.goto('/');
    await page.getByRole('button', { name: /▼/ }).click();
    await page.getByRole('button', { name: testBoardName }).click();
    await page.getByRole('button', { name: `${testBoardName} ▼` }).waitFor();

    // Wait for Realtime subscription to be ready
    await page.waitForTimeout(1500);
  });

  test.afterEach(async () => {
    // Clean up test board (CASCADE deletes lists and cards)
    await supabase.from('boards').delete().eq('id', testBoardId);
  });
});
```

**重要ポイント**:
- `is_test_board: true`を必ず設定（デフォルトリスト自動生成を抑止）
- `crypto.randomUUID()`で完全にユニークなボードID
- `afterEach`で確実にクリーンアップ
- Realtime購読の準備完了を待機（1500ms）

#### なぜis_test_board: trueが必要か

`app/page.tsx`には以下のロジックがあります：

```typescript
const shouldSeedDefaults =
  data.lists.length === 0 && (!currentBoard || !currentBoard.is_test_board);

if (shouldSeedDefaults) {
  await initializeDefaultLists(user.id, currentBoardId);
  // Creates "To Do", "In Progress", "Done" lists
}
```

`is_test_board: true`を設定しないと：
1. 空のテストボードが作成される
2. アプリが自動的に3つのデフォルトリストを追加
3. テストが「1つ追加→削除→0件期待」しても、実際は3件残る
4. テスト失敗 ❌

### Drag & Drop実装

#### 問題: dragTo()が動かない

Playwrightの`locator.dragTo()`は@dnd-kitで動作しません：

```typescript
// ❌ これは動かない
await secondCard.dragTo(firstCard);
```

**理由**:
- @dnd-kitは**連続的なmousemoveイベント**を監視
- `dragTo()`は始点→終点への**一気の移動**
- 中間の`mousemove`イベントが不足し、@dnd-kitが検出できない

#### 解決策: mouse APIで段階的移動

```typescript
/**
 * Drag and drop helper using mouse API with intermediate steps
 * Required for @dnd-kit which needs continuous mousemove events
 */
async function dragAndDrop(page: Page, source: Locator, target: Locator) {
  // Get bounding boxes
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();

  if (!sourceBox || !targetBox) {
    throw new Error('Source or target element not visible');
  }

  // Calculate positions (center of elements)
  const startX = sourceBox.x + sourceBox.width / 2;
  const startY = sourceBox.y + sourceBox.height / 2;
  const endX = targetBox.x + targetBox.width / 2;
  const endY = targetBox.y + targetBox.height / 2;

  // Calculate midpoint for smoother drag
  const midX = (startX + endX) / 2;
  const midY = (startY + endY) / 2;

  // Perform drag with intermediate mousemove events
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.waitForTimeout(250); // Wait for touch sensor activation delay

  // Move with steps to generate intermediate mousemove events
  await page.mouse.move(midX, midY, { steps: 10 });
  await page.mouse.move(endX, endY, { steps: 10 });

  await page.mouse.up();
  await page.waitForTimeout(500); // Wait for drop animation and Realtime sync
}
```

**使用例**:

```typescript
test('should drag and drop a card to a different list', async ({ page }) => {
  // Setup: Create lists and card
  await page.getByRole('button', { name: '+ Add List' }).click();
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: '+ Add List' }).click();
  await page.waitForTimeout(1000);

  const addCardButtons = page.getByRole('button', { name: '+ Add Card' });
  await addCardButtons.first().click();
  await page.waitForTimeout(1000);

  const card = page.getByText('New Card').first();
  const secondList = page.getByRole('button', { name: /New List/i }).nth(1);

  // Drag using mouse API
  await dragAndDrop(page, card, secondList);

  // Verify
  await expect(page.getByText('New Card')).toHaveCount(1);
});
```

**キーポイント**:
- `steps: 10`: 10回の中間`mousemove`イベントを生成
- `waitForTimeout(250)`: @dnd-kitのTouch sensorの`activationDelay`に対応
- `waitForTimeout(500)`: Drop後のアニメーション + Realtime同期を待機
- 中間点（midpoint）を経由することでスムーズな動き

### Realtime同期の待機

Supabaseのリアルタイム同期には時間がかかるため、適切な待機が必要：

```typescript
// ❌ 悪い例: 待機なし
await page.getByRole('button', { name: '+ Add List' }).click();
await page.getByRole('button', { name: '+ Add Card' }).click(); // リスト作成が完了していない

// ✅ 良い例: 適切な待機
await page.getByRole('button', { name: '+ Add List' }).click();
await page.waitForTimeout(1000); // Realtimeで同期完了を待つ
await page.getByRole('button', { name: '+ Add Card' }).click();
```

**推奨待機時間**:
- リスト/カード作成: `1000ms`
- 削除操作: `2000ms`（Realtime DELETE伝播 + UI更新）
- Drag & Drop: `500ms`（アニメーション + 同期）
- ボード切り替え: `1500ms`（Realtime購読の再接続）

### 削除テストのパターン

```typescript
test('should delete a list', async ({ page }) => {
  // 1. Create item
  await page.getByRole('button', { name: '+ Add List' }).click();
  await expect(page.getByRole('button', { name: /New List/i }).first()).toBeVisible();
  await page.waitForTimeout(1000); // Wait for Realtime sync

  // 2. Open menu and delete
  const menuButton = page.locator('button:has-text("⋯")').first();
  await menuButton.click();
  await page.waitForTimeout(500);

  page.once('dialog', dialog => dialog.accept()); // Handle confirm dialog
  const deleteButton = page.getByTestId('delete-list-button');
  await deleteButton.click();

  // 3. Wait for deletion to propagate
  await page.waitForTimeout(2000); // Realtime propagation + UI update

  // 4. Verify deletion
  await expect(page.getByRole('button', { name: /New List/i })).toHaveCount(0);
});
```

### テストデータのクリーンアップ

**自動クリーンアップ**:
- `afterEach`でボード削除（CASCADE設定によりリスト・カードも削除）
- テスト失敗時でも必ず実行される

**手動クリーンアップ**（デバッグ用）:

```typescript
// Old test boards cleanup
await supabase.from('boards').delete().match({ is_test_board: true });
```

または Supabase MCPツールで：

```sql
DELETE FROM boards WHERE name LIKE 'Test-%' OR is_test_board = true;
```

## スキップされたテスト

### Auth Tests (7テスト)

認証テストは`NEXT_PUBLIC_BYPASS_AUTH=true`と競合するため一時的にスキップ：

```typescript
test.describe.skip('Authentication', () => {
  // Tests that require real auth flow
});
```

**将来の解決策**: 二重webServer構成
- Port 3000: `NEXT_PUBLIC_BYPASS_AUTH=true`（Kanban tests用）
- Port 3001: 通常モード（Auth tests用）

## テスト実行

### ローカル実行

```bash
# 全テスト実行
npm run test:e2e

# UIモード（デバッグ用）
npm run test:e2e:ui

# 特定のテストのみ
npx playwright test --grep "drag and drop"

# 並列度指定
npx playwright test --workers=1
```

### CI実行

```bash
# Sequential execution for stability
npx playwright test --workers=1 --reporter=line
```

## テスト結果（2025-10-10時点）

**Phase 2完了**:
- ✅ **21/21 テストが成功（100%）**
- ⏭️ 7 テストがスキップ（Authのみ）
- ❌ 0 失敗
- ⚡ 実行時間: 33.8秒（並列実行、workers: 4）

**カバレッジ**:
- ✅ リスト CRUD（作成、読取、更新、削除）
- ✅ カード CRUD
- ✅ Drag & Drop（同一リスト内、異なるリスト間）
- ✅ データ永続化（ページリロード後）
- ✅ オフライン同期キュー
- ✅ モバイルレスポンシブ
- ✅ RLS ポリシー検証
- ⏭️ 認証フロー（Phase 3で対応予定）

## トラブルシューティング

### テストがフラキー（不安定）

**症状**: 同じテストが成功したり失敗したりする

**原因と対策**:
1. **Realtime競合**: 動的ボード生成を使用（`crypto.randomUUID()`）
2. **待機時間不足**: 適切な`waitForTimeout`を追加
3. **デフォルトリスト自動生成**: `is_test_board: true`を設定

### Drag & Dropが動かない

**症状**: カードがドラッグされない

**対策**:
1. `locator.dragTo()`ではなく`dragAndDrop()`ヘルパー関数を使用
2. `steps: 10`で中間イベントを生成
3. Touch sensor activation delay (250ms)を考慮

### 削除テストが失敗

**症状**: 削除後もアイテムが残る

**チェックリスト**:
- [ ] `is_test_board: true`を設定したか？
- [ ] 削除後に十分な待機時間（2000ms）を設けたか？
- [ ] Realtimeサブスクリプションが正しく設定されているか？

## ベストプラクティス

### ✅ DO

- 各テストで固有のボードを作成（`crypto.randomUUID()`）
- `is_test_board: true`を必ず設定
- Realtime同期に適切な待機時間を設ける
- Drag & DropはmouseAPIを使用
- `afterEach`で確実にクリーンアップ
- テスト名は動作を明確に記述（"should ..."形式）

### ❌ DON'T

- 共有ボードを複数テストで使い回さない
- `is_test_board`フラグを省略しない
- `locator.dragTo()`を@dnd-kitで使わない
- 待機時間を短くしすぎない（フラキーの原因）
- テスト失敗時のクリーンアップを忘れない

## 参考資料

- [Playwright Documentation](https://playwright.dev/)
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [@dnd-kit Documentation](https://docs.dndkit.com/)
- [Supabase Realtime](https://supabase.com/docs/guides/realtime)
- [チケット: E2Eテストの安定化](../tickets/2025-10-10/01-e2e-test-stability-issues.md)
