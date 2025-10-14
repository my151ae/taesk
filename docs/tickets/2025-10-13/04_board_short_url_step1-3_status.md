
# 04: Board Short URL（/b）— Step1〜3 完了確認 & 仕上げ仕様書
**Date (JST): 2025-10-13 09:38**  
**Owner:** 松本Ops  
**Status:** 実装確認 + 最終仕上げタスク定義（この通りにやれば完成）

---

## 0. 背景 / スコープ
- 目的：**/b を正規URL**として統一し、SSR・UI・Middleware・Edge/KV・E2E を貫通させる。  
- 本書では **Step1〜3 の完了状況**を整理し、**残差（仕上げ）**をタスク化する。  
  - Step 1: `/b/:short_id/[[...slug]]` の SSR & canonical 308  
  - Step 2: UI/クライアントの **/b 正規フロー統一**（URLコピー・updateURL・モーダル閉じ）  
  - Step 3: Middleware + Edge/KV による `/?board=<uuid>` → `/b/:short_id/...` の **308 正規化**

---

## 1. Step1〜3 完了状況（サマリ）
| Step | 目的 | 実装状況 | 備考 |
|---|---|---|---|
| **Step 1** | `/b` SSR + slug不一致の 308 | **概ね完了** | `page.tsx` + `generateMetadata` 強化済み。slug 不一致時の `permanentRedirect(308)` 実装あり。`revalidate = 0`。※ `generateMetadata` は軽量化要確認。 |
| **Step 2** | /b 正規フロー（UI/URL/モーダル） | **実装済だが調整要** | コピー導線（短縮/正規）追加、`updateURL`/`handleCloseCardModal` を /b 前提で刷新。ただし **ボード切替時にURL反映が遅い**現象あり → 即時化が必要。 |
| **Step 3** | Middleware + Edge/KV で `/?board` → `/b` 308 | **概ね完了** | KVキーの環境別ネームスペース化・API応答に canonical path 付与・Middlewareで 308。※ **`/` の扱い（デフォボードへ308 or ランディング）未固定**。 |

**ユーザー観測からの補足**
- `/b` は使われている（OK）。
- **`/` を開くだけでは変わらない**（→ 仕様未固定）。
- **ボード切替でURLが“少し遅れて”変わる**、**元のボードに戻す時も遅い**（→ `updateURL` 即時化が未）。

---

## 2. 仕上げが必要な点（未完/改善）
1) **`/` の仕様固定**  
   - A案: `app/(board)/page.tsx` を **サーバーコンポーネント**にし、**デフォルトボードへ 308**。  
   - B案: `/` はランディング（**ボードUIは常に `/b/...`**）。  
   → どちらか **明確に固定**（E2Eも合わせる）。

2) **URL更新の“即時化”**  
   - ボード切替時、**同期的に** `router.replace('/b/<sid>')`。  
   - `tail`（`id_short-slug`）が同期生成できれば**同一 tick**で `/b/<sid>/<tail>` に上書き。  
   - データ待ち/ネットワーク待ちでURLを止めない（slugはSSRの 308 に任せられる）。

3) **モーダル閉じの履歴復元の徹底**  
   - 基本は `router.back()`、履歴が無ければ `router.replace('/b/<sid>')` フォールバック。  
   - 直リンク/リロード起点でも `/b` に残る。

4) **`generateMetadata` の軽量化**  
   - canonical 判定と軽い値生成のみ。重い取得は page 側に寄せる。

5) **Middleware の誤発火防止**  
   - 条件は **`pathname === '/'` かつ `searchParams.has('board')`**。  
   - `/_next`, `/api`, 静的アセット配下は対象外。  
   - KV ミス時は **404 or `/`** の汎用応答（情報露出防止）。

6) **DB（本番）確認**  
   - `boards.short_id`（NOT NULL, UNIQUE）, `boards.slug`, （任意）`boards.id_short` の存在/充足。  
   - バックフィル完了件数=総件数、UNIQUEインデックス有効。

7) **クリップボード フォールバックの堅牢化**  
   - `navigator.clipboard` 失敗時に一時 `textarea` + `execCommand('copy')`。  
   - 成否トーストを共通化。

8) **Realtime 再購読の並列化/重複抑止**  
   - URL更新と**並列**に `unsubscribe(old)` → `subscribe(new)`。  
   - レース防止に **世代カウンタ / AbortController**。

