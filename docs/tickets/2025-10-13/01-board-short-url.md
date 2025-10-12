
# 01 — Board Short URL（/b）立て直し計画 & 実装指示（JST 2025-10-12 21:41）

> 目的：**ボード短縮URL（`/b/:short_id/[[...slug]]`）を“正”に統一**し、UI/SSR/ミドルウェア/テスト/DB まで一気通貫で整備して**回帰ゼロ**で完成させる。

---

## A. ここまで（AS-IS）

- **仕様/ロードマップ**は v1.3 まで整理済み（Step 0〜3の方針・KV経由メタ取得・308 正規化など）。
- **現状の実装観測**
  - `/?board=uuid` ベースのクエリ同期が残っており、**カードモーダルを閉じると `/` に戻る**など履歴/URLの不整合が発生。
  - `app/(board)/page.tsx` が依然クライアント主体で **/b フローを正とする責務切り替え未完**。
  - `/b/[short_id]/[[...slug]]/page.tsx` は **params が Promise 型**パターンのままの可能性が高く、型/実装が揺れている（Card 側で同様パターンの実装が存在）。
  - Realtime 再購読の破棄→再購読は実装済みで安定。
  - Middleware で `/?board=uuid` → `/b/:short_id` への 308 と、KV+Edge ラッパでのメタ取得の骨格は作成済み。

---

## B. 何が詰まっているか（GAP）

1) **コピー導線不在**  
   - ボード詳細メニューに「正規URL」「短縮URL」の2系統コピーを露出できていない。  
   - `buildBoardShortUrl()` が未使用。

2) **URL 正規系の統一不足**  
   - **/b 系を正**としていながら、`updateURL()`/`handleCloseCardModal()` が **旧 `/?board` 前提**。  
   - **ルートの責務**：`app/(board)/page.tsx` がボード Top を返し続けており、`/b/...` へ寄せきれていない。

3) **SSR & 308 のテスト欠如**  
   - `/` → `/b/:short_id` への 308、`/b/:short_id` の SSR 初期データ読み込み、canonical 308 正規化の **E2E/Unit が未整備**。

4) **DB 状態の未確定**  
   - `boards.short_id / id_short / slug` の **本番反映確認が未**。バックフィル済みかどうかも未確認。

---

## C. 決定（TO-BE）

- **URL の唯一正規**：`/b/<short_id>`（必要に応じ `/<tail>` を slug 的に付与）。
- **アプリ内部状態**は React/Store で管理し、URL は **表示とディープリンク**のために一貫して `/b/...` を使う。
- **モーダル Close** は **`router.back()` を最優先**し、履歴がない場合のみ **`router.replace('/b/<sid>')`** のフォールバック。
- **リダイレクト**：
  - `/?board=<uuid>` → **308** → `/b/<short_id>`（Middleware）
  - `/b/<sid>/<wrong-tail>` → **308** → `/b/<sid>/<canonical-tail>`（SSR）

---

## D. 実装手順（PR 粒度）

### PR-1: ボードメニューに「短縮URL/正規URLコピー」追加（UI）

**変更点**
- `app/(board)/_components/KanbanBoardClient.tsx` のボード詳細メニューに下記を追加：
  - 「ボードURLをコピー（短縮）」→ `buildBoardShortUrl(board)` を使用
  - 「ボードURLをコピー（正規）」→ `buildBoardCanonicalUrl(board)` を使用

**サンプル実装（差分イメージ）**
```diff
// app/(board)/_components/KanbanBoardClient.tsx
+ import { buildBoardShortUrl, buildBoardCanonicalUrl } from '@/lib/board-url';
+ import { copyToClipboard } from '@/lib/ui';

  <MenuItem onClick={() => setShowBoardMenu(false)} .../>

+ <MenuItem
+   onClick={() => copyToClipboard(buildBoardShortUrl(currentBoard))}
+   icon={<LinkIcon />}
+ >
+   短縮URLをコピー
+ </MenuItem>
+ <MenuItem
+   onClick={() => copyToClipboard(buildBoardCanonicalUrl(currentBoard))}
+   icon={<LinkIcon />}
+ >
+   正規URLをコピー
+ </MenuItem>
```

