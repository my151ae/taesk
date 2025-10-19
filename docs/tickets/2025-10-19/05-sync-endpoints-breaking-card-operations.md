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
1. `app/api/boards/[boardId]/cards/reorder/route.ts`
   - `zod` スキーマが `title` を必須としているが、クライアントの `upsertCardsWithAssigneeFallback` では `title` を含めないケースがあり 422 が発生。
   - API 側も upsert 時に `title` を落とす構造になっており、既存レコードとの差分マージをしていない。

2. `app/api/boards/[boardId]/lists/reorder/route.ts`
   - 同じく `title` を送らずに position のみ更新しているため、Supabase upsert 時に `title` が null で 500。

3. 旧実装ではクライアントが Supabase REST を直接叩いており、今回の API routes 移行で必須フィールドの扱いが変わったが、クライアント側の payload 更新が不完全のままになっている。

## 対応方針
1. **API スキーマ＆アップサート修正**
   - `cards/reorder` / `lists/reorder` の `zod` スキーマを `partial()` にするか、API 側で既存レコードを読み込んで欠損フィールドを補完した上で upsert する。
   - もしくはクライアントから `title` / `description` など必要フィールドを常に送るように仕様を揃える。どちらを採るか決めて実装。

2. **クライアント側 payload の見直し**
   - `upsertCardsWithAssigneeFallback` と `syncToSupabase` の `listUpdates` で必須フィールドを明示的に送る。
   - D&D などで position を並び替える際も `title` を保持するようにする。

3. **再発防止**
   - カード/リスト保存用のユニットテスト or Playwright の assertions を追加し、200 を返すことと DB 反映を検証。
   - API routes の仕様差分を `docs/detail` に追記。

## ブロッカー
- なし（API とフロントの両方を調整すれば解消可能）。ただし修正範囲が広いため影響調査が必要。

## 次のアクション
1. スキーマ/アップサート修正案を決定し、実装着手。
2. カード・リスト更新系のフロント payload を統一。
3. Playwright を JSON レポート付きで再実行し、パスを確認。

