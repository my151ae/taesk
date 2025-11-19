# 01 - Timeline Header Integration

## 目的
Timeline 画面のヘッダーに既存のボード操作 UI（ボード切り替え、共有、プロフィール、通知など）を復活させ、旧 Kanban からシームレスに移行できるようにする。

## 作業項目
- [ ] Kanban のヘッダー構造を洗い出し、必要なコンポーネント (`ShareDialog`, `NotificationsBell`, `ProfileSettings`, etc.) を Timeline に移植。
- [ ] 可能であれば `BoardHeader` コンポーネント化し、Kanban/Timeline 両方で再利用。
- [ ] ボード切り替え導線（board picker）を Timeline 上に設置。
- [ ] Timeline 固有の文言・時刻表示（GMT+09）との整合性を確認。

## 完了条件
- Timeline 画面で旧ヘッダーと同等の操作 (Share, Notification, Profile, Board Switch) が利用可能。
- UI/UX が旧 Kanban と破綻なく共存。
