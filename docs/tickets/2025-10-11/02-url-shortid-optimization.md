# Ticket 02: URL short_id表示最適化

**Date**: 2025-10-11
**Priority**: 🔴 High
**Status**: 🟡 計画中
**Phase**: 2.6 (UI/UX改善)

## 現状の問題

### 実装の問題点

1. **URLルーティングの混乱**
   - `/c/:short_id/:slug` にアクセス → `/c/[short_id]/[[...slug]]/page.tsx` が処理
   - `window.history.replaceState()` でURL変更 → Next.jsが新しいページとして認識
   - 結果：ページ再レンダリングが発生する可能性

2. **二重URL管理**
   - `/?board=xxx&card=yyy` （内部管理用）
   - `/c/:short_id/:slug` （表示用）
   - どちらが真実の状態か不明確

3. **パフォーマンス懸念**
   - モーダル開閉のたびにURL書き換え
   - Next.jsのルーティングシステムと競合する可能性
   - 「待たせる動き」が発生する可能性

### 現在の実装フロー

```typescript
// カードクリック
openCardModal(cardId)
  → boardData.cards.find(c => c.id === cardId)
  → window.history.replaceState('/c/short_id/slug')
  → Next.jsが `/c/[short_id]/page.tsx` を検索？
  → 混乱

// モーダル閉じる
closeCardModal()
  → window.history.replaceState('/?board=xxx')
  → 再度ルーティング混乱？
```

## 理想の仕様

### 基本方針

**「画面上は常にshort_id URLを表示、内部的にはReact Stateで管理」**

### 要件

1. **即座にURL変更**
   - カードクリック → 瞬時にURL変更（`/c/:short_id/:slug`）
   - ページ再読み込み一切なし
   - 待ち時間ゼロ

2. **URLとReact Stateの分離**
   - URL: 表示専用（`/c/:short_id/:slug` または `/`）
   - React State: 実際のデータ管理（`selectedCardId`）
   - URLからStateへの同期は初回ロード時のみ

3. **シンプルなルーティング**
   - `/` → KanbanBoard（ボードビュー）
   - `/c/:short_id/:slug` → KanbanBoard（ボードビュー + モーダル）
   - 常に同じコンポーネント、モーダルの開閉だけが違う

4. **short_idベースの設計**
   - 内部的にも可能な限りshort_idで管理
   - UUIDは最小限の使用（DB操作のみ）

## 技術的アプローチ案

### 案1: URLパラメータ完全無視アプローチ

```typescript
// ページコンポーネント (app/page.tsx)
function KanbanBoard() {
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  // 初回ロード時のみURLから状態を復元
  useEffect(() => {
    const path = window.location.pathname;
    if (path.startsWith('/c/')) {
      const shortId = path.split('/')[2];
      const card = findCardByShortId(shortId);
      if (card) setSelectedCardId(card.id);
    }
  }, []); // 依存配列空 = 初回のみ

  const openCardModal = (cardId: string) => {
    setSelectedCardId(cardId);

    const card = boardData.cards.find(c => c.id === cardId);
    if (card?.short_id) {
      const url = `/c/${card.short_id}/${card.id_short}-${card.slug}`;
      // URLだけ変更、Next.jsのルーティングは無視
      window.history.replaceState(null, '', url);
    }
  };

  const closeCardModal = () => {
    setSelectedCardId(null);
    window.history.replaceState(null, '', '/');
  };

  return (
    <>
      {/* ボードビュー */}
      <Board onClick={openCardModal} />

      {/* モーダル（selectedCardIdで制御） */}
      {selectedCardId && <CardModal card={...} onClose={closeCardModal} />}
    </>
  );
}
```

**メリット**:
- シンプル
- ページ遷移一切なし
- 高速

**デメリット**:
- Next.jsのルーティングシステムを無視（アンチパターン？）
- `/c/:short_id` への直接アクセスは別途 `/c/[short_id]/page.tsx` が必要

---

### 案2: Dynamic Route統合アプローチ

```typescript
// app/[[...slug]]/page.tsx (すべてのルートを統合)
function KanbanBoard({ params }: { params: { slug?: string[] } }) {
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  useEffect(() => {
    if (params.slug && params.slug[0] === 'c') {
      // /c/:short_id/:slug の場合
      const shortId = params.slug[1];
      const card = findCardByShortId(shortId);
      if (card) setSelectedCardId(card.id);
    }
  }, [params.slug]);

  // 以下同じ
}
```

**メリット**:
- Next.jsのルーティングに従う
- すべてのルートを1つのコンポーネントで処理

