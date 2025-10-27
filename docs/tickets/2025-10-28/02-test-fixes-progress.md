# E2Eテスト修正進捗 - 2025-10-28

## 📊 修正結果サマリー

| テスト | 修正前 | 修正後 | 状態 |
|-------|-------|-------|------|
| **@mentions typeahead** | ❌ FAIL | ✅ PASS | 完了 |
| **restore snapshot on drag error** | ❌ FAIL | ⚠️ FLAKY | 進行中 |
| **normalized positions** | ❌ FAIL | ⚠️ FLAKY | 進行中 |

---

## ✅ 完了した修正

### 1. @mentions テストの修正 (`comments.spec.ts`)

**問題**: `/api/boards/${boardId}/members` のレスポンス待機がタイムアウト

**原因**: `waitForResponse` を `type('@')` の**後**に設定していたため、APIリクエストが既に完了している可能性

**修正内容**:
```typescript
// ❌ Before: waitForResponse AFTER typing
await commentTextarea.type('@', { delay: 100 });
await page.waitForResponse(...); // Too late!

// ✅ After: Setup promise BEFORE typing
const membersResponsePromise = page.waitForResponse(...);
await commentTextarea.type('@', { delay: 100 });
await membersResponsePromise;
```

**結果**: ✅ **100% 成功** (リトライなし)

---

### 2. Realtime 競合問題の対策

**問題**: テスト間でRealtimeイベントが混入し、リスト数が期待値と不一致 (期待: 2, 実際: 4)

**実装した対策**:

#### a) テスト環境でのRealtime無効化

**ファイル**: `.env.test`
```bash
# Disable Realtime in test environment to prevent cross-test interference
NEXT_PUBLIC_DISABLE_REALTIME=true
```

**ファイル**: `app/(board)/_components/KanbanBoardClient.tsx`
```typescript
useEffect(() => {
  if (!currentBoardId) return;

  // Disable Realtime in test environment if flag is set
  if (process.env.NEXT_PUBLIC_DISABLE_REALTIME === 'true') {
    console.log('[Realtime] Disabled via NEXT_PUBLIC_DISABLE_REALTIME flag');
    setRealtimeStatus('disconnected');
    return;
  }

  // ... Realtime setup
}, [currentBoardId]);
```

#### b) チャンネル名の標準化

推奨パターンに従ってチャンネル名を変更:
```typescript
// ❌ Before
.channel(`board-changes-${currentBoardId}`)

// ✅ After
.channel(`board:${currentBoardId}`)
```

#### c) UPSERT ロジックの確認

既に実装済み（重複排除機能あり）:
```typescript
if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
  setBoardData((prev) => {
    const newList = payload.new as List;
    const idx = prev.lists.findIndex(list => list.id === newList.id);

    if (idx >= 0) {
      // Update existing
      const updatedLists = [...prev.lists];
      updatedLists[idx] = newList;
      return { ...prev, lists: updatedLists };
    }

    // Insert new
    return { ...prev, lists: [...prev.lists, newList] };
  });
}
```

---

## ⚠️ 残っている課題

### Kanban テストの不安定性

**症状**: リスト数が4つになる問題がまだ発生

**調査結果**:
- ✅ Realtime は無効化されている
- ✅ 各テストは一意のボード ID を使用
- ✅ UPSERT ロジックは実装済み
- ⚠️ シリアル実行 (`workers=1`) でも失敗

**推測される原因**:
1. **UIの状態残留**: 同じブラウザセッション内で複数のボードに移動するため、localStorageやReact stateが混在
2. **ボード切り替えの非同期処理**: ボード切り替え時のクリーンアップが不完全
3. **ダブルクリック**: テストのクリック操作が二重に実行されている可能性

**次のステップ**:

1. **各テストで新しいブラウザコンテキストを使用**
   ```typescript
   test.use({ context: { ... } }); // 独立したコンテキスト
   ```

2. **ボード切り替え時のlocalStorageクリア**
   ```typescript
   await page.evaluate(() => localStorage.clear());
   await page.reload();
   ```

3. **より安定したクリック操作**
   ```typescript
   await page.getByRole('button', { name: '+ Add List' }).click({ clickCount: 1, delay: 100 });
   await page.waitForFunction(() => {
     return document.querySelectorAll('[data-testid^="list-"]').length === expectedCount;
   }, { timeout: 5000 });
   ```

4. **DBレベルでの重複防止**
   - `lists` テーブルに UNIQUE 制約を追加 (board_id, position)
   - または ON CONFLICT ハンドリング

---

## 📁 変更されたファイル

### アプリケーションコード

1. **`app/(board)/_components/KanbanBoardClient.tsx`**
   - Realtime 無効化フラグのサポート追加
   - チャンネル名を `board:${boardId}` に変更

2. **`.env.test`**
   - `NEXT_PUBLIC_DISABLE_REALTIME=true` を追加

### テストコード

3. **`e2e/comments.spec.ts`**
   - `waitForResponse` の順序を修正（@mentions テスト）

4. **`e2e/kanban.spec.ts`**
   - `beforeEach` のコメント更新（Realtime無効化の説明）
   - テスト内のクリーンアップロジックを簡素化

---

## 🎯 次の優先事項

1. **Kanban テストの完全な安定化**
   - ブラウザコンテキストの分離
   - localStorage のクリア戦略
   - DB制約の追加検討

2. **Flaky テストの確認**
   - `should rename a list`
   - `should edit a card`

3. **drag エラーロールバック実装**
   - API失敗時のUI復元
   - `page.route()` でのモック

4. **position 正規化ロジック**
   - 1000/10刻みのルール実装

---

## 🔍 参考情報

- **ガイド**: `/docs/detail/testing.md`
- **チケット**: `/docs/tickets/2025-10-26/06-test-splits-and-fix-flows.md`
- **Playwright設定**: `playwright.config.ts` (workers=4, retries=1)

---

**生成日時**: 2025-10-28
**実行環境**: Playwright 1.56.0, NEXT_PUBLIC_DISABLE_REALTIME=true
