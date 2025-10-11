# Ticket 03: モーダルルーティング実装（Intercepting Routes）

**Date**: 2025-10-11
**Priority**: 🔴 High
**Status**: 🟡 In Progress
**Phase**: 2.6 (UI/UX改善)

## 概要

GPT-5tの推奨に従い、Next.js App RouterのIntercepting Routes + Parallel Routesを使用して、カードモーダルを正しく実装する。

## GPT-5t推奨アーキテクチャ

### 基本方針

- **`/c/:short_id/:slug` を本物のルートとして実装**
- **Intercepting Routes + Parallel Routesでモーダル化**
- **クリック時 = モーダル、直リンク/更新時 = 単独ページ**
- **戻るボタンでモーダルが自然に閉じる**

### 主要な変更点

| 項目 | 現在（NG） | 推奨（OK） |
|-----|----------|----------|
| URL書き換え | `window.history.replaceState()` 多用 | Next.js Router API (`router.back()`) |
| ルート構成 | `/c/*` を rewrite で `/` に流す | `/c/*` を実体ルートとして実装 |
| モーダル実装 | State管理のみ | Intercepting Routes |
| スラッグ正規化 | クライアント側 | サーバー側 `permanentRedirect(308)` |
| 履歴管理 | replaceStateで履歴なし | pushで履歴あり（戻るで閉じる） |

## ディレクトリ構造

```
app/
  (board)/                    # ルートグループ（ボードビュー）
    page.tsx                  # カンバンボード（通常表示）
    layout.tsx                # モーダル用並列スロット配置
    @modal/                   # 並列ルート（モーダル専用）
      (..)c/                  # インターセプトルート
        [short_id]/
          [[...slug]]/
            page.tsx          # ← カードモーダル（Server Component）
      default.tsx             # モーダルなし時の表示
  c/                          # 実体ルート（直リンク用）
    [short_id]/
      [[...slug]]/
        page.tsx              # カード単独ページ + slug正規化
```

### ルーティングの仕組み

1. **ボード内でカードクリック**:
   - `<Link href="/c/AbCd1234/1-task-name">` をクリック
   - `(board)/@modal/(..)c/[short_id]/page.tsx` がインターセプト
   - → モーダル表示、URL: `/c/AbCd1234/1-task-name`

2. **直リンク・更新**:
   - `/c/AbCd1234/1-task-name` に直接アクセス
   - `c/[short_id]/[[...slug]]/page.tsx` が処理
   - → カード単独ページ表示

3. **戻るボタン**:
   - ブラウザバックまたは `router.back()`
   - → モーダルが閉じて、ボードビューに戻る

## 実装詳細

### 1. app/(board)/layout.tsx

```tsx
export default function BoardLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  return (
    <>
      {children}
      {modal}
    </>
  );
}
```

### 2. app/(board)/page.tsx（既存のKanbanBoard）

```tsx
'use client';

import Link from 'next/link';

export default function KanbanBoard() {
  // 既存のボードロジック

  return (
    <div>
      {boardData.lists.map(list => (
        <div key={list.id}>
          {list.cards.map(card => (
            <Link
              key={card.id}
              href={`/c/${card.short_id}/${card.id_short}-${card.slug}`}
            >
              <div className="card">
                {card.title}
              </div>
            </Link>
          ))}
        </div>
      ))}
    </div>
  );
}
```

### 3. app/(board)/@modal/(..)c/[short_id]/[[...slug]]/page.tsx

```tsx
import { notFound } from 'next/navigation';
import { CardModalClient } from './CardModalClient';

// Server Component
export default async function InterceptedCardModal({
  params,
}: {
  params: { short_id: string; slug?: string[] };
}) {
  // サーバー側でカード取得
  const card = await getCardByShortId(params.short_id);

  if (!card) {
    notFound();
  }

  // Client Componentにデータを渡す
  return <CardModalClient card={card} />;
}
```

### 4. app/(board)/@modal/(..)c/[short_id]/[[...slug]]/CardModalClient.tsx

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { CardModal } from '@/app/components/CardModal';

export function CardModalClient({ card }: { card: Card }) {
  const router = useRouter();

  const handleClose = () => {
    // 履歴を戻る = モーダルを閉じる
    router.back();
  };

  return (
    <CardModal
      card={card}
      onClose={handleClose}
      // ... 他のprops
    />
  );
}
```

### 5. app/(board)/@modal/default.tsx

```tsx
// モーダルがない時（通常のボードビュー）
export default function Default() {
  return null;
}
```

### 6. app/c/[short_id]/[[...slug]]/page.tsx（直リンク用）

```tsx
import { notFound, permanentRedirect } from 'next/navigation';

