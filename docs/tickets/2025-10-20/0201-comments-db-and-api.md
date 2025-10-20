# 0201 コメントDB/API拡張

**作成日**: 2025-10-20
**関連エピック**: `docs/tickets/2025-10-20/0200-comments-notifications-epic.md`
**担当候補**: BE（Supabase） + FE（API呼び出し）

---

## 🎯 ゴール
- `comment_mentions` テーブルと関連インデックス/RLSを追加し、コメントのメンション情報を正規化する
- 既存 API Routes（`/api/cards/[cardId]/comments`・`/api/comments/[commentId]`）が新テーブルと同期しつつ `mentions` 配列を返却できるようにする
- コメント作成/編集/削除の処理をオフラインキュー（`KanbanBoardClient`）と整合が取れるよう整理し、Realtime 配信準備を整える

## 📝 背景
- Phase3 で `comments` テーブルと CRUD API は存在するが、メンション情報は TEXT 配列で保持しており検索・通知生成に不向き
- 今後の通知生成（0204）やメンションUX改善（0203）で高速に参照できる構造が必要
- コメントイベントはオフラインキュー→API Routes 経由で保存する設計であり、DB変更後も破綻しないよう事前に仕様を明文化する必要がある

## ✅ スコープ
- Supabase Migration の追加（`comment_mentions` テーブル、FK、複合インデックス、`updated_at` トリガー）
- `comments` テーブルに `board_id`/`deleted_at` の整合を確認し、必要ならマイグレーションで追加（既存データ整合チェック含む）
- `comment_mentions` と `comments.mentions` を同期させる DB トリガー（INSERT/UPDATE/DELETE）
- `lib/supabase.ts` 型定義更新（`Comment` / `CommentWithAuthor`）
- `/api/cards/[cardId]/comments`・`/api/comments/[commentId]` の入出力調整とバリデーション強化
- Board権限チェックを API 内に追加（`board_members` 照会）し、RLS と二重にガード

## 🚫 非スコープ
- UI レイヤーでのコメント表示/操作（0202 以降で対応）
- メンションタイプアヘッドや mention UI（0203）
- 通知生成処理（0204）

## 📦 実装タスク
1. **マイグレーション追加**
   - `comment_mentions(id uuid default gen_random_uuid(), comment_id uuid references comments(id) on delete cascade, mentioned_user_id uuid references profiles(id) on delete cascade, created_at timestamptz default now())`
   - `create unique index idx_comment_mentions_unique on comment_mentions(comment_id, mentioned_user_id)`
   - `create index idx_comment_mentions_user on comment_mentions(mentioned_user_id)`
   - `comments` テーブルに `board_id` が存在しない場合は追加＋`cards.board_id` から埋める処理をマイグレーションに含める
   - `deleted_at` 列の有無を確認し、論理削除のための `deleted_at timestamptz` を追加（既存 API が `is('deleted_at', null)` を利用できるよう統一）
2. **同期トリガー作成**
   - `comment_mentions` への INSERT/DELETE で `comments.mentions` を再計算するトリガー
   - `comments` の INSERT/UPDATE で `mentions` 配列 → `comment_mentions` を再生成するトリガー（冪等性確保）
   - メンションIDが存在しないユーザーの場合はスキップし、整合性エラーをログに送る
3. **RLS/ポリシー調整**
   - `comment_mentions` に対して `board_members` を基準とした SELECT/INSERT 権限を付与
   - `comments` RLS を `board_id` 単位で見直し（commenter ロール以上が CRUD 可能）
4. **API Routes 更新**
   - POST/PATCH 時に `mentions` の入力を UUID 配列として受け取り、トリガー同期を前提に insert/update
   - 取得時は `comment_mentions` をJOIN するのではなく、`mentions` 配列をそのまま返却（トリガーで同期済み）
   - `board_id` の整合性・権限チェック（`cards.board_id` → `board_members`）
   - 失敗時は構造化エラー（`{ code, message }`）で返す
5. **型定義とユーティリティ整備**
   - `lib/supabase.ts` の `Comment` 型に `board_id`・`deleted_at` を追加
   - コメントAPIレスポンス用の zod スキーマ追加（`lib/validators/comments.ts` を新設するか、既存 helpers に追記）
6. **オフラインキューとの整合**
   - `KanbanBoardClient` のコメント関連オペレーション（存在する場合）を確認し、`mentions` 入力を UUID 配列に揃える
   - オフライン再送時に `board_id` を含めて送信するようにキューのペイロードを定義

## 🔐 セキュリティ / RLS
- `comment_mentions` へのアクセスは `board_members.role IN ('owner','editor','commenter')` のみ許可
- API レイヤーでも `board_members` を確認し、RLS エラーを 403 として扱う
- Supabase ログにメンション不整合（存在しないユーザー等）を記録し、将来の監査ログと連携

## ✅ 受け入れ基準
- [ ] コメント作成時に `comment_mentions` にメンション分のレコードが生成され、削除時には削除される
- [ ] `/api/cards/[cardId]/comments` のレスポンスが `mentions: string[]` を従来通り返しつつ、DB は正規化済み
- [ ] コメント編集でメンションを変更した際、`comment_mentions` と `comments.mentions` が同期される
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
4. 監視: Supabase error ログ、`comment_mentions` の件数

## 📎 依存関係
- 前提: Phase3 で追加したコメントAPI/テーブルがデプロイ済み
- 後続: 0202（UI統合）、0203（メンションUI）、0204（通知生成）

## ❓ オープン課題
- トリガーでの同期コスト（大量コメント時のパフォーマンス）
- コメント編集ロック（15分制限など）の仕様再確認

