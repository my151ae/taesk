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

## GPT5t返信
了解。現状案（特に「rewrite＋`replaceState` 多用」）は、**Next.js App Routerの“モーダル用ルーティング”の素振りと逆行**していて、将来の保守やUXで詰みポイントが出そうです。短く結論→詳細レビュー→修正案→テスト観点の順でまとめます。

---

# TL;DR（結論）

* **`/c/<short_id>/<idShort>-<slug>` を“本物のルート”として持ち、Interception + Parallel Routesでモーダル化**しましょう。
  → クリック時はモーダル、直リンク/更新時は単独ページという**公式推奨パターン**。戻る/進むも自然に効く。([Next.js][1])
* **スラッグ不一致はサーバー側で `permanentRedirect()`（=308）**。履歴・SEO・解析も正しく揃います。([Next.js][2])
* **`window.history.replaceState` 連発は原則やめる**（履歴が積まれず“戻るで閉じる”が壊れやすい）。必要なら `router.push/replace` を使う。([MDN Web Docs][3])
* **`rewrites` で `/c/* → /` に流す設計は非推奨**（ソフト200・キャッシュ衝突・計測/SEOの混乱の温床）。rewriteは「URLを**見かけ上**変えないプロキシ」。ここでは**redirect**や**インターセプト**が適任。([Next.js][4])

---

# 実装レビュー（問題点）

1. **履歴制御が不自然**
   モーダル表示に `replaceState` を使うと**履歴エントリが増えず**、ユーザーの「戻る＝モーダルを閉じる」が崩れます。History API自体も`push/replace`では`popstate`が即時には発火しない等の癖があり、ハンドリングが複雑化。([MDN Web Docs][3])

2. **二重URL管理と“真実の所在”の曖昧さ**
   `/?board=...&card=...` と `/c/:short_id/:slug` の**二重管理**は同期ズレの温床。**URL＝状態のソースオブトゥルース**に寄せるべきです。

3. **rewriteで `/c/*` を `/` に集約**
   Rewritesは**見かけのURLを保ったまま他パスの内容を返す**機能。ページ実体が`/`に寄るため、**キャッシュ鍵・解析・SEOの整合**が壊れがち。ここは**“本物の /c ルート”**を使い、UIだけモーダルに。([Next.js][4])

4. **Next.jsのモーダル設計と逆行**
   App Routerは**Intercepting Routes + Parallel Routes**で「ギャラリー→写真モーダル」のような**“直リンクは単ページ / クリックはモーダル”**を公式に用意。これを使えば**URLも履歴も自然**に。([Next.js][1])

---

# 改善提案（推奨アーキテクチャ）

## 1) ルート構成（App Router）

```
app/
  (board)/
    page.tsx                 // カンバン（通常表示）
    @modal/                  // モーダル用並列スロット
      (.. )c/
        [short_id]/
          page.tsx           // ← ここが「インターセプトされたカード」= モーダル表示
  c/
    [short_id]/
      page.tsx               // 直リンク時のフルページ表示
```

* `(board)/@modal/(..)c/[short_id]` が **インターセプト**。通常の`/c/[short_id]`はそのまま実体ページ。
* この構成で**クリック＝モーダル**、**直リンク/更新＝単ページ**、**戻る＝モーダルを閉じる**が自動で整います。([Next.js][1])

**リンク側（カードクリック）**

```tsx
<Link href={`/c/${shortId}/${idShort}-${slug}`}>…</Link> 
// クリック時は (board) 配下からインターセプトされモーダルで出る
```

## 2) スラッグ正規化（サーバー側で308）

