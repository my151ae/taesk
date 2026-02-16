# Phase 3: API層の実装リファクタ

## 目標
- API 実装を共通化し、重複・型崩れ・エラーハンドリングのばらつきを削減する。

## タスク分解
1. ルートハンドラ共通化
- [x] `withErrorHandling` を導入
- [x] 認証済みユーザー取得の共通ヘルパーを導入
- [x] レスポンスエラーコードを共通 enum に寄せる

2. バリデーション統一
- [x] Zod スキーマを `lib/api-types` か `lib/validators` へ集約
- [x] `request.json()` 後の `any` を段階廃止
- [x] 422 エラーの payload 形式を統一

3. rate-limit 基盤の置換
- [x] `lib/server/rate-limit.ts` の in-memory 実装を段階撤去
- [x] 共有ストア（KV など）前提の実装へ移行
- [x] API ごとの key 設計（user/ip/board）を決定

4. service-role クライアント単一点化
- [x] 生成関数を `lib/server/supabaseAdmin.ts` に一本化
- [x] `lib/server/notifications.ts` など重複実装を削除
- [x] 呼び出し元に用途コメント（理由）を追加

## 完了条件
- [x] 主要 API が共通ハンドラで実装されている
- [x] バリデーションとエラー形式が統一されている
- [x] rate-limit が分散環境で機能する

## 適用済み実装（2026-02-16）
- 共通認証/権限ヘルパーを `lib/server/api-security.ts` に追加。
- レート制限を `KV 優先 + in-memory fallback` に更新。
- `boards`, `cards`, `members` の更新系 API を共通ガードへ移行。
- service-role クライアント生成を `lib/server/supabaseAdmin.ts` へ集約。
