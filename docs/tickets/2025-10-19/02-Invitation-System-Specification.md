# 招待機能の仕様整理

**作成日**: 2025-10-19
**対象**: Phase3 ボード共有機能の招待システム設計

---

## 🤔 現在の問題点

### 1. **Supabase の認証方式**
現在は **Google OAuth のみ**を使用しています。
- ✅ Google アカウントでログイン可能
- ❌ メールアドレス＋パスワードでのサインアップは **未対応**

### 2. **ShareDialog の実装状況**
```typescript
// 現在の実装（TODO コメント付き）
const handleInvite = async (e: React.FormEvent) => {
  // TODO: Implement invite by email (create board_invite record)
  // For now, just show success message
  alert(`Invite sent to ${inviteEmail} as ${ROLE_LABELS[inviteRole]}`);
};
```

- ✅ UI は実装済み（メールアドレス入力 + ロール選択）
- ❌ 実際の招待処理は未実装（alert のみ）
- ❌ メール送信機能なし
- ❌ 招待受諾フローなし

### 3. **ユーザー管理の課題**
- **既存メンバー**: `board_members` テーブルで管理
- **新規招待**: `board_invites` テーブルで管理（未実装）
- **問題**: メールアドレス入力時に、既存ユーザーか新規ユーザーか判別できない

---

## 🎯 必要な設計判断

### A. 招待対象の整理

#### パターン1: 既存 Taesk ユーザーのみ招待可能
**メリット**:
- シンプルな実装
- メール送信不要
- Supabase の設定変更不要

**デメリット**:
- 新規ユーザーを招待できない
- 事前に Taesk に登録してもらう必要がある

**実装方法**:
1. メールアドレス入力時に `profiles` テーブルを検索
2. 存在する場合のみ `board_members` に追加
3. 存在しない場合はエラーメッセージ表示

#### パターン2: 新規ユーザーも招待可能（メール送信あり）
**メリット**:
- UX が良い（招待リンクをクリックするだけ）
- 一般的な招待フロー

**デメリット**:
- メール送信サービスが必要（SendGrid/Resend）
- 実装が複雑
- コストがかかる

**実装方法**:
1. `board_invites` テーブルにレコード作成（トークン付き）
2. 招待メール送信（招待リンク: `/invite/[token]`）
3. ユーザーが招待リンクをクリック
4. Taesk に未登録なら Google ログイン促す
5. ログイン後、自動的に `board_members` に追加

#### パターン3: ハイブリッド（既存ユーザーは即追加、新規は招待）
**メリット**:
- 既存ユーザーは即座に追加（UX 良）
- 新規ユーザーも招待可能

**デメリット**:
- 実装が最も複雑
- UI で2つのフローを説明する必要がある

---

## 💡 推奨仕様（パターン1 + 将来拡張）

### Phase 3.2: 既存ユーザーのみ招待（即時実装）

#### 動作フロー
```
1. ShareDialog で メールアドレス入力
   ↓
2. API: GET /api/profiles/search?email={email}
   → profiles テーブルを検索
   ↓
3a. ユーザーが存在する場合:
    → POST /api/boards/[boardId]/members
    → 即座に board_members に追加
    → 「{name} をボードに追加しました」と表示
   ↓
3b. ユーザーが存在しない場合:
    → エラーメッセージ:
       「このメールアドレスは Taesk に登録されていません。
        先に https://taesk.vercel.app でアカウント作成してもらってください。」
```

#### 必要な実装
1. **新規 API**: `GET /api/profiles/search?email={email}`
   - `profiles` テーブルから email で検索
   - 存在すれば profile 情報を返す
   - 存在しなければ 404

2. **ShareDialog の更新**:
   ```typescript
   const handleInvite = async (e: React.FormEvent) => {
     e.preventDefault();
     if (!inviteEmail.trim()) return;

     setInviting(true);
     try {
       // 1. 既存ユーザーか確認
       const searchRes = await fetch(`/api/profiles/search?email=${encodeURIComponent(inviteEmail)}`);

       if (!searchRes.ok) {
         alert('このメールアドレスは Taesk に登録されていません。\n先に https://taesk.vercel.app でアカウント作成してもらってください。');
         return;
       }

       const { profile } = await searchRes.json();

       // 2. すでにメンバーか確認
       if (members.some(m => m.profile_id === profile.id)) {
         alert('このユーザーは既にメンバーです。');
         return;
       }

       // 3. メンバーに追加
       const addRes = await fetch(`/api/boards/${boardId}/members`, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({
           profile_id: profile.id,
           role: inviteRole,
         }),
       });

       if (addRes.ok) {
         alert(`${profile.full_name || profile.email} をボードに追加しました！`);
         setInviteEmail('');
         setInviteRole('editor');
         loadMembers(); // メンバーリスト再読み込み
       }
     } catch (error) {
       console.error('Error adding member:', error);
       alert('メンバー追加に失敗しました');
     } finally {
       setInviting(false);
     }
   };
   ```

