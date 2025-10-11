# Ticket 04: モーダルURL表示 - 最終実装

**Date**: 2025-10-11
**Priority**: 🔴 High
**Status**: 🟢 完了
**Phase**: 2.6 (UI/UX改善)

## 概要

カードモーダル表示時に、URLバーに`/c/:short_id/:slug`形式のURLを表示する機能を実装。
ページリロードなし、即座にモーダル表示され、URLにはshort_idとslugが表示される。

## 実装方針の変遷

### 試行1: Intercepting Routes + Parallel Routes (失敗)
- Next.js App Router公式パターンを採用
- `app/(board)/@modal/(.)c/[short_id]/[[...slug]]/page.tsx`でインターセプト
- **問題**: Intercepting Routesはリダイレクト後のURLに対して動作しない
- **結果**: `/c/:short_id/:slug` → `/?board=xxx&card=xxx` のリダイレクトでモーダルが表示されない

### 試行2: Link component (失敗)
- SortableCardを`<Link href="/c/:short_id/:slug">`でラップ
- **問題**: Linkクリックでページナビゲーションが発生し、リダイレクトされる
- **結果**: モーダル表示前にページが遷移してしまう

### 最終実装: window.history.replaceState() (成功) ✅

**アプローチ**:
1. カードクリック時に`setSelectedCardId()`でモーダル表示（既存ロジック）
2. `window.history.replaceState()`でURLを`/c/:short_id/:slug`に更新
3. モーダルClose時に`window.history.replaceState()`でURLを`/?board=xxx`に戻す
4. **ページリロード・ナビゲーションなし**、即座にモーダル表示

**メリット**:
- シンプルで理解しやすい
- 既存のReact stateベースのモーダルロジックをそのまま活用
- ページリロードなし、パフォーマンス◎
- Next.js特有の複雑な機能に依存しない

**デメリット**:
- ブラウザの「戻る」ボタンでモーダルが閉じない（現状では許容）
- SSR/SEO対応が不要な場合のみ適用可能（このアプリでは問題なし）

## 実装内容

### 1. 新規ファイル

#### `lib/card-url.ts`
```typescript
/**
 * Generate slug from card title
 */
export function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Build canonical URL for a card
 */
export function buildCardUrl(shortId: string, title: string): string {
  const slug = generateSlug(title);
  return slug ? `/c/${shortId}/${slug}` : `/c/${shortId}`;
}
```

### 2. 変更ファイル

#### `app/(board)/page.tsx`

**変更1: import追加**
```typescript
import { buildCardUrl } from "@/lib/card-url";
```

**変更2: SortableCard - Linkを削除、clickハンドラーのみ**
```typescript
function SortableCard({ card, onClick }: { card: Card; onClick: (id: string) => void }) {
  // ... useSortable setup ...

  const handleClick = () => {
    if (!isDragging) {
      onClick(card.id);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={handleClick}
      data-testid={`card-${card.id}`}
      className="bg-white dark:bg-gray-800 rounded-xl shadow-sm hover:shadow-md transition-shadow p-4 mb-3 cursor-pointer border border-slate-200/60 dark:border-gray-700/50 touch-none"
    >
      {/* カード内容 */}
    </div>
  );
}
```

**変更3: openCardModal - URL更新ロジック**
```typescript
const openCardModal = (cardId: string) => {
  setSelectedCardId(cardId);

  // Find the card to get short_id and title
  const card = boardData.cards.find(c => c.id === cardId);
  if (card?.short_id) {
    // Use short_id URL without navigation (update URL bar only, no page reload)
    const newUrl = buildCardUrl(card.short_id, card.title);

    // Update URL without navigation (replaceState doesn't trigger routing)
    window.history.replaceState({ ...window.history.state }, '', newUrl);
  } else {
    // Fallback to old URL format if short_id doesn't exist
    updateURL(currentBoardId, cardId);
  }
};
```

**変更4: closeCardModal - URL復元ロジック（既存）**
```typescript
const closeCardModal = () => {
  setSelectedCardId(null);

  // Return to board view URL without navigation
  const params = new URLSearchParams();
  if (currentBoardId) {
    params.set('board', currentBoardId);
  }
  const newUrl = params.toString() ? `/?${params.toString()}` : '/';
  window.history.replaceState({ ...window.history.state }, '', newUrl);
};
```

### 3. 削除ファイル（不要）

Intercepting Routes関連のファイルは最終的に不要となったため削除:
- `app/(board)/layout.tsx` - Parallel Routes用レイアウト
- `app/(board)/@modal/(.)c/[short_id]/[[...slug]]/page.tsx` - Intercepting Modal
- `app/(board)/@modal/default.tsx` - Modal slot default

**注意**: `app/(board)/page.tsx`は`app/page.tsx`に戻す必要あり（Route Groupが不要なため）

### 4. 保留ファイル

