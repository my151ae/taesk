# 0203 メンションタイプアヘッド & パーサー

**作成日**: 2025-10-20
**関連エピック**: `docs/tickets/2025-10-20/0200-comments-notifications-epic.md`
**担当候補**: FE + BE（パーサー/バリデーション）

---

## 🎯 ゴール
- コメント入力中に `@` でボードメンバーを検索し、選択したメンバーの UUID を正確に送信できる
- コメント本文内のメンションをハイライト表示し、hover/focus でユーザーカードを表示できる
- サーバー側ではメンションの抽出・検証を厳格化し、`comment_mentions` と同期する

## 📝 背景
- 現状は単純な文字列マッチで `@` を検知し、曖昧な `mentions` 配列を送っている
- 通知生成やプロフィール表示を正確に行うため、メンバーIDベースのメンション機構が必要
- 将来的な Slack ライクのサジェスト（roleフィルタ等）にも耐えられるアーキテクチャを整備したい

## ✅ スコープ
- `CommentsPanel` の入力欄にメンバーサジェストポップアップを実装（keyboard 対応・IME 考慮）
- 選択したメンバーを本文に挿入しつつ、内部的には UUID を保持（`mentions` hidden field or state）
- サーバー側のバリデーション: 存在しないメンバーやボード外ユーザーを拒否
- コメント本文レンダリング時に `<Mention>` コンポーネントを挟み、ハイライト/hoverカードを実装
- オフライン時もボードメンバーキャッシュからサジェストできるようにする

## 🚫 非スコープ
- メンション通知生成（0204）
- メンション履歴の管理、@channel 的機能

## 📦 実装タスク
1. **タイプアヘッドコンポーネント実装**
   - `useMentions` Hook（`CommentsPanel` から切り出し）
   - `@` 入力検知・候補取得（`boardMembers` キャッシュ）・キーボード操作
   - モバイル時の UX（スクリーン段差）
2. **本文内マークアップ**
   - コメント投稿時に `${displayName}` ではなく特殊トークン（例: `<@uuid>`）を保管し、表示時にレンダリング変換
   - Markdown/Text 表示時にも崩れないフォーマット（例: plain textには displayName）
3. **サーバーバリデーション強化**
   - `/api/cards/[cardId]/comments` で `mentions` に含まれる ID が `board_members` に属しているか検証
   - バリデーション失敗時は 400 で詳細エラーを返す
4. **ハイライト & ユーザーカード**
   - `<Mention>` コンポーネント新設（`app/(board)/_components/Mention.tsx`）
   - hover/focus でプロフィールポップオーバー（avatar, email, role）
   - アクセシビリティ: `aria-haspopup`、キーボードフォーカス
5. **オフライン対応**
   - `KanbanBoardClient` が持つメンバーキャッシュをローカルストレージと同期
   - オフライン時はキャッシュのみでサジェストし、復帰後に diff を解決

## ✅ 受け入れ基準
- [ ] `@` を入力すると 20ms 以内に候補が表示され、Enter/Tab/Click で選択できる
- [ ] 送信された `mentions` は全て UUID であり、`comment_mentions` が正しく生成される
- [ ] 表示上は `@Display Name` がハイライトされ、hover でプロフィールが表示される
- [ ] オフライン時も直前に取得したメンバーが候補に出る
- [ ] 無効なメンバーIDを送信した場合はバリデーションエラーになる

## 🧪 テスト
- [ ] `npm run lint`
- [ ] `npx playwright test e2e/phase3-comments.spec.ts --grep "@mentions" --reporter=json > playwright-report-comments-mentions.json`
  - [ ] `sed -n '/^{/,$p' playwright-report-comments-mentions.json | jq '.stats'`
- [ ] 単体テスト： mention parser（`lib/comments/mentions.test.ts`）

## 📎 依存関係
- 前提: 0201（DB/API拡張）、0202（コメントUI統合）
- 後続: 0204（通知生成、メンション通知）

## ❓ オープン課題
- メンバー数が多いボードでのパフォーマンス（仮想リスト導入の是非）
- メンション表示フォーマット（Markdown互換）

