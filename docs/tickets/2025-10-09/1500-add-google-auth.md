# Google認証の実装

**Status**: 🔴 Not Started
**Priority**: 🔥 High
**Created**: 2025-10-09 1500
**Assignee**: TBD
**Estimated**: 8 hours

## 概要

Supabase Authを使用してGoogleソーシャルログイン機能を実装する。最低限のGoogle認証のみを実装し、ユーザーごとのデータ分離を実現する。

## 目的

- ユーザー認証機能の基盤を構築
- ユーザーごとのデータ分離によるセキュリティ向上
- 簡単なログインでユーザー体験を向上

## 実装内容

- [ ] Supabase AuthでGoogle OAuth設定
- [ ] Google Cloud ConsoleでOAuth認証情報作成
- [ ] ログインページ/コンポーネント作成
- [ ] ログアウト機能実装
- [ ] 認証状態管理（Context/hooks）
- [ ] RLSポリシー更新（user_id列追加）
- [ ] データベーススキーマ更新（user_id FK追加）
- [ ] 既存のCRUD操作にuser_idフィルタ追加
- [ ] ログイン前後のリダイレクト処理

## 技術的詳細

### データベース変更

```sql
-- listsテーブルにuser_id追加
ALTER TABLE lists ADD COLUMN user_id UUID REFERENCES auth.users(id);

-- cardsテーブルにuser_id追加（または lists経由でアクセス制御）
-- オプション: cards.user_id を追加してもよい

-- RLSポリシー有効化
ALTER TABLE lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE cards ENABLE ROW LEVEL SECURITY;

-- 読み取りポリシー
CREATE POLICY "Users can view own lists"
  ON lists FOR SELECT
  USING (auth.uid() = user_id);

-- 挿入ポリシー
CREATE POLICY "Users can insert own lists"
  ON lists FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 更新ポリシー
CREATE POLICY "Users can update own lists"
  ON lists FOR UPDATE
  USING (auth.uid() = user_id);

-- 削除ポリシー
CREATE POLICY "Users can delete own lists"
  ON lists FOR DELETE
  USING (auth.uid() = user_id);

-- cards用のポリシー（list経由でアクセス制御）
CREATE POLICY "Users can view cards in own lists"
  ON cards FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM lists
      WHERE lists.id = cards.list_id
      AND lists.user_id = auth.uid()
    )
  );

-- 同様に INSERT/UPDATE/DELETE も
```

### コンポーネント構成

```
app/
├── login/
│   └── page.tsx          # ログインページ
├── contexts/
│   └── AuthContext.tsx   # 認証状態管理
└── page.tsx              # メインページ（認証チェック追加）
```

### Supabase Auth設定

1. Supabase Dashboard → Authentication → Providers
2. Google有効化
3. Redirect URL設定: `https://taesk.vercel.app/auth/callback`
4. ローカル: `http://localhost:3000/auth/callback`

### 環境変数

不要（Supabase SDKが自動処理）

## 受け入れ基準

- [ ] Googleアカウントでログインできる
- [ ] ログアウトできる
- [ ] 未認証時はログインページにリダイレクト
- [ ] ログイン後は自分のボードのみ表示される
- [ ] 他ユーザーのデータは見えない・編集できない
- [ ] RLSポリシーが正しく動作している
- [ ] 既存の全機能が認証後も正常動作
- [ ] モバイルでもログインできる

## 関連チケット

- [#2025-10-09/1510-implement-realtime-sync](./1510-implement-realtime-sync.md) - リアルタイム同期（認証前提）
- [#2025-10-09/1520-add-offline-sync-queue](./1520-add-offline-sync-queue.md) - オフライン同期

## ノート

### 注意点

- 既存データへの影響を考慮（マイグレーション戦略）
- localStorageとの整合性（user_id含める必要あり）
- 認証エラーハンドリング（ネットワークエラー、トークン期限切れ）

### 実装順序

1. データベーススキーマ変更（migration）
2. RLSポリシー設定
3. 認証コンポーネント実装
4. 既存CRUD操作の修正
5. テスト

### テスト項目

- ログイン/ログアウトフロー
- 複数ユーザーでのデータ分離確認
- RLSポリシー動作確認（直接SQL実行して確認）
- 既存E2Eテストが認証後も通ることを確認

### 将来の拡張

Phase 1では最低限のGoogle認証のみ実装。将来的には以下も検討:
- メール/パスワード認証
- GitHub認証
- プロフィール編集機能
