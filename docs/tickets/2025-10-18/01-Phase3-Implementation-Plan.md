# Phase 3 Implementation Plan (v0.4.0)

**作成日:** 2025-10-17 23:53 UTC
**対象リポジトリ:** `my151ae/taesk`

---


## 目的（Phase 3: Collaboration）
- ボード単位の権限管理を導入し、共同編集時の安全性と操作性を高める。
- コメント（スレッド、@メンション）でカード単位の議論を可能にする。
- 通知（アプリ内・PWAプッシュ）で変更やメンションに即応できる体験を提供する。

---

## 現状と前提
- Phase 2.1 でカードの担当者（`assignee_id`）が導入済み。UI/同期は実装されているが、DB に外部キー（`cards.assignee_id → profiles.id`）が張られるため、**profiles レコードの自動作成**が必須（サインイン時 or 最初の書き込み前）。
- PWA 対応・リアルタイム・オフライン同期・マルチボードなどの基盤は既に動作。これらを前提に Phase3 を積み上げる。

---

## スコープと成果物

### 3.1 ボード共有権限
**要件**
- ボードごとに **Owner / Editor / Commenter / Viewer** のロールを付与。
- 招待リンク or メールでメンバー追加。ロール変更・削除が可能。
- RLS で lists / cards / comments へのアクセスを **board_id を起点**に制御。

**データモデル（DDL スケッチ）**
```sql
-- 役割
create type member_role as enum ('owner','editor','commenter','viewer');

-- 既存: boards, profiles は前提

-- メンバーシップ
create table board_members (
  board_id uuid not null references boards(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  role member_role not null default 'editor',
  created_at timestamptz not null default now(),
  primary key (board_id, profile_id)
);

-- 招待
create table board_invites (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards(id) on delete cascade,
  email text not null,
  role member_role not null default 'editor',
  token text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_board_invites_board_id on board_invites(board_id);
```

**RLS ポリシー（例）**
```sql
-- boards
alter table boards enable row level security;

create policy select_boards_for_members
  on boards for select
  using ( exists (select 1 from board_members m
                  where m.board_id = boards.id and m.profile_id = auth.uid()) );

-- lists / cards / comments も board_id 経由で同様に
```

**UI/UX**
- 「Share」ダイアログ（ボード右上）：メンバー一覧、招待、ロール変更、リンクコピー。
- 共有 URL は `/b/:short_id/settings/share` などに配置。
- エンプティステート：非メンバーがアクセスした場合は閲覧/申請 UI を出す。

**実装メモ**
- 既存 Realtime 購読を `board_id` フィルタで運用（lists/cards/comments/notifications）。
- 既存データ移行：`board_members` に **既存作成者=owner**、その他は空。

**テスト**
- ユースケース：招待→受諾、ロール変更、メンバー削除、非メンバーアクセス制御。
- E2E：Viewer は編集不可、Commenter はコメントのみ可、Editor は CRUD 可能、Owner 全権。

---

### 3.2 コメント機能（スレッド & メンション）
**要件**
- カード詳細にコメントタブ。
- 返信でスレッド化。`@` タイプアヘッドで profiles 検索→メンション。
- 編集/削除（ソフトデリート）履歴表示。

**データモデル（DDL スケッチ）**
```sql
create table comments (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references cards(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete set null,
  parent_id uuid null references comments(id) on delete cascade,
  body text not null,
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_comments_card_time on comments(card_id, created_at);
create index idx_comments_parent on comments(parent_id);
```

**RLS ポリシー**
- `exists (select 1 from board_members where board_id = cards.board_id and profile_id = auth.uid())` をベースに select/insert/update を付与。
- Viewer は select のみ。Commenter 以上は insert。編集/削除は `author_id = auth.uid()`。

**UI/UX**
- エディタ（Shift+Enter で改行、Enter で投稿）。
- メンションは `@` でプロフィール候補（avatar/name/email）。
- スレッドの折りたたみ、編集マーク、削除時の “削除済み” 表示。

