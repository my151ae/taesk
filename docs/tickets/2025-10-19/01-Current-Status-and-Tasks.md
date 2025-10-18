# Phase3 実装状況まとめ & 今後のタスク

**作成日**: 2025-10-19
**対象**: Phase3 (Collaboration) 機能の現状整理と今後の計画

---

## 📊 Phase3 実装状況サマリー

### ✅ 実装完了 & 動作確認済み

#### 1. **ボード共有権限（Board Permissions）**
- **データベース**: ✅ 完了
  - `board_members` テーブル（owner/editor/commenter/viewer）
  - `board_invites` テーブル
  - RLS ポリシー（ロール別アクセス制御）

- **API**: ✅ 完了
  - `GET /api/boards/[boardId]/members` - メンバー一覧・検索
  - `POST /api/boards/[boardId]/members` - メンバー追加
  - `PATCH /api/boards/[boardId]/members/[profileId]` - ロール変更
  - `DELETE /api/boards/[boardId]/members/[profileId]` - メンバー削除

- **UI**: ✅ 完了
  - ShareDialog コンポーネント（メンバー一覧、ロール変更、削除機能）
  - ヘッダーに Share ボタン統合済み

#### 2. **コメント機能（Comments）**
- **データベース**: ✅ 完了
  - `comments` テーブル（スレッド対応、メンション機能）
  - RLS ポリシー（commenter 以上が作成可能）

- **API**: ✅ 完了
  - `GET /api/cards/[cardId]/comments` - コメント一覧
  - `POST /api/cards/[cardId]/comments` - コメント作成
  - `PATCH /api/comments/[commentId]` - 編集
  - `DELETE /api/comments/[commentId]` - 削除（ソフトデリート）

- **UI**: ✅ 完了
  - CommentsPanel コンポーネント（スレッド表示、返信、編集、削除）
  - @メンション機能（タイプアヘッド、ドロップダウン）

#### 3. **通知システム（Notifications）**
- **データベース**: ✅ 完了
  - `notifications` テーブル
  - `push_subscriptions` テーブル（PWA用）
  - RLS ポリシー（自分の通知のみ閲覧可能）

- **API**: ✅ 完了
  - `GET /api/notifications` - 通知一覧
  - `POST /api/notifications` - 通知作成
  - `PATCH /api/notifications/[notificationId]` - 既読化

- **UI**: ✅ 完了
  - NotificationsBell コンポーネント（ベルアイコン、未読バッジ、ドロップダウン）
  - ヘッダーに統合済み

---

## 🐛 2025-10-19 バグ修正完了

### 修正1: Vercel デプロイエラー
- **問題**: Next.js 15 の API route params の型エラー
- **修正**: すべての API route で `params: Promise<{ id: string }>` に変更、`await` を追加
- **コミット**: `390ccf8`

### 修正2: @supabase/ssr 導入と認証エラー
- **問題**: Phase3 API routes で 401 Unauthorized エラー
- **修正**:
  - `@supabase/ssr` パッケージをインストール
  - `createServerSupabaseClient()` を作成（Cookie ハンドリング付き）
  - すべての Phase3 API routes を更新
- **コミット**: `6afd44f`

### 修正3: PKCE ログインエラー
- **問題**: "invalid request: both auth code and code verifier should be non-empty"
- **修正**:
  - `createBrowserClient()` に Cookie handlers を追加
  - `app/auth/callback/route.ts` を server client に更新
  - E2E auth setup で Cookie にセッション保存
- **コミット**: `40ddef7`, `169c080`
- **テスト結果**: E2E 認証テスト 5/5 passed ✅

### 修正4: Google プロフィール画像エラー
- **問題**: 担当者アバター表示時の Next.js Image エラー
- **修正**: `next.config.ts` に `lh3.googleusercontent.com` を追加
- **コミット**: `5cdded6`

---

## 🎯 現在の機能実装状況

### Phase3 実装済み機能

| 機能 | データベース | API | UI | 統合 | 状態 |
|------|-------------|-----|----|----|------|
| ボード権限管理 | ✅ | ✅ | ✅ | ✅ | **動作中** |
| コメント（スレッド） | ✅ | ✅ | ✅ | ⚠️ | **要統合** |
| @メンション | ✅ | ✅ | ✅ | ⚠️ | **要統合** |
| 通知システム | ✅ | ✅ | ✅ | ✅ | **動作中** |
| 既読管理 | ✅ | ✅ | ✅ | ✅ | **動作中** |

**⚠️ 注意**: CommentsPanel は実装済みだが、CardModal への統合が未完了

---

## 📋 今後のタスク

### 🔴 優先度: 高（即時対応）

