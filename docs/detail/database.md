# Database Schema (2025-10-15)

Taesk は Supabase（PostgreSQL）を使用し、ボードを中心にリスト・カードがぶら下がる 3 層構造です。追加で活動履歴やオフライン同期キュー向けのテーブルを利用します。

## テーブル一覧

| テーブル | 役割 | 補足 |
|----------|------|------|
| `boards` | ボード本体 | ショートURL・正規URL用の `short_id` / `id_short` / `slug` を保持 |
| `lists`  | ボード内のリスト | ボード FK、表示順 (`position`) を管理 |
| `cards`  | リスト内のカード | タグ、期限、優先度、担当者、ショートURLを持つ |
| `activity_logs` | 監査ログ | 操作履歴（作成/更新/削除/移動）を記録 |
| `profiles` | ユーザープロファイル | Supabase Auth ユーザー情報の拡張・担当者選択に利用 |

`profiles` テーブルは Supabase の `auth.users` を拡張し、担当者表示名やアバターなどのメタデータを保持します。共有ボード運用のため `user_id` はこれまで同様 `NULL` を許容します。

## エンティティ関係図

```
boards 1 ── n lists 1 ── n cards
   │                    │
   └─────── n activity_logs (board 単位の監査)
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
- `assignee_id` は v0.3.1 で追加。`profiles` テーブルを参照して担当者の ID を保持する。
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

## シーケンス & 補助関数

- `lib/board-utils.ts`
  - `createUniqueBoardShortId()`: base58 文字列生成。Supabase 側でも UNIQUE 制約で衝突を防止。
  - `getNextBoardIdShort()`: Supabase RPC または `boards` テーブルから最大値 + 1 を算出。
  - `slugifyBoardName()`: ボード名から URL フレンドリーな slug を生成。
- `lib/card-utils.ts`
  - `createUniqueShortId()`: カード同士でかぶらない short ID を発行。
  - `getNextIdShort(boardId)`: カード用の連番。ボード単位で採番し canonical URL を構築。

## RLS ポリシー概要

現状は「ログイン済みユーザーは全データにアクセス可」という共有ボード運用です。実際のポリシー例：

```sql
ALTER TABLE public.boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage all boards"
  ON public.boards FOR ALL
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can manage all lists"
  ON public.lists FOR ALL
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can manage all cards"
  ON public.cards FOR ALL
  USING (auth.role() = 'authenticated');
```

将来的にボード単位の権限を導入する際は `board_members` / `board_roles` テーブルを追加し、`auth.uid()` による紐付けへ移行予定です。

## データ初期化フロー

1. ログイン後、`getBoardById` → メインボードを読み込み
2. `fetchBoardInitialData` で `lists` と `cards` を取得
3. `initializeDefaultLists` が、テストボード以外で空の場合に `To Do / In Progress / Done` をシード
4. クライアントで `saveToStorage` により localStorage にキャッシュ

## テスト用フラグ `is_test_board`

Playwright テストでは毎回一意のボードを作成し `is_test_board: true` をセットしています。これにより、アプリ起動時のデフォルトリスト自動シードが抑止され、テストデータを完全にコントロールできます（`docs/detail/testing.md` 参照）。

---

最新更新日: 2025-10-15