**受け入れ条件**
- クリックでクリップボードへ即時コピー・トースト表示（成功/失敗）。
- 現在ボードが切り替わっても出力 URL が常に正しい。

---

### PR-2: `/b/...` 正規化に合わせた URL 同期・モーダル閉じ挙動の統一

**変更点**
- `updateURL()` を **`/b/<sid>` 起点**に書き換え。`/?board` 系は廃止。
- `handleCloseCardModal()` は **`router.back()` → ダメなら `router.replace('/b/<sid>')`**。  
  - `router.back()` が `/` に落ちないよう、**ボード → カード（モーダル）**の**一段履歴**が残る遷移に統一。

**差分イメージ**
```diff
// app/(board)/_components/KanbanBoardClient.tsx
- const updateURL = (boardId: string, cardId?: string) => {
-   const q = new URLSearchParams({ board: boardId, ...(cardId && { card: cardId }) });
-   router.replace(`/?${q.toString()}`);
- };
+ const updateURL = (sid: string, tail?: string) => {
+   const path = tail ? `/b/${sid}/${tail}` : `/b/${sid}`;
+   router.replace(path);
+ };

- const handleCloseCardModal = () => router.replace('/');
+ const handleCloseCardModal = (sid: string) => {
+   // まず戻る（/c or /b/tail → /b/<sid> を想定）
+   if (window.history.length > 1) {
+     router.back();
+     return;
+   }
+   router.replace(`/b/${sid}`);
+ };
```

**受け入れ条件**
- モーダルを閉じても **必ず `/b/<sid>` に留まる/戻る**。
- 直リンク（F5）でも挙動が破綻しない。

---

### PR-3: ルート責務の再配置（SSR 化）

**変更点**
- `app/(board)/page.tsx` を **サーバーコンポーネント**に変更し、**デフォルトボードの `/b/<sid>` へ 308**。  
  - あるいはプロダクト方針次第で `/` はランディング扱いにして **ボード UI は常に `/b/...`** でのみ提供。
- `app/(board)/b/[short_id]/[[...slug]]/page.tsx`：
  - `type PageParams = { short_id: string; slug?: string[] };` に統一（Promise ではなく素直な型）。
  - **canonical tail** 算出 → 不一致なら **`permanentRedirect()`**。
  - `revalidate = 0`（リアルタイム性重視）。

**差分イメージ**
```diff
// app/(board)/page.tsx
-export default function KanbanBoardPage() { return <KanbanBoardClient /> }
+import { permanentRedirect } from 'next/navigation';
+import { getDefaultBoardShortId } from '@/lib/boards';
+export default async function RootBoardRedirect() {
+  const sid = await getDefaultBoardShortId();
+  permanentRedirect(`/b/${sid}`);
+}
```

```diff
// app/(board)/b/[short_id]/[[...slug]]/page.tsx
-export default async function BoardPage({ params }: { params: Promise<any> }) {
-  const { short_id, slug } = await params;
+type PageParams = { short_id: string; slug?: string[] };
+export default async function BoardPage({ params }: { params: PageParams }) {
+  const { short_id, slug } = params;
  // 1) board を取得（権限/存在チェック）
  // 2) canonicalTail を構築 → 不一致時は permanentRedirect(`/b/${sid}/${tail}`)
  // 3) 初期データを SSR 供給
}
```

---

### PR-4: Middleware / Edge / KV の仕上げ

**変更点**
- `middleware.ts`：
  - `matcher: ['/']` は維持
  - `/?board=<uuid>` を受けたら KV で `<uuid>→<sid>` を解決し **308** → `/b/<sid>` へ
  - 失敗時は **404**（情報露出を避ける）
- `lib/edge/get-board-meta.ts`：KV ミス時に **署名付き API** 経由で 1 回だけフォールバック。
- `app/api/board-meta/route.ts`：レスポンスに `canonicalPath` を含め、クライアントの早期正規化に寄与。

