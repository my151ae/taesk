# Taesk Roadmap Summary

詳細なロードマップは `docs/tickets/roadmap.md` で日次更新されています。本ファイルでは最新バージョンのハイライトのみを要約します（最終更新: 2025-10-15）。

## 現在のステータス

- **バージョン**: v0.1.0
- **テスト**: Playwright 34 シナリオ（全件パス）
- **主要機能**: マルチボード、カードモーダル（Intercepting Routes）、タグ/期限/優先度、オフライン同期、Supabase Realtime

## 直近の完了項目（v0.3 系）

- カード個別 URL とモーダル表示の共存（Intercepting Routes 実装）
- `updateURL` の単一ナビゲーション化（段階的リダイレクトを解消）
- オフライン同期キュー + Realtime の安定化（board 切り替え時の再購読を整理）
- Playwright テストの整理（JSON レポート運用、34 ケースへ拡充）

## 次のフォーカス領域

1. Phase 3 – Collaboration: ボード共有権限、コメント機能、通知
2. Phase 4 – Advanced: カスタムフィールド、オートメーション、テンプレート
3. Phase 5 – Performance: 仮想スクロール、添付ファイル、アーカイブ機構

詳細・履歴・優先度は [`docs/tickets/roadmap.md`](./tickets/roadmap.md) を参照してください。
