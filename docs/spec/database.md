# Database Schema (Timeline 2025-11)

Taesk のデータ層は Supabase (PostgreSQL) 上にあり、Team を上位コンテナ、Board を Team 配下の作業単位として扱います。Timeline UI 向けの `due_*` フィールド群に加え、Team 権限、Board 権限、通知、Push 配信ログ、A/B バケット管理をサポートします。

## テーブル一覧

| テーブル | 役割 | Timeline との関係 |
| --- | --- | --- |
| `teams` | Team 本体。メンバーと Board を束ねる上位コンテナ | `/board` bootstrap, Team Settings |
| `team_members` | Team メンバーと Team role | Team Settings, Board 作成可否判定 |
| `boards` | ボード本体。short URL / slug 管理 | `/board` の初期ボードやボードピッカーに利用 |
| `board_members` | メンバーと権限 | Timeline API の認可、ShareDialog |
| `lists` | 旧 Kanban のリスト（A/B では未使用） | カードの `list_id` 互換のため残存 |
| `cards` | Timeline/A/B のカード | `due_start`, `due_end`, `due_bucket`, `due_bucket_position`, `checked`, `checklist`, `content`, `excerpt` など |
| `comments` | カードコメント | CardModal / CommentsPanel |
| `notifications`, `notification_preferences`, `notification_delivery_logs`, `push_subscriptions` | 通知系テーブル | NotificationSettings / Web Push |
| `activity_logs` | 操作監査 | ボードレベルでの変更追跡 |
| `google_calendar_accounts` | Google OAuth 連携 | カレンダー同期の認可情報 |
| `calendar_sync` | カードと Google 予定の紐付け | 二重同期の防止、双方向更新 |
| `profiles` | Supabase Auth ユーザーの拡張 | タイムライン開始時刻（`timeline_start_hour`）など |
| `board_invites` | メール招待 | ShareDialog (ロールアウト中) |

## ER 図（簡易）

```
teams 1 ── n boards 1 ── n cards ──┬─ n comments
  │            │                   │
  │            │                   └─ n card.assignee_ids → profiles
  │            ├─ n board_members ── profiles (role: owner/editor/commenter/viewer)
  │            ├─ n activity_logs
  │            └─ n board_invites
  └─ n team_members ── profiles (role: owner/admin/member/guest)

profiles 1 ── n comments (author_id)
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
  day_range INTEGER DEFAULT 2,
  list_range INTEGER DEFAULT 30,
  list_window_before_days INTEGER DEFAULT 15,
  list_window_after_days INTEGER DEFAULT 15,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- `short_id` + `slug` は `/b/:short_id/:slug` や `/@modal/(...)c` などで使用。
- `/board` は Team/Board bootstrap 入口であり、最後に使った Board、またはアクセス可能な Board へ遷移する。未所属時は default Team + default Board を生成する。
- `is_test_board` が true の場合、E2E 専用ボードとして扱い、初期データを制限。
- `day_range` は Timeline の表示日数（1〜7日）を制御。
- List は `list_window_before_days` / `list_window_after_days` を正本として扱い、`list_range` は `before + after + 1` の導出値を保持。

## board_members

```sql
CREATE TYPE member_role AS ENUM ('owner', 'editor', 'commenter', 'viewer');

CREATE TABLE public.board_members (
  board_id UUID NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role member_role NOT NULL DEFAULT 'editor',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (board_id, profile_id)
);
```

- Board access は Team 配下で成立するが、最終的な認可判定の正本は `board_members` である。
- Timeline API (`GET /api/boards/:id/timeline`) は `board_members` に存在しない場合 403 を返す。
- ShareDialog で role 編集・削除を行い、RLS ポリシーが連動。
- Board 招待受諾時、Team 未所属ユーザーは Team に `guest` として自動追加される。

## lists

リストテーブルは Kanban 時代から継続し、`cards.list_id` や API 互換のために使用します。Timeline では A/B 管理を `due_bucket` で行うため、`lists` 自体は UI に登場しません。

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
```

## cards

```sql
CREATE TABLE public.cards (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  list_id UUID NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  board_id UUID NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  user_id UUID NULL,
  position INTEGER NOT NULL,
  tags TEXT[] DEFAULT ARRAY[]::TEXT[],
  due_date TIMESTAMPTZ NULL, -- JST 変換の基準日
  due_start TIME WITHOUT TIME ZONE NULL,
  due_end TIME WITHOUT TIME ZONE NULL,
  due_bucket TEXT NULL
    CHECK (due_bucket IS NULL OR due_bucket IN ('a', 'b')),
  due_bucket_position DOUBLE PRECISION NULL,
  checked BOOLEAN NOT NULL DEFAULT FALSE,
  checklist JSONB NOT NULL DEFAULT jsonb_build_object('version', 1, 'lines', '[]'::jsonb),
  content JSONB NOT NULL DEFAULT '[]'::jsonb,
  excerpt TEXT NOT NULL DEFAULT '',
  duration INTEGER DEFAULT 60,
  start_reminder_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  start_reminder_minutes INTEGER NOT NULL DEFAULT 0,
  end_reminder_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  end_reminder_minutes INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NULL,
  assignee_id UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  assignee_ids UUID[] DEFAULT ARRAY[]::UUID[],
  assigned_to TEXT NULL, -- legacy fallback
  short_id TEXT UNIQUE,
  id_short INTEGER NULL,
  slug TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cards_board ON public.cards(board_id);
CREATE INDEX idx_cards_board_due_date ON public.cards(board_id, due_date);
CREATE INDEX idx_cards_due_bucket_position ON public.cards(due_bucket, due_bucket_position DESC NULLS LAST);
```

