# 0201 コメントDB/API拡張

**作成日**: 2025-10-20
**関連エピック**: `docs/tickets/2025-10-20/0200-comments-notifications-epic.md`
**担当候補**: BE（Supabase） + FE（API呼び出し）

---

## 🎯 ゴール
- `comments.mentions uuid[]` 方針を維持しつつ、GIN インデックスとバリデーションでメンション検索を高速化する
- 既存 API Routes（`/api/cards/[cardId]/comments`・`/api/comments/[commentId]`）を最新エラーフォーマット／Idempotency-Key 対応に揃える
- コメント作成/編集/削除がオフラインキュー（`KanbanBoardClient`）と整合し、Realtime 配信のベースとなるイベント整備を行う

## 📝 背景
- Phase3 で `comments` テーブルと CRUD API は存在し、`mentions` は既に `uuid[]` として保存されている
- 今後の通知生成（0204）やメンションUX改善（0203）では UUID 配列を前提に処理するため、スキーマ変更は不要だが索引・バリデーションの強化が必要
- コメントイベントはオフラインキュー→API Routes 経由で保存する設計であり、API の共通仕様（Idempotency-Key/統一エラー）を整備しておく

## ✅ スコープ
- Supabase Migration の追加（`comments` への GIN インデックス、`updated_at` トリガー再確認）
- `comments` テーブルの `board_id`・`deleted_at` 列の存在確認と欠落時の補完マイグレーション
- `comments.mentions` に対する入力バリデーション（UUID のみ許可、ボードメンバー外は拒否）
- `lib/supabase.ts` 型定義（`Comment` / `CommentWithAuthor`）の `board_id`・`deleted_at` 反映
- `/api/cards/[cardId]/comments`・`/api/comments/[commentId]` のエラーフォーマット統一と Idempotency-Key 対応
- Board 権限チェックを API 内（`board_members`）で実施し、RLS と二重にガード
- オフラインキューペイロードの定義見直し（`mentions: string[]` を UUID 前提に）

## 🚫 非スコープ
- UI レイヤーでのコメント表示/操作（0202 以降で対応）
- メンションタイプアヘッドや mention UI（0203）
- 通知生成処理（0204）

## 📦 実装タスク
1. **マイグレーション追加**
   - `create index if not exists idx_comments_mentions_gin on comments using gin(mentions);`
   - `create index if not exists idx_comments_card_time on comments(card_id, created_at);`（存在確認のみ）
   - `comments` に `deleted_at timestamptz` が無い場合は追加し、ソフトデリートを統一
   - `board_id` 欠落時は `cards.board_id` を参照して埋める移行 SQL を追加
2. **バリデーションユーティリティ**
   - `lib/validators/comments.ts` を新設し、`mentions` を UUID[] として検証
   - ボード外のメンバー ID が含まれていた場合は 400 エラー
3. **API Routes 更新**
   - POST/PATCH/DELETE のレスポンスを共通`{ data, error: { code, message } }` 形式に統一
   - Idempotency-Key ヘッダ対応（同一キー再送時は 409 ではなく既存結果を返す）
   - `board_id` をリクエストスコープでキャッシュし、権限チェック + Realtime broadcast に利用
4. **型定義とテスト補強**
   - `lib/supabase.ts` の `Comment` 型に `board_id`・`deleted_at` を追加
   - Supabase クライアントのテスト（ユニット）で `mentions` の型安全性を確認
5. **オフラインキューとの整合**
   - `KanbanBoardClient` のコメント同期キューを確認し、`mentions` を UUID[] として保持
   - 再送時に Idempotency-Key を付与するように定義（`comment:${cardId}:${clientMutationId}` など）
6. **監査・ログ**
   - Supabase ログにバリデーション失敗をINFOレベルで出力し、監査テーブル（既存）に追記できるようフックを用意

## 🔐 セキュリティ / RLS
- `comments` の RLS を `board_id` ベースで再検証（commenter 以上が CRUD 可能）
- API レイヤーでも `board_members` を確認し、RLS エラーを 403 として扱う
- メンション不整合は Supabase ログに出力し、必要に応じて監査テーブルへ保存

## ✅ 受け入れ基準
- [ ] `/api/cards/[cardId]/comments` のレスポンスが `mentions: string[]`（UUID）を返し、`uuid` 以外の値は 400 となる
- [ ] GIN インデックスによりメンション検索クエリが 50ms 以内で返る（ローカル負荷テスト）
- [ ] Idempotency-Key を付与した再送で二重投稿が発生しない
- [ ] RLS/権限違反時に 403 が返る（ボード外ユーザーで確認）

## 🧪 テスト
- [ ] `npm run lint`
- [ ] `npx playwright test e2e/phase3-comments.spec.ts --reporter=json > playwright-report-comments.json`
  - [ ] `cat playwright-report-comments.json | jq '.stats'`
- [ ] 必要に応じて `supabase db lint`（ローカル環境）でマイグレーション検証
- [ ] Postman/Thunder Client などでコメントAPIのメンション更新パターンを手動確認

## 🔄 ロールアウト手順
1. 本番 DB バックアップ取得
2. マイグレーション適用（`supabase db push` または Vercel 上の CI で適用）
3. API/FE デプロイ
4. 監視: Supabase error ログ、`comments` レコードにおける `mentions` の UUID 整合率

## 📎 依存関係
- 前提: Phase3 で追加したコメントAPI/テーブルがデプロイ済み
- 後続: 0202（UI統合）、0203（メンションUI）、0204（通知生成）

## ❓ オープン課題
- トリガーでの同期コスト（大量コメント時のパフォーマンス）
- コメント編集ロック（15分制限など）の仕様再確認
