# ボード短縮URL：恒久対応ロードマップ＆実装仕様（Trello準拠・改訂版）
**Rev**: 1.2
**Date**: 2025-10-12
**Author**: 松本Ops / Claude Code レビュー反映

---

## この改訂での主な変更点（Rev 1.2）
- **順序入替**: まず SSR（サーバーコンポーネント）で `/b/...` を成立させ、その後 Intercepting を最適化用途として導入（Step 1 ⇄ 2 を逆転）。
- **Realtime 重複購読の明確な対策**: `useEffect` の依存配列を `boardId` のみにし、`removeChannel` の徹底。
- **Middleware の性能対策**: `/?board=uuid` → `/b/...` 変換は **Edge KV キャッシュ**を前提。キャッシュミス時のみDB。
- **Step 4をオプション化**: Step 1-3で基本機能完成。Intercepting Routesは完成後に再設計。
- **コード例の構文修正**: 実装可能なレベルに精緻化。
- **実装優先度の明記**: Phase 1（必須）= Step 1-3、Phase 2（オプション）= Step 4。

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

**注**: Step 4 は Phase 1 完成後に、実際の運用状況を踏まえて再設計することを推奨します。

---

## 用語
- **short_id**: Base62 8文字のユニークID（例: `aBcD1234`）
- **id_short**: ボードの連番（例: `1`）
- **slug**: タイトル由来のURL語（例: `main-board`）
- **正規URL**: `/b/:short_id/:id_short-:slug`
- **短縮URL**: `/b/:short_id`（省略 slug での到達）

---

## 前提（Step 0: 必要時のみ）
- DB: `boards.short_id (UNIQUE)`, `boards.id_short`, `boards.slug` が存在し、既存ボードにバックフィル済み。
- ユーティリティ: `createUniqueBoardShortId()`, `getNextBoardIdShort()`, `slugifyBoardName()`。
- URLビルダー: `buildBoardUrl(board)`, `buildBoardShortUrl(board)`。
- 共有UI: ボード詳細メニューに「URLコピー（短縮/正規）」ボタン。

**Exit条件**: 既存全ボードで `buildBoardUrl()` が正規URLを返却。

---

# 恒久対応（捨てコードなしの段階導入）

## Step 1: SSR 基礎実装（サーバーコンポーネントで `/b/...` を確立）
**狙い**: 追加API呼び出し無しで **直接 `/b/...` にサーバーで到達**、slug の正規化もサーバーで解決。初期データは SSR で供給、Realtime はクライアントで購読。

### ルーティング
- 推奨: `app/(board)/b/[short_id]/[[...slug]]/page.tsx`（**Server Component**）
  - 既存のルートグループが `(board)` の場合はその配下でサーバーページを定義。
- 代替: ルート直下の場合は `app/b/[short_id]/[[...slug]]/page.tsx`。

### 仕様
1. `short_id` でボードを取得。存在しなければ `notFound()`。
2. `id_short` と `slug` を用いて正規URLを構築。差異があれば `redirect(canonical)`（**1回のみ**）。
3. 初期データ（ボード、リスト等）を `KanbanBoardClient` へ props で渡す。
4. SEO: `<link rel="canonical">` を正規URLに、`og:url` も同値に。

### 参考コード（抜粋・サーバー側）
```tsx
// app/(board)/b/[short_id]/[[...slug]]/page.tsx
import { notFound, redirect } from 'next/navigation'
import { getBoardByShortId } from '@/lib/server/boards'
import { buildBoardUrl } from '@/lib/board-url'
import KanbanBoardClient from '@/components/kanban/KanbanBoardClient'

type Params = { short_id: string; slug?: string[] }

export default async function BoardPage({ params }: { params: Params }) {
  const { short_id, slug } = params
  const board = await getBoardByShortId(short_id)
  if (!board) notFound()

  const canonical = buildBoardUrl(board) // /b/:short_id/:id_short-:slug
  const slugPath = slug?.join('/') || ''
  const current = slugPath ? `/b/${short_id}/${slugPath}` : `/b/${short_id}`
  if (current !== canonical) redirect(canonical)

  const initialData = await fetchBoardInitialData(board.id) // サーバーで初期データ収集
  return <KanbanBoardClient initialBoard={board} initialData={initialData} />
}
```

### 受け入れ条件
- `/b/:short_id` と `/b/:short_id/:id_short-:slug` の直アクセス・リロードで **SSR** が成立し、**1回以内**の正規化で収束。
- 追加の `/api/boards/resolve` の **クライアント fetch を使用しない**（= 体感遅延無し）。

### テスト
- E2E: 直アクセス、slug 不一致→正規化、内部遷移、404。
- Unit: `getBoardByShortId`, `buildBoardUrl`, サーバーローダ。

---

## Step 2: Realtime 購読の最適化（重複購読排除）
**狙い**: `boardId` 変更時のみ再購読し、**必ず**以前のチャンネルをクローズ。`router.push/replace` による再レンダーでも安全。

### 実装ガイド
```ts
// クライアント側（KanbanBoardClient 内）
useEffect(() => {
  if (!boardId) return
  const channel = supabase.channel(`board:${boardId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'boards' }, (payload) => {
      // ボード変更を処理
    })
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

