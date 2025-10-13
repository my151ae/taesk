# 03: Board Short URL（/b）最終仕上げ仕様書 — 「どこまでできたか / 何を直すか」
**Date (JST):** 2025-10-13 07:26  
**Owner:** 松本Ops  
**Status:** 最終仕様（この通りに実装・検証すれば完了）

---

## 0. 背景 / スコープ
- 目標：**/b を“正”URL**として統一し、`/?board=<uuid>` からは **308 Permanent Redirect** で正規化。UI・SSR・Middleware・Edge/KV・E2E まで一貫して回帰ゼロにする。
- 本書は **02_board_short_url.md（実装途中）** の続編で、**現在の実装状態**と**残差（未完部分）**を明確化し、**完了までの具体タスクと受け入れ基準**を定める。

---

## 1. ここまでできたこと（確認済み）
### 実装
- **URLユーティリティ**
  - `lib/board-url.ts`: `buildBoardCanonicalUrl` 追加。**短縮/正規URLの両形式を安定生成**できる。
- **UI / クライアント**
  - `app/(board)/_components/KanbanBoardClient.tsx`:  
    - **短縮/正規URLのコピー導線**を追加（クリップボード + フォールバック）。  
    - **updateURL** / **モーダル終了時の履歴復元**を **/b 正規フロー**へ揃えた。
- **SSR / ルーティング**
  - `app/(board)/b/[short_id]/[[...slug]]/page.tsx`:  
    - **SSR対応**に強化。`generateMetadata` で **canonical メタ**を発行。  
    - **slug 不一致時**に **308 `permanentRedirect`** を実施。
- **API / Edge / KV / Middleware**
  - `app/api/board-meta/route.ts` / `lib/edge/get-board-meta.ts` / `middleware.ts`:  
    - **canonical path** を API 応答へ含め、**KV キャッシュ**経由で `/?board=uuid → /b/:short_id/...` の **308 正規化**を安定化。  
    - **環境別ネームスペース付き**の KV キーで汚染/環境混在を回避。
- **E2E**
  - `e2e/kanban.spec.ts`:  
    - ボード生成時に **short_id / id_short / slug 採番**。  
    - `/?board=uuid` の **308 リダイレクト**、`/b/...` **slug 不一致の正規化**を検証するシナリオを追加。

### 状態観測（ユーザー報告）
- `/b` 形式の URL は**使われている**。  
- ただし、`/` にアクセスしただけでは**期待挙動（308 or ランディング切替）が統一されていない**。  
- **ボード切替時に URL 反映が遅延**（非同期処理完了待ちと思われる）。  
- **元のボードへ戻す時も URL 切替が遅い**。

---

## 2. 残っている課題（未完 / 要修正）
1) **`/` の取り扱いが未固定**  
   - 選択肢A: `app/(board)/page.tsx` を **サーバーコンポーネント**化し、**デフォルトボードへ 308**。  
   - 選択肢B: `/` はランディング（**ボード UI は常に `/b/...` のみ**）。  
   → 現状は **A/B のどちらかに固定されていない**。

2) **ボード切替時の URL 反映が遅い**（体感）  
   - `updateURL()` が **データ取得（slug/canonicalTail）完了**まで **await** している/依存している疑い。  
   - **URLは即時** `/b/:sid` に更新 → 可能なら同一 tick で `/b/:sid/:tail` に置換、**待ち合わせしない**方針へ。

3) **モーダル閉じの履歴復元の徹底**  
   - `router.back()` を**最優先**。履歴が無い場合のみ `/b/:sid` へ `replace` でフォールバック。  
   - 直リンク/リロード時でも**/bに残る**ことを保証。

4) **`generateMetadata` が重くならない保証**  
   - canonical 判定以外の重処理は page 側に寄せ、**TTFB を阻害しない**。

5) **Middleware のスコープ/安全策**  
   - `/?board=<uuid>` 検知は **`pathname === '/'` かつ `searchParams.has('board')`** のみ。  
   - `/_next`, `/api` など**システムパスを巻き込まない**。  
   - KV ミス時のフォールバックは **404 or `/`**（情報漏洩を避ける）。

6) **DB 本番確認**（書き込み無し確認クエリで十分）  
   - `boards.short_id`（NOT NULL/UNIQUE）、`boards.slug`、（任意）`boards.id_short` が**すべて充足**。  
   - **バックフィル完了件数 = 総件数**。UNIQUE インデックス有効。

