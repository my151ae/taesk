# Database Schema (2025-10-23)

Taesk は Supabase（PostgreSQL）を使用し、ボードを中心にリスト・カードがぶら下がる 3 層構造です。Phase 3で追加されたコラボレーション機能により、コメント、通知、ボード権限管理のテーブルも含まれます。

## テーブル一覧

### コアテーブル

| テーブル | 役割 | 補足 |
|----------|------|------|
| `boards` | ボード本体 | ショートURL・正規URL用の `short_id` / `id_short` / `slug` を保持 |
| `lists`  | ボード内のリスト | ボード FK、表示順 (`position`) を管理 |
| `cards`  | リスト内のカード | タグ、期限、優先度、複数担当者、ショートURLを持つ |
| `profiles` | ユーザープロファイル | Supabase Auth ユーザー情報の拡張・担当者選択に利用 |
| `activity_logs` | 監査ログ | 操作履歴（作成/更新/削除/移動）を記録 |

### コラボレーションテーブル (Phase 3)

| テーブル | 役割 | 補足 |
|----------|------|------|
| `board_members` | ボードメンバー管理 | ボードごとのメンバーと権限（owner/editor/commenter/viewer）を管理 |
| `board_invites` | ボード招待 | メール招待トークンと有効期限を管理 |
| `comments` | カードコメント | スレッド形式のコメント、@メンション、編集・削除履歴 |
| `notifications` | 通知 | In-app通知、@メンション通知、コメント通知 |
| `push_subscriptions` | Web Push購読 | ブラウザのプッシュ通知購読情報（VAPID） |
| `notification_delivery_logs` | 通知配信ログ | Web Push配信履歴、レート制限、エラー追跡 |

## エンティティ関係図

```
boards 1 ──┬─ n lists 1 ── n cards ──┬─ n comments
           │                         │
           │                         └─ n assignee_ids → profiles
           │
           ├─ n activity_logs (board 単位の監査)
           ├─ n board_members ── profiles (role: owner/editor/commenter/viewer)
           └─ n board_invites

profiles 1 ──┬─ n comments (author_id)
             ├─ n notifications (recipient_id)
             └─ n push_subscriptions

notifications 1 ── n notification_delivery_logs
push_subscriptions 1 ── n notification_delivery_logs
```

## boards

