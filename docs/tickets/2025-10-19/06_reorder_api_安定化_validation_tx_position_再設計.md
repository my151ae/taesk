# 06 - Reorder API 安定化: Validation / TX / Position 再設計

- **日付**: 2025-10-19
- **作成者**: 松本Ops
- **対象**: `app/api/boards/[boardId]/cards/reorder/route.ts`, `app/api/boards/[boardId]/lists/reorder/route.ts`
- **関連**: `docs/tickets/2025-10-19/05-sync-endpoints-breaking-card-operations.md`（原因/暫定対応）
- **ステータス**: Phase1 = ✅ 実装済（検証中） / Phase2 = 🟡 設計完了・着手前

---

## 0. 要約（TL;DR）
- **問題**: reorder API が position 以外の必須列まで巻き込み更新し、NOT NULL 制約やスキーマ不整合で 422/500 を誘発。
- **基本方針**: **reorder は position 専用の“部分更新 API”** に限定。内容（title など）は別 API で更新。
- **Phase1**（本PR）: 厳密バリデーション（重複 / 所属 / 存在）→ 400、**逐次 update + フェイルセーフ・ロールバック**、詳細ログ。API 契約を明文化。
- **Phase2**（次PR）: **ボード単位トランザクション**（必要時 advisory lock）、**position ギャップ方式 + 定期リナンバリング**、**並列/大量ケースの自動テスト**整備、パフォーマンス最適化（CTE一括更新検討）。

---

## 1. 背景とスコープ
- reorder 時の D&D 同期が **`id`/`position`のみの意図**に対し、upsert 設計で **欠損列が null 書込** → NOT NULL 制約崩れ。
- 本チケットは **cards/lists の順序入替（位置変更）に限定**。カード内容更新や作成/削除は対象外。

**スコープ**
- ✅ 並び替え（同一リスト内・**必要に応じて**クロスリスト移動）。
- ✅ ペイロード検証、権限/所属検証、存在検証、異常時の扱い（400）。
- ✅ 可観測性（ログ/メトリクス）整備。
- ❌ カード内容の編集、作成/削除、コメント等の非 position 更新。

---

## 2. API 仕様（契約）
### 2.1 リクエスト
```
PATCH /api/boards/:boardId/cards/reorder
PATCH /api/boards/:boardId/lists/reorder
Content-Type: application/json

{
  "updates": [
    { "id": "card_123", "position": 1010, "listId": "list_a"? },
    { "id": "card_456", "position": 1020 }
  ]
}
```
- **必須**: `id`, `position`
- **任意**: `listId`（**クロスリスト移動を許容する場合のみ**。Phase1では読み取りのみ/未使用でも可）
- **備考**: `position` は整数。小数は拒否。

### 2.2 成功レスポンス（200）
```
{
  "updated": 12,
  "unchanged": 0,
  "durationMs": 48
}
```

### 2.3 失敗レスポンス（400）
```
{
  "error": "Bad Request",
  "issues": [
    { "code": "DUPLICATE_ID", "id": "card_123" },
    { "code": "UNKNOWN_ID", "id": "card_999" },
    { "code": "CROSS_BOARD", "id": "card_456", "expectedBoardId": "...", "actualBoardId": "..." },
    { "code": "FOREIGN_LIST", "id": "card_789", "listId": "list_x" }
  ]
}
```

### 2.4 不変条件
- この API は **position 以外の列を一切変更しない**。
- 同一 payload の再送は**冪等**（サーバ状態が不変）。

---

## 3. バリデーション & エラー設計（Phase1）
- **重複 ID**: `updates[].id` の重複を検出 → 400。
- **未知 ID**: 対象ボードに属する実在レコード集合と `updates` の差分を検出 → 400（不足・余剰いずれも明示）。
- **ボード所属**: `cards`/`lists` の `board_id` が URL の `:boardId` と一致しない場合 → 400。
- **（任意）listId 検証**: `listId` を送る場合、指定 `listId` が同一 `boardId` に属さない → 400。
- **position 整合性**: `position` が整数以外、範囲外、NaN → 400。

**失敗時の扱い**
- Phase1 は **逐次 update だが、更新前 snapshot（id→position）からのロールバック**を実装済み。
- 例外発生時は **可能な限り元の並び**に復元、復元不可時はエラーログと合わせて 500（想定外）を返却。

---

## 4. サーバ実装ポイント
### 4.1 スキーマ（Zod）
```ts
const ReorderSchema = z.object({
  updates: z.array(z.object({
    id: z.string().min(1),
    position: z.number().int(),
    listId: z.string().min(1).optional(),
  })).min(1)
});
```

### 4.2 更新フロー（Phase1）
1. 入力検証（Zod）。
2. `SELECT` で対象レコードを **id→{boardId, listId, position}** へ集約、**存在/所属**を検証。
3. 事前に **position のスナップショット**を保持。
4. **逐次 update**（Prisma/Knex 等）。失敗時は snapshot から **ロールバック**。
5. 結果を集計して 200 を返却。

### 4.3 更新フロー（Phase2 予定）
- **ボード単位トランザクション** + **必要時 advisory lock**
  - 例：Postgres `pg_advisory_xact_lock(hashtext(:boardId))`。
  - これにより **all-or-nothing** と並行競合の抑制を実現。
- **一括更新（CTE）** への移行を検討
  - `WITH v(id, position) AS (VALUES ...)
     UPDATE cards c SET position = v.position FROM v WHERE c.id = v.id;`
  - 大量更新時のレイテンシ/ロック時間が短縮。

---

## 5. Position 設計（Phase2）
- **ギャップ方式**（例：初期 1000、刻み 10）で再並び替え時の**部分更新**を簡素化。
- 隣接差が **≤2** の密集を検出したら **定期リナンバリング**を実施（メンテ API またはジョブ）。
- 将来的に `UNIQUE(board_id, list_id, position)` を導入可能な整合性に揃える。

**リナンバリング例（同一 list 内）**
```
-- 擬似コード
BEGIN;
SELECT id FROM cards WHERE board_id=$1 AND list_id=$2 ORDER BY position ASC FOR UPDATE;
-- 1000,1010,1020,... で再採番
COMMIT;
```

---

## 6. 可観測性（Observability）
### 6.1 構造化ログ（例）
```json
{
  "event": "cards.reorder",
  "boardId": "b_123",
  "actorId": "u_456",
  "updates": 12,
  "changed": 12,
  "durationMs": 48,
  "issues": [],
  "hint": ""
}
```
- 失敗時は `issues` に検知内容（DUPLICATE_ID/UNKNOWN_ID など）を配列で格納。

### 6.2 メトリクス（推奨）
- `reorder_requests_total{target="cards|lists"}`
- `reorder_errors_total{code="..."}`
- `reorder_duration_ms_bucket{le="..."}`（P95/P99 監視）
- SLO 目安：**≤100 件で p95 < 200ms**

---

## 7. テスト計画
### 7.1 P0 スモーク（本PRに含める）
- **正常系**: 単一ボードで reorder → 200、**position 以外が変化しない**。
- **異常系**: 未知 ID / 重複 ID / 別ボード listId → 400、DB 不変。
- **冪等性**: 同一 payload を 2 回送って同じ結果。

#### Node スクリプト例（手元用）
```ts
// scripts/smoke-reorder.ts
import fetch from "node-fetch";

async function main() {
  const payload = { updates: [
    { id: "card_1", position: 1000 },
    { id: "card_2", position: 1010 },
  ]};
  const url = `http://localhost:3000/api/boards/b_123/cards/reorder`;
  const res = await fetch(url, { method: "PATCH", headers: {"content-type":"application/json"}, body: JSON.stringify(payload)});
  console.log(res.status, await res.text());
}
main();
```

### 7.2 P1 自動化（次PR）
- **並列 reorder**: 20〜50 並列で position が破綻しない。
- **クロスリスト移動**: `listId` 変更を含む reorder が仕様どおり。
- **大量更新**: 200 件以上でもタイムアウトせず整合性保持。
- **E2E（Playwright）**: D&D → ページ再読込 → 並び保持。

#### Playwright 例（スケルトン）
```ts
import { test, expect } from '@playwright/test';

