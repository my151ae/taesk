# 04 - Realtime & SyncQueue

## 目的
Kanban で採用しているリアルタイム購読 (`subscribeToBoard`) とオフライン同期 (`syncQueue`) の仕組みを Timeline UI に統合し、複数ユーザー/オフライン環境でも正しく更新が反映されるようにする。

## 作業項目
- [ ] `useRealtimeBoard` 相当のロジックを抽出し、Timeline データ取得に組み込む。
- [ ] Timeline の DnD で発生する更新を `syncQueue` 経由でキューイングし、API 反映・ロールバック処理を実装。
- [ ] リアルタイムイベントを受け取った際に Timeline イベント/A/B リストへ適用。
- [ ] メトリクス (`timeline-minute-resolution-errors` など) と連携してハードニング。

## 完了条件
- 別タブや他ユーザーの操作がリアルタイムで Timeline に反映される。
- オフラインでドラッグ＆ドロップ → 復帰時に正しく同期される。
