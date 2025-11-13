# A/B 浮遊リスト & CardModal 連携

**Status**: 🔴 Not Started  
**Priority**: 🔵 Medium  
**Created**: 2025-11-13 14:42 JST  
**Assignee**: Frontend/Fullstack  
**Estimated**: 2d

## 概要
Today/Tomorrow の A/B リストカードを実装し、チェックリスト・完了ステータス・CardModal との双方向同期を実現する。Timeline/A-B の排他所属ルールを守りつつ、最小限の編集体験を用意する（通知や繰り返しは範囲外）。

## 目的
- 時間を確定していないタスクを A/B に積んで整理し、必要に応じてタイムラインへ昇格できる UX を成立させる。
- CardModal を唯一の編集ポイントとして維持し、データ整合を守る。

## 実装内容
- [ ] `ABListCard` コンポーネントで A/B セクション + チェックボックス UI を実装。
- [ ] `schedule_bucket` ごとの並び順を `position` で制御し、ドラッグで A/B 内並べ替えができるようにする。
- [ ] CardModal から `schedule_channel`, `schedule_bucket`, `scheduled_*` を編集できるフォームを追加。
- [ ] コメント機能（`app/components/CardModal.tsx` 周辺）で新フィールドを参照できるようにしておく（通知連携は後続タスク）。
- [ ] `CardModal` のオープン手段（URL クエリ/クリック）を timeline ページ用に拡張。

## 技術的詳細
- A/B チェックリストのチェックボックスは `Card.checked` 既存フィールドを流用せず、新たに `ab_items`（client-only）→ CardModal で `checklist` と統一する案を要検討。
- Notification/Realtime 連携は今回対象外。コピー案の検討のみ行い、実装はチケット分割。
- `e2e/comments.spec.ts` で CardModal を多用しているため、既存テストに影響が出ないよう feature flag でガード。
- Timeline/A-B の排他ルールに合わせ、CardModal 保存時は `schedule_channel` を一貫して更新し、二重所属が起きないよう validation を入れる。

## 受け入れ基準
- [ ] A/B リストのチェック操作が Supabase に保存され、ページ再読み込み後も維持される。
- [ ] CardModal で A/B セクションを編集すると UI に即時反映される。
- [ ] Playwright で A/B → Timeline 変換、CardModal 更新のテストが追加される（通知テストは不要）。

## 関連チケット
- [04-timeline-drag-drop.md](./04-timeline-drag-drop.md)
- [06-metrics-and-tests.md](./06-metrics-and-tests.md)
- [00- TaeskMap マスタープラン](./00-today-list-layout.md)