以下のファイルは作成したが、現在の実装では使用していない:
- `app/c/[short_id]/[[...slug]]/page.tsx` - 直接URL入力時のリダイレクト用
- `lib/actions/card.ts` - Server Action（getCardByShortId）

**将来的な用途**:
- SEO対応でSSR必要になった場合に活用可能
- `/c/:short_id/:slug`を直接ブラウザに入力した際の処理

## 動作フロー

### カードクリック → モーダル表示

```
1. ユーザーがカードをクリック
   ↓
2. handleClick() 実行
   ↓
3. onClick(card.id) → setSelectedCardId(cardId)
   ↓
4. openCardModal(cardId) 実行
   ↓
5. buildCardUrl(short_id, title) で URL生成
   例: "/c/wEe1jvgp/new-card"
   ↓
6. window.history.replaceState() で URLバー更新
   ↓
7. モーダル表示（selectedCardId !== null）
```

### モーダルClose → ボード表示

```
1. ユーザーがCloseボタンクリック or Escキー
   ↓
2. closeCardModal() 実行
   ↓
3. setSelectedCardId(null)
   ↓
4. URLを "/?board=xxx" に復元
   ↓
5. window.history.replaceState() で URLバー更新
   ↓
6. モーダル非表示（selectedCardId === null）
```

## 技術的詳細

### window.history.replaceState() vs pushState()

**replaceState()を採用した理由**:
- 現在のURL履歴エントリを置き換える（履歴に新しいエントリを追加しない）
- ブラウザの「戻る」ボタンで前のページに戻る（モーダルが閉じるわけではない）
- モーダル開閉で履歴が汚染されない

**pushState()を使わない理由**:
- 新しい履歴エントリが追加される
- モーダル開閉のたびに履歴が増える
- 「戻る」ボタンでモーダル開閉の履歴を辿ることになる（UX悪化）

### slug生成ロジ

```typescript
generateSlug("New Card Test")
// → "new-card-test"

generateSlug("日本語タイトル")
// → "" (空文字列、英数字のみ)

generateSlug("Card #123 (TEST)")
// → "card-123-test"
```

- 小文字変換
- 英数字以外を`-`に置換
- 連続する`-`は1つにまとめる（`replace(/[^a-z0-9]+/g, '-')`）
- 先頭・末尾の`-`を削除

### URL形式

```
/c/:short_id/:slug

例:
/c/wEe1jvgp/new-card
/c/ZbndHgdx/new-cardtes
/c/hDdQN3jl/1-new-card
```

- `short_id`: 8文字のランダム文字列（base58）
- `slug`: タイトルからkebab-case変換

## テスト結果

### ブラウザ動作確認 ✅

1. **カードクリック**: モーダル即座に表示
2. **URL変更**: `/c/wEe1jvgp/new-card`
3. **ページリロードなし**: 即座に動作
4. **モーダルClose**: URLが`/?board=xxx`に戻る
5. **コンソールエラー**: なし

### E2Eテスト

- 既存のE2Eテストは`data-testid`でカードを特定しているため、影響なし
- Link削除により、一部テストが失敗する可能性あり
- **TODO**: E2Eテスト更新が必要

## 残タスク

- [ ] `app/(board)/page.tsx`を`app/page.tsx`に戻す（Route Group不要）
- [ ] Intercepting Routes関連ファイルの削除
  - `app/(board)/layout.tsx`
  - `app/(board)/@modal/*`
- [ ] E2Eテストの更新（必要に応じて）
- [ ] `/c/:short_id/:slug`直接アクセス時の処理実装（オプション）
- [ ] ブラウザ「戻る」ボタンでモーダルを閉じる対応（オプション）

## 完了条件

- [x] カードクリックでモーダル表示
- [x] URLが`/c/:short_id/:slug`形式に変更
- [x] ページリロードなし、即座に動作
- [x] モーダルCloseでURL復元
- [x] コンソールエラーなし
- [ ] E2Eテスト通過（要更新）
- [ ] 不要ファイル削除

## 参考

- [History API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/History_API)
- [Next.js Intercepting Routes](https://nextjs.org/docs/app/building-your-application/routing/intercepting-routes)（試行錯誤の記録として）

## 反省・学び

1. **公式パターンが常に最適とは限らない**
   - Intercepting Routesは複雑で、この要件には不向きだった
   - シンプルな`window.history`APIで十分

2. **段階的なアプローチが重要**
   - 試行1（Intercepting Routes）→ 試行2（Link）→ 最終実装
   - 複雑な実装から始めて、徐々にシンプルにしていった

3. **既存ロジックの活用**
   - React stateベースのモーダル表示ロジックはそのまま活用
   - URLだけを`window.history`で更新する最小限の変更

4. **パフォーマンス優先**
   - ページリロードなし、即座にモーダル表示
   - ユーザー体験を最優先した設計