---

### PR-5: E2E / Unit テスト追加（Playwright + Vitest）

**E2E（主要観点）**
- `/?board=<uuid>` へアクセス → **/b/<sid> に 308**（`page.waitForURL` で検証）
- `/b/<sid>` 直リンク → ボードが SSR で初期化される
- `/b/<sid>/<wrong>` → **/b/<sid>/<canonical> に 308**
- カードモーダル open/close：**close → /b/<sid> に戻る**、戻るでモーダルが閉じる
- コピー導線：クリックで**正しい URL がクリップボード**に入る

**Unit**
- `buildBoardShortUrl` / `buildBoardCanonicalUrl` の入出力
- `canonicalTail` の正規化ルール（日本語/記号混在）

---

### PR-6: DB マイグレーション確認 & 本番反映

**要件**
- `boards.short_id`（text, unique, not null）  
- `boards.slug`（text, nullable）  
- （任意）`boards.id_short`（int, unique）— もし UI 表示で「#123」等が必要なら。

**チェック手順**
```sql
-- 1) スキーマ
select column_name, data_type, is_nullable
from information_schema.columns
where table_name='boards' and column_name in ('short_id','slug','id_short');

-- 2) ユニーク制約
select i.relname as index_name, a.attname as column_name
from pg_class t
join pg_index ix on t.oid=ix.indrelid
join pg_class i on i.oid=ix.indexrelid
join pg_attribute a on a.attrelid=t.oid and a.attnum=any(ix.indkey)
where t.relname='boards' and i.relname like '%short_id%';

-- 3) バックフィル済み件数
select count(*) filter (where short_id is not null) as filled, count(*) total from boards;
```

**運用フック（Supabase／DB）**
- INSERT/UPSERT 時に `short_id` を自動付与する DB 関数または Row Level function を用意（既存の採番ロジックと整合）。

---

## E. 受け入れ条件（Definition of Done）

- `/` → `/b/<sid>`（308）／`/?board` → `/b/<sid>`（308）が **常に正**。
- **UI のコピー導線**が 2 種（短縮/正規）で存在し、値は **常に正**。
- **モーダル閉じ**で **`/b/<sid>` に残るか戻る**（履歴が 1 段深い場合は `back()` で閉じる）。
- SSR の `params` 型と canonical 308 のロジックが **/c 実装と矛盾しない**。
- E2E/Unit がグリーンで、回帰が再発しない。

---

## 付録：ユーティリティ（`lib/board-url.ts` 例）

```ts
// server & client safe
export function toSlugBase(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function buildBoardShortUrl(origin: string, shortId: string): string {
  return `${origin}/b/${shortId}`;
}

export function buildBoardCanonicalTail(board: {{ id_short?: number; slug?: string; title?: string }}): string {
  if (board?.id_short && board?.slug) return `${board.id_short}-${board.slug}`;
  if (board?.title) return toSlugBase(board.title);
  return '';
}

export function buildBoardCanonicalUrl(origin: string, board: {{ shortId: string; id_short?: number; slug?: string; title?: string }}): string {
  const tail = buildBoardCanonicalTail(board);
  return tail ? `${origin}/b/${board.shortId}/${tail}` : `${origin}/b/${board.shortId}`;
}
```

---

## ロールアウト手順（本番）

1. **DB 確認 & バックフィル完了**（件数一致）  
2. **KV 同期**（`uuid → short_id` マップ）／ミドルウェア 308 を一時的にステージングで有効化  
3. **E2E 全通過**（308/SSR/モーダル/コピー）  
4. **本番投入** → **メトリクス監視**（308 回数、404、KV ミス率、モーダル閉じ後の直帰率）  
5. 旧 `/?board` のリンクを徐々に除去（監視しつつ 0% まで）

---

### 備考
- Card 側の `/c/...` 実装では `params` が Promise 型の例があり、**/b 側は素直な `params` 型**に合わせると事故が減ります。
- URL 正規化は **308（Permanent）** を統一採用（POST 互換性維持）。
