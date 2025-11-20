# 00 - Timeline Default Board Rollout

## 背景
- Kanban UI から Timeline UI への置き換えを進行中。
- 現在 `/board` `/b/[short_id]` は timeline を表示するが、ヘッダー/共有/フィルターなど旧 UI の機能が未統合。
- 既存のメンバー機能やコメント導線、リアルタイム同期を復活させつつ、新レイアウトをデフォルト体験にする。

## ゴール
1. Timeline 画面で旧ボードの操作系 (ボード切り替え、メンバー、通知、コメントパネルなど) を利用可能にする。
2. 既存のフィルター、検索、リアルタイム同期、オフラインキューを timeline 用に移植。
3. Playwright などのテストとメトリクス手順を更新し、新レイアウトがデフォルトであることをドキュメントに反映。

## 実行順序
0. **事前リファクタリング (推奨)**
   - `KanbanBoardClient.tsx` に含まれる以下のロジックを `lib/hooks` または `app/(board)/_hooks` に抽出・共通化する。
     - リアルタイム同期 (`useRealtimeBoard`)
     - オフラインキュー処理 (`useSyncQueue`)
     - フィルター・検索ロジック (`useBoardFilters`)
     - ボードメンバー管理 (`useBoardMembers`)

1. **ヘッダー/シェル統合**
   - Timeline ヘッダーに `ShareDialog`, `NotificationSettings`, `NotificationsBell`, `ProfileSettings` 等を配置。
   - 可能であればヘッダー部分を `BoardHeader` コンポーネントとして切り出し、Kanban/Timeline で共有可能にする。
   - ボード切り替え (board picker) の導線を追加。

2. **メンバー/コメント導線 + モーダル復活**
   - `CommentsPanel` の開閉トリガーを timeline へ移植。
   - カードモーダル (`CardModal`) を Kanban 同様に URL 連携で開閉できるよう復活させる。
     - Parallel Routes (`app/(board)/@modal/(...)c/...`) を確認し、タイムラインからも `?card=SHORTID` / `/c/SHORTID` でモーダルを描画できるようにする。

3. **フィルター & 検索**
   - 共通化した `useBoardFilters` を Timeline に適用。
   - タグ/テキスト検索を timeline events + A/B リストにも適用。

4. **リアルタイム & オフライン同期**
   - 共通化した `useRealtimeBoard` と `useSyncQueue` を Timeline に統合。
   - DnD 結果やモーダル保存で optimistic update → API → rollback を再利用。

5. **テスト/メトリクス更新**
   - `e2e/timeline.spec.ts` を拡張し、以下のテストケースを追加:
     - ヘッダー機能（共有、通知、プロフィール）
     - フィルター・検索機能
     - リアルタイム同期（複数タブでの動作確認）
   - `test-summary`、Playwright specs、`docs/detail/testing.md` を timeline 前提に更新。

6. **ドキュメント・リリースノート**
   - `docs/index.md` / `docs/detail/components.md` の「主要 UI」を timeline に差し替え。
   - 変更点を `docs/tickets/2025-11-19/xx-*.md` シリーズに追記し、PR で共有。

## ToDo リスト
- [x] 共通ロジックの抽出 (Hooks化)
- [ ] ヘッダーコンポーネントの統合・共通化
- [ ] コメント/メンバー導線の復活 + CardModal 復活
- [ ] フィルター/検索の適用
- [x] リアルタイム同期 & オフライン同期の適用
- [ ] Playwright テストの拡充 (`e2e/timeline.spec.ts`)
- [ ] ドキュメント更新
- [ ] 最終 E2E 実行 & サマリー反映
