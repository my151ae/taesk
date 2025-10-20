# 0202 CardModal コメントUI統合

**作成日**: 2025-10-20
**関連エピック**: `docs/tickets/2025-10-20/0200-comments-notifications-epic.md`
**担当候補**: FE（React/Next.js）

---

## 🎯 ゴール
- `CardModal` 内でコメントスレッド（`CommentsPanel`）をシームレスに表示し、カード編集体験と統合する
- コメント操作（投稿/返信/編集/削除）が既存のボード状態管理・オフラインキュー・Realtime と整合する
- UI/UX を Phase3 のデザインガイドに沿って改善（空状態・読み込み・エラーハンドリング等）

## 📝 背景
- 現在 `CommentsPanel` は独立コンポーネントであり、カード詳細モーダルに組み込まれていない
- 楽観更新はあるが、ボード全体の state（`KanbanBoardClient` の Zustand ストア）とは疎結合で、Realtime 購読も未実装
- コメント機能をボードの主要フローに載せることで、通知・メンションとセットでユーザー価値が高まる

## ✅ スコープ
- `app/components/CardModal.tsx`（または `app/(board)/@modal/...` の page）にコメントタブ（またはセクション）を追加
- `CommentsPanel` をカードデータにバインドし直し、`KanbanBoardClient` の state/selectors を利用
- コメントローディング・エラー・リトライ UI の整備、スレッド表示のデザイン調整
- Realtime コメント購読の初期実装（`supabase.channel('comments:board_id=...')`）を `KanbanBoardClient` から呼び出し、`CommentsPanel` に流す
- オフライン時の表示（読取専用 or キューイングメッセージ）の制御

## 🚫 非スコープ
- メンションタイプアヘッドの改善（0203）
- 通知/バッジ関連の UI（0205）
- コメントに添付ファイルを追加するなどの拡張

## 📦 実装タスク
1. **CardModal レイアウト調整**
   - 詳細タブ構成を見直し（例: `Details / Activity / Comments`）
   - コメントセクションのスクロール管理（モーダル高さを超えてもスクロールしやすくする）
2. **State 管理の再編**
   - `KanbanBoardClient` の Zustand store に `commentsByCard` キャッシュと更新アクションを追加
   - `CommentsPanel` は props から `cardId` を受け取りつつ、store からコメント一覧を購読
   - オフラインキュー投入（0201 で定義した payload）を Action に移譲
3. **API 呼び出し共通化**
   - `lib/api/comments.ts`（新規）に `fetchComments`, `createComment`, `updateComment`, `deleteComment` を集約
   - fetch エラーのトースト通知やリトライ UI を導入
4. **Realtime 購読**
   - `KanbanBoardClient` 起動時にコメントチャンネルを購読し、INSERT/UPDATE/DELETE を store に反映
   - オフライン→オンライン復帰時は `loadComments` をリフレッシュ
5. **UI 改善**
   - プレースホルダー文言・空状態・ローディングスケルトン
   - 編集フォーム/返信フォームのアクセシビリティ（ラベル・ボタン説明）
   - スクロール位置の自動調整（新着コメントへジャンプ）

## ✅ 受け入れ基準
- [ ] CardModal を開くとコメントタブ/セクションが表示され、既存コメントが読み込まれる
- [ ] コメント作成・返信・編集・削除が UI から行え、結果が即座に反映される（楽観更新→サーバー確定）
- [ ] 別ブラウザからコメントが追加された場合、Realtime 経由で5秒以内に反映される
- [ ] オフライン時は送信ボタンがキュー処理に切り替わり、復帰後に自動送信される
- [ ] 権限がないユーザーではコメントUIが非表示 or 読取専用になる

## 🧪 テスト
- [ ] `npm run lint`
- [ ] `npx playwright test e2e/phase3-comments.spec.ts --reporter=json > playwright-report-comments.json`
  - [ ] `cat playwright-report-comments.json | jq '.stats'`
- [ ] Storybook/Chromatic があればスクリーンショット更新（任意）
- [ ] Realtime テスト: 2つのブラウザセッションで手動確認（必要なら録画）

## 📎 依存関係
- 前提: 0201 の DB/API 更新が完了し、コメントAPIが安定していること
- 後続: 0203 のメンションUX改善、0204 の通知生成

## ❓ オープン課題
- コメント履歴の無限スクロール対応が必要か（現状 50件制限）
- CardModal の SSR/Streaming との相性確認