**デメリット**:
- `params` が変わるたびにuseEffect発火 = 再レンダリング？
- 複雑

---

### 案3: Middleware + Shallow Routing

```typescript
// middleware.ts
export function middleware(request: NextRequest) {
  const url = request.nextUrl;

  if (url.pathname.startsWith('/c/')) {
    // /c/:short_id → / にrewrite (URLは変えずに内部的に/)
    url.pathname = '/';
    return NextResponse.rewrite(url);
  }
}

// app/page.tsx
function KanbanBoard() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname.startsWith('/c/')) {
      const shortId = pathname.split('/')[2];
      const card = findCardByShortId(shortId);
      if (card) setSelectedCardId(card.id);
    }
  }, []); // 初回のみ

  // URLだけ変更、実際のルーティングはしない
  const openCardModal = (cardId: string) => {
    setSelectedCardId(cardId);
    const card = boardData.cards.find(c => c.id === cardId);
    if (card?.short_id) {
      const url = `/c/${card.short_id}/${card.id_short}-${card.slug}`;
      window.history.replaceState(null, '', url);
    }
  };
}
```

**メリット**:
- Next.jsのルーティングシステムと協調
- `/c/:short_id` も `/` も同じページコンポーネント
- パフォーマンス良好

**デメリット**:
- Middlewareの設定が必要

---

### 案4: app/c/[short_id]/page.tsx を削除、すべて app/page.tsx で処理

```typescript
// app/c/[short_id]/[[...slug]]/page.tsx を削除

// app/page.tsx
function KanbanBoard() {
  const pathname = usePathname();
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  // 初回ロード時のみURLから復元
  useEffect(() => {
    if (pathname.startsWith('/c/')) {
      const shortId = pathname.split('/')[2];
      const card = findCardByShortId(shortId);
      if (card) {
        setSelectedCardId(card.id);
        // URLを正規化（slugが間違っている場合）
        if (card.slug && !pathname.includes(card.slug)) {
          const correctUrl = `/c/${card.short_id}/${card.id_short}-${card.slug}`;
          window.history.replaceState(null, '', correctUrl);
        }
      } else {
        // カードが見つからない → ホームにリダイレクト
        window.history.replaceState(null, '', '/');
      }
    }
  }, []); // 空配列 = 初回のみ

  const openCardModal = (cardId: string) => {
    setSelectedCardId(cardId);
    const card = boardData.cards.find(c => c.id === cardId);
    if (card?.short_id) {
      const url = `/c/${card.short_id}/${card.id_short}-${card.slug}`;
      window.history.replaceState(null, '', url);
    }
  };

  const closeCardModal = () => {
    setSelectedCardId(null);
    window.history.replaceState(null, '', '/');
  };

  return (
    <>
      <Board onClick={openCardModal} />
      {selectedCardId && <CardModal onClose={closeCardModal} />}
    </>
  );
}
```

**問題**: `/c/:short_id` にアクセスすると404になる（app/c/page.tsxがないため）

**解決**: Next.jsの設定で `/c/*` を `/` にrewriteする

```typescript
// next.config.js
module.exports = {
  async rewrites() {
    return [
      {
        source: '/c/:short_id*',
        destination: '/',
      },
    ];
  },
};
```

**メリット**:
- 最もシンプル
- `/c/:short_id` も `/` も同じコンポーネント
- ページ遷移一切なし
- 高速

**デメリット**:
- Next.jsのファイルベースルーティングを一部無視

---

## 比較表

| アプローチ | シンプルさ | パフォーマンス | Next.js準拠 | 待ち時間 |
|----------|----------|-------------|-----------|---------|
| 案1: URLパラメータ無視 | ⭐⭐⭐ | ⭐⭐⭐ | ❌ | ゼロ |
| 案2: Dynamic Route統合 | ⭐ | ⭐⭐ | ⭐⭐⭐ | 少しある |
| 案3: Middleware | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ゼロ |
| 案4: Rewrite設定 | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ | ゼロ |

## 推奨アプローチ

**案4: Rewrite設定 + app/page.tsx統合**

理由：
1. **待ち時間ゼロ** - `window.history.replaceState()` のみ
2. **シンプル** - 1つのコンポーネントで完結
3. **高速** - ページ遷移なし、再レンダリングなし
4. **直感的** - URLが常にshort_idベース

## 実装手順

### 1. next.config.js にrewrite追加

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/c/:short_id*',
        destination: '/',
      },
    ];
  },
};