// Server Component
export default async function CardStandalonePage({
  params,
}: {
  params: { short_id: string; slug?: string[] };
}) {
  // カード取得
  const card = await getCardByShortId(params.short_id);

  if (!card) {
    notFound();
  }

  // スラッグ正規化（308リダイレクト）
  const expectedSlug = card.id_short && card.slug
    ? `${card.id_short}-${card.slug}`
    : card.slug || '';

  const currentSlug = params.slug?.join('/') || '';

  if (expectedSlug && currentSlug !== expectedSlug) {
    permanentRedirect(`/c/${card.short_id}/${expectedSlug}`);
  }

  // カード単独ページを表示
  return (
    <div className="container mx-auto p-4">
      <h1>{card.title}</h1>
      <p>{card.description}</p>
      {/* ... カード詳細表示 */}
    </div>
  );
}
```

### 7. app/components/CardModal.tsx（既存を修正）

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export function CardModal({
  card,
  onClose,
  // ... 他のprops
}: CardModalProps) {
  const router = useRouter();

  // Escキーで閉じる
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose(); // router.back() が呼ばれる
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose} // モーダル外クリックで閉じる
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* モーダル内容 */}
        <button onClick={onClose} aria-label="Close">
          ✕
        </button>
        {/* ... */}
      </div>
    </div>
  );
}
```

## データ取得の最適化

### サーバー側でカード取得（推奨）

```typescript
// lib/actions/card.ts
'use server';

import { createClient } from '@/lib/supabase/server';
import { cache } from 'react';

// React Cacheでキャッシュ
export const getCardByShortId = cache(async (shortId: string) => {
  const supabase = createClient();

  const { data: card, error } = await supabase
    .from('cards')
    .select('*')
    .eq('short_id', shortId)
    .single();

  if (error) return null;
  return card;
});
```

### クライアント側の最適化（必要な場合）

```typescript
// クライアント側でもshort_idインデックスを作る（ボード内検索用）
const cardsByShortId = useMemo(() => {
  const map = new Map<string, Card>();
  boardData.cards.forEach(card => {
    if (card.short_id) {
      map.set(card.short_id, card);
    }
  });
  return map;
}, [boardData.cards]);
```

## URLコピー機能

CardModalに「リンクをコピー」ボタンを追加：

```tsx
<button
  onClick={() => {
    const url = `${window.location.origin}/c/${card.short_id}/${card.id_short}-${card.slug}`;
    navigator.clipboard.writeText(url);
  }}
>
  📋 Copy Link
</button>
```

## next.config.js の変更

**rewriteを削除**：

```javascript
// Before (NG)
module.exports = {
  async rewrites() {
    return [
      { source: '/c/:short_id*', destination: '/' },
    ];
  },
};

// After (OK) - rewriteを削除
module.exports = {
  // ... 他の設定のみ
};
```

## 移行手順

### フェーズ1: ディレクトリ構造作成

1. `app/(board)` ディレクトリ作成
2. 既存の `app/page.tsx` を `app/(board)/page.tsx` に移動
3. `app/(board)/layout.tsx` 作成（並列スロット対応）
4. `app/(board)/@modal/(..)c/[short_id]/[[...slug]]/page.tsx` 作成
5. `app/(board)/@modal/default.tsx` 作成

### フェーズ2: カード単独ページ作成

1. `app/c/[short_id]/[[...slug]]/page.tsx` 作成
2. `getCardByShortId()` Server Action実装
3. slug正規化ロジック実装（`permanentRedirect`）

### フェーズ3: カードリンク化

1. SortableCardを`<Link>`でラップ
2. `onClick`ハンドラ削除（Linkのデフォルト動作を使う）
3. CardModal の `onClose` を `router.back()` に変更

### フェーズ4: テスト・検証

1. E2Eテスト更新
2. 動作確認（モーダル、直リンク、戻る）
3. パフォーマンス確認
4. next.config.js から rewrite削除

### フェーズ5: クリーンアップ

1. 不要なコード削除（`window.history.replaceState`等）
2. 既存の`app/c/[short_id]/[[...slug]]/page.tsx`（旧実装）削除
3. ドキュメント更新

## E2Eテストの変更

```typescript
test('should open card modal on click', async ({ page }) => {
  await page.goto('/');

  // カードをクリック
  await page.getByText('Test Card').click();

  // URLが /c/:short_id/:slug に変わる
  await expect(page).toHaveURL(/\/c\/[a-zA-Z0-9]+\/\d+-/);

  // モーダルが表示される
  await expect(page.locator('[role="dialog"]')).toBeVisible();

  // 戻るボタンでモーダルが閉じる
  await page.goBack();
  await expect(page).toHaveURL('/');
  await expect(page.locator('[role="dialog"]')).not.toBeVisible();
});

test('should open card directly from URL', async ({ page }) => {
  // 直リンクでアクセス
  await page.goto('/c/AbCd1234/1-test-card');

  // カード単独ページが表示される（モーダルではない）
  await expect(page.locator('h1')).toContainText('Test Card');
  await expect(page.locator('[role="dialog"]')).not.toBeVisible();
});

test('should redirect wrong slug to correct one', async ({ page }) => {
  // 間違ったslugでアクセス
  await page.goto('/c/AbCd1234/wrong-slug');

  // 正しいslugにリダイレクト（308）
  await expect(page).toHaveURL('/c/AbCd1234/1-test-card');
});
```

