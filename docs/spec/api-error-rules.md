# API Error Code / HTTP Status ルール

## 基本方針
- 失敗レスポンスは `{ error: { code, message, details? } }` を基本形式とする。
- 例外の最終ハンドリングは `withErrorHandling` で `INTERNAL_ERROR (500)` に正規化する。
- 業務上の失敗（認証・権限・入力不正・存在しない）は、例外ではなく明示レスポンスで返す。

## コードとステータスの対応
- `UNAUTHENTICATED` → `401`
- `FORBIDDEN` → `403`
- `INVALID_ORIGIN` → `403`
- `NOT_FOUND` → `404`
- `INVALID_BODY` / `VALIDATION_ERROR` → `400` or `422`
- `CONFLICT` / 重複制約 (`23505`) → `409`
- `DB_ERROR` → `500`
- `INTERNAL_ERROR` → `500`

## 運用ルール
- バリデーションは `zod` 失敗時に `INVALID_BODY (422)` を返す。
- DB 例外のうち列不足 (`42703`) は、可能ならフォールバック実行後に `DB_ERROR` へ正規化する。
- ルート実装では `try/catch` を最小化し、予期しない例外は `withErrorHandling` に集約する。