7) **クリップボードの非HTTPSフォールバックの堅牢化**  
   - `navigator.clipboard` 不可時の**選択→execCommand**/一時 `textarea` 方式の動作保証・テスト。

8) **slug/canonicalTail の決定ルールの一意性**  
   - 日本語/記号/全角半角の正規化、連続ハイフン・末尾ハイフン除去、大小文字正規化。  
   - `id_short-slug` 形式の**衝突回避**と**エンコードの二重化防止**。

9) **Realtime 再購読の並列化/重複抑止**  
   - URL更新（ナビゲーション）と**並列**で購読切替。**URLを待たせない**。  
   - 旧チャネル unsubscribe → 新チャネル subscribe の順序が**必ず**守られる。

10) **E2E の網羅度アップ**  
   - `/?board` → `/b` 308、`/b/:sid/:wrong` → canonical 308、**即時URL**、**モーダル閉じ**、**Realtime 1本化**、**コピー導線**の**全パス**を一本で通す。

---

## 3. 完成に向けた具体タスク（実装指示）
> **優先度: 高→低** で並べています。PR を分けてもOK。

### T-1: `/` の仕様を固定する（A or B）
- **A案（推奨）**: `app/(board)/page.tsx` をサーバーコンポーネント化し、**デフォルトボード短縮ID**を取得して `permanentRedirect('/b/<sid>')`。  
  - `getDefaultBoardShortId()` をサーバー util として実装。  
- **B案**: `/` はランディング。**ボードUIは /b でのみ提供**（`app/(board)/page.tsx` からボードUIを撤去）。

**受け入れ基準**
- `/` にアクセスしたときの挙動が**常に同じ**（Aなら 308、Bならランディング）。

---

### T-2: `updateURL()` を「即時 `/b/:sid` →（可能なら即）`/b/:sid/:tail`」に変更
**方針**
- `tail`（`id_short-slug`）が**同期生成できる**とき：1 tick 内に `/b/:sid/:tail` まで置換。  
- **できない**とき：ひとまず `/b/:sid` へ即時置換。**SSR の 308** が canonical へ寄せてくれるので待たない。

**擬似コード**
```ts
function updateURLImmediate(board) { 
  const sid = board.shortId;
  router.replace(`/b/${sid}`); // 即時
  const tail = buildBoardCanonicalTail(board); // 同期で作れるなら
  if (tail) queueMicrotask(() => router.replace(`/b/${sid}/${tail}`));
}
```

**受け入れ基準**
- ボード切替直後、**アドレスバーが瞬時に `/b/:sid`** に変わること。  
- `tail` が揃えば**すぐ** `/b/:sid/:tail` に上書きされるが、体感遅延は出ない。

---

### T-3: `handleCloseCardModal()` を統一
**仕様**
- まず `router.back()`。**戻れない**場合のみ `router.replace('/b/:sid')`。  
- 直リンク/リロード起点でも**/b に残る**。

**受け入れ基準**
- モーダル閉じで **/b に留まる/戻る**。`/` に落ちることがない。

---

### T-4: `generateMetadata()` の軽量化
**仕様**
- canonical 判定（`tail === canonicalTail(board)`）のみ。  
- 不一致なら `permanentRedirect(canonical)`.  
- 重いフェッチは page 側へ回す。

**受け入れ基準**
- `/b/:sid` の **TTFB が劣化しない**（事前値比 ±10% 以内が目安）。

---

### T-5: Middleware のスコープ厳密化
**仕様**
- 条件: `pathname === '/' && searchParams.has('board')`。それ以外（`/_next`, `/api` 等）は **素通し**。  
- KV ミス時フォールバック: **404 or `/`** に固定（メッセージは汎用）。

**受け入れ基準**
- `/?board` 以外で **誤発火しない**。ログの 308 件数が期待値に収束。

---

### T-6: クリップボード フォールバック堅牢化
**仕様**
- `navigator.clipboard` 失敗時: 一時 `textarea` で `document.execCommand('copy')`。  
- 成否トーストを必ず表示。

**受け入れ基準**
- **HTTP / 古いブラウザ**でもコピーが実用になる（E2E で最小限カバー）。

---

