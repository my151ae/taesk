# 目的
- カードと同様にボードも短いURL（/b/:short_id および /b/:short_id/:id_short-:slug）を**恒久的**に提供する。
- 既存の `/?board=uuid` 依存実装から段階的に脱却し、最終的に `/b/...` を**正規URL**とする。

---

# スコープ
- 対象：ボード表示・ボード切替・カードモーダル導線・共有UI・SEO
- 非対象：権限モデル、通知、外部連携（将来拡張の影響点は記載）

---

# 用語
- **short_id**: Base62 8文字のユニークID（例: `aBcD1234`）
- **id_short**: ボード内の連番（例: `1`）
- **slug**: タイトル由来のURL語（例: `main-board`）
- **正規URL（canonical）**: `/b/:short_id/:id_short-:slug`
- **短縮URL**: `/b/:short_id`（リダイレクトまたは表示許容）

---

# 前提（満たしている状態）
- DBに `boards.short_id`, `boards.id_short`, `boards.slug` が存在し、既存ボードに値が付与されている。
- `buildBoardUrl()` / `buildBoardShortUrl()` が利用可能。

> 以上が未整備の場合は「Step 0: 前提整備」を実施する。

## Step 0: 前提整備（必要時のみ）
- マイグレーション：`short_id (unique)`, `id_short`, `slug`
- バックフィル：既存ボード全レコードへ値を生成・保存
- ユーティリティ：`createUniqueBoardShortId()`, `getNextBoardIdShort()`, `slugifyBoardName()`
- 共有UI：ボード詳細メニューに「URLコピー（短縮/正規）」

**Exit条件**
- 既存全ボードに `short_id/id_short/slug` があり、`buildBoardUrl()` が `/b/:short_id/:id_short-:slug` を返す

---

# 段階的・恒久策（捨てコードなし）

## Step 1: Intercepting Routes ラッパーで `/b/...` を表層固定（ベースは現行CSR）
**狙い**
- ブラウザのURLバーに `/b/...` を常に表示しつつ、既存の `app/(board)/page.tsx`（CSR）をそのまま利用。

**実装要点**
1. **Intercepting ルート**: `app/(.)b/[short_id]/[[...slug]]/page.tsx`（Client）
   - `short_id` → `uuid` 逆引きを `/api/boards/resolve` で行う
   - 取得後、`router.replace('/?board=uuid', { scroll: false })`
   - 初回表示時の“空白”防止にローディングプレースホルダを返す
2. **API**: `app/api/boards/resolve/route.ts`
   - 入力: `short`
   - 出力: `{ uuid, id_short, slug }`
   - 失敗: 404
   - キャッシュ: Edge Runtimeで短期K/Vキャッシュ（例: 60s）
3. **URL生成**: 既存UIのリンクは `buildBoardUrl()` を利用。コピーUIは短縮/正規を切替可能。
4. **ボード切替**: 内部遷移も `/b/...` を `router.push`。Interceptingによりベースは `/?board=uuid` のまま描画される。
5. **カードモーダル**: 現状維持（`/c/...` でモーダル）。

**受け入れ条件**
- `/b/:short_id` と `/b/:short_id/:id_short-:slug` に直接アクセスしてもURLバーは `/b/...` のまま
- ネットワークタブに `/?board=uuid` への**サーバーリダイレクトが存在しない**（`replace` によるクライアント遷移のみ）
- ボード切替時に Realtime の重複購読/Connecting 固まりが発生しない（購読の確実なクリーンアップ）
- 旧 `/?board=` 直アクセスは従来どおり機能（後続ステップで整理）

**テスト**
- E2E: 直接アクセス / リロード / 内部遷移 / 異常 `short_id` 404
- ユニット: `resolve` API 正常・異常、URLビルダー生成

**リスク/緩和**
- Intercepting の複雑さ → ルーティング単体テストを追加
- 逆引きAPIのレイテンシ → Edge Cache と失敗時の再試行

---

## Step 2: ハイブリッド化（サーバー初期データ + CSR購読）
**狙い**
- `/b/...` で**サーバーが初期データを取得**し、初期描画を安定化（SEO/OGにも備える）。Realtimeは従来どおりクライアント購読。

**実装要点**
1. `app/b/[short_id]/[[...slug]]/page.tsx`（Server）を新設/拡張
   - `short_id` からボード取得、正規化（`/:id_short-:slug` 不一致時は 308）
   - 初期データ（ボード、リスト、メタ）を props 経由で `KanbanBoard` に渡す
2. **共有ロジック切り出し**
   - データ取得: `lib/server/boards.ts` に移管
   - CSR側は初期データが存在すればそれを採用、無ければフェッチ
3. **`/?board` 互換**
   - 現時点では維持（後続で整理）