## パフォーマンス最適化

### React Cacheの活用

```typescript
// lib/actions/card.ts
import { cache } from 'react';

export const getCardByShortId = cache(async (shortId: string) => {
  // 同じリクエスト内で複数回呼ばれても1回だけDB問い合わせ
  // ...
});
```

### データプリフェッチ（オプション）

```tsx
// ホバー時にプリフェッチ
<Link
  href={`/c/${card.short_id}/${card.slug}`}
  prefetch={true} // デフォルトでtrue
>
  {card.title}
</Link>
```

## アクセシビリティ対応

### モーダル

- `role="dialog"`
- `aria-modal="true"`
- `aria-labelledby="modal-title"`
- フォーカストラップ（react-focus-lockなど）
- Escapeキーで閉じる
- 閉じるボタンにaria-label

### カード単独ページ

- 適切な見出し階層（h1, h2, ...）
- パンくずリスト（オプション）
- `<title>`タグの動的設定

## SEO対応

### metadata設定

```typescript
// app/c/[short_id]/[[...slug]]/page.tsx
export async function generateMetadata({ params }) {
  const card = await getCardByShortId(params.short_id);

  return {
    title: card.title,
    description: card.description,
    alternates: {
      canonical: `/c/${card.short_id}/${card.id_short}-${card.slug}`,
    },
  };
}
```

## リグレッションチェックリスト

- [ ] ボード内でカードクリック → モーダル表示、URL: `/c/:short_id/:slug`
- [ ] モーダル状態で戻るボタン → モーダルが閉じる、URL: `/`
- [ ] `/c/:short_id/:slug` に直接アクセス → カード単独ページ表示
- [ ] 間違ったslugでアクセス → 308で正規URLにリダイレクト
- [ ] Escapeキーでモーダルが閉じる
- [ ] モーダル外クリックでモーダルが閉じる
- [ ] リンクコピーボタンが動作
- [ ] ドラッグ&ドロップとクリックが競合しない
- [ ] モバイルでスムーズに動作
- [ ] ページ遷移・再読み込みなし（待ち時間ゼロ）
- [ ] 既存E2Eテストが通る
- [ ] 新しいE2Eテストが通る

## メリット

1. **Next.js公式パターン準拠** - 保守性・理解しやすさ向上
2. **自然な履歴管理** - 戻るボタンでモーダルが閉じる
3. **SEO最適化** - 308リダイレクト、canonical URL
4. **パフォーマンス** - React Cache、適切なキャッシュ戦略
5. **アクセシビリティ** - 正しいARIA属性、フォーカス管理
6. **DX向上** - History APIの罠を回避、シンプルな実装

## デメリット

1. **大規模なリファクタリング** - ディレクトリ構造変更
2. **学習コスト** - Intercepting Routes + Parallel Routesの理解が必要
3. **既存コードとの互換性** - 一部書き直し必要

## 実装タスク

- [ ] `app/(board)` ディレクトリ構造作成
- [ ] `app/(board)/layout.tsx` 実装
- [ ] `app/(board)/@modal/(..)c/[short_id]/[[...slug]]/page.tsx` 実装
- [ ] `app/(board)/@modal/default.tsx` 実装
- [ ] `app/c/[short_id]/[[...slug]]/page.tsx` 実装（slug正規化含む）
- [ ] `getCardByShortId()` Server Action実装
- [ ] SortableCardを`<Link>`化
- [ ] CardModalの`onClose`を`router.back()`に変更
- [ ] next.config.jsからrewrite削除
- [ ] E2Eテスト更新
- [ ] 動作確認
- [ ] パフォーマンス測定
- [ ] アクセシビリティ確認
- [ ] ドキュメント更新
- [ ] コミット

## 参考リンク

- [Next.js Intercepting Routes](https://nextjs.org/docs/app/api-reference/file-conventions/intercepting-routes)
- [Next.js Parallel Routes](https://nextjs.org/docs/app/building-your-application/routing/parallel-routes)
- [permanentRedirect](https://nextjs.org/docs/app/api-reference/functions/permanentRedirect)
- [React Cache](https://react.dev/reference/react/cache)
- [GPT-5t回答](../02-url-shortid-optimization.md#gpt5t返信)
