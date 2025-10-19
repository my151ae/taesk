# 04-API Routes リファクタリング（精査・修正版）
**作成日**: 2025-10-19
**レビュー対象**: 03-Migrate-to-API-Routes.md
**目的**: クライアントの直接 Supabase アクセスを廃止し、API Route 経由へ完全移行。セキュリティ、可観測性、保守性を向上。

---

## この版での主な修正点（03 からの差分）
- **抜け漏れ補完**:
  - 🔹 **カードの一括並び替え / 複数更新**エンドポイントを追加（`PATCH /cards/reorder` または `PATCH /cards/sync`）
  - 🔹 **ボード一覧/詳細/更新/削除**の REST を定義（ヘッダーのボード切替で必要）
  - 🔹 **Idempotency-Key** を利用した**オフライン再送の二重適用防止**（任意→推奨）
- **命名とHTTP動詞の正規化**:
  - `PUT /lists/sync` → **`PATCH /lists/reorder`（推奨）**：部分更新・順序更新を意図
  - 単一更新は `PATCH /.../:id`、一括は `PATCH /.../reorder|sync`
- **サーバー副作用の集約**:
  - クライアントからの **`/activity` 直呼び出しを廃止**。リスト/カード作成・更新・削除時に**サーバー側で自動記録**
- **権限・認証の徹底**:
  - すべての Route で **Cookie セッション → Supabase RLS** を通す（service_role は原則不使用）
  - **ボードメンバー検証**（RLS だけに依存せず、アプリ側で 403 明示返却）
- **I/O の共通化**:
  - リクエスト/レスポンスを **Zod スキーマ**でバリデーション
  - 統一エラー形式 `{ "error": { "code": "", "message": "", "details": {} } }` とステータスコード（201/204/400/401/403/404/409/422/500）
- **パフォーマンス/UX**:
  - 集約取得 `GET /boards/:id/data` に **最小列選択**・**position ソート**・**no-store** ヘッダ
  - 並び替えは **差分のみ送信**（全件よりも更新対象だけの upsert 配列を推奨）

---

## スコープ
- 対象: DB CRUD（boards/lists/cards/activity_logs）と集約取得
- 除外: 認証 UI/サインイン/サインアウト（Auth は現状通りでOK）
- 依存: Supabase RLS / Realtime / App Router（`app/api/**/route.ts`）

---

## API 設計（修正版）

### 0) 共通
- 認証: Cookie セッションを `createRouteHandlerClient` 等で取得し RLS 適用
- 権限: `board_id` に対し **メンバーシップ検証** → NG は 403
- Header:
  - `Idempotency-Key: <uuid>`（任意→**推奨**。オフライン再送の二重適用防止）
  - `Cache-Control: no-store`（認証ページ）
- バリデーション: `zod` で `req.json()` を検証（例: `CardUpdateSchema`）
- ログ: 成功時のみ activity をサーバー側で記録（エラー時は記録しない）

---

### 1) Boards
- **GET `/api/boards`** … ユーザーが参照可能なボード一覧
- **POST `/api/boards`** … 新規作成（名前/説明）→ **201**
- **GET `/api/boards/:boardId`** … 単一取得
- **PATCH `/api/boards/:boardId`** … 名前変更などの部分更新
- **DELETE `/api/boards/:boardId`** … CASCADE（必要なら）→ **204**
  - サーバーで activity: `board.deleted` を自動記録

> 既存の 03 では `POST /api/boards` のみ明記。**一覧/詳細/更新/削除**を明示追加。

---

### 2) Aggregation
- **GET `/api/boards/:boardId/data`**
  - 返却: `{ "lists": List[], "cards": Card[] }`
  - 実装要点:
    - `select` で必要最小列のみ（`id, title, position, ...`）
    - `order('position')`
    - メンバー検証→403、未認証→401
    - `Cache-Control: no-store`

---

### 3) Lists
- **POST `/api/boards/:boardId/lists`** … 作成（デフォルト作成にも使用）→ **201**
- **PATCH `/api/boards/:boardId/lists/:listId`** … 単一の部分更新（タイトル/position など）
- **DELETE `/api/boards/:boardId/lists/:listId`** → **204**
- **PATCH `/api/boards/:boardId/lists/reorder`**（**03の `PUT /lists/sync` を置換**）
  - 入力: `{ "updates": [ { "id": string, "position": number, "updated_at"?: string } ] }`
  - 作用: `upsert(updates)` で一括適用（差分のみ推奨）
  - 競合: position のユニーク制約がある場合は 409 を返却
  - すべて成功時に activity: `list.reordered`

---

### 4) Cards
- **POST `/api/boards/:boardId/cards`** … 追加 → **201**
- **PATCH `/api/boards/:boardId/cards/:cardId`** … 単一の部分更新（タイトル/説明/タグ/期日/担当/`list_id` 変更含む）
- **DELETE `/api/boards/:boardId/cards/:cardId`** → **204**
- **PATCH `/api/boards/:boardId/cards/reorder`**（**新規**）
  - 入力: `{ "updates": [ { "id": string, "list_id": string, "position": number, "updated_at"?: string } ] }`
  - 作用: 複数カードの並び替え/リスト間移動を一括 upsert
  - サーバーで activity: `card.moved` / `card.reordered` を自動記録

> 03 では **カードの一括更新が未定義**だったため追加。D&D とオフライン同期の両方を安全に処理可能。

---

### 5) Activity（自動化方針）
- **エンドポイントは原則不要**。各 CRUD の成功時にサーバー側で `activity_logs` へ insert。
- どうしても分離したい場合のみ **`POST /api/boards/:boardId/activity`** を残すが、クライアントからの直呼びは避ける。

---