9) **E2E の追補（網羅）**  
   - `/?board=<uuid>` → `/b/:sid` へ **308**。  
   - `/b/:sid/:wrong` → `/b/:sid/:canonical` へ **308**。  
   - **ボード切替 直後にURL即時**、同tickで `:tail` 上書き。  
   - **モーダル閉じで /b に残る/戻る**。  
   - **Realtime 1本化**（旧購読へイベントが届かない）。  
   - **コピー導線**（短縮/正規）成功 + フォールバック成功。

---

## 3. 実装タスク（PR粒度の指示）
### T-1 `/` 仕様固定（A 推奨）
- `app/(board)/page.tsx` をサーバー化 → `const sid = await getDefaultBoardShortId()` → `permanentRedirect('/b/' + sid)`。  
- B 案なら、`/` はランディング表示のみとし、**ボードUIは /b へ集約**。

**Done 条件**: `/` の動作が常に同一（A: 308 / B: ランディング）。

---

### T-2 `updateURL()` の即時化
- 先に `/b/<sid>` に **同期**で `router.replace`。  
- 可能なら `queueMicrotask` で同tickに `/b/<sid>/<tail>` まで上書き。  
- 非同期結果を待たない。

**擬似コード**
```ts
function updateURLImmediate(board) {
  const sid = board.shortId;
  router.replace(`/b/${sid}`); // 即時
  const tail = buildBoardCanonicalTail(board); // 同期で作れるなら
  if (tail) queueMicrotask(() => router.replace(`/b/${sid}/${tail}`));
}
```

**Done 条件**: 切替クリック直後、**アドレスバーが瞬時に `/b/:sid`** へ。

---

### T-3 `handleCloseCardModal()` の統一
- `router.back()` 最優先。履歴無しのみ `router.replace('/b/:sid')`。

**Done 条件**: 閉じたら常に **/b に残る/戻る**。

---

### T-4 `generateMetadata` の軽量化
- canonical 判定だけに絞る。重い fetch は page 側で。

**Done 条件**: `/b/:sid` の TTFB が劣化しない（±10%以内）。

---

### T-5 Middleware スコープ厳密化
- `pathname === '/' && has('board')` のみ 308。  
- それ以外は素通し。KV ミス時は 404 or `/`。

**Done 条件**: 誤発火ゼロ。ログの 308 が期待どおり。

---

### T-6 クリップボード フォールバック
- 一時 `textarea` + `execCommand('copy')` を実装。  
- 成否トースト。

**Done 条件**: 非HTTPS/古ブラウザでも実用。

---

### T-7 Realtime 再購読
- 並列進行で URL を待たせない。  
- 世代管理で重複購読を抑止。

**Done 条件**: 旧ボードにイベントが届かない。

---

### T-8 DB（本番）確認（読み取り専用）
```sql
-- 存在確認
SELECT 
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='boards' AND column_name='short_id') AS has_short_id,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='boards' AND column_name='slug')     AS has_slug,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='boards' AND column_name='id_short') AS has_id_short;

-- 充足状況
SELECT COUNT(*) AS total,
       COUNT(short_id) AS short_id_filled,
       COUNT(slug)     AS slug_filled,
       COUNT(id_short) AS id_short_filled
FROM boards;
```

**Done 条件**: `short_id` NULL=0、UNIQUE 有効。

---

### T-9 E2E 追補
- 9つの観点（2章の「E2E の追補（網羅）」）を全てテストに追加。

**Done 条件**: すべてグリーン／フレークなし。

---

## 4. 完了条件（Definition of Done）
- `/` の仕様が固定（308 or ランディング）。  
- `/?board=<uuid>` は **常に 308** → `/b/:sid`、`/b/:sid/:wrong` → `/b/:sid/:canonical`。  
- **URL更新は即時**（切替直後 `/b/:sid` → 可能なら同tickで `:tail`）。  
- **モーダル閉じ**で **/b に残る/戻る**。  
- **クリップボード**はフォールバック含めて成功。  
- **Realtime** は常に**1本**（重複購読なし）。  
- **E2E/Unit** が全てグリーン、TTFB 劣化なし（±10%以内）。  
- 本番DBの `short_id/slug` 充足・UNIQUE 有効。

---

## 5. 付録：slug/canonicalTail の指針
```ts
export function toSlugBase(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

export function buildBoardCanonicalTail(b: { id_short?: number; slug?: string; title?: string }) {
  if (b?.id_short && b?.slug) return `${b.id_short}-${b.slug}`;
  if (b?.title) return toSlugBase(b.title);
  return '';
}
```

---

### 備考
- **URLは“表示の事実”として即時更新**、データは後追いでOK。  
- 迷ったら **/c 実装の正規化方針**（308 / replaceState / back優先）に合わせる。