## Step 3: `/?board=uuid` → `/b/...` への移行（Middleware + KV キャッシュ）
**狙い**: 正規URLを `/b/...` に統一。外部・旧ブックマークの互換は **308** で1回の変換。性能劣化を避ける。

### 実装要点
- Middleware で `/?board=uuid` を検知し、**KV を先に引く**。
- KV ミス時のみ DB で `uuid → {{ short_id, id_short, slug }}` を引き、結果を **TTL付きで KV に保存**。
- その上で **308** で `/b/:short_id/:id_short-:slug` にリダイレクト。

### 参考コード（疑似）
```ts
// middleware.ts
import { NextRequest, NextResponse } from 'next/server'
import { kv } from '@vercel/kv'

export async function middleware(req: NextRequest) {
  const url = new URL(req.url)
  const uuid = url.searchParams.get('board')
  if (url.pathname === '/' && uuid) {
    const cached = await kv.get(`board:uuid:${uuid}`) as any | null
    if (cached) {
      return NextResponse.redirect(new URL(`/b/${cached.short_id}/${cached.id_short}-${cached.slug}`, url), 308)
    }
    const board = await getBoardById(uuid) // Edge Function 等で軽量化
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

### 受け入れ条件
- 旧リンクからの流入は **常に1回の 308** で `/b/...` に統一。
- 連続アクセスでも DB 負荷は KV で吸収。

### テスト
- E2E: 旧URL → 正規URL、キャッシュヒット/ミスの両パス。
- 負荷: KV 命中率と DB クエリ回数をダッシュボードで監視。

---

## Step 4: Intercepting Routes による最適化 & カードモーダル統合（オプション）
**狙い**: URLバーを `/b/...` に保ったまま、カード `/c/...` をモーダルで重畳。内部ナビの体験を洗練。

### ルーティングと注意点
- **Intercepting は階層に依存**。ボード配下の背景を保つなら：
  - `app/(board)/(.)c/[short_id]/[[...slug]]/page.tsx`（**(.) = 同階層**）
- ルート直下で他階層から拾うなら：
  - `app/(...)c/[short_id]/[[...slug]]/page.tsx`（**(... ) = 任意の階層**）

### カード直アクセス時の親ボード逆引き
- `/c/:short_id` 直アクセスでは、先に **カード → 親ボード** を解決して背景を用意。

```tsx
// app/c/[short_id]/[[...slug]]/page.tsx (Server)
import { notFound } from 'next/navigation'
import { getCardByShortId } from '@/lib/server/cards'
import { getBoardById } from '@/lib/server/boards'
import KanbanBoardClient from '@/components/kanban/KanbanBoardClient'

export default async function CardDirectPage({ params }: { params: { short_id: string } }) {
  const card = await getCardByShortId(params.short_id)
  if (!card) notFound()
  const board = await getBoardById(card.board_id)
  const initialData = await fetchBoardInitialData(board.id)
  return <KanbanBoardClient initialBoard={board} initialData={initialData} initialCardId={card.id} />
}
```

### 受け入れ条件
- `/c/...` 直アクセスで **背景ボードがSSR**、モーダルが開く。戻る/進むで期待どおりに開閉。
- ボード→カード→ボードの遷移で URL と履歴が一貫。

### テスト
- E2E: 直アクセス、内部遷移、履歴操作、共有リンク。

---

## 横断タスク
- **計測**: 308 回数、SSR TTFB、リアルタイム購読のエラー率、KV 命中率。
- **アクセシビリティ**: モーダルのフォーカストラップ・SR連携。
- **フラグ**: `enableBoardSSR` / `enableKvRedirect` / `enableCardIntercept` を段階で切替。
- **ロールアウト**: Dev → Staging → Prod。ロールバックはフラグで段階的に。

---

## 受け入れテスト（総合）
1. `/b/:short_id/:id_short-:slug` 直アクセス→SSR→CSR購読が安定（正規化 ≤1 回）。
2. 内部遷移すべて `/b/...` を維持し、`/?board` 依存は無い（Step 3 完了後）。
3. `/?board=uuid` からは 308 一発で `/b/...` へ（KV 命中時）。
4. `/c/...` 直アクセスで背景SSR + モーダル、履歴が期待どおり。

---

## リスクと対策
- **KV ミス連発**: TTL/プリウォーム、失敗率でフォールバックロジックを計測。
- **SSR と CSR の二重フェッチ**: SWR キー統一、`initialData` 供給で防止。
- **Realtime 購読リーク**: 依存を `boardId` のみに固定、`removeChannel` の E2E 検証。

---

## 付録 A: ルート構成の例
```
app/
  (board)/
    b/[short_id]/[[...slug]]/page.tsx       # Step 1 SSRボードページ（正規）
    (.)c/[short_id]/[[...slug]]/page.tsx    # Step 4 Intercepting（任意）
  c/[short_id]/[[...slug]]/page.tsx         # Step 4 直アクセス用（背景SSR + モーダル）
middleware.ts                                # Step 3 旧URL→正規URL（KV）
```

## 付録 B: 受け入れチェックリスト（各Step）
- Step 1: SSR 直アクセスOK / 正規化 ≤1 回 / 追加API無し
- Step 2: 購読重複ゼロ / 切替の安定
- Step 3: 308 一発変換 / KV 命中で DB ヒット極小
- Step 4: モーダル履歴の整合 / 直アクセスの体験一貫

---

以上。