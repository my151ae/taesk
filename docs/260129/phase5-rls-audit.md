# Phase 5: RLS 監査メモ（2026-01-29）

## 背景
`e2e/rls.spec.ts` は実行可能な E2E というより「期待する RLS 状態のドキュメント」だったため、
テストからは外し **ドキュメント化** する方針に変更。

## 想定される RLS 期待値（現行の共有ボード設計前提）
- 共有ボード設計のため、RLS は「全ユーザー共有」を許容する設計になる可能性が高い。
- もし「個人分離」ではなく「共同作業」が正史なら、従来の RLS 期待値は再定義が必要。

## 検証したい観点（実 DB での確認用）
1. `lists` / `cards` に `user_id` が必須なのか
2. `board_members` を介したアクセス制御が正しいか
3. 共有ボードの方針に対して RLS が過剰に厳しすぎないか

## 確認用 SQL（例）
```sql
SELECT schemaname, tablename, policyname, permissive, cmd, qual
FROM pg_policies
WHERE tablename IN ('lists', 'cards', 'board_members')
ORDER BY tablename, policyname;
```

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'lists' AND column_name = 'user_id';
```

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'cards' AND column_name = 'user_id';
```

## 次のアクション
- 共有ボード仕様が最終決定したら RLS の期待値を定義し直す。
- その上で必要なら **DB 検証スクリプト（SQL）** を自動化へ。
