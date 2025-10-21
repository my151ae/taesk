# 02: 2025-10-20 チケット進捗サマリ

**作成日**: 2025-10-21  
**対象**: `docs/tickets/2025-10-20/*`

## ✅ 完了済み
- `docs/tickets/2025-10-20/01-unify-error-format-tests.md`: API とテストの旧エラーフォーマット依存を除去。Option A 採用で互換フラグ不要、CI 緑を確認済み。
- `docs/tickets/2025-10-20/0201-1-comments-db-and-api.md`: コメント DB/Routes の更新を完了。GIN インデックス追加・Idempotency Key 対応・新エラーフォーマット統一でオフライン/Realtime の土台が整備された。

## 🚧 進行中・部分実装
- `docs/tickets/2025-10-21/0202-comments-ui-cardmodal-integration.md`: CardModal にはコメントタブが追加され（`app/components/CardModal.tsx:75-204`）、CommentsPanel のリアルタイム購読も導入済み（`app/(board)/_components/CommentsPanel.tsx:35-112`）。一方で Zustand への統合・オフラインキュー連携は未着手で、API ラッパーも使わず `fetch` を直呼びしている（`app/(board)/_components/CommentsPanel.tsx:124-220`）。`lib/api/comments.ts` は作成済みだが未利用（`lib/api/comments.ts:1-118`）。
- `docs/tickets/2025-10-21/0203-mentions-typeahead-and-parser.md`: Mention コンポーネントとハイライト表示は導入済み（`app/(board)/_components/Mention.tsx:1-126`）、CommentsPanel にタイプアヘッドが追加されている（`app/(board)/_components/CommentsPanel.tsx:226-439`）。しかし本文は依然プレーンテキスト保存で `<@uuid>` トークン化や安全な差し込みは未実装（投稿時も `body` をそのまま送信、`app/(board)/_components/CommentsPanel.tsx:185-199`）。オフライン用メンバーキャッシュも未対応。
- `docs/tickets/2025-10-21/0204-notification-generation-rules.md`: 通知サービスを追加し、コメント作成時に生成処理を呼び出している（`lib/server/notifications.ts:1-196`, `app/api/cards/[cardId]/comments/route.ts:206-252`）。ただし受信者解決は assignee/既存コメント投稿者のみに限定されカード作成者が漏れており（`lib/server/notifications.ts:72-111`）、`INSERT ... ON CONFLICT DO UPDATE` 相当の挙動や単体テストは未整備。
- `docs/tickets/2025-10-21/0205-inapp-notifications-ui.md`: Realtime 購読で新着の反映は行っている（`app/(board)/_components/NotificationsBell.tsx:18-67`）が、タブ/ドロワー UI・Zustand ストア・ローカルキャッシュ・一括既読などのスコープ項目は未着手で、従来のドロップダウン UI のまま（`app/(board)/_components/NotificationsBell.tsx:69-107`）。

## ⏳ 未着手・仕様段階
- `docs/tickets/2025-10-20/02_コメント機能＆通知システム_実装の流れ（phase_3_2_3.md`: エピック全体の流れをまとめた資料。現状は設計リファレンスのみ。
- `docs/tickets/2025-10-20/0201-comments-db-and-api.md`: 元の仕様書。実作業は 0201-1 に反映済みで追加タスクなし。
- `docs/tickets/2025-10-21/0206-push-subscription-and-sw.md`: Push 購読と Service Worker 実装の仕様。0207 と連動するバックエンド/フロント両面のタスク。
- `docs/tickets/2025-10-21/0207-edge-function-send-webpush.md`: Edge Function での Web Push 送信パイプライン設計。0206 の購読実装が前提。
- `docs/tickets/2025-10-21/0208-permission-and-settings-ux.md`: 通知許可と設定 UI の仕様。0204〜0207 の基盤構築後に着手する位置付け。
- `docs/tickets/2025-10-21/0209-e2e-and-docs.md`: コメント/通知/Push 周りの E2E とドキュメント更新タスク。実装完了後に CI 安定化と文書化を担当。

## 🚀 次の一手候補
1. 0202 を仕切り直し、Zustand 連携・オフラインキュー統合・API ラッパー利用を完了させてコメントUIをボード状態管理に載せる。
2. 0203 の mention パイプラインを完成させる（UUID トークン化、サニタイズ表示、オフラインキャッシュ）。
3. 0204/0205 を順に仕上げ、通知生成と UI を仕様通りに揃えてから 0206 以降へ進む。
