# A/B 浮遊リスト & CardModal 連携

**Status**: 🔴 Not Started  
**Priority**: 🔵 Medium  
**Created**: 2025-11-13 14:42 JST  
**Assignee**: Frontend/Fullstack  
**Estimated**: 2d

## 概要
Today/Tomorrow の A/B リストカードを実装し、チェックリスト・完了ステータス・CardModal との双方向同期を実現する。コメント/通知との互換性も担保する。

## 目的
- 時間を確定していないタスクを A/B に積んで整理し、必要に応じてタイムラインへ昇格できる UX を成立させる。
- CardModal を唯一の編集ポイントとして維持し、データ整合を守る。

## 実装内容
- [ ] `ABListCard` コンポーネントで A/B セクション + チェックボックス UI を実装。
- [ ] `schedule_bucket` ごとの並び順を `position` で制御し、ドラッグで A/B 内並べ替えができるようにする。
- [ ] CardModal から `schedule_channel`, `schedule_bucket`, `scheduled_*` を編集できるフォームを追加。
- [ ] コメント/通知機能（`app/components/CardModal.tsx` 周辺）で新フィールドを扱い、メンション通知に schedule 情報を含める。
- [ ] `CardModal` のオープン手段（URL クエリ/クリック）を timeline ページ用に拡張。

## 技術的詳細
- A/B チェックリストのチェックボックスは `Card.checked` 既存フィールドを流用せず、新たに `ab_items`（client-only）→ CardModal で `checklist` と統一する案を要検討。
- Notification トーストに「Moved to Today A」等の copy を追加。
- `e2e/comments.spec.ts` で CardModal を多用しているため、既存テストに影響が出ないよう feature flag でガード。

## 受け入れ基準
- [ ] A/B リストのチェック操作が Supabase に保存され、ページ再読み込み後も維持される。
- [ ] CardModal で A/B セクションを編集すると UI に即時反映される。
- [ ] Playwright で A/B → Timeline 変換、CardModal 更新、通知表示のテストが追加される。

## 関連チケット
- [04-timeline-drag-drop.md](./04-timeline-drag-drop.md)
- [06-metrics-and-tests.md](./06-metrics-and-tests.md)
- [00- TaeskMap マスタープラン](../taeskmap/00-today-list-layout.md)
