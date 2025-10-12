# 01: Board Short URL（/b）— 現状整理と最終仕上げ計画

**Date:** 2025-10-13 (JST)  
**Owner:** 松本Ops  
**Status:** 提案（要レビュー）

---

## 目的 / ゴール
- **ボード**に対して Trello 風の **短縮ID（`short_id`）** を付与し、**正規URL**（`/b/:short_id/:slug?`）を導入。
- 旧形式（`/?board=<uuid>`）からは **308 Permanent Redirect** で正規化。
- UI から **短縮URL / 正規URL のコピー**導線を提供。
- SSR と E2E を含む **回帰に強い実装**に仕上げ、運用フロー（本番データ確認/バックフィル）を明確化。

---

## リポジトリ確認に基づく「ここまで」（2025-10-13 時点）
- **カード（/c）側**の短縮URL・正規化は実装が進み、
  - `/c/:short_id` / `/c/:short_id/:slug` 直リンク、slug 不一致時の 308 正規化、URL をモーダル表示と同期待ち受けで **自然な履歴**に調整、E2E の整合まで概ね整っている。
  - ドキュメント／チケットも整備済み（`docs/tickets/2025-10-10/...`）。
- **ボード（/b）側**はまだベースのみ（`/?board=` パラメータ）で、/b の SSR ルート・ミドルウェア・メタ取得ラッパは **未反映**の想定。
- `KanbanBoardClient.tsx` といった大規模コンポーネント分割は **未確認**（現状は `app/(board)/page.tsx` ベース）。

> 補足: 上記は **公開リポジトリの最新コミット**を基準にした観測。ローカルの未 Push 変更があれば本計画で吸収します。

---

## ギャップ / 要修正ポイント
1. **/b ルートの未実装**
   - `app/(board)/b/[short_id]/[[...slug]]/page.tsx` （SSR）
   - `generateMetadata()` で **canonical** メタ構築＆ slug 正規化（`permanentRedirect`）
2. **`/?board=` → `/b/...` の 308**
   - `middleware.ts`（`matcher: ["/"]`）で UUID を short_id に変換 → 正規 URL へ 308
   - 失敗時は `/` or 404（※漏洩防止のため具体エラーは出さない）
3. **Edge/Node メタ取得ラッパ**（任意）
   - `lib/edge/get-board-meta.ts` → Vercel KV キャッシュ → 未ヒット時は API Route 経由で取得
4. **UI 導線**
   - ボードメニューに **「正規URLをコピー」「短縮URLをコピー」** を追加
   - `buildBoardShortUrl(board)` / `buildBoardCanonicalUrl(board)` を利用
5. **URL 同期ロジックの一本化**
   - `updateURL` / `handleCloseCardModal` など、**/b を正**とした履歴更新（`replaceState` か `router.replace`）
6. **E2E/ユニット**
   - 308 正規化、モーダル閉じで **正規URL維持**、Realtime 再購読の回帰、カード URL（/c）との併存を網羅。

---

## 実装タスク（チェックリスト）

### A. ルーティング / SSR
- [ ] `app/(board)/b/[short_id]/[[...slug]]/page.tsx` を実装（`revalidate = 0`、SSR 初期データ読込）。
- [ ] `generateMetadata` で **slug 正規化**（:slug が不一致なら `permanentRedirect(canonical)`）。
- [ ] `runtime` は Node.js（Supabase Service Role を安定読み込み）。

### B. ミドルウェア（308 正規化）
- [ ] `middleware.ts` に `matcher: ["/"]` を設定。
- [ ] `/?board=<uuid>` を検知 → Board の `short_id` 引当て → `/b/:short_id/:slug?` へ `Response.redirect(…, 308)`。
- [ ] エラー時は `/` へフォールバック（個人情報漏洩を避ける）。

### C. メタ取得ラッパ / キャッシュ（任意）
- [ ] `lib/edge/get-board-meta.ts`：KV 参照 → キャッシュミス時は `app/api/board-meta` 経由で取得。
- [ ] TTL/キャッシュポイズニング対策（キーに `env` / `projectId` を含める）。

