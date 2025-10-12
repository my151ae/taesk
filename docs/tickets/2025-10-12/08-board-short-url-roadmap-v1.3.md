# ボード短縮URL：恒久対応ロードマップ＆実装仕様（Trello準拠・改訂版 v1.3）
**Rev**: 1.3  
**Date**: 2025-10-12  
**Author**: 松本Ops / レビュー反映（Phase1完了優先・Edge互換調整）

---

## この改訂（v1.3）の主な変更点
- **Step 0（前提）を正式化**し、既存ボードへのバックフィルと URL ビルダー整備を必須前提として明記。
- **Middleware `matcher` を `['/']` に限定**（`'/?board=:path*'` は無効）。
- **Edge互換の取得レイヤー**として `lib/edge/get-board-meta.ts` を導入。Middleware からは **importでDB層を直接呼ばず**、Route Handler 経由の `fetch` を使用。
- **Step 1 の正規化は 308（`permanentRedirect`）**を使用（SEO/クローラの学習を促進）。
- **SSRのキャッシュ方針を明記**（`revalidate = 0` または `dynamic = 'force-dynamic'`）。
- **Phase 2（Step 4）は 1–3 完了後に再評価**する運用方針を固定。

---

## 実装優先度
### Phase 1: 必須機能（Step 0–3）
このフェーズで `/b/...` の基本機能が完成します。  
- **Step 0**: 前提整備（スキーマ/バックフィル/ビルダー/コピー導線）  
- **Step 1**: SSR 基礎実装（サーバーコンポーネント）  
- **Step 2**: Realtime 購読の最適化  
- **Step 3**: Middleware による旧URL変換（KV キャッシュ + Edge互換取得）  

**Exit条件**: `/b/:short_id/:id_short-:slug` で SSR が機能し、`/?board=uuid` からの **308** リダイレクトが安定。

### Phase 2: オプション最適化（Step 4）
Step 1–3 の実装・検証完了後に、体験向上のために導入。  
- **Step 4**: Intercepting Routes & カードモーダル統合（再評価のうえ導入）

---

## 用語
- **short_id**: Base62 8文字のユニークID（例: `aBcD1234`）
- **id_short**: ボードの連番（例: `1`）
- **slug**: タイトル由来のURL語（例: `main-board`）
- **正規URL**: `/b/:short_id/:id_short-:slug`
- **短縮URL**: `/b/:short_id`（省略 slug での到達）

---

## Step 0: 前提整備（必須）
- **DB**: `boards.short_id (UNIQUE)`, `boards.id_short`, `boards.slug` を持ち、既存すべてにバックフィル済み。
- **ユーティリティ**: `createUniqueBoardShortId()`, `getNextBoardIdShort()`, `slugifyBoardName()`。
- **URLビルダー**: `buildBoardUrl(board)`, `buildBoardShortUrl(board)`。
- **共有UI**: ボード詳細メニューに短縮/正規 URL コピー導線を用意。

**Exit条件**: 既存すべてのボードで `buildBoardUrl()` が正規URL（`/b/:short_id/:id_short-:slug`）を返却。

---

# Step 1: SSR 基礎実装（サーバーコンポーネントで `/b/...` を確立）
**狙い**: 追加API呼び出し無しで **直接 `/b/...` にサーバー到達**、slug 正規化もサーバーで解決。初期データは SSR で供給、Realtime はクライアントで購読。

### ルーティング
- 推奨: `app/(board)/b/[short_id]/[[...slug]]/page.tsx`（**Server Component**）
- 代替: `app/b/[short_id]/[[...slug]]/page.tsx`

### 参考コード（サーバー）
```tsx
// app/(board)/b/[short_id]/[[...slug]]/page.tsx
import { notFound, permanentRedirect } from 'next/navigation'
import { getBoardByShortId, fetchBoardInitialData } from '@/lib/server/boards'
import { buildBoardUrl } from '@/lib/board-url'
import KanbanBoardClient from '@/components/kanban/KanbanBoardClient'

export const revalidate = 0 // または: export const dynamic = 'force-dynamic'

type Params = { short_id: string; slug?: string[] }

export default async function BoardPage({ params }: { params: Params }) {
  const { short_id, slug } = params
  const board = await getBoardByShortId(short_id)
  if (!board) notFound()

  const canonical = buildBoardUrl(board) // /b/:short_id/:id_short-:slug
  const current = ['/b', short_id, ...(slug ?? [])].join('/')
  if (current !== canonical) {
    // SEO のため 308（恒久）で正規化
    permanentRedirect(canonical)
  }

  const initialData = await fetchBoardInitialData(board.id)
  return <KanbanBoardClient initialBoard={board} initialData={initialData} />
}
```

### 受け入れ条件
- `/b/:short_id` と `/b/:short_id/:id_short-:slug` の直アクセス・リロードで **SSR** が成立し、**≤1 回**の正規化で収束（**308**）。
- クライアント側で `fetch('/api/boards/resolve')` を使わない（= 体感遅延無し）。

### テスト
- E2E: 直アクセス、slug 不一致→正規化、内部遷移、404。
- Unit: `getBoardByShortId`, `buildBoardUrl`, サーバーローダ。

---

# Step 2: Realtime 購読の最適化（重複購読排除）
**狙い**: `boardId` 変更時のみ再購読し、**必ず**以前のチャンネルをクローズ。`router.push/replace` による再レンダーでも安全。

