# タイムライン DnD / インタラクション実装

**Status**: 🔴 Not Started  
**Priority**: 🔥 High  
**Created**: 2025-11-13 14:39 JST  
**Assignee**: Frontend  
**Estimated**: 3d

## 概要
時間軸上でカードをドラッグ移動/リサイズし、A/B リスト間の移動もサポートする。既存の DnD Kit 実装を流用しつつ、1 分単位の座標変換とスナップ処理を追加する。Timeline/A-B の排他所属を保ちながら最小限の操作感を提供する。

## 目的
- 今日/明日の予定を素早く組み替えられる操作感を提供する。
- 変更を即座に Supabase へ反映し、Realtime で他ユーザーへ配信する。

## 実装内容
- [ ] `TimelineDragLayer` コンポーネントを追加し、`@dnd-kit` の `MouseSensor`/`TouchSensor` を時間軸向けに調整。
- [ ] ドラッグ開始時にカードを `timeline` / `ab-list` へ変換するロジックを追加。A/B からタイムラインへ移動する場合は `due_date`/`due_start`/`due_end` を自動初期化。
- [ ] ドロップ/リサイズは **15 分刻み** でスナップし、Shift を押しながらで 5 分刻み。カードの見た目は 15 分グリッドに従い、1 分精度は詳細編集で適用される。
- [ ] リサイズ（上下のグリップ）を実装し、`due_end` を更新。
- [ ] 変更内容を `syncQueue` に積んで Supabase API へ送信。Optimistic UI を維持。
- [ ] 同時所属禁止を守るため、タイムラインへドロップした時点で `due_channel` を `timeline` に更新し、A/B の `due_bucket` をリセット。
- [ ] CardModal など詳細エディタで 1 分単位を入力した場合、イベント高さを再計算する `recalculateHeightFromDuration` ヘルパーを用意し、DnD後も一貫させる。

## 技術的詳細
- `DndContext` は既存 Kanban と競合しないよう、新 UI では独立したコンテキストを持つ。
- スクロール中のドラッグは `autoScroll` をカスタム実装。モバイルでは長押し 300ms で開始。
- アクセシビリティ対応として `KeyboardSensor` を `sortableKeyboardCoordinates` ではなく独自マッピングで 5 分移動を実現（より細かい 1 分調整は CardModal）。

## 受け入れ基準
- [ ] タイムライン上でカードをドラッグして時間/日付を変更できる。
- [ ] A/B リスト ↔ Timeline の往復が成功し、CardModal でも変更を確認できる。
- [ ] Realtime 接続中の別ブラウザで同じ操作が同期される。
- [ ] Playwright シナリオ（comments/spec とは別）で最小限の DnD E2E が追加される。

## 関連チケット
- [03-timeline-ui-shell.md](./03-timeline-ui-shell.md)
- [05-floating-list-card-modal.md](./05-floating-list-card-modal.md)
- [00- TaeskMap マスタープラン](./00-today-list-layout.md)
