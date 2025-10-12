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
    .on('postgres_changes', { event: '*', schema: 'public', table: 'board