**受け入れ条件**
- `/b/...` 直アクセスでサーバーから初期描画され、CLSが小さい
- 正規化が1回で完了（ループしない）
- Realtimeは1チャンネルのみ購読

**テスト**
- E2E: 直アクセス初期描画の速度計測、正規化確認
- Unit: サーバーローダ、正規URL生成

**リスク/緩和**
- SSR + CSR重複フェッチ → SWRキー統一と初期データキャッシュで抑制

---

## Step 3: `/b/...` を正規化、`/?board` をレガシーへ
**狙い**
- プロダクトの正規URLを `/b/...` に統一し、`/?board=uuid` はレガシー互換のみへ。

**実装要点**
1. **ミドルウェア**
   - 旧 `/?board=uuid` へのアクセスは `/b/:short_id/:id_short-:slug` に 308
   - 逆引きはEdge Functionまたはキャッシュ
2. **UI/ナビゲーション**
   - すべて `/b/...` を使用。`updateURL(boardId)` を全面廃止
3. **SEO**
   - `<link rel="canonical">` を `/b/...` に統一
   - OG/Twitterカードの `og:url` も `/b/...`

**受け入れ条件**
- 内部・外部すべてのリンクが `/b/...`
- `/?board=` からの流入は1回の 308 で `/b/...` に収束

**テスト**
- E2E: 旧リンクからの移行、外部共有リンクの挙動

**リスク/緩和**
- 古いブックマークの多さ → 308 + 計測で影響監視

---

## Step 4: カードモーダルと `/b/...` の統合（Trelloライクな体験を完成）
**狙い**
- `/b/...` を**背景**に保ったまま `/c/...` をモーダル表示（Intercepting Routes）。

**実装要点**
1. `app/(.)c/[short_id]/[[...slug]]/page.tsx` を導入（Intercepting）
2. モーダル閉鎖で `/b/...` に復帰
3. ダイレクト `/c/...` アクセスはボードを背景にマウントしてからモーダルを開く

**受け入れ条件**
- `/c/...` 直アクセスで背景ボードがSSRで表示され、モーダルが重なる
- ブラウザの戻る/進むで期待どおりに開閉

**テスト**
- E2E: 直アクセス/内部遷移、履歴遷移、共有リンク

---

# 横断タスク
- **Realtime購読の健全化**: `boardId` 依存で単一チャンネル購読、unmount時に `removeChannel` を必ず実行
- **計測**: 308数、直アクセスSSR TTFB、モーダル開閉履歴、エラー率
- **アクセシビリティ**: モーダルのフォーカストラップ/スクリーンリーダ対応

---

# ロールアウト計画
- **環境順**: Dev → Staging → Prod
- **フラグ**: `enableBoardShortUrl`、`enableBoardSSR`、`enableCardModalIntercept`（段階で切替）
- **ロールバック**: Step単位でflag off。データは後方互換のため保持。

---

# 受け入れテスト（総合）
1. `/b/:short_id/:id_short-:slug` 直アクセス→SSR→CSR購読が安定
2. 内部遷移でURLが常に `/b/...` を維持
3. 旧 `/?board=uuid` から1回のリダイレクトで `/b/...` に到達
4. `/c/...` 直アクセスで背景ボード + モーダル表示、戻るで閉じる
5. 共有UIの短縮/正規リンクが意図どおりに動作

---

# 想定影響点
- ルーティング：`app/b/*`, `app/(.)b/*`, `app/(.)c/*`, `middleware.ts`
- API：`/api/boards/resolve`
- クライアント：ボード切替・共有UI・モーダル
- SEO：canonical/OG

---

# 付録：コード断片（雛形）
```tsx
// app/(.)b/[short_id]/[[...slug]]/page.tsx (Step 1)
'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function InterceptB({ params: { short_id } }: { params: { short_id: string } }) {
  const router = useRouter()
  useEffect(() => {
    let alive = true
    ;(async () => {
      const r = await fetch(`/api/boards/resolve?short=${short_id}`)
      if (!alive) return
      if (r.ok) {
        const { uuid } = await r.json()
        router.replace(`/?board=${uuid}`, { scroll: false })
      } else {
        router.replace('/404')
      }
    })()
    return () => { alive = false }
  }, [short_id, router])
  return null
}
```

```ts
// middleware.ts (Step 3)
import { NextRequest, NextResponse } from 'next/server'
export function middleware(req: NextRequest) {
  const url = new URL(req.url)
  const board = url.searchParams.get('board')
  if (url.pathname === '/' && board) {
    // 逆引き (uuid → short_id/id_short/slug)
    // 実装は Edge Function / KV を利用
    // 見つかれば /b/:short_id/:id_short-:slug へ 308
  }
  return NextResponse.next()
}
```