**テスト**
- コメント作成/編集/削除、親子スレッド、メンション解決、非メンバー不可。

---

### 3.3 通知システム（アプリ内 & PWA プッシュ）
**要件**
- イベント：メンション、担当者変更、コメント返信、期限リマインド等。
- 配信：アプリ内バッジ + トースト / PWA プッシュ（ユーザー同意）。
- 既読管理。

**データモデル（DDL スケッチ）**
```sql
create table notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references profiles(id) on delete cascade,
  type text not null,                            -- 'mention','assignee_changed','due_soon' 等
  payload jsonb not null,                        -- {card_id, comment_id, message, ...}
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_notifications_recipient_time on notifications(recipient_id, created_at desc);

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
```

**イベント生成**
- クライアント or Edge Functions でイベント発火 → `notifications` に insert。
- PWA プッシュ：Service Worker + VAPID キー。`push_subscriptions` から送信。

**UI/UX**
- ヘッダーにベルアイコン（未読数）。ドロップダウンで最近の通知、既読化、設定リンク。
- 設定で通知種類ごとのオン/オフとプッシュ登録。

**テスト**
- メンション→通知生成→受信（Realtime）→既読化の E2E。
- PWA プッシュは integration（Service Worker 登録/購読/解除）。

---

## クロスカット（移行・RLS・パフォーマンス）

### プロファイル自動作成（必須）
**課題**: `cards.assignee_id` の外部キーにより、存在しない `profiles.id` を指すと 409/23503 エラー。  
**対策**:
1) **サインアップ/初回ログイン** 時に `auth.users` → `public.profiles` を自動生成（DB トリガ）。  
2) 書き込み時に `profiles` が無ければ最小レコードを upsert（フェイルセーフ）。

**DDL スケッチ**
```sql
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, email, avatar_url)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''), new.email, new.raw_user_meta_data->>'avatar_url')
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

### RLS と取得経路
- サーバー側フェッチ時は**認証コンテキストが必要**。クライアント側取得に寄せる or サーバー側は Service Role/Edge Functions 経由で実施。

### インデックス/Realtime
- `board_id` での購読フィルタに合わせ、主要テーブルに `board_id` 複合インデックスを整備。

---

## マイルストン & 見積（相対）
- **Week 1-2**: スキーマ（`board_members`, `comments`, `notifications`, `push_subscriptions`）、RLS、トリガ、マイグレーション、基本 UI ワイヤ。  
- **Week 3**: Share ダイアログ・メンバー CRUD、コメント UI、メンション、通知一覧。  
- **Week 4**: PWA プッシュ、期限リマインド、E2E・負荷・アクセシビリティ。

---

## ロールアウト手順
1. スキーマ適用（バックフィル含む）→ フィーチャーフラグ OFF でデプロイ。
2. `profiles` 自動作成のトリガ確認 → 監視ダッシュボード。
3. Share/Comments/Notifications を段階的に ON。
4. ロールバックは UI フラグ OFF + RLS ポリシー温存、通知キューは排出。

---

## 付録: API/関数インタフェース（案）
```ts
// Members
addMember(boardId: UUID, userIdOrEmail: string, role: 'owner'|'editor'|'commenter'|'viewer')
updateMemberRole(boardId: UUID, profileId: UUID, role: member_role)
removeMember(boardId: UUID, profileId: UUID)

// Comments
createComment(cardId: UUID, body: string, mentions?: UUID[], parentId?: UUID)
listComments(cardId: UUID): Promise<Comment[]>
updateComment(id: UUID, body: string)
deleteComment(id: UUID)

// Notifications
listNotifications(): Promise<Notification[]>
markAsRead(id: UUID)
subscribePush(endpoint, p256dh, auth)
unsubscribePush(id: UUID)
```

---

## 補足: フィーチャーフラグ
- `ff_board_permissions`
- `ff_comments`
- `ff_notifications`
- `ff_push`

ON/OFF で安全に段階展開可能。