- `due_date` があり `due_start`/`due_end` が両方ある場合は Timeline イベントとして表示。  
- `due_date` があり `due_start`/`due_end` が未設定の場合は A/B に入り、`due_bucket` と `due_bucket_position` で並ぶ。  
- `due_date` が過去日で `checked = false` のカードは Overdue shortcut 投影にも出る。visible range 内では本体の `events` / `abBuckets` と重複表示される。  
- `due_bucket` が未指定の場合は UI 側で `b` をフォールバックとして扱う。  
- `due_bucket_position` は降順で並ぶ floating number。DnD 時に `Date.now()` を使いユニーク値を割り当てる。
- `checked` は Timeline の完了チェックボックスや A/B カードにもそのまま反映される。

## comments

```sql
CREATE TABLE public.comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  card_id UUID NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
  board_id UUID NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  parent_id UUID NULL REFERENCES public.comments(id),
  body TEXT NOT NULL,
  mentions UUID[] DEFAULT ARRAY[]::UUID[],
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_comments_card ON public.comments(card_id, created_at ASC);
```

- Timeline の CardModal から投稿・編集・削除される。`useCommentsStore` が `mentions` を参照し @mention 通知を作成。

## notifications / preferences / delivery logs

- `notifications`: In-app 通知のメタデータ（種類、card_id、既読フラグ、payload JSON）
- `notification_preferences`: ユーザー単位で通知方式（in-app, push）、quiet hours、音声設定を保持
- `push_subscriptions`: Web Push endpoint, keys, metadata
- `notification_delivery_logs`: Edge Function からの配信結果を保存

これらは Timeline ヘッダーの NotificationSettings / NotificationsBell で読み書きされる。

## activity_logs

ボード内の CRUD 操作を監査し、Timeline/A/B 操作もここで追跡できる。`details` JSON に `due_bucket` や時刻変更の差分を格納可能。

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
```

## Google カレンダー連携

Google カレンダーとの同期や通知のために、以下のテーブル群を使用します。

- `google_calendar_accounts`: ユーザーごとの Google OAuth トークン、接続ステータス、対象カレンダーID を保持。
- `google_calendar_events`: 同期対象の Google 予定のキャッシュ。
- `calendar_sync`: Taesk の `card_id` と Google の `event_id` を1対1でリンク。`status` が `active` の場合に双方向同期が動作。
- `reminders_queue`: リマインダー通知（Push/Web）の配信予定キュー。
- `card_content_history`: カード本文（`content`）の変更履歴を保存。

### profiles 拡張

```sql
ALTER TABLE public.profiles ADD COLUMN timeline_start_hour INTEGER DEFAULT 0;
```
- `timeline_start_hour`: タイムライン表示の開始時刻（0-23）。デフォルトは 0 (00:00)。

## Timeline API

- エンドポイント: `GET /api/boards/[boardId]/timeline`
- ロジック:
  1. Supabase SSR クライアントで `auth.getUser()` → 認可
  2. Team 配下の Board access を前提に、`board_members` をチェック（owner/editor/commenter/viewer 全員許可）
  3. `cards` を `board_id` で取得し、`due_date` + `due_start`/`due_end` の有無で events/abBuckets を振り分け
  4. 過去日かつ未完了のカードは `overdue` shortcut にも載せ、visible range 内のカードは本体の `events` / `abBuckets` にも載せる
  5. `events` / `abBuckets` / `overdue` / `serverNow` を整形し JSON で返却
- `days` は `start`/`range` を元に JST (+09:00) で生成（1〜7日）。

## Migrations

- `20251113090000_add_due_fields.sql`: `due_start`, `due_end`, `due_bucket` などを追加（初期）
- `20251117091500_add_due_bucket_position.sql`: `due_bucket_position` と降順インデックスを追加
- `20251125000000_update_bucket_schema.sql`: `due_bucket` を `a|b` へ統一（`due_channel` を削除）
- `20251129090000_add_checklist_to_cards.sql`: `checklist` 追加、`description` 削除
- `20251220090000_add_card_content.sql`: `content` / `excerpt` 追加
- `20260107000000_add_duration_to_cards.sql`: `duration` 追加

## 参考: 型定義

`lib/supabase.ts` で TypeScript 型を定義。Timeline UI は `DueBucket`, `Card` 型を直接 import している。

```ts
export type DueBucket = 'a' | 'b';

export interface Card {
  id: string;
  title: string;
  due_start: string | null;
  due_end: string | null;
  due_bucket: DueBucket | null;
  due_bucket_position: number | null;
  // ... (省略)
}
```

これらの型を通じて API と UI が統一され、TimelineBoardPage 内の DnD・CardModal・Playwright テストが同じフィールド定義を参照できるようになっています。