### 6) オフライン同期 / 冪等性
- クライアントの同期キューからは**単一更新**は `PATCH /.../:id`、**複数更新**は `PATCH /.../reorder|sync` を使用
- **Idempotency-Key** をヘッダで送る（`uuid`）。サーバーは key を `idempotent_requests(board_id, key)` に保存して**重複リクエストを弾く**（2xx を再返却）
- 完全なトランザクションが必要なら、将来的に **RPC（SQL関数）`apply_actions(board_id, jsonb, key)`** を検討

---

## 実装スケッチ（Next.js App Router）

```ts
// app/api/_lib/supabase-server.ts
import { cookies } from 'next/headers'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'

export function supabaseServer() {
  return createRouteHandlerClient({ cookies })
}
```

```ts
// app/api/boards/[boardId]/cards/reorder/route.ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/app/api/_lib/supabase-server'
import { assertMember } from '@/app/api/_lib/authz' // board権限チェック

const Body = z.object({
  updates: z.array(z.object({
    id: z.string().uuid(),
    list_id: z.string().uuid(),
    position: z.number().int().min(0),
    updated_at: z.string().datetime().optional(),
  })).min(1),
})

export async function PATCH(_: Request, { params }: { params: { boardId: string }}) {
  const supabase = supabaseServer()
  const { boardId } = params

  // 認証 & 権限
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Login required' }}, { status: 401 })
  const ok = await assertMember(supabase, boardId, user.id)
  if (!ok) return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Not a board member' }}, { status: 403 })

  // バリデーション
  const body = await _.json()
  const parsed = Body.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: { code: 'INVALID_BODY', message: 'Validation failed', details: parsed.error.flatten() }}, { status: 422 })

  const updates = parsed.data.updates.map(u => ({ ...u, board_id: boardId }))

  // 一括 upsert（差分だけ送る前提）
  const { error } = await supabase.from('cards').upsert(updates)
  if (error) return NextResponse.json({ error: { code: 'DB_ERROR', message: error.message }}, { status: 500 })

  // activity はここで記録（省略）
  return NextResponse.json({ ok: true }, { status: 200 })
}
```

---

## 置換マップ（コード対応）
| 現行 直叩き（例） | 新 API | 備考 |
|---|---|---|
| `from('lists').select()` | `GET /api/boards/:id/data` | 一括取得に統合 |
| `from('activity_logs').insert()` | **削除**（サーバー自動記録） | |
| `from('lists').insert()` | `POST /api/boards/:id/lists` | デフォルト作成も同一 |
| `from('cards').upsert(updatedCard)` | `PATCH /api/boards/:id/cards/:cardId` | 単一更新 |
| `from('lists').upsert([...])` | `PATCH /api/boards/:id/lists/reorder` | 一括（差分のみ） |
| `from('lists').delete().eq('id', id)` | `DELETE /api/boards/:id/lists/:listId` | |
| `from('boards').insert()` | `POST /api/boards` | |
| `from('cards').delete().eq('id', id)` | `DELETE /api/boards/:id/cards/:cardId` | |
| （**新規**） | `PATCH /api/boards/:id/cards/reorder` | D&D/同期キュー用 |

---

## 受け入れ基準
- クライアントから **Supabase 直接呼び出しが 0 件**（静的コード検索で `supabase.from` がヒットしない）
- 主要操作（作成/編集/削除/並び替え/リスト間移動/集約取得）が **すべて API Route 経由で成功**
- 未認証は 401、未権限は 403 が返る
- オフライン再送でも**重複適用が起きない**（Idempotency-Key で確認）
- Realtime が引き続き反映される（書き込みは API→DB→Realtime 経由）

---

## 実施順（所要 4〜5h 目安）
1. `GET /boards/:id/data` を先行実装（CORS 即解消）
2. Lists/単一 Cards の `POST/PATCH/DELETE` を実装
3. **`PATCH /cards/reorder` と `PATCH /lists/reorder`** を実装（差分 upsert）
4. Activity のサーバー副作用化（クライアントからの `/activity` 呼び出し削除）
5. クライアント置換 & 動作確認（E2E 更新）
6. 静的検索で `supabase.from` の残骸をゼロ化 → 完了

---

## メモ（実装 Tips）
- `position` 更新は **整数かつ 0 起点**で統一。欠番許容（UI で順序のみ意味）
- `updated_at` はサーバー側で `now()` に正規化（クライアント値は任意）
- 403 と 404 の使い分け：対象が存在しない場合でも**非メンバーには 403**を優先（情報漏えい防止）
- 大量更新時は upsert 配列を **100件程度でバッチ**に分割（必要時）

---

## TODO（チェックリスト）
- [ ] `GET /boards/:id/data`
- [ ] `POST /boards/:id/lists`
- [ ] `PATCH /boards/:id/lists/:listId`
- [ ] `DELETE /boards/:id/lists/:listId`
- [ ] **`PATCH /boards/:id/lists/reorder`**
- [ ] `POST /boards/:id/cards`
- [ ] `PATCH /boards/:id/cards/:cardId`
- [ ] `DELETE /boards/:id/cards/:cardId`
- [ ] **`PATCH /boards/:id/cards/reorder`**
- [ ] **Activity 自動記録（各 CRUD 内で）**
- [ ] `POST /boards` / `GET /boards` / `GET /boards/:id` / `PATCH /boards/:id` / `DELETE /boards/:id`（必要に応じて）
- [ ] クライアントコードの置換（`fetch` 化）
- [ ] E2E テスト更新

---

### 付録: エラー応答例
```json
{
  "error": {
    "code": "INVALID_BODY",
    "message": "Validation failed",
    "details": { "issues": [] }
  }
}
```

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "Not a board member"
  }
}
```
