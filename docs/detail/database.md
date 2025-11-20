# Database Schema (Timeline 2025-11)

Taesk のデータ層は Supabase (PostgreSQL) 上にあり、Timeline UI 向けの `due_*` フィールド群を中心に設計されています。ボード → カード → コメントのコア構造に加え、ボード権限・通知・Push 配信ログ・A/B バケット管理などをサポートします。

## テーブル一覧

| テーブル | 役割 | Timeline との関係 |
| --- | --- | --- |
| `boards` | ボード本体。short URL / slug 管理 | `/board` の初期ボードやボードピッカーに利用 |
| `board_members` | メンバーと権限 | Timeline API の認可、ShareDialog |
| `lists` | 旧 Kanban のリスト（A/B では未使用） | 既存 API 互換のため残存 |
| `cards` | Timeline/A/B/List-only のカード | `due_channel`, `due_start`, `due_end`, `due_bucket`, `due_bucket_position`, `checked` など |
| `comments` | カードコメント | CardModal / CommentsPanel |
| `notifications`, `notification_preferences`, `notification_delivery_logs`, `push_subscriptions` | 通知系テーブル | NotificationSettings / Web Push |
| `activity_logs` | 操作監査 | ボードレベルでの変更追跡 |
| `profiles` | Supabase Auth ユーザーの拡張 | CardModal の担当者、Mention の候補 |
| `board_invites` | メール招待 | ShareDialog (ロールアウト中) |

## ER 図（簡易）

```
boards 1 ── n cards ──┬─ n comments
  │                   │
  │                   └─ n card.assignee_ids → profiles
  ├─ n board_members ── profiles (role: owner/editor/commenter/viewer)
  ├─ n activity_logs
  └─ n board_invites

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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- `short_id` + `slug` は `/b/:short_id/:slug` や `/@modal/(...)c` などで使用。
- `MAIN_BOARD_ID` (0000...0001) が `/board` のデフォルト対象。
- `is_test_board` が true の場合、E2E 専用ボードとして扱い、初期データを制限。

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

- Timeline API (`GET /api/boards/:id/timeline`) は `board_members` に存在しない場合 403 を返す。
- ShareDialog で role 編集・削除を行い、RLS ポリシーが連動。

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
  description TEXT DEFAULT '' NOT NULL,
  list_id UUID NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  board_id UUID NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  user_id UUID NULL,
  position INTEGER NOT NULL,
  tags TEXT[] DEFAULT ARRAY[]::TEXT[],
  due_date TIMESTAMPTZ NULL, -- JST 変換の基準日
  due_start TIME WITHOUT TIME ZONE NULL,
  due_end TIME WITHOUT TIME ZONE NULL,
  due_channel TEXT NOT NULL DEFAULT 'list-only'
    CHECK (due_channel IN ('timeline', 'ab-list', 'list-only', 'archived')),
  due_bucket TEXT NULL
    CHECK (due_bucket IS NULL OR due_bucket IN ('today_a', 'today_b', 'tomorrow_a', 'tomorrow_b')),
  due_bucket_position DOUBLE PRECISION NULL,
  priority TEXT NOT NULL DEFAULT 'medium', -- enum: low / medium / high
  checked BOOLEAN NOT NULL DEFAULT FALSE,
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

- `due_channel` でカードの所属を判別:  
  - `timeline`: Today/Tomorrow の時間軸へ表示。`due_start` / `due_end` の差からブロック高さを算出。  
  - `ab-list`: Today/Tomorrow の A/B リストへ表示。`due_bucket` と `due_bucket_position` を使用。  
  - `list-only`: 旧 Kanban のみで使用する遺産。Timeline API では除外。  
  - `archived`: Timeline/A/B には表示されない。  
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

ボード内の CRUD 操作を監査し、Timeline/A/B 操作もここで追跡できる。`details` JSON に `due_channel` 変更や `due_bucket` の変遷を格納可能。

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

## Timeline API

- エンドポイント: `GET /api/boards/[boardId]/timeline`
- ロジック:
  1. Supabase SSR クライアントで `auth.getUser()` → 認可
  2. `board_members` をチェック（owner/editor/commenter/viewer 全員許可）
  3. `cards` を `board_id` + `due_channel`/`due_bucket` で取得  
     - 42703 (column missing) を検知した場合、`due_*` カラムがない古い DB に向けて互換レスポンスを返す
  4. `events` / `abBuckets` / `serverNow` を整形し JSON で返却
- `days` は常に Today/Tomorrow の 2 日分。`formatDateJst` が JST (+09:00) で日付を生成。

## Migrations

- `20251113090000_add_due_fields.sql`: `due_start`, `due_end`, `due_channel`, `due_bucket`、チェック制約、`idx_cards_board_due_date` を追加
- `20251117091500_add_due_bucket_position.sql`: `due_bucket_position` と降順インデックスを追加
- 以前の Kanban 用マイグレーションも `supabase/migrations/` に残っているが、Timeline で必要なのは上記 2 つ + `20251111090000_add_card_checked_flag.sql`

## 参考: 型定義

`lib/supabase.ts` で TypeScript 型を定義。Timeline UI は `DueChannel`, `DueBucket`, `Card` 型を直接 import している。

```ts
export type DueChannel = 'timeline' | 'ab-list' | 'list-only' | 'archived';
export type DueBucket = 'today_a' | 'today_b' | 'tomorrow_a' | 'tomorrow_b';

export interface Card {
  id: string;
  title: string;
  due_channel: DueChannel;
  due_start: string | null;
  due_end: string | null;
  due_bucket: DueBucket | null;
  due_bucket_position: number | null;
  // ... (省略)
}
```

これらの型を通じて API と UI が統一され、TimelineBoardPage 内の DnD・CardModal・Playwright テストが同じフィールド定義を参照できるようになっています。