### D. UI / ユーティリティ
- [ ] `lib/board-url.ts` に `buildBoardShortUrl(board)` / `buildBoardCanonicalUrl(board)` を定義（存在すれば活用）。
- [ ] ボードメニューにコピー導線を追加（`navigator.clipboard.writeText` + 非 HTTPS フォールバック）。
- [ ] `updateURL` / `handleCloseCardModal` の **/b 正規フロー**対応。

### E. Realtime / サブスク管理
- [ ] ボード切替時に古いチャネルを **確実に unsubscribe** → 新規 subscribe。
- [ ] ルート起点（/b）でも **重複購読が発生しない** ことを検証。

### F. テスト（Playwright + 単体）
- [ ] `/?board=<uuid>` → `/b/:short_id` へ **308** を検証（`expect(response.status()).toBe(308)` など）。
- [ ] `/b/:short_id/:slug` **slug 不一致** → 308 正規化。
- [ ] モーダルを閉じても **/b 正規URLを維持**。
- [ ] **Realtime 再購読**が 1 本で安定。（切替後に旧ボードにイベントが飛ばない）
- [ ] **/c（カード）系**と干渉しないことの回帰（共存動作）。

---

## データ（本番）確認 / バックフィル

### 1) 反映状況確認（安全確認用クエリ）
> Supabase (Postgres) 前提。**書き込みを伴わない確認クエリ**のみ記載。

```sql
-- カラム存在確認
SELECT
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'boards' AND column_name = 'short_id'
  ) AS has_short_id,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'boards' AND column_name = 'id_short'
  ) AS has_id_short,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'boards' AND column_name = 'slug'
  ) AS has_slug;

-- NULL 比率チェック
SELECT
  COUNT(*) AS total,
  COUNT(short_id) AS short_id_filled,
  COUNT(id_short) AS id_short_filled,
  COUNT(slug)     AS slug_filled
FROM boards;
```

### 2) バックフィル実施ガイド（概要）
- **採番方針**
  - `short_id`: Base62 8桁（全体で一意）。
  - `id_short`: ボード内連番（将来 UI に露出することを想定）。
  - `slug`: `toSlugBase(name)` → `id_short` 併記で衝突回避（例: `12-my-board`）。
- **実施方法**
  - まず **ステージング**でスクリプトを走らせ、E2E を通す。
  - **リハーサル**後に本番で実行（トランザクションで保護、途中中断可）。
  - 実施後に **インデックス**（`UNIQUE( short_id )`）を有効化。

> バックフィル SQL/スクリプトはリポジトリの `scripts/` ディレクトリに配置（既存があれば更新）。

---

## 完了条件 (Definition of Done)
- [ ] `/b/:short_id` 直リンクでボードが SSR 表示される。
- [ ] `/?board=<uuid>` は **常に** `/b/:short_id` へ 308。
- [ ] slug 有り URL（`/b/:short_id/:idShort-:slug`）で **slug 不一致時に 308 正規化**。
- [ ] ボードメニューから **正規/短縮 URL を 1 クリックコピー**できる。
- [ ] モーダル開閉や DnD 後でも **正規URLが維持**される（`replaceState`/`router.replace` の一貫性）。
- [ ] E2E（308/モーダル/再購読/共存）フルパスが **安定合格**。

---

## ロールアウト / リスク
- **段階ロールアウト**: ステージング → QA → 10% → 100%（キャッシュ/KV は TTL 監視）。
- **既知のリスク**
  - Intercepting Routes の挙動差（Next.js minor 差異）→ モーダルは **/c 専用**として切り分け、/b は SSR を堅実運用。
  - KV キャッシュ不整合 → **キャッシュキーに env / projectId を含める**、TTL 短め設定。
  - Realtime 再購読の取りこぼし → E2E で**切替直後のイベント**が旧ボードへ飛ばないことを検証。

---

## 参考
- 既存の **カード (/c) 実装**（短縮ID・slug 正規化・E2E 一式）
- 既存ドキュメント: `docs/tickets/roadmap.md`、`docs/tickets/2025-10-10/*`

> 本ドキュメントは **/b（ボード）側**の仕上げに集中。**/c（カード）側**は現状仕様を維持し、相互干渉を避ける設計とします。