### 実装ガイド（クライアント）
```ts
useEffect(() => {
  if (!boardId) return
  const channel = supabase.channel(`board:${boardId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'boards' }, (payload) => {
      // 変更を処理
    })
    .subscribe()

  return () => {
    supabase.removeChannel(channel) // 必ず購読解除
  }
}, [boardId]) // 依存は boardId のみ
```

### 受け入れ条件
- 切替時に **常に1チャンネルのみ SUBSCRIBED**。重複無し。
- 「Connecting… 固まり」や再接続ループが観察されない。

---

# Step 3: `/?board=uuid` → `/b/...`（Middleware + KV + Edge互換取得）
**狙い**: 正規URLを `/b/...` に統一。旧ブックマーク互換は **308** 一発。Middleware では **DB直叩き禁止**。

### 取得レイヤー
- `lib/edge/get-board-meta.ts`（Edge互換の薄い `fetch` ラッパー）
- `app/api/board-meta/route.ts`（UUID → `{ short_id, id_short, slug }` を返す Route Handler。`runtime='edge'` 推奨）

### サンプル：`lib/edge/get-board-meta.ts`
```ts
// lib/edge/get-board-meta.ts
export async function getBoardMeta(uuid: string, baseUrl?: string) {
  const url = new URL('/api/board-meta?uuid=' + encodeURIComponent(uuid), baseUrl ?? process.env.NEXT_PUBLIC_BASE_URL)
  const res = await fetch(url, { cache: 'no-store' }) // KVに載るためここは都度でOK
  if (!res.ok) return null
  return (await res.json()) as { short_id: string; id_short: number; slug: string }
}
```

### サンプル：`app/api/board-meta/route.ts`
```ts
// app/api/board-meta/route.ts
import { NextResponse } from 'next/server'
import { getBoardById } from '@/lib/server/boards'

export const runtime = 'edge'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const uuid = searchParams.get('uuid')
  if (!uuid) return NextResponse.json({ error: 'uuid required' }, { status: 400 })
  const board = await getBoardById(uuid)
  if (!board) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ short_id: board.short_id, id_short: board.id_short, slug: board.slug })
}
```

### サンプル：`middleware.ts`
```ts
// middleware.ts
import { NextRequest, NextResponse } from 'next/server'
import { kv } from '@vercel/kv'
import { getBoardMeta } from '@/lib/edge/get-board-meta'

export async function middleware(req: NextRequest) {
  const url = new URL(req.url)
  const uuid = url.searchParams.get('board')
  if (url.pathname === '/' && uuid) {
    const cacheKey = `board:uuid:${uuid}`
    const cached = (await kv.get(cacheKey)) as { short_id: string; id_short: number; slug: string } | null
    if (cached) {
      return NextResponse.redirect(new URL(`/b/${cached.short_id}/${cached.id_short}-${cached.slug}`, url), 308)
    }

    const meta = await getBoardMeta(uuid, url.origin)
    if (!meta) return NextResponse.redirect(new URL('/404', url), 308)

    await kv.set(cacheKey, meta, { ex: 3600 }) // 1時間
    return NextResponse.redirect(new URL(`/b/${meta.short_id}/${meta.id_short}-${meta.slug}`, url), 308)
  }
  return NextResponse.next()
}

export const config = { matcher: ['/'] }
```

### 受け入れ条件
- 旧リンクからの流入は **常に 308 一発**で `/b/...` に統一。
- キャッシュヒット時は DB へ到達しない。

---

# Step 4（Phase 2）: Intercepting Routes 最適化 & カードモーダル統合（**Step1–3完了後に再評価**）
**狙い**: URLバーを `/b/...` に保ったまま、カード `/c/...` をモーダルで重畳。内部ナビ体験の洗練。

### ルーティング注意
- **Intercepting は階層依存**。ボード配下の背景を保つなら：  
  - `app/(board)/(.)c/[short_id]/[[...slug]]/page.tsx`（`(.)`= 同階層）  
- ルート直下から広域に拾うなら：  
  - `app/(...)c/[short_id]/[[...slug]]/page.tsx`（`(... )`= 任意階層）

### カード直アクセス時の親ボード逆引き（サーバー）
```tsx
// app/c/[short_id]/[[...slug]]/page.tsx
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

---

## 微妙になりがちな点（最終チェック）
- **Intercepting のパス**: `(.)` / `(...)` の意味を厳密運用。`app/(.)b/...` は不採用。
- **正規化のループ回避**: `params` から `current` を構築し、差分時のみ **一度だけ** 308。
- **SSRキャッシュ**: Realtime前提なら `revalidate = 0`（または `dynamic='force-dynamic'`）。
- **Middleware負荷**: まず KV → ミス時に Route Handler（Edge）経由で取得。
- **IDバリデーション**: `short_id=/^[A-Za-z0-9]{8}$/`、`id_short` 数値、`slug` は URL セーフ化。
- **二重フェッチ抑止**: SSR初期データをクライアントへ渡し、SWRキーを統一。
- **購読リーク**: 依存は `boardId` のみ。`removeChannel` を徹底。

---

## フラグとロールアウト
- **Feature Flags**: `enableBoardSSR` / `enableKvRedirect` / `enableCardIntercept`
- **Rollout**: Dev → Staging → Prod（段階導入・即時ロールバック可能）

---

## 受け入れテスト（総合）
1. `/b/:short_id/:id_short-:slug` 直アクセス→SSR→CSR購読が安定（正規化 ≤1 回）。  
2. 内部遷移は常に `/b/...` を維持（Step 3 完了後は `/?board` 依存なし）。  
3. `/?board=uuid` は **308 一発**で `/b/...` へ（KV命中時）。  
4. `/c/...` 直アクセスで背景SSR + モーダル（Step 4 導入時）。

---

以上。