```sql
CREATE TABLE public.boards (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  user_id UUID NULL,
  is_test_board BOOLEAN DEFAULT FALSE,
  short_id TEXT UNIQUE,
  id_short INTEGER UNIQUE,
  slug TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- `short_id`: `createUniqueBoardShortId()` で生成される base58 風 8 文字 ID。
- `id_short`: `getNextBoardIdShort()` が連番を払い出し、正規 URL で `:id_short-:slug` に利用。
- `is_test_board`: E2E 用ボードに付与し、デフォルトリストの自動シードを抑止。

## lists

```sql
CREATE TABLE public.lists (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  position INTEGER NOT NULL,
  board_id UUID NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  user_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_lists_board ON public.lists(board_id, position ASC);
```

- `user_id` は共有ボード設計のため `NULL` を許容。`getActualUserId` でテストユーザーの場合 `NULL` をセット。
- リストの並び順は `position` だけでなくドラッグ操作時に動的に再計算される。

## cards

```sql
CREATE TABLE public.cards (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT DEFAULT '' NOT NULL,
  list_id UUID NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  board_id UUID NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  user_id UUID NULL,
  position INTEGER NOT NULL,
  tags TEXT[] DEFAULT ARRAY[]::TEXT[],
  due_date TIMESTAMPTZ NULL,
  priority TEXT NOT NULL DEFAULT 'medium', -- enum: low / medium / high
  assignee_id UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  assignee_ids UUID[] DEFAULT ARRAY[]::UUID[], -- Phase 3: 複数担当者対応
  assigned_to TEXT NULL, -- legacy fallback (v0.3 以前のテキスト担当者)
  short_id TEXT UNIQUE,
  id_short INTEGER NULL,
  slug TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cards_list ON public.cards(list_id, position ASC);
CREATE INDEX idx_cards_board ON public.cards(board_id);
CREATE INDEX idx_cards_short_id ON public.cards(short_id);
```

- ショート URL は `createUniqueShortId()`（base62 8 文字）と `slugify()` で生成。
- `id_short` はボード内の連番（例: `1-setup-backlog`）。
- `tags` は Playwright テストで `Array.isArray()` か確認されるため空配列で初期化。
- `assignee_id` は v0.3.1 で追加（単一担当者、後方互換性のため残存）。
- `assignee_ids` は Phase 3 で追加。複数担当者対応の配列フィールド。
- `assigned_to` はレガシー互換用のテキスト列（旧データの移行完了後に削除予定）。

## profiles

```sql
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  avatar_url TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_email ON public.profiles(email);
```

- Supabase Auth からのサインアップ時に Edge Function などで `full_name` / `avatar_url` を同期する想定。
- Playwright/E2E テストでは `profiles` にテストユーザーを upsert して担当者選択を検証する。

## activity_logs

```sql
CREATE TABLE public.activity_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  board_id UUID NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  user_id UUID NULL,
  action TEXT NOT NULL CHECK (action IN ('created','updated','deleted','moved')),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('card','list')),
  entity_id TEXT NULL,
  entity_title TEXT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_activity_logs_board ON public.activity_logs(board_id, created_at DESC);
```

- `logActivity` ヘルパー (`lib/supabase.ts`) がカード/リスト操作時に呼び出される。
- `details` には移動元/先のボード ID などを JSON で保持可能。

## board_members (Phase 3)

```sql
CREATE TYPE member_role AS ENUM ('owner', 'editor', 'commenter', 'viewer');

CREATE TABLE public.board_members (
  board_id UUID NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role member_role NOT NULL DEFAULT 'editor',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (board_id, profile_id)
);

CREATE INDEX idx_board_members_profile ON public.board_members(profile_id);
```

- ボードごとのメンバーと権限を管理。
- `role`: owner（全権限）, editor（編集可）, commenter（コメントのみ）, viewer（読み取りのみ）。
- RLSポリシーで role に基づくアクセス制御を実装。

## board_invites (Phase 3)

```sql
CREATE TABLE public.board_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role member_role NOT NULL DEFAULT 'editor',
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_board_invites_token ON public.board_invites(token);
CREATE INDEX idx_board_invites_email ON public.board_invites(email);
```

- メール招待トークンと有効期限を管理。
- `accepted_at` が NULL の場合は未受諾。

## comments (Phase 3)

```sql
CREATE TABLE public.comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id UUID NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  parent_id UUID NULL REFERENCES public.comments(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  mentions UUID[] DEFAULT ARRAY[]::UUID[], -- メンションされたユーザーのUUID配列
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL, -- ソフトデリート
  idempotency_key TEXT NULL -- 重複防止キー
);

CREATE INDEX idx_comments_card ON public.comments(card_id, created_at ASC);
CREATE INDEX idx_comments_author ON public.comments(author_id);
CREATE INDEX idx_comments_parent ON public.comments(parent_id);
```

- カードに対するコメント。`parent_id` でスレッド形式の返信をサポート。
- `mentions`: @メンションされたユーザーのUUID配列。通知生成に使用。
- `deleted_at`: 削除済みコメントはソフトデリートで履歴を保持。

## notifications (Phase 3)

```sql
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- 'comment' | 'mention' | 'assignment' など
  payload JSONB NOT NULL, -- 通知の詳細データ
  read_at TIMESTAMPTZ NULL,
  dedupe_key TEXT NULL, -- 重複防止キー (type:recipient_id:comment_id:card_id)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_recipient ON public.notifications(recipient_id, created_at DESC);
CREATE INDEX idx_notifications_dedupe ON public.notifications(dedupe_key);
```

- In-app通知を管理。
- `payload`: カードタイトル、コメント本文、アクター情報などをJSONで格納。
- `dedupe_key`: 同一イベントからの重複通知を防止。

## push_subscriptions (Phase 3)

```sql
CREATE TABLE public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint TEXT UNIQUE NOT NULL,
  p256dh TEXT NOT NULL, -- VAPID公開鍵
  auth TEXT NOT NULL,   -- VAPID認証シークレット
  user_agent TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_sent_at TIMESTAMPTZ NULL,
  failure_count INTEGER DEFAULT 0
);

