# リファクタリング・チェックリスト（2026-01-22）

## 事前確認
- [x] docs/260122 の計画・タスクと現行実装の差分を整理する
- [x] タイムラインの時刻表示（out-top）と本文プレビューの挙動を再確認する

## コード整理
- [x] `TimelineCard` の未使用 props（`duration`, `alignTop`）を削除し、呼び出し側を更新
- [x] `TimelineEventItem` の未使用ロジック（`isNarrow`/`isSmall` 等）を削除
- [x] 生成時のAIコメントやプレースホルダコメントを除去
- [x] 未使用コンポーネント（`TimelineGrid`, `TimelineBuckets`）を削除

## ドキュメント更新
- [x] docs/260122 のタスク/計画を現行実装に合わせて更新
- [x] docs/detail/components.md の構成図・説明を DaySection/TimelineColumn へ置換
- [x] docs/detail/architecture.md の UI 構成/フック説明を現状に合わせて整理

## 仕上げ
- [x] 変更箇所の整合チェック（型/ビルドを必要に応じて確認）
