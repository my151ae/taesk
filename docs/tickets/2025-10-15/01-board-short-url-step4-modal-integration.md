# Board Short URL - Step4 モーダル統合

**Status**: 🔴 Not Started
**Priority**: 🔥 High
**Created**: 2025-10-15 0135
**Assignee**: Claude
**Estimated**: 4 hours

## 概要

/c ショートURL経由でカードモーダルを表示・正規化できるようにし、Step1-3 から残っている `/c` 系のDoDを完了させる。

## 目的

ショートURLからカード詳細に直接アクセスした際も、ボード体験を維持しつつモーダル表示とURL正規化が機能するようにして、ユーザーがブックマークや共有リンクからスムーズに利用できるようにする。

## 実装内容

- [ ] `/c/:short_id/[[...slug]]` の intercepting route とレイアウト（parallel routes）を実装
- [ ] `/c/:short_id` 直アクセス時にボードを背景読み込みしカードモーダルを開くフローを構築
- [ ] slug/id_short の正規化ロジックを共有化し、誤ったslugでも置換されるようにする
- [ ] KanbanBoardClient の URL 復元処理を `/c` ルートでも動作するよう拡張
- [ ] E2E（kanban.spec.ts）で `/c` 系シナリオが通過するよう調整

## 技術的詳細

- Next.js の intercepting routes（`app/(board)/b/[short_id]/[[...slug]]` と調和する `/c` ルート）を活用
- 既存の `buildCardUrl` / `buildBoardUrl` ヘルパーを流用し、URL整合性を統一
- `CardModal` 表示時の状態管理を `/c` ルート経由でも破綻しないようにリファクタリング
- Playwright テストで `/c` 専用の待機条件・URL検証を更新

## 受け入れ基準

- [ ] `/c/:short_id` アクセスでカードモーダルが表示され、URLが維持される
- [ ] `/c/:short_id/wrong-slug` アクセスで canonical slug に置換される
- [ ] モーダルを閉じた後にボードURLへ戻り、再度リロードしてもエラーが出ない
- [ ] Playwright E2E が 33/33 Pass になる

## 関連チケット

- [2025-10-14/01-board-short-url-step1-3-fixes](../2025-10-14/01-board-short-url-step1-3-fixes.md)

## ノート

- Step1-3 修正で `/c` 系が未着手なため作成
- 既存ボードロード処理との競合に注意
