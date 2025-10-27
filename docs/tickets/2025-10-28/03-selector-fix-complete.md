# E2Eテストセレクタ修正完了 - 2025-10-28

## 📊 修正結果サマリー

| テスト | 修正前 | 修正後 | 状態 |
|-------|-------|-------|------|
| **@mentions typeahead** | ❌ FAIL | ✅ PASS | 完了 |
| **restore snapshot on drag error** | ❌ FAIL | ✅ PASS | 完了 |
| **normalized positions** | ❌ FAIL | ✅ PASS | 完了 |

---

## 🐛 根本原因の発見

### 問題: "Expected: 2, Received: 4"

テストは2つのリストを作成していたが、セレクタが4つの要素にマッチしていた。

### 原因: セレクタの二重マッチング

```typescript
// ❌ 問題のあったセレクタ
const lists = page.locator('[data-testid^="list-"]');
```

このセレクタは以下の**両方**にマッチしていた：

1. `data-testid="list-${list.id}"` - リストコンテナ（KanbanBoardClient.tsx:588）
2. `data-testid="list-${list.id}-dropzone"` - ドロップゾーン（KanbanBoardClient.tsx:658）

**結果**: 2リスト × 2要素/リスト = 4マッチ ❌

### 修正内容

```typescript
// ✅ 修正後: data-type 属性を使用
const lists = page.locator('[data-type="list"]');
```

`data-type="list"` はリストコンテナ**のみ**に付与されており、ドロップゾーンには付与されていない。

**結果**: 2リスト × 1要素/リスト = 2マッチ ✅

---

## 🔧 変更されたファイル

### テストコード

**`e2e/kanban.spec.ts`**

#### 1. `should restore snapshot on drag error` テスト

```typescript
// 修正箇所: 3ヶ所

// ❌ Before
const lists = page.locator('[data-testid^="list-"]');

// ✅ After
const lists = page.locator('[data-type="list"]');
```

修正行:
- Line 917: 初期化時のセレクタ
- Line 928: 2リスト作成後の検証
- Line 956: リロード後の検証

#### 2. `should use normalized positions` テスト

```typescript
// 修正箇所: 2ヶ所

// ❌ Before
const lists = page.locator('[data-testid^="list-"]');

// ✅ After
const lists = page.locator('[data-type="list"]');
```

修正行:
- Line 989: 初期化時のセレクタ
- Line 1001: 2リスト作成後の検証

---

## ✅ テスト結果

### 実行コマンド

```bash
npx playwright test -g "should restore snapshot on drag error|should use normalized positions" --reporter=json
```

### 結果

```json
{
  "expected": 4,      // 4テスト全成功（core × 2 + full × 2）
  "unexpected": 0,    // 失敗なし
  "flaky": 0,         // 不安定なテストなし
  "skipped": 0        // スキップなし
}
```

✅ **100% 成功** （リトライなし）

---

## 📝 学んだこと

### セレクタ設計のベストプラクティス

1. **`data-testid` の命名規則に注意**
   - プレフィックスマッチング (`^=`) は予期しない要素にマッチする可能性がある
   - 親要素と子要素で同じプレフィックスを避ける

2. **専用の `data-type` 属性を活用**
   - `data-type="list"` のような明示的な属性は安全
   - コンテナと内部要素を区別できる

3. **視覚的な確認だけでは不十分**
   - スクリーンショットには2リストしか見えなかったが、DOM には4要素が存在
   - セレクタが実際に何にマッチしているか確認が必要

### デバッグ手法

1. **JSON レポートの詳細なエラーメッセージを確認**
   - `"Expected: 2, Received: 4"` から DOM 要素の重複を疑う

2. **コンポーネントのレンダリングコードを確認**
   - `data-testid` の付与箇所を検索
   - 複数箇所で同じプレフィックスが使われていないか確認

3. **スクリーンショットと DOM の差異に注意**
   - 非表示要素やオーバーレイ要素も DOM に存在する

---

## 🎯 次のステップ

### 残っているタスク

1. **drag エラーロールバック実装** ⏳
   - `page.route()` で API 失敗をモック
   - マウス API で D&D 操作を実行
   - UI が元の状態に復元されることを確認

2. **position 正規化ロジック実装** ⏳
   - 1000/10 刻みルールの実装
   - `expect.poll` で非同期待機を実装
   - 既存テストの強化

### 完了したタスク ✅

1. ✅ 毎テスト一意ボード作成に全面移行
2. ✅ @mentions/コメントを安定化
3. ✅ Realtime競合問題の解決
4. ✅ テストセレクタを修正

---

## 📁 関連ドキュメント

- **ガイド**: `/docs/detail/testing.md`
- **前回のチケット**: `/docs/tickets/2025-10-28/02-test-fixes-progress.md`
- **テスト結果サマリー**: `/docs/tickets/2025-10-28/01-test-results-summary.md`

---

**生成日時**: 2025-10-28
**実行環境**: Playwright 1.56.0, workers=4, retries=1
**修正結果**: 🎉 **2テスト完全修正 (4/4 passing)**
