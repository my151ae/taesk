# Phase 3 Implementation Plan (v1.1)

**作成日:** 2025-10-18 (JST)  
**保存場所:** `/docs/tickets/2025-10-18/Phase3-Implementation-Plan.md`  
**対象リポジトリ:** `my151ae/taesk`

> 本書はレビュー指摘（2025-10-18）を反映した更新版です。

---

## 変更点（Changelog）
- ✅ **作成日の整合性**: 2025-10-18 に統一。
- ✅ **RLSの具体化**: boards/lists/cards/comments ごとの `select/insert/update/delete` とロール別条件を明示。
- ✅ **移行SQLの明記**: 既存ボード作成者を `board_members.owner` に登録する DML を追加。
- ✅ **メンション実装詳細**: 検索API、パース、通知トリガーを定義。
- ✅ **PWAプッシュ前提**: VAPID 鍵・Service Worker・送信経路（Edge Functions）を具体化。
- ✅ **フィーチャーフラグ運用**: 開発=env、本番=Vercel Edge Config の方針を明記。
- ✅ **パフォーマンス**: 主要インデックスを DDL として追加。
- ✅ **ロールバック手順**: RLS一時無効化/再有効化など具体コマンドを追記。

---

## 目的（Phase 3: Collaboration）
- ボード単位の権限管理で共同編集の安全性と操作性を向上。
- カード単位の議論（スレッド/メンション）を可能に。
- 通知（アプリ内・PWAプッシュ）で変更やメンションに即応。

---

## 現状と前提
- Phase 2.1 で担当者（`assignee_id`）を導入。**外部キー** `cards.assignee_id → profiles.id` により、profiles 未作成ユーザーに割当てると 409/23503 が発生するため、**profiles 自動作成**（サインアップ時トリガ or 最初の書込前の補完）が必須。
- PWA/Realtime/オフライン/マルチボードの基盤は稼働済み。本計画はその上に構築。

---

## スコープと成果物

### 3.1 ボード共有権限
**要件**
- ロール: `owner / editor / commenter / viewer`（ボード単位）
- 追加: 招待リンク or メール。ロール変更/削除。

**スキーマ（DDL）**
```sql
create type member_role as enum ('owner','editor','commenter','viewer');

create table if not exists board_members (
  board_id uuid not null references boards(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  role member_role not null default 'editor',
  created_at timestamptz not null default now(),
  primary key (board_id, profile_id)
);

create table if not exists board_invites (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards(id) on delete cascade,
  email text not null,
  role member_role not null default 'editor',
  token text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

-- 主要インデックス（パフォーマンス）
create index if not exists idx_board_members_profile on board_members(profile_id);
create index if not exists idx_board_invites_board_id on board_invites(board_id);
```

**RLS（例）**
```sql
-- boards
alter table boards enable row level security;

create policy if not exists select_boards_for_members
  on boards for select
  using (exists (
    select 1 from board_members m
    where m.board_id = boards.id
      and m.profile_id = auth.uid()
  ));

-- lists
alter table lists enable row level security;

create policy if not exists select_lists_for_board_members
  on lists for select
  using (exists (
    select 1 from board_members m
    where m.board_id = lists.board_id
      and m.profile_id = auth.uid()
  ));

create policy if not exists insert_lists_for_editors
  on lists for insert
  with check (exists (
    select 1 from board_members m
    where m.board_id = lists.board_id
      and m.profile_id = auth.uid()
      and m.role in ('owner','editor')
  ));

create policy if not exists update_lists_for_editors
  on lists for update
  using (exists (
    select 1 from board_members m
    where m.board_id = lists.board_id
      and m.profile_id = auth.uid()
      and m.role in ('owner','editor')
  ));

create policy if not exists delete_lists_for_owners
  on lists for delete
  using (exists (
    select 1 from board_members m
    where m.board_id = lists.board_id
      and m.profile_id = auth.uid()
      and m.role in ('owner')
  ));

-- cards
alter table cards enable row level security;

create policy if not exists select_cards_for_board_members
  on cards for select
  using (exists (
    select 1 from board_members m
    where m.board_id = cards.board_id
      and m.profile_id = auth.uid()
  ));

create policy if not exists insert_cards_for_editors
  on cards for insert
  with check (exists (
    select 1 from board_members m
    where m.board_id = cards.board_id
      and m.profile_id = auth.uid()
      and m.role in ('owner','editor')
  ));

create policy if not exists update_cards_for_editors
  on cards for update
  using (exists (
    select 1 from board_members m
    where m.board_id = cards.board_id
      and m.profile_id = auth.uid()
      and m.role in ('owner','editor')
  ));

create policy if not exists delete_cards_for_owners
  on cards for delete
  using (exists (
    select 1 from board_members m
    where m.board_id = cards.board_id
      and m.profile_id = auth.uid()
      and m.role in ('owner')
  ));

-- comments（3.2で作成するテーブルに適用）
alter table comments enable row level security;

create policy if not exists select_comments_for_board_members
  on comments for select
  using (exists (
    select 1
    from cards c
    join board_members m on m.board_id = c.board_id and m.profile_id = auth.uid()
    where c.id = comments.card_id
  ));

create policy if not exists insert_comments_for_commenters
  on comments for insert
  with check (exists (
    select 1
    from cards c
    join board_members m on m.board_id = c.board_id and m.profile_id = auth.uid()
    where c.id = comments.card_id
      and m.role in ('owner','editor','commenter')
  ));

create policy if not exists update_own_comments
  on comments for update
  using (author_id = auth.uid());

create policy if not exists delete_own_comments
  on comments for delete
  using (author_id = auth.uid());
```