`app/c/[short_id]/page.tsx`（Server Component）でカード取得→`expected = \`${idShort}-${slug}``を算出し、  `params`が不一致なら`permanentRedirect(`/c/${shortId}/${expected}`)`。**308**なのでSEO/共有リンクも安定。([Next.js][2])

## 3) クライアント側の履歴操作は最小限

* 原則 `window.history.*` は**使わない**。
* ボタンでのクローズは `router.back()`（=モーダルを閉じる歴史に戻る）で自然挙動。
* どうしてもURLだけ置換したい場面は `router.replace()` を検討。([Qiita][5])

## 4) rewriteの撤廃

* **`/c/* → /` rewrite**は削除。実体ルート`/c`を用意し、**インターセプト**でモーダル化。
* RewritesはAPIプロキシ等、別用途に限定。([Next.js][4])

## 5) そのほか運用指針

* **コピー用リンク**は2本立て（短縮 `/c/<short_id>` と可読 `/c/<short_id>/<idShort>-<slug>`）。
* `generateMetadata()` で `<link rel="canonical">` を `/c/<short_id>/<slug>` に。
* アクセシビリティ：モーダルは**フォーカストラップ、`aria-modal`, `role="dialog"`**, 閉じるボタンは**`router.back()`**で履歴連携。
* `short_id` 検索はサーバー側（DBインデックス）で解決し、クライアントは極力受け取るだけに。

---

# サンプル断片（最小）

**インターセプト側（モーダル）** – `app/(board)/@modal/(..)c/[short_id]/page.tsx`

```tsx
// Server Component: カード取得
export default async function CardModal({ params }) {
  const card = await getCardByShortId(params.short_id); // DB等
  return <Modal card={card} />; // client component with focus-trap
}
```

**直リンク側（正規化）** – `app/c/[short_id]/page.tsx`

```tsx
import { permanentRedirect } from 'next/navigation';

export default async function CardPage({ params }) {
  const card = await getCardByShortId(params.short_id);
  if (!card) notFound();

  const expected = `${card.idShort}-${card.slug}`;
  const got = /* params から後段スラッグ取り出し */;
  if (expected && got !== expected) {
    permanentRedirect(`/c/${card.shortId}/${expected}`); // 308
  }
  return <CardStandalone card={card} />;
}
```

（※実装全体はこの方針で落とし込みます。ここでは最小のみ）

---

# パフォーマンス/SEO/UXの効果

* **UX**: 戻る/進むが自然（公式モーダルパターン）。([Next.js][1])
* **SEO**: **308正規化**で重複排除・リンク資産集中。([Next.js][2])
* **計測**: 実体ページが `/c/*` なので、パス別の解析が正確。
* **保守**: History APIの罠回避。ルーターAPIと公式パターンで一貫性。

---

# リグレッション用チェックリスト

* 直リンク `/c/<sid>/<slug>` 直開→単ページで表示
* `/c/<sid>` 直開→自動で最新スラッグに308
* ボードからクリック→モーダルで開く／**戻る**で閉じる
* タイトル変更→URL生成が新スラッグに／旧URLは308で正規化
* ネットワーク遅延でもモーダル開閉の**待ちなし**（UIは先に開き、データはSWR/React Cacheで）
* アクセシビリティ：フォーカス遷移、Esc閉じる、スクリーンリーダー読み上げ
* 解析：`/c/*` でイベントが取れること
* 既存E2E：モーダル経由/直リンク経由の両系統

---

# いただいた質問への即答

1. **この実装以外に正解は？**
   → 公式の**Intercepting Routes + Parallel Routes**が最適解。([Next.js][1])
2. **Next.js 15でのベストプラクティス？**
   → 上記パターン＋**サーバー側で`permanentRedirect(308)`による正規化**。([Next.js][2])
3. **`replaceState` 多用は問題？**
   → 履歴が積まれず「戻るで閉じる」が壊れがち。基本**Router API**を使う。([MDN Web Docs][3])
4. **rewriteなしで実現？**
   → **可能**。`/c/*` を**実体ルート**にし、**インターセプト**でモーダル化。([Next.js][1])
5. **パフォーマンス懸念？**
   → ルート実体化で**キャッシュ鍵が明確**になり安定。クライアント側は余計な再レンダや`useEffect`同期を減らせる。
6. **SEO/アクセシビリティ？**
   → **308正規化＋canonical**でSEO良化。モーダルは**ARIA/フォーカス管理**を実装（構造化はそのまま）。([Next.js][6])

---

必要なら、この方針で**フォルダ構成・最小コード**まで一気に差し替え案を作ります（クリック→モーダル、直リンク→単ページ、slug正規化、テスト観点まで）。

[1]: https://nextjs.org/docs/app/api-reference/file-conventions/intercepting-routes "File-system conventions: Intercepting Routes | Next.js"
[2]: https://nextjs.org/docs/app/api-reference/functions/permanentRedirect?utm_source=chatgpt.com "Functions: permanentRedirect | Next.js"
[3]: https://developer.mozilla.org/ja/docs/Web/API/History_API/Working_with_the_History_API?utm_source=chatgpt.com "履歴 API の操作 - Web API | MDN - MDN Web Docs"
[4]: https://nextjs.org/docs/pages/api-reference/config/next-config-js/rewrites?utm_source=chatgpt.com "next.config.js Options: rewrites | Next.js"
[5]: https://qiita.com/Naoya__in_web/items/9f547e7e6078072673bb?utm_source=chatgpt.com "【Next.js】useRouter の5大メソッドまとめ｜push・replace・back ..."
[6]: https://nextjs.org/docs/14/app/building-your-application/routing/redirecting?utm_source=chatgpt.com "Routing: Redirecting | Next.js"