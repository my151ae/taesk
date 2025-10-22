# ボード：リスト並び替え仕様書（Phase2 / 実装準拠）
**版**: v1.1 / **日付**: 2025-10-23 / **作成**: 松本Ops → 改訂: Codex

**対象**: `PATCH /api/boards/:boardId/lists/reorder`

**関連**:
- カード並び替え `PATCH /api/boards/:boardId/cards/reorder`
- リスト再採番 `POST /api/boards/:boardId/lists/renumber`
- カード再採番 `POST /api/boards/:boardId/cards/renumber`

---

## 0. 背景・目的
- Phase2 実装（Supabase RPC + advisory lock + CTE 一括更新）が既に稼働。逐次 update + アプリ側ロールバックという旧仕様は廃止済み。
- UI は `@dnd-kit` + 楽観更新でドラッグ＆ドロップを主経路としており、キーボード操作は `KeyboardSensor` 標準挙動（Space → 矢印で移動）に依存。`Shift+Arrow` ベースの独自ショートカットや ARIA 強化は未着手。
- position は UI 側で 0,1,2... の連番を付与し、必要に応じてリナンバリング RPC がギャップ採番（1000/10刻み）へ整える設計。UI 側関数 `normalizePositions` 等は未実装。
- 本仕様書は **現行実装とテストの挙動を反映** し、不足しているアクセシビリティ要件・テスト網羅をギャップとして明示する。

---

## 1. 用語
- **リスト**: `lists(id uuid, board_id uuid, position int, title text, ...)`
- **position**: 表示順序。UI 側は 0 起点連番、リナンバリング RPC がギャップ（1000, 1010, ...）を再付与。
- **更新レコード (update)**: `{ id: UUID, position: number }` の配列要素。クロスボード更新は不可。

---

## 2. 不変条件
1. 同一 `board_id` 内で `list.id` は一意。
2. リクエスト単位で `updates[].id` および `updates[].position` に重複なし。
3. `updates[]` に含まれるすべてのレコードは URL の `:boardId` に属する。
4. API は `position` 以外の列を書き換えない（Supabase RPC 側でも `position` のみ更新）。
5. 応答は冪等: 同一 payload を再送してもサーバ状態が変わらない。

---

## 3. API 仕様
### 3.1 エンドポイント
`PATCH /api/boards/:boardId/lists/reorder`

### 3.2 リクエスト
```json
{
  "updates": [
    { "id": "uuid-list-a", "position": 0 },
    { "id": "uuid-list-b", "position": 1 }
  ]
}
```
- `updates` は 1 件以上必須。
- `id`: UUID 文字列（`z.string().uuid()`）。
- `position`: 整数（`z.number().int()`）。UI は 0 起点。RPC は受け取った値をそのまま書き込む。
- UI からは `title` 等の余剰プロパティも送信されるが、Zod が strip するため無視される。

### 3.3 成功レスポンス（200）
```json
{
  "updated": 2,
  "unchanged": 1,
  "durationMs": 34
}
```
- `updated`: 実際に位置が書き換わった件数（Supabase RPC の `updated_count`）。
- `unchanged`: `updates.length - updated`。
- `durationMs`: API 内で計測した処理時間（ms）。

### 3.4 失敗レスポンス
- スキーマ/型エラー（Zod 失敗）
```json
{
  "error": {
    "code": "INVALID_BODY",
    "message": "Validation failed",
    "details": { ...Zod error flatten... }
  }
}
```
- 論理バリデーション（重複・未知 ID・クロスボード）
```json
{
  "error": { "code": "VALIDATION_ERROR", "message": "Bad Request" },
  "issues": [
    { "code": "DUPLICATE_ID", "id": "..." },
    { "code": "DUPLICATE_POSITION", "id": "..." },
    { "code": "UNKNOWN_ID", "id": "..." },
    {
      "code": "CROSS_BOARD",
      "id": "...",
      "expected_board_id": "...",
      "actual_board_id": "..."
    }
  ]
}
```
- データベース系（RPC 失敗・Supabase エラー）
```json
{
  "error": { "code": "DB_ERROR", "message": "..." }
}
```
- 想定外の例外
```json
{
  "error": { "code": "INTERNAL_ERROR", "message": "Internal server error" }
}
```

### 3.5 エラーコード備考
- `INVALID_BODY` と `VALIDATION_ERROR` は**フォーマットが異なる**ため、クライアントは `error.code` を分岐キーに使用すること。
- `issues` 配列は重複・未知 ID などが複数同時に発生した場合も全件返す。

---

## 4. サーバ処理フロー（実装準拠）
1. Supabase Auth でログイン確認。未ログインは 401 `UNAUTHENTICATED`。
2. `board_members` から `owner`/`editor` 権限を確認。権限不足は 403 `FORBIDDEN`。
3. リクエスト JSON を `ReorderListsSchema` で検証。
4. `updates` から `id`/`position` の Set を構築し、重複検知。
5. Supabase で該当リストを `select('id, board_id, position')`。未知 ID／クロスボードを `issues` に格納。
6. バリデーションエラーがあれば 400 `VALIDATION_ERROR` + `issues`。
7. ボード ID を 32bit にハッシュし、`pg_advisory_xact_lock` 用のキーを生成。
8. `supabase.rpc('reorder_lists_tx', { p_board_id, p_lock_key, p_updates })`
   - 内部では CTE で一括 `UPDATE lists SET position = u.position` を実行。
   - ロックはトランザクションスコープで開放され、部分更新や整合性崩壊は発生しない。
9. `updated_count` を算出し、`unchanged` と `durationMs` を応答。
10. JSON 文字列で構造化ログ出力：
```json
{"event":"lists.reorder","boardId":"...","actorId":"...","updated":N,"unchanged":M,"durationMs":T}
```

---

## 5. UI / クライアント挙動
### 5.1 データモデル
- `KanbanBoardClient.tsx` では `arrayMove` で楽観的に配列を並べ替え、`position = index` を再付与。
- オフライン時は Sync Queue に `UPDATE` を積み、オンライン時は `/lists/reorder` → `/cards/reorder` の順で同期。

### 5.2 キーボード操作（現状）
- `@dnd-kit` の `KeyboardSensor` をそのまま利用。
  - `Space` キーでピックアップ
  - `ArrowLeft` / `ArrowRight`（および上下）で移動候補を変更
  - 再度 `Space` でドロップ
- カスタムショートカット（`Shift+Arrow` / `Ctrl+Shift+Arrow`）やロービング `tabIndex`、`aria-live` 通知は未実装。

### 5.3 DOM / ARIA 状態（ギャップ）
- リストコンテナに `role="list"` 等は付与されていない。
- フォーカス管理はタブ順（自然 DOM）に依存。ドラッグ操作でフォーカスが失われる場合がある。
- 仕様として掲げていたアクセシビリティ要件は**未達**。別途チケット化が必要。

### 5.4 エラー処理
- 失敗時はエラートースト表示。ただしレスポンスの `issues` 内容までは現状サーフェスされない。（ログのみ）
- UI 側でのスナップショット復元ロジックは未整備。ドラッグ失敗時は `boardData` が書き換わったままの場合がある。改善タスク。

---

## 6. Position ギャップとリナンバリング
- 現実装ではドラッグ毎に position = index を付与するため、ギャップはすぐ失われる。
- `POST /lists/renumber` / `POST /cards/renumber`（`renumber_list_positions`, `renumber_card_positions`）が 1000,1010,... のギャップを再付与。
- `supabase/migrations/20251019000001_position_gap_renumbering.sql` にて `detect_position_density` も実装済み（ギャップ ≦2 を検知）。
- 自動トリガーや UI からの呼び出し導線は未実装。運用ドキュメント整備が必要。

---

## 7. 受け入れ基準（更新）
- **A1**: API がトランザクション更新で `updated`/`unchanged` を返却し、DB 整合性を保つ。
- **A2**: 重複 ID を含む payload で 400 `VALIDATION_ERROR` + `DUPLICATE_ID` が返る。
- **A3**: 存在しない ID で 400 `VALIDATION_ERROR` + `UNKNOWN_ID`。
- **A4**: 別ボード ID を含むと 400 `VALIDATION_ERROR` + `CROSS_BOARD`。
- **A5**: スキーマ不正で 400 `INVALID_BODY`（details 含む）。
- **A6**: RPC エラー時に 500 `DB_ERROR` が返り、部分的な更新は発生しない。
- **A7 (ギャップ)**: キーボード操作・ARIA 改善を後続タスクとして追跡（現状未達）。

---

## 8. テスト状況とギャップ
### 8.1 実装済み
- `e2e/reorder-api.spec.ts`
  - Phase2 仕様（トランザクション / advisory lock）を前提にカード・リスト双方の reorder を検証。
  - 重複 ID（`DUPLICATE_ID`）や Invalid UUID → 400 を確認。
  - リスト再採番・カード再採番 RPC の正常系テストあり。
  - 短所: `issues` 配列の個別検証はカード側のみ。リスト側は `updated` のみ確認。

### 8.2 未カバー
- UI 操作（ドラッグ or キーボード）～ API 反映 ～ ページ再読込までの一連フロー。
- `VALIDATION_ERROR` の細分化（`DUPLICATE_POSITION`, `CROSS_BOARD`）をリスト対象で検証するテスト。
- オフラインキュー経由の同期テスト。
- アクセシビリティ（ARIA 属性 / スクリーンリーダ通知）。

### 8.3 TODO（以前のメモを引き継ぎ）
1. `phase3-comments.spec.ts` → `comments.spec.ts`
2. `phase3-webpush.spec.ts` → `notifications.spec.ts`
3. `phase3-invite.spec.ts` → `invites.spec.ts`
4. 追加カバレッジ: @メンション, In-app 通知, ボード権限
5. CI で `@e2e:essential` タグをゲートにする運用（Playwright grep）。

---

## 9. 監視・ログ
- CloudWatch / Supabase ログには `event="lists.reorder"` の JSON が出力される。`issues` は出力していないため、要件どおりに観測するなら追記が必要。
- 監視指標（推奨）: 成功率、`durationMs` p95、400/500 比率、リナンバリング RPC の呼び出し頻度。

---

## 10. 今後の改善タスク（ギャップまとめ）
1. キーボードショートカット: `Shift+Arrow`, `Ctrl/Cmd+Shift+Arrow`, roving `tabIndex`, `aria-live` 通知。
2. UI 側のスナップショット復元とエラー表示（`issues` 内容を反映）。
3. position ギャップ維持戦略（UI で gap を保つ / 自動リナンバリング）。
4. Playwright: UI フロー + タグ運用 + テストリネーム。
5. 構造化ログの粒度（`issues` 配列をログ出力）。

---

## 11. チェックリスト（更新）
- [ ] API レスポンス（`updated`/`unchanged`/`durationMs`）が仕様通りである
- [ ] 400 応答の `error.code` / `issues` をクライアントが正しく処理する
- [ ] RPC 失敗時に部分更新が残らないことをテスト（DB ロールバック確認）
- [ ] リスト/カード再採番 RPC の運用手順を明文化
- [ ] キーボード・アクセシビリティ改善タスクのチケット化

