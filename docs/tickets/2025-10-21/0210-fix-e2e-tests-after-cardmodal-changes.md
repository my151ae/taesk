# 0210 - E2Eテスト修正（CardModal変更対応）

**作成日**: 2025-10-21
**関連**: 0202 CardModal統合
**優先度**: High

---

## 🎯 ゴール

CardModalへのCommentsタブ追加（0202）により失敗した34件のE2Eテストを修正し、全テストを通過させる。

---

## 📝 背景

### 実施した変更（0202）
- CardModalに`Details`/`Comments`タブを追加
- デフォルトで`Details`タブが選択される
- モーダル構造が変更された

### テスト結果
- **成功**: 16/50 (32%)
- **失敗**: 34/50 (68%)
- **実行時間**: 115秒

### 主な失敗原因（推測）
1. **要素が見つからない**: タブ内に隠れている要素へのアクセス
2. **セレクタの不一致**: モーダル構造変更による既存セレクタの無効化
3. **タイミング問題**: タブ切り替えによる要素表示の遅延

---

## 🔍 失敗パターン分析

### パターン1: CardModal内の要素アクセス
**影響を受けるテスト:**
- `should edit a card` (kanban.spec.ts:326)
- `should delete a card` (kanban.spec.ts:403)
- `should assign and clear a card assignee` (kanban.spec.ts:449)

**問題:**
```typescript
// 既存テスト
const titleInput = page.locator('input[placeholder="Card title"]');
await titleInput.waitFor({ state: 'visible' });
```

**修正方針:**
```typescript
// タブ選択を明示
await page.getByRole('button', { name: 'Details' }).click();
const titleInput = page.locator('input[placeholder="Card title"]');
await titleInput.waitFor({ state: 'visible' });
```

### パターン2: モーダル構造の変更
**影響を受けるテスト:**
- カードモーダルを開くすべてのテスト
- URL遷移テスト

**問題:**
- タブUIの追加により、DOMの深さが変化
- role="dialog"の位置が変わった可能性

**修正方針:**
- より具体的なセレクタに変更
- aria-labelやdata-testidの活用

### パターン3: タイミング問題
**影響を受けるテスト:**
- drag and drop関連
- 連続操作テスト

**問題:**
- タブ切り替えのアニメーションで遅延
- Reactのstate更新タイミング変化

**修正方針:**
- `waitForTimeout`の調整
- より確実な要素待機

---

## 📦 実装タスク

### Task 1: テスト失敗の詳細分析
- [ ] HTMLレポート（http://127.0.0.1:9323）で全失敗を確認
- [ ] 失敗パターンをカテゴリ分類（要素不在/タイムアウト/アサーション失敗）
- [ ] 優先度の高いテストから特定（基本CRUD > 高度な機能）

### Task 2: CardModal関連テストの修正
- [ ] `should edit a card` - Detailsタブ選択を追加
- [ ] `should delete a card` - 同上
- [ ] `should assign and clear a card assignee` - 同上
- [ ] モーダル開閉テスト全般の見直し

### Task 3: セレクタの改善
- [ ] CardModal.tsxにdata-testid追加（必要に応じて）
- [ ] より堅牢なセレクタに変更（role > placeholder > class）
- [ ] タブ切り替え用ヘルパー関数作成

### Task 4: タイミング調整
- [ ] waitForTimeout → waitFor({ state: 'visible' })に変更
- [ ] アニメーション完了を確実に待つ
- [ ] タブ切り替え後の安定待機

### Task 5: テストユーティリティ改善
- [ ] `test-summary.js`で失敗詳細を表示（エラーメッセージ含む）
- [ ] `quick-test.sh`で特定テストのみ実行できるよう改善
- [ ] CI/CDでのテストレポート保存

---

## ✅ 受け入れ基準

- [ ] 全50件のE2Eテストが通過（expected: 50, unexpected: 0）
- [ ] テスト実行時間が120秒以内
- [ ] `npm run build`が成功
- [ ] CardModal関連テストが安定して通る（3回連続成功）

---

## 🧪 テスト実行コマンド

### 全テスト実行
```bash
npx playwright test --reporter=json > playwright-report.json
node test-summary.js
```

### 個別ファイル実行
```bash
./quick-test.sh e2e/kanban.spec.ts
```

### HTMLレポート確認
```bash
npx playwright show-report --host 127.0.0.1 --port 9323
# Open http://127.0.0.1:9323
```

### 特定テストのみ
```bash
npx playwright test -g "should edit a card"
```

---

## 📎 参考情報

### 作成したツール
- `test-summary.js` - JSONレポートのシンプル表示
- `quick-test.sh` - 個別テストファイル実行
- `test-runner.sh` - 見やすいレポート生成

### 関連ファイル
- `app/components/CardModal.tsx` - 変更されたモーダル
- `e2e/kanban.spec.ts` - メインテストファイル
- `playwright.config.ts` - Playwright設定

### デバッグTips
```typescript
// スクリーンショット撮影
await page.screenshot({ path: 'debug.png' });

// 要素の存在確認
const element = await page.locator('selector').count();
console.log('Element count:', element);

// タブの状態確認
const activeTab = await page.locator('[aria-selected="true"]').textContent();
console.log('Active tab:', activeTab);
```

---

## ❓ オープン課題

1. **Commentsタブのテストは必要か？**
   - 現状: コメント機能のE2Eテストは未作成
   - 対応: 別チケット（0209）で対応予定

2. **data-testid導入の是非**
   - メリット: テストが壊れにくい
   - デメリット: 本番コードへのテストコード混入
   - 方針: 必要最小限で導入（CardModalのタブなど）

3. **テスト実行時間の最適化**
   - 現状: 115秒（50テスト）
   - 目標: 60秒以内
   - 対策: 並列実行数調整、不要なwaitForTimeout削減

---

## 📊 進捗トラッキング

### Phase 1: 分析（30分）
- [ ] HTMLレポートで全失敗確認
- [ ] 失敗パターン分類
- [ ] 修正計画作成

### Phase 2: 修正（2-3時間）
- [ ] CardModal関連テスト修正（10件程度）
- [ ] その他のUI変更影響修正（24件程度）
- [ ] セレクタ改善

### Phase 3: 検証（30分）
- [ ] 全テスト実行
- [ ] 3回連続成功確認
- [ ] レポート更新

---

## 🚀 完了条件

1. `npx playwright test`で全テスト成功
2. `node test-summary.js`で以下を確認:
   ```
   ✅ Passed:  50
   ❌ Failed:  0
   ⏭️  Skipped: 0
   ```
3. ドキュメント更新（このチケットに結果記載）
4. コミット・プッシュ

---

**作成者**: Claude
**レビュー**: 未
**ステータス**: 🔴 未着手