#### T1. CommentsPanel を CardModal に統合
- **目的**: カード詳細画面でコメント機能を使えるようにする
- **作業内容**:
  1. CardModal に CommentsPanel コンポーネントをインポート
  2. カードID と ボードID を props として渡す
  3. モーダル内のレイアウト調整（タブ or セクション分け）
  4. スタイル調整（モーダル内でのスクロール対応）
- **見積もり**: 30分〜1時間
- **優先度**: ⭐⭐⭐

#### T2. 招待機能の実装完成
- **現状**: ShareDialog に招待フォームはあるが、alert のみ表示
- **作業内容**:
  1. `POST /api/boards/[boardId]/invites` API 作成
  2. 招待トークン生成・保存
  3. メール送信（SendGrid or Resend 統合）
  4. 招待受諾ページ作成（`/invite/[token]`）
- **見積もり**: 2〜3時間
- **優先度**: ⭐⭐

### 🟡 優先度: 中（Phase3 完成に必要）

#### T3. Realtime 購読の実装
- **目的**: コメント・通知の自動更新
- **作業内容**:
  1. Supabase Realtime Channel 設定
  2. `comments` テーブル変更の購読
  3. `notifications` テーブル変更の購読
  4. UI の自動更新処理
- **見積もり**: 1〜2時間
- **優先度**: ⭐⭐

#### T4. E2E テストの追加
- **対象機能**: Phase3 全般
- **テストファイル**:
  - `e2e/phase3-permissions.spec.ts` - 権限管理
  - `e2e/phase3-comments.spec.ts` - コメント機能
  - `e2e/phase3-notifications.spec.ts` - 通知機能
- **見積もり**: 2〜3時間
- **優先度**: ⭐

### 🟢 優先度: 低（将来実装）

#### T5. PWA プッシュ通知
- **作業内容**:
  1. Service Worker 作成（`/public/sw.js`）
  2. VAPID 鍵生成・設定
  3. プッシュ購読 UI
  4. `/api/send-push` Edge Function
- **見積もり**: 3〜4時間
- **優先度**: ⭐

#### T6. 通知トリガーの実装
- **現状**: 通知を作成する API はあるが、自動トリガーがない
- **必要な処理**:
  - コメントでメンションされたら通知
  - カードにアサインされたら通知
  - 期限が近づいたら通知
  - コメントに返信されたら通知
- **見積もり**: 2〜3時間
- **優先度**: ⭐

---

## 🔧 機能微調整・追加の候補

### UI/UX 改善

1. **コメント機能の改善**
   - リッチテキストエディタ（Markdown 対応）
   - 画像添付機能
   - コード記法のシンタックスハイライト

2. **通知機能の改善**
   - 通知のグループ化（同じカードの通知をまとめる）
   - 通知設定（どの通知を受け取るか選択可能に）
   - 一括既読機能

3. **権限管理の改善**
   - ボード設定画面の追加
   - デフォルトロールの設定
   - 招待リンクの生成（トークン有効期限付き）

### 機能追加

4. **アクティビティログの表示**
   - 既存の `activity_logs` テーブルを活用
   - カード詳細画面に履歴タブ追加
   - 誰がいつ何を変更したか表示

5. **メンション通知の詳細化**
   - メンション箇所のハイライト
   - メンションされたコメントへの直リンク

6. **権限エラーの UX 改善**
   - 権限不足時のわかりやすいメッセージ
   - 必要な権限レベルの表示

---

## 📝 実装優先順位の提案

### フェーズ分け

**Phase 3.1 (即時)**: CommentsPanel 統合
- T1: CardModal への統合（30分〜1時間）

**Phase 3.2 (今週中)**: 招待機能完成
- T2: 招待システム実装（2〜3時間）

**Phase 3.3 (来週)**: Realtime & テスト
- T3: Realtime 購読（1〜2時間）
- T4: E2E テスト（2〜3時間）

**Phase 3.4 (将来)**: プッシュ通知 & 高度機能
- T5: PWA プッシュ通知（3〜4時間）
- T6: 通知トリガー（2〜3時間）

---

## 🎨 推奨される次のアクション

### 今日中に実装すべき:
1. ✅ **T1: CommentsPanel を CardModal に統合** (最優先)
   - ユーザーがすぐに使える形にする
   - 実装時間も短い

### 今週中に実装すべき:
2. **T2: 招待機能の完成**
   - ボード共有の完全な実現
   - チーム協働の要となる機能

### 余裕があれば:
3. **T3: Realtime 購読**
   - UX の大幅向上
   - 通知・コメントの即時反映

---

## 📚 関連ドキュメント

- [Phase3 実装計画](../2025-10-18/03-Phase3-Implementation-Plan.md)
- [Phase3 完了レポート](../2025-10-18/04-Phase3-Completion-Report.md)
- [アーキテクチャ](../../detail/architecture.md)
- [データベース設計](../../detail/database.md)

---

**作成者**: Claude Code
**日付**: 2025-10-19
**バージョン**: Phase3 + Bugfixes
