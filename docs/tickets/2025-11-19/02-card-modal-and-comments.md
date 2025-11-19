# 02 - Card Modal & Comments Revival

## 目的
Timeline 画面からカードモーダル (`CardModal`) とコメント導線を復活させ、Kanban と同じ URL 連携 (`?card=SHORTID` / `/c/SHORTID`) で開閉できるようにする。

## 作業項目
- [ ] `KanbanBoardClient` のモーダル制御ロジック（`selectedCardId`, `cardModalStatus`, `useSearchParams` など）を抽出/共通化し、Timeline でも利用する。
- [ ] `app/(board)/@modal/(...)c/[short_id]/[[...slug]]` を確認し、Timeline ルートでも Parallel Routes によりモーダルを描画。
- [ ] `CommentsPanel` のトリガーやメンバー情報を Timeline に移植。
- [ ] Timeline のカード UI にモーダル起動ボタンを設置し、URL 連携が機能するか E2E で確認。

## 完了条件
- Timeline からカードモーダルを開閉でき、コメント機能も Kanban と同様に利用可能。
- `?card=SHORTID` 付き URL で Timeline を開いた場合、該当カードのモーダルが表示される。
