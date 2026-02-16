# Phase 3: API層の実装リファクタ

## 目標
- API 実装を共通化し、重複・型崩れ・エラーハンドリングのばらつきを削減する。

## タスク分解
1. ルートハンドラ共通化
- [ ] `withErrorHandling` を導入
- [ ] 認証済みユーザー取得の共通ヘルパーを導入
- [ ] レスポンスエラーコードを共通 enum に寄せる

2. バリデーション統一
- [ ] Zod スキーマを `lib/api-types` か `lib/validators` へ集約
- [ ] `request.json()` 後の `any` を段階廃止
- [ ] 422 エラーの payload 形式を統一

3. rate-limit 基盤の置換
- [ ] `lib/server/rate-limit.ts` の in-memory 実装を段階撤去
- [ ] 共有ストア（KV など）前提の実装へ移行
- [ ] API ごとの key 設計（user/ip/board）を決定

4. service-role クライアント単一点化
- [ ] 生成関数を `lib/server/supabaseAdmin.ts` に一本化
- [ ] `lib/server/notifications.ts` など重複実装を削除
- [ ] 呼び出し元に用途コメント（理由）を追加

## 完了条件
- [ ] 主要 API が共通ハンドラで実装されている
- [ ] バリデーションとエラー形式が統一されている
- [ ] rate-limit が分散環境で機能する