module.exports = nextConfig;
```

### 2. app/c/[short_id]/[[...slug]]/page.tsx を削除

既存の `/c/:short_id` ルートを削除し、すべて `/` で処理

### 3. app/page.tsx の修正

```typescript
'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

function KanbanBoard() {
  const pathname = usePathname();
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  // 初回ロード時のみURLから状態復元
  useEffect(() => {
    if (pathname.startsWith('/c/')) {
      const parts = pathname.split('/');
      const shortId = parts[2];

      // short_idからカードを検索
      const card = boardData.cards.find(c => c.short_id === shortId);

      if (card) {
        setSelectedCardId(card.id);

        // slugが正しいか確認、間違っていれば修正
        const expectedSlug = card.id_short && card.slug
          ? `${card.id_short}-${card.slug}`
          : card.slug || '';
        const currentSlug = parts[3] || '';

        if (expectedSlug && currentSlug !== expectedSlug) {
          const correctUrl = `/c/${card.short_id}/${expectedSlug}`;
          window.history.replaceState(null, '', correctUrl);
        }
      } else {
        // カードが見つからない → ホームに戻す
        window.history.replaceState(null, '', '/');
      }
    }
  }, []); // 空配列 = マウント時のみ実行

  const openCardModal = (cardId: string) => {
    setSelectedCardId(cardId);

    const card = boardData.cards.find(c => c.id === cardId);
    if (card?.short_id) {
      const slug = card.id_short && card.slug
        ? `${card.id_short}-${card.slug}`
        : card.slug || '';
      const url = `/c/${card.short_id}${slug ? '/' + slug : ''}`;

      // URLだけ変更（ページ遷移なし）
      window.history.replaceState(null, '', url);
    }
  };

  const closeCardModal = () => {
    setSelectedCardId(null);
    // ホームに戻す（ページ遷移なし）
    window.history.replaceState(null, '', '/');
  };

  return (
    <>
      <Board cards={boardData.cards} onClick={openCardModal} />
      {selectedCardId && (
        <CardModal
          card={boardData.cards.find(c => c.id === selectedCardId)!}
          onClose={closeCardModal}
        />
      )}
    </>
  );
}
```

### 4. データ取得の最適化

short_idベースでカードを検索する頻度が高いので、インデックスを作成：

```typescript
// カードのshort_idインデックス
const cardsByShortId = useMemo(() => {
  const map = new Map<string, Card>();
  boardData.cards.forEach(card => {
    if (card.short_id) {
      map.set(card.short_id, card);
    }
  });
  return map;
}, [boardData.cards]);

// 高速検索
const card = cardsByShortId.get(shortId);
```

## メリット

1. **待ち時間ゼロ** - `window.history.replaceState()` は同期処理
2. **ページ遷移なし** - Reactコンポーネントはそのまま
3. **URLが常に短い** - `/c/AbCdefGh/1-new-card`
4. **共有しやすい** - URLコピーですぐ共有可能
5. **SEO対応** - サーバーサイドで `/c/:short_id` も正しく処理
6. **シンプル** - 1つのページコンポーネントで完結

## デメリット

1. **Next.jsの規約から逸脱** - rewriteを使用
2. **既存の `/c/[short_id]/page.tsx` を削除** - 互換性の問題

## 代替案との比較

- **`router.push()`**: ページ遷移が発生 → ❌ 遅い
- **`?card=uuid`**: URLが長い、不格好 → ❌ UX悪い
- **Dynamic Route**: useEffect再実行 → ❌ パフォーマンス懸念

## 完了条件

- [ ] カードクリック → 瞬時にURL変更（`/c/:short_id/:slug`）
- [ ] ページ再読み込み・待ち時間ゼロ
- [ ] `/c/:short_id` に直接アクセス → モーダル表示
- [ ] モーダル閉じる → `/` に戻る（瞬時）
- [ ] slug間違い → 自動修正（301リダイレクトなし、replaceStateで修正）
- [ ] 既存のE2Eテスト通過

## 質問事項（GPT-5tに確認）

1. **この実装以外に正解はあるか？**
2. **Next.js 15でのベストプラクティスは？**
3. **window.history.replaceState() の多用は問題ないか？**
4. **rewriteを使わずに実現する方法は？**
5. **パフォーマンス上の懸念点は？**
6. **SEO・アクセシビリティへの影響は？**

## 参考

- Next.js Rewrites: https://nextjs.org/docs/app/api-reference/next-config-js/rewrites
- History API: https://developer.mozilla.org/en-US/docs/Web/API/History_API
- Trello URL Structure: https://trello.com/c/XXXXX/123-card-name