#### 見積もり
- API 実装: 15分
- ShareDialog 更新: 30分
- テスト: 15分
- **合計: 約1時間**

---

### Phase 3.3: 新規ユーザー招待（将来実装）

#### 前提条件
1. メール送信サービス（SendGrid/Resend）の契約
2. 招待メールテンプレート作成
3. 招待受諾ページ作成

#### 動作フロー
```
1. ShareDialog で メールアドレス入力
   ↓
2. API: GET /api/profiles/search?email={email}
   ↓
3a. ユーザーが存在する場合:
    → 即座に board_members に追加（Phase 3.2 と同じ）
   ↓
3b. ユーザーが存在しない場合:
    ↓
    4. POST /api/boards/[boardId]/invites
       → board_invites テーブルにレコード作成
       → 招待トークン生成（UUID）
       → 有効期限設定（7日間）
    ↓
    5. メール送信
       → 件名: "{Your Name} があなたを Taesk ボードに招待しました"
       → 本文: 招待リンク（https://taesk.vercel.app/invite/{token}）
    ↓
    6. 招待メール送信完了メッセージ
       → 「{email} に招待メールを送信しました」
```

#### 必要な実装
1. `POST /api/boards/[boardId]/invites` API
2. メール送信サービス統合
3. `/app/invite/[token]/page.tsx` - 招待受諾ページ
4. 招待リンククリック時の処理

#### 見積もり
- API 実装: 1時間
- メール送信統合: 1時間
- 招待受諾ページ: 1時間
- **合計: 約3時間**

---

## 🔍 Supabase 認証設定の確認

### 現在の設定（推測）
- **Google OAuth**: ✅ 有効
- **Email/Password**: ❓ 確認が必要

### 確認方法
Supabase Dashboard → Authentication → Providers で確認してください。

#### もし Email/Password が無効の場合
**推奨**: そのままにする
- Google OAuth のみでシンプルに運用
- 招待されたユーザーも Google アカウントでログイン

#### もし Email/Password を有効にしたい場合
1. Supabase Dashboard で有効化
2. サインアップページ作成
3. パスワードリセット機能実装
4. セキュリティ考慮（パスワード強度チェック等）

---

## 📋 推奨実装プラン

### 今すぐ実装すべき（Phase 3.2）

**T2-A: 既存ユーザー検索＆追加機能**
- 優先度: 🔴 高
- 見積もり: 1時間
- 実装内容:
  1. `GET /api/profiles/search?email={email}` API 作成
  2. ShareDialog の handleInvite 更新
  3. 重複チェック追加
  4. エラーメッセージ改善

### 後回しでOK（Phase 3.3+）

**T2-B: 新規ユーザー招待（メール送信）**
- 優先度: 🟡 中
- 見積もり: 3時間
- 前提条件:
  - メール送信サービスの契約
  - ビジネス要件の確認（本当に必要か？）

---

## 🎨 UI の改善提案

### ShareDialog の表示改善

#### 現在の招待フォーム
```
┌─────────────────────────────────────┐
│ Invite by Email                     │
├─────────────────────────────────────┤
│ [email@example.com] [Editor ▼] [Invite] │
└─────────────────────────────────────┘
```

#### 改善後（Phase 3.2）
```
┌──────────────────────────────────────────┐
│ メンバーを追加                             │
├──────────────────────────────────────────┤
│ メールアドレス（Taesk 登録済みユーザー）       │
│ [email@example.com                    ] │
│ ロール: [Editor ▼]                       │
│                                [追加] │
│                                          │
│ ℹ️ Taesk に未登録の方を招待する場合は、     │
│   先に https://taesk.vercel.app で        │
│   Google アカウントでログインしてもらって   │
│   ください。                              │
└──────────────────────────────────────────┘
```

---

## ✅ 結論と推奨アクション

### 即時実装（今日中）
**T2-A: 既存ユーザー検索＆追加機能**
- これで十分に使える機能になる
- 実装時間も1時間程度で済む
- メール送信サービス不要

### 将来検討（ユーザーフィードバック後）
**T2-B: 新規ユーザー招待**
- 実際に「新規ユーザーを招待したい」という要望が多ければ実装
- それまでは「先にアカウント作成してもらう」運用で問題ない

### 次のステップ
1. ✅ この仕様で OK か確認
2. ✅ Supabase の Email/Password 設定を確認（必要に応じて）
3. 🚀 T2-A を実装開始

---

**作成者**: Claude Code
**レビュー待ち**: 松本様
**決定事項記録日**: 2025-10-19
