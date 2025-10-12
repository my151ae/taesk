# ボード短縮URL：恒久対応ロードマップ＆実装仕様（Trello準拠・改訂版 v1.2）
**Rev**: 1.2  
**Date**: 2025-10-12  
**Author**: 松本Ops / レビュー反映（Step4をPhase2へ移動）

---

## 実装優先度
### Phase 1: 必須機能（Step 1-3）
このフェーズで `/b/...` の基本機能が完成します。  
- **Step 1**: SSR 基礎実装（サーバーコンポーネント）  
- **Step 2**: Realtime 購読の最適化  
- **Step 3**: Middleware による旧URL変換（KV キャッシュ）  

**Exit条件**: `/b/:short_id/:id_short-:slug` で SSR が機能し、`/?board=uuid` からのリダイレクトが安定。

### Phase 2: オプション最適化（Step 4）
Step 1-3 の実装・検証完了後に、体験向上のために導入します。  
- **Step 4**: Intercepting Routes & カードモーダル統合

**注**: Step 4 は Phase 1 完成後に、実運用の数値（遷移頻度・SSR TTFB・リアルタイムの安定性）を踏まえて再設計・再評価します。

---

## 用語
- **short_id**: Base62 8文字のユニークID（例: `aBcD1234`）
- **id_short**: ボードの連番（例: `1`）
- **slug**: タイトル由来のURL語（例: `main-board`）
- **正規URL**: `/b/:short_id/:id_short-:slug`
- **短縮URL**: `/b/:short_id`（省略 slug での到達）

---

## 前提（Step 0: 必要時のみ）
- DB: `boards.short_id (UNIQUE)`, `boards.id_short`, `boards.slug` が存在し、既存ボードへバックフィル済み。
- ユーティリティ: `createUniqueBoardShortId()`, `getNextBoardIdShort()`, `slugifyBoardName()`。
- URLビルダー: `buildBoardUrl(board)`, `buildBoardShortUrl(board)`。
- 共有UI: ボード詳細メニューに短縮・正規 URL コピー導線を用意。

**Exit条件**: 既存すべてのボードで `buildBoardUrl()` が正規URL（`/b/:short_id/:id_short-:slug`）を返却する。

---

# Step 1: SSR 基礎実装（サーバーコンポーネントで `/b/...` を確立）
**狙い**: 追加API呼び出し無しで **直接 `/b/...` にサーバーで到達**、slug の正規化もサーバーで解決。初期データは SSR で供給、Realtime はクライアントで購読。

### ルーティング
- 推奨: `app/(board)/b/[short_id]/[[...slug]]/page.tsx`（**Server Component**）
- 代替: `app/b/[short_id]/[[...slug]]/page.tsx`（ルート直下）

### 仕様
1. `short_id` でボードを取得（見つからなければ `notFound()`）。
2. `id_short` と `slug` で正規URLを構築。差異があれば `redirect(canonical)`（**1回のみ**）。
3. 初期データ（ボード、リスト等）を `KanbanBoardClient` へ props で渡す。
4. SEO: `<link rel="canonical">` を正規URLに、`og:url` も同値に。

### サンプル（Server）
```tsx
// app/(board)/b/[short_id]/[[...slug]]/page.tsx
import { notFound, redirect } from 'next/navigation'
import { getBoardByShortId, fetchBoardInitialData } from '@/lib/server/boards'
import { buildBoardUrl } from '@/lib/board-url'
import KanbanBoardClient from '@/components/kanban/KanbanBoardClient'

export const revalidate = 0 // Realtime前提のため常に最新（必要に応じて dynamic = 'force-dynamic' でも可）
// export const dynamic = 'force-dynamic'

type Params = { short_id: string; slug?: string[] }

export default async function BoardPage({ params }: { params: Params }) {
  const { short_id, slug } = params
  const board = await getBoardByShortId(short_id)
  if (!board) notFound()

  const canonical = buildBoardUrl(board) // /b/:short_id/:id_short-:slug
  const current = ['/b', short_id, ...(slug ?? [])].join('/')
  if (current !== canonical) redirect(canonical)

  const initialData = await fetchBoardInitialData(board.id)
  return <KanbanBoardClient initialBoard={board} initialData={initialData} />
}
```

