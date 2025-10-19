# 05 - Reorder API が壊れてカード/リスト保存に失敗している

## 概要
- 発生日: 2025-10-19
- 担当: 未割当
- 優先度: 🔴 High

カード編集やドラッグ＆ドロップ後の同期で、`/api/boards/[boardId]/cards/reorder` が **422 Validation failed**、 `/api/boards/[boardId]/lists/reorder` が **500 Internal Server Error** を返す。ブラウザの操作でも Playwright テストでも再現し、ボードの更新系フローが全滅している。

## 症状 / ログ
- ブラウザのコンソール: `KanbanBoardClient.tsx:1204 PATCH .../cards/reorder 422 (Unprocessable Entity)` → `Error: Validation failed`
- 同時に `lists/reorder` も 500 を返し、`null value in column "title" of relation "lists" violates not-null constraint` が出力。
- Playwright でもカード追加・編集・D&D 関連の全テストが Timeout / 失敗で落ちている。

## 原因分析
1. `cards/reorder` API が position 更新しか必要ないのに、全カラムを upsert しようとしていた。
   - Zod スキーマで `title` を必須にしていたため、クライアント側が position のみ送るケースで 422 が発生。
   - upsert により既存列が `null` 上書きされ、NOT NULL 制約に抵触。

2. `lists/reorder` も同様に upsert で `title` を `null` にしてしまい、500 エラーを誘発。

3. カード編集ハンドラ（`handleSaveCard`）は内容更新も `cards/reorder` に乗せていたため、position 専用 API として整理できていなかった。

4. エラーハンドリング不足で、実際の 500 の原因（未定義変数など）がログに出ず、調査しづらい状態だった。

## 実施した修正
1. **API 側の役割分離**
   - `cards/reorder` と `lists/reorder` を position 更新専用に変更。Zod スキーマを `id/list_id/position` のみに絞り、`update` に切り替え。
   - 失敗時に payload や Supabase からの詳細をログ出力するよう改善。

2. **カード内容更新 API の強化**
   - `/api/boards/[boardId]/cards/[cardId]` で `assigned_to`/`slug` を受け取れるようスキーマ拡張。
   - クライアントの `handleSaveCard` を更新し、タイトル変更などは専用 PATCH を呼ぶように修正。

3. **入力バリデーションとロールバック**
   - reorder API で重複 ID・位置・他ボードの混入を検出し、400 を返すようにした。
   - 更新前の状態を保持し、途中で失敗した場合は可能な範囲で元の並びに戻すフェイルセーフを導入。

4. **再現用スクリプトとログで検証**
   - `.env.test` のテストユーザーで auth し、Cookie を付けた fetch で API を直接叩く Node スクリプトを追加検証に使用。
   - `dev-server.log` に `status 200` とリクエスト結果が出ることを確認し、再現リポートにログを添付。

## 検証結果
- 手動: 上記スクリプトでカードのタイトルを PATCH → Supabase レコードが更新されることを確認。
- Playwright: フルスイートは別チケットで調整継続中だが、少なくともカード編集の API エラーは解消。

## 残課題
- 並び替え API をトランザクション化し、ボード単位で競合が起きないようにする（必要なら advisory lock）。
- `list_id` の所属ボード検証や重複 position チェックなどの入力バリデーションを追加し、全件まとめて 400 を返せるようにする。
- position のギャップ方式（例: 10 刻み）＋定期リナンバリング方針を決め、`UNIQUE(board_id, list_id, position)` を導入しても破綻しないようにする。
- 同一 payload を再送しても結果が変わらないことを保証する（冪等性の確認）。
- Playwright のタイムアウトが残っているケースを追跡し、完全な自動テスト成功を目指す。

## 推奨スモークテスト
1. 同一ボードに対して並行に reorder を投げても順序が破綻しない。
2. クロスリスト移動（`list_id` 変更）を含むケースで期待通りに並び替え結果が反映される。
3. 約 200 件規模の大量更新でもタイムアウトせず整合性が取れる。
4. 重複または未知の ID を含めて送った場合に 400 が返り、DB 側が変更されない。
5. 同一 payload を 2 回送っても結果が同じ（冪等）。
6. 再起動やページ再読込後も並び順とリスト位置が正しく永続化されている。