test('cards reorder persists', async ({ page }) => {
  await page.goto('/boards/b_123');
  await page.dragAndDrop('[data-card="card_1"]', '[data-drop-pos="1010"]');
  await page.reload();
  await expect(page.locator('[data-card="card_1"]').first()).toHaveAttribute('data-pos', '1010');
});
```

---

## 8. セキュリティ/権限
- `actor` が当該 `boardId` にアクセス可能であることをサーバ側で検証。
- RLS or アプリ層権限のどちらでも、**API 入力に依存しないサーバ判定**を徹底。
- Rate Limit（例：ボード単位 qps 制限）を導入検討。

---

## 9. ロールバック/フェイルセーフ
- Phase1: **逐次 update + スナップショット復元** を実装済み。
- Phase2: **TX 中に失敗 → 全体ロールバック**へ移行。復旧不能時はインシデント手順へ委譲。

---

## 10. パフォーマンス/スケール戦略
- 小〜中規模: 逐次 update でも p95 < 200ms を目標。
- 大規模: CTE 一括更新 + インデックス最適化、ペイロード上限（例：1000 件）を設定。

---

## 11. 受け入れ条件（Definition of Done）
1. P0 スモークがローカル/CI で緑（正常系/異常系/冪等）。
2. 200 件の更新で p95 < 300ms を満たす（開発環境の参考値）。
3. ログに PII を含めないことを確認。
4. 05 ドキュメントの残課題リストが本書に取り込まれ、**相互リンク**が張られている。

---

## 12. 実装メモ（サンプル）
### 12.1 ルート抜粋（擬似コード）
```ts
export async function PATCH(req: NextRequest, { params }: { params: { boardId: string }}) {
  const { updates } = ReorderSchema.parse(await req.json());
  const boardId = params.boardId;

  // 1) 入力整形と重複チェック
  const ids = updates.map(u => u.id);
  const dup = findDuplicates(ids);
  if (dup.length) return badRequest('DUPLICATE_ID', dup);

  // 2) 既存レコード取得 & 所属/存在チェック
  const current = await db.selectCardsByIds(ids); // id -> { boardId, listId, position }
  const issues = validate(current, updates, boardId);
  if (issues.length) return badRequest('VALIDATION_FAILED', issues);

  // 3) スナップショット
  const snapshot = new Map(current.map(c => [c.id, c.position]));

  // 4) 逐次 update + フェイルセーフ
  try {
    for (const u of updates) {
      await db.updateCardPosition(u.id, u.position /* , u.listId? */);
    }
    return json({ updated: updates.length, unchanged: 0, durationMs: 0 });
  } catch (e) {
    // rollback best-effort
    for (const [id, pos] of snapshot) {
      try { await db.updateCardPosition(id, pos); } catch {}
    }
    throw e; // フレームワーク側で 500 応答
  }
}
```

### 12.2 一括更新（Phase2 検討）
```sql
WITH v(id, position) AS (
  VALUES -- ($1, $2), ($3, $4), ...
)
UPDATE cards c SET position = v.position FROM v WHERE c.id = v.id;
```

---

## 13. リスクと緩和
- **同時更新の競合** → Phase2 で TX + advisory lock を導入。
- **position 密集による再採番頻度増** → 閾値制御 + バックグラウンド実行。
- **大量 payload** → 上限・分割・CTE での短時間ロック。

---

## 14. タスク & マイルストーン
- **Phase1（本PR）**
  - [x] バリデーション実装（重複/所属/存在/型）
  - [x] 逐次 update + ロールバック
  - [x] 詳細ログ/メトリクス
  - [ ] P0 スモーク（手動/スクリプト）緑 → CI 連携

- **Phase2（次PR）**
  - [ ] TX + advisory lock
  - [ ] 位置ギャップ方式 + リナンバリング実装
  - [ ] 並列/大量/クロスリストの自動テスト
  - [ ] CTE 一括更新の採用判断（計測ベース）

---

## 15. 変更履歴（Changelog）
- 2025-10-19: 初版作成（Phase1 実装内容の明文化、Phase2 設計）。