### T-7: slug/canonicalTail のルール明文化 & 実装
**仕様**
- 小文字化 → NFKD 正規化 → ダイアクリティカル除去 → **英数・CJK**以外は `-` に置換 → 連続/端の `-` を削除。  
- `id_short` があれば `"{id_short}-{slug}"`。  
- `encodeURIComponent` の重複回避（**二重エンコード禁止**）。

**受け入れ基準**
- 同名/似名のボードで**衝突しない**。slug 不一致時は**必ず 308** で揃う。

---

### T-8: Realtime 再購読の並列化/重複抑止
**仕様**
- URL更新（replace）と**並列**に `unsubscribe(old)` → `subscribe(new)`。  
- レースを避けるため、**世代カウンタ** or **AbortController** を使用。

**受け入れ基準**
- 切替後に**旧ボードへイベントが飛ばない**。複数購読にならない。

---

### T-9: DB（本番）確認（読み取り専用）
**クエリ例**
```sql
-- 存在確認
SELECT 
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='boards' AND column_name='short_id') AS has_short_id,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='boards' AND column_name='id_short')  AS has_id_short,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='boards' AND column_name='slug')      AS has_slug;

-- 充足状況
SELECT COUNT(*) AS total,
       COUNT(short_id) AS short_id_filled,
       COUNT(slug)     AS slug_filled,
       COUNT(id_short) AS id_short_filled
FROM boards;

-- インデックス（例）
-- \d+ boards;  -- psql のメタコマンドで UNIQUE(short_id) を目視確認
```

**受け入れ基準**
- `short_id` の **NULL が 0**、UNIQUE 制約が有効。

---

### T-10: E2E 追補
**想定ケース**
1. `/?board=<uuid>` へアクセス → **/b/:sid に 308**（ネットワーク/ページ双方で検証）。  
2. `/b/:sid` 直リンクで SSR 初期化。  
3. `/b/:sid/:wrong` → **/b/:sid/:canonical に 308**。  
4. **ボード切替**：クリック直後に URL が **即時 `/b/:sid`** に変わる（tail があれば同 tick で上書き）。  
5. **モーダル**：open → close で **/b に戻る**（履歴が無ければ `replace` フォールバック）。  
6. **コピー導線**：短縮/正規ともに **クリップボード**に入り、失敗時はフォールバック成功。  
7. **Realtime**：切替直後に**旧ボードへイベントが届かない**。

**受け入れ基準**
- すべてグリーン。フレーク時は **タイムアウト/待機**よりも **状態同期の欠落**を疑って修正。

---

## 4. 完了条件（DoD）
- `/` の仕様が**固定**（308 or ランディング）。  
- `/?board=<uuid>` は **常に 308** で `/b/:sid`（slug 不一致も 308 で揃う）。  
- **URL更新が即時**。ボード切替直後に `/b/:sid` →（あれば）`/b/:sid/:tail`。  
- **モーダル**を閉じても **/b に残る/戻る**。  
- **クリップボード**が HTTPS 以外/古い環境でも実用（フォールバック有効）。  
- **Realtime** は常に**1本**、旧購読へイベントが飛ばない。  
- **E2E/Unit** が全てグリーン。TTFB 劣化なし（±10% 以内）。  
- 本番DBの**short_id/slug**が充足し、UNIQUE が有効。

---

## 5. ロールアウト / 監視
- **段階ロールアウト**：Staging → QA → 本番 10% → 100%。  
- **監視**：
  - 308 件数 / 404 率 / KV ミス率（環境別）。  
  - SSR 初回応答時間（`/b/:sid`）。  
  - モーダル閉じ後の直帰率。  
  - Realtime エラー/再接続回数。

---

## 6. 付録：ユーティリティ例（slug/canonical）
```ts
export function toSlugBase(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')         // ダイアクリティカル除去
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf-]+/g, '-') // 英数+CJK以外は -
    .replace(/^-+|-+$/g, '')                   // 端の - を除去
    .replace(/-(2,)/g, '-');                   // 連続 - を1つに
}

export function buildBoardCanonicalTail(b: { id_short?: number; slug?: string; title?: string }) {
  if (b?.id_short && b?.slug) return `${b.id_short}-${b.slug}`;
  if (b?.title) return toSlugBase(b.title);
  return '';
}
```

---

### メモ
- **“URLは表示の事実、状態はアプリ”** を徹底し、URL更新は**待たない**のが安定のコツ。
- 迷ったら **/c 実装の正規化方針**（308/replaceState/back優先）に合わせると事故が減る。