**UI/UX**
- Share ダイアログ（メンバー一覧/招待/ロール変更/リンクコピー）
- 非メンバー来訪時のエンプティステート（申請/オーナーへ通知）

**Realtime**
- `board_id` フィルタで lists/cards/comments/notifications を購読

**移行（既存データ）**
```sql
-- 既存ボードの作成者を owner として初期投入
insert into board_members (board_id, profile_id, role)
select id, user_id, 'owner'::member_role
from boards
where user_id is not null
on conflict (board_id, profile_id) do nothing;
```

---

### 3.2 コメント（スレッド & メンション）
**スキーマ（DDL）**
```sql
create table if not exists comments (
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

-- 主要インデックス
create index if not exists idx_comments_card_time on comments(card_id, created_at);
create index if not exists idx_comments_parent on comments(parent_id);
```

**メンション実装詳細**
- **検索API**（board_members 限定・部分一致）
  ```ts
  // GET /api/boards/:boardId/members?query=xx など
  export async function searchBoardMembers(boardId: UUID, query: string): Promise<Profile[]> {
    // RLS: board_members 経由で board に属する profiles のみ返す
  }
  ```
- **パース**: クライアントで本文から `@username` を抽出 → プロファイル解決 → `mentions` 配列に `profile_id[]` を格納
- **通知トリガー**: コメント insert 後（DBトリガ or Edge Function）で `mentions` の各 `profile_id` へ通知レコード作成

**UI/UX**
- エディタ（Enter=投稿 / Shift+Enter=改行）
- `@` でタイプアヘッド（avatar/name/email）
- 編集/削除（ソフトデリート表示）/スレッド折りたたみ

---

### 3.3 通知（アプリ内 & PWA プッシュ）
**スキーマ（DDL）**
```sql
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references profiles(id) on delete cascade,
  type text not null,               -- 'mention','assignee_changed','due_soon' 等
  payload jsonb not null,           -- {card_id, comment_id, message, ...}
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

-- 主要インデックス
create index if not exists idx_notifications_recipient_time
  on notifications(recipient_id, created_at desc);
```

**PWAプッシュの前提**
- **VAPID鍵**:  
  - `NEXT_PUBLIC_VAPID_PUBLIC_KEY`（クライアント公開用）  
  - `VAPID_PRIVATE_KEY`（Edge Functions で保持）
- **Service Worker**: `/public/sw.js` に `push`/`notificationclick` ハンドラを実装
- **送信経路**: `POST /api/send-push`（Edge Functions） → `web-push` ライブラリで配信（`push_subscriptions` 参照）

**UI/UX**
- ヘッダーのベル（未読数バッジ）→ ドロップダウン（既読化/設定）
- 通知設定画面（種類ごとのオン/オフ、プッシュ登録/解除）

---

## クロスカット（RLS・パフォーマンス・移行）

### プロファイル自動作成（必須）
- サインアップ時に `auth.users` → `public.profiles` へ upsert する DB トリガを配置
- 書込時フェイルセーフ: `profiles` が無ければ最小行を upsert

### 代表インデックス（再掲）
```sql
-- cards
create index if not exists idx_cards_board_position on cards(board_id, list_id, position);
create index if not exists idx_cards_assignee on cards(assignee_id);
-- lists
create index if not exists idx_lists_board_position on lists(board_id, position);
-- board_members / comments / notifications は上記各セクションを参照
```

---

## フィーチャーフラグ運用
- **開発**: `.env.local` で
  - `NEXT_PUBLIC_FF_BOARD_PERMISSIONS=true`
  - `NEXT_PUBLIC_FF_COMMENTS=true`
  - `NEXT_PUBLIC_FF_NOTIFICATIONS=true`
  - `NEXT_PUBLIC_FF_PUSH=false`（段階解放）
- **本番**: Vercel **Edge Config** にキーを配置し、ランタイムで取得（A/B や段階展開を容易化）

---

## マイルストン（相対）
- **Week 1-2**: スキーマ/トリガ/RLS/マイグレーション、Share/Comments/Notifications の UI ワイヤ
- **Week 3**: Share 完成、コメント（スレッド/メンション）、通知一覧・既読
- **Week 4**: PWA プッシュ、期限リマインド、E2E/負荷/アクセシビリティ

---

## ロールアウト & ロールバック

**段階適用**  
1) `board_members` & `board_invites` 適用 → フィーチャーフラグ OFF  
2) 既存ボードの `owner` 初期投入（移行SQL）  
3) RLS を **SELECT → INSERT → UPDATE → DELETE** の順で段階的に有効化  
4) フラグ ON（小規模ボードから順次）

**ロールバック（例）**
```sql
-- デバッグのため一時的に RLS 無効化
alter table board_members disable row level security;
alter table lists disable row level security;
alter table cards disable row level security;
alter table comments disable row level security;
alter table notifications disable row level security;

-- 収束後に再有効化
alter table board_members enable row level security;
alter table lists enable row level security;
alter table cards enable row level security;
alter table comments enable row level security;
alter table notifications enable row level security;
```

---

## 付録: API インタフェース（更新）
```ts
// Members
addMember(boardId: UUID, userIdOrEmail: string, role: 'owner'|'editor'|'commenter'|'viewer')
updateMemberRole(boardId: UUID, profileId: UUID, role: member_role)
removeMember(boardId: UUID, profileId: UUID)
searchBoardMembers(boardId: UUID, query: string): Promise<Profile[]>

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

## 付録: サインアップ時 profiles 自動作成（DDL スケッチ）
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