### 受け入れ条件
- `/b/:short_id` と `/b/:short_id/:id_short-:slug` の直アクセス・リロードで **SSR** が成立し、**≤1 回**の正規化で収束。
- クライアント側の `fetch('/api/boards/resolve')` を使わない（= 体感遅延無し）。

### テスト
- E2E: 直アクセス、slug 不一致→正規化、内部遷移、404。
- Unit: `getBoardByShortId`, `buildBoardUrl`, サーバーローダ。

---

# Step 2: Realtime 購読の最適化（重複購読排除）
**狙い**: `boardId` 変更時のみ再購読し、**必ず**以前のチャンネルをクローズ。`router.push/replace` による再レンダーでも安全。

### 実装ガイド
```ts
// クライアント側（KanbanBoardClient 内）
useEffect(() => {
  if (!boardId) return
  const channel = supabase.channel(`board:${boardId}`)
    .on('presence', { event: 'sync' }, () => {/* ... */})
    .subscribe()

  return () => {
    // 必ず購読解除（await不可だが remove でOK）
    supabase.removeChannel(channel)
  }
}, [boardId]) // ← 依存は boardId のみ
```

### 受け入れ条件
- 切替時に **常に1チャンネルのみ SUBSCRIBED**。重複無し。
- 「Connecting… 固まり」や再接続ループが観察されない。

### テスト
- 計測: チャンネル生成/クローズのログ数が切替ごとに1回ずつ。
- 疑似大量切替（連打）でも安定。

---

# Step 3: `/?board=uuid` → `/b/...` への移行（Middleware + KV キャッシュ）
**狙い**: 正規URLを `/b/...` に統一。外部・旧ブックマークの互換は **308** で1回の変換。性能劣化を避ける。

### 実装要点
- Middleware で `/?board=uuid` を検知し、**まず KV を参照**。
- KV ミス時のみ Edge Function / ルートハンドラ経由で `uuid → { short_id, id_short, slug }` を取得し、結果を **TTL付きで KV に保存**。
- その上で **308** で `/b/:short_id/:id_short-:slug` にリダイレクト。

### サンプル（疑似）
```ts
// middleware.ts
import { NextRequest, NextResponse } from 'next/server'
import { kv } from '@vercel/kv'
// getBoardMeta は Edge 互換な取得手段（例: Edge Function / Route Handler 経由）を想定
import { getBoardMeta } from '@/lib/server/board-meta'

export async function middleware(req: NextRequest) {
  const url = new URL(req.url)
  const uuid = url.searchParams.get('board')
  if (url.pathname === '/' && uuid) {
    const cached = await kv.get(`board:uuid:${uuid}`) as any | null
    if (cached) {
      return NextResponse.redirect(new URL(`/b/${cached.short_id}/${cached.id_short}-${cached.slug}`, url), 308)
    }
    const board = await getBoardMeta(uuid) // 例: Edge Function 経由の fetch
    if (!board) return NextResponse.redirect(new URL('/404', url), 308)
    await kv.set(`board:uuid:${uuid}`, {
      short_id: board.short_id, id_short: board.id_short, slug: board.slug
    }, { ex: 3600 })
    return NextResponse.redirect(new URL(`/b/${board.short_id}/${board.id_short}-${board.slug}`, url), 308)
  }
  return NextResponse.next()
}

export const config = { matcher: ['/'] }
```

※ `getBoardMeta` は KV ミス時にボードの短縮メタデータを返す Edge 互換 API（例: Route Handler 経由の fetch）を薄くラップした関数を想定。