CREATE INDEX idx_push_subscriptions_profile ON public.push_subscriptions(profile_id);
CREATE INDEX idx_push_subscriptions_endpoint ON public.push_subscriptions(endpoint);
```

- Web Pushブラウザ購読情報を管理。
- `failure_count`: 配信失敗カウント。閾値超過で購読を削除。

## notification_delivery_logs (Phase 3)

```sql
CREATE TABLE public.notification_delivery_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id UUID NULL REFERENCES public.notifications(id) ON DELETE SET NULL,
  subscription_id UUID NULL REFERENCES public.push_subscriptions(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failure', 'retrying')),
  error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_delivery_logs_notification ON public.notification_delivery_logs(notification_id);
CREATE INDEX idx_delivery_logs_subscription ON public.notification_delivery_logs(subscription_id);
```

- Web Push配信の履歴とエラー追跡。
- レート制限の実装にも使用（per-subscription, per-minute）。

## シーケンス & 補助関数

- `lib/board-utils.ts`
  - `createUniqueBoardShortId()`: base58 文字列生成。Supabase 側でも UNIQUE 制約で衝突を防止。
  - `getNextBoardIdShort()`: Supabase RPC または `boards` テーブルから最大値 + 1 を算出。
  - `slugifyBoardName()`: ボード名から URL フレンドリーな slug を生成。
- `lib/card-utils.ts`
  - `createUniqueShortId()`: カード同士でかぶらない short ID を発行。
  - `getNextIdShort(boardId)`: カード用の連番。ボード単位で採番し canonical URL を構築。
- `lib/server/notifications.ts` (Phase 3)
  - `createNotification()`: 通知生成ヘルパー。quiet hours、dedupe_keyを処理。
  - `isInQuietHours()`: ユーザーのタイムゾーンでquiet hours判定。

## RLS ポリシー概要

Phase 3では `board_members` テーブルを使用したロールベースのアクセス制御を実装しています。

### Boards

```sql
ALTER TABLE public.boards ENABLE ROW LEVEL SECURITY;

-- ボードメンバーのみアクセス可能
CREATE POLICY "Board members can view boards"
  ON public.boards FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.board_members
      WHERE board_id = boards.id AND profile_id = auth.uid()
    )
  );

-- Owner のみ更新可能
CREATE POLICY "Board owners can update boards"
  ON public.boards FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.board_members
      WHERE board_id = boards.id AND profile_id = auth.uid() AND role = 'owner'
    )
  );
```

### Cards & Lists

```sql
-- Editor 以上がカード・リストを作成・編集可能
CREATE POLICY "Board editors can manage cards"
  ON public.cards FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.board_members
      WHERE board_id = cards.board_id
        AND profile_id = auth.uid()
        AND role IN ('owner', 'editor')
    )
  );

-- Commenter 以上がカードを閲覧可能
CREATE POLICY "Board members can view cards"
  ON public.cards FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.board_members
      WHERE board_id = cards.board_id AND profile_id = auth.uid()
    )
  );
```

### Comments (Phase 3)

```sql
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

-- ボードメンバーはコメントを閲覧可能
CREATE POLICY "Board members can view comments"
  ON public.comments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.cards c
      JOIN public.board_members bm ON bm.board_id = c.board_id
      WHERE c.id = comments.card_id AND bm.profile_id = auth.uid()
    )
  );

-- Commenter 以上がコメントを作成可能
CREATE POLICY "Board members can create comments"
  ON public.comments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.cards c
      JOIN public.board_members bm ON bm.board_id = c.board_id
      WHERE c.id = comments.card_id
        AND bm.profile_id = auth.uid()
        AND bm.role IN ('owner', 'editor', 'commenter')
    )
  );

-- 自分のコメントのみ更新・削除可能
CREATE POLICY "Users can update their own comments"
  ON public.comments FOR UPDATE
  USING (author_id = auth.uid());
```

### Notifications (Phase 3)

```sql
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- 自分宛ての通知のみ閲覧・更新可能
CREATE POLICY "Users can view their own notifications"
  ON public.notifications FOR SELECT
  USING (recipient_id = auth.uid());

CREATE POLICY "Users can update their own notifications"
  ON public.notifications FOR UPDATE
  USING (recipient_id = auth.uid());
```

## データ初期化フロー

1. ログイン後、`getBoardById` → メインボードを読み込み
2. `fetchBoardInitialData` で `lists` と `cards` を取得
3. `initializeDefaultLists` が、テストボード以外で空の場合に `To Do / In Progress / Done` をシード
4. クライアントで `saveToStorage` により localStorage にキャッシュ

## テスト用フラグ `is_test_board`

Playwright テストでは毎回一意のボードを作成し `is_test_board: true` をセットしています。これにより、アプリ起動時のデフォルトリスト自動シードが抑止され、テストデータを完全にコントロールできます（`docs/detail/testing.md` 参照）。

---

最新更新日: 2025-10-23 (Phase 3 完了)