### 受け入れ条件
- 旧リンクからの流入は **常に1回の 308** で `/b/...` に統一。
- 連続アクセスでも DB 負荷は KV で吸収。

### テスト
- E2E: 旧URL → 正規URL、キャッシュヒット/ミスの両パス。
- 負荷: KV 命中率と DB クエリ回数を監視。

---

# Step 4（Phase 2）: Intercepting Routes 最適化 & カードモーダル統合（**Step1-3完了後に再評価**）
**狙い**: URLバーを `/b/...` に保ったまま、カード `/c/...` をモーダルで重畳。内部ナビの体験を洗練。

### ルーティング注意点（再確認）
- **Intercepting は階層に依存**。ボード配下の背景を保つなら：  
  - `app/(board)/(.)c/[short_id]/[[...slug]]/page.tsx`（`(.)`= 同階層）  
- ルート直下から広域に拾うなら：  
  - `app/(...)c/[short_id]/[[...slug]]/page.tsx`（`(... )`= 任意の階層）

### カード直アクセス時の親ボード逆引き
- `/c/:short_id` 直アクセスは **カード → 親ボード** を解決して背景をSSR。

```tsx
// app/c/[short_id]/[[...slug]]/page.tsx (Server)
import { notFound } from 'next/navigation'
import { getCardByShortId } from '@/lib/server/cards'
import { getBoardById, fetchBoardInitialData } from '@/lib/server/boards'
import KanbanBoardClient from '@/components/kanban/KanbanBoardClient'

export default async function CardDirectPage({ params }: { params: { short_id: string } }) {
  const card = await getCardByShortId(params.short_id)
  if (!card) notFound()
  const board = await getBoardById(card.board_id)
  const initialData = await fetchBoardInitialData(board.id)
  return <KanbanBoardClient initialBoard={board} initialData={initialData} initialCardId={card.id} />
}
```

### 導入判断の材料
- SSR TTFB、URL遷移体感、カード直アクセス比率、戻る/進む操作比率、エラー率。

---

## 微妙になりがちな点（再確認済み）
- **Intercepting のパス**: `app/(.)b/...` は同階層扱いで意図どおりに働かないため不採用。用途に応じて `(...)` または `(board)/(.)c/...` を選択。  
- **正規化の無限ループ回避**: `current` は `params` から構築し、`redirect` は差分がある場合のみ1回。`/b/:short_id` から `/:id_short-:slug` へ収束。  
- **SSRのキャッシュ**: Realtime前提のため `revalidate = 0`（または `dynamic = 'force-dynamic'`）を推奨。  
- **Middlewareの負荷**: KV を先に引く。DB直叩きは避け、Edge Function経由等で軽量化。  
- **IDのバリデーション**: `short_id` は `/^[A-Za-z0-9]{8}$/`、`id_short` は数値、`slug` は URL セーフに正規化。  
- **OG/Canonical**: 正規URLのみを露出。短縮 `/b/:short_id` は内部的に正規へ収束。  
- **二重フェッチ**: SSR 初期データをクライアントへ渡し、SWR キーを統一して重複取得を抑制。  
- **購読リーク**: 依存は `boardId` のみ・`removeChannel` を徹底。

---

## フラグとロールアウト
- Feature Flags: `enableBoardSSR` / `enableKvRedirect` / `enableCardIntercept`  
- Rollout: Dev → Staging → Prod（段階導入・即時ロールバック可能）

---

## 受け入れテスト（総合）
1. `/b/:short_id/:id_short-:slug` 直アクセス→SSR→CSR購読が安定（正規化 ≤1 回）。  
2. 内部遷移すべて `/b/...` を維持、`/?board` 依存は無し（Step 3 完了後）。  
3. `/?board=uuid` からは 308 一発で `/b/...` へ（KV ヒット時）。  
4. `/c/...` 直アクセスで背景SSR + モーダル（Step4導入時）。

---

以上。
