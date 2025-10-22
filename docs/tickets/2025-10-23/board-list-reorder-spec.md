
# Trello風ボード: リスト移動仕様書（実装 & テスト方針）
最終更新: 2025-10-23 / 作成者: ChatGPT（松本Ops向け）

---

## 0. 背景と目的
- 現状、**初期リストと新規リストで D&D の挙動差**がある疑い。
- 配列順と `position` ベースの表示順の**不整合**、追加直後の `position` の**正規化不足**などが主因になりがち。
- 本仕様では、**並び替えロジックを純関数化**し、**UI からは同一ロジックを呼ぶ**アーキテクチャへ移行。
- E2E は **D&D はスモークのみ**に抑え、**ショートカット／メニュー操作**を主経路として**網羅的かつ安定的**に検証。
- さらに、**E2E 実行モードを分割**（Essential / Feature-wise / Failure-wise / All）して、開発の速度と品質を両立する。

---

## 1. スコープ
- 対象: ボード上の**リスト**（カラム）の**並び替え**とその永続化。
- 非対象: リストの中のカード並び替え、他ボード間移動、ユーザー権限、リアルタイム多人数同時編集の競合解決（必要なら別仕様）。

---

## 2. 用語 / データモデル
```ts
type List = {
  id: string;
  title: string;
  position: number; // 0..N-1 の連番で保持・表示基準もこれに揃える
  // その他メタ: createdAt, updatedAt, boardId など
};
type Board = {
  id: string;
  lists: List[]; // ソースオブトゥルース。保存時は常に position を正規化してから永続化。
};
```
- **不変条件（Invariant）**
  1. `lists.length = N` のとき `position` は `0..N-1` の**連番**。
  2. `position` 昇順でソートした順が UI 表示順と**一致**。
  3. 並び替えは **ID 指定**で行い、**副作用のない純関数**で決定。

---

## 3. 機能仕様

### 3.1 並び替えロジック（純関数）
- **目的**: UI 入力形態（D&D / キーボード / メニュー）に依存せず**唯一のロジック**で順序を計算。
- **関数シグネチャ**
```ts
export function reorderListsByIds(
  lists: List[],
  activeId: string, // 動かす対象のリストID
  overId: string    // 移動先基準リストID（その位置に入る）
): List[];
``>
- **仕様**
  - `activeId` と `overId` の**現在インデックス**を求め、`arrayMove` 等で再配置。
  - 返却前に **position を 0..N-1 に再採番**（正規化）。
  - 例外系: ID 不在 / 同一ID → **入力無視（同値返却）**。
- **計算量**: O(N)。

#### 3.1.1 付属ユーティリティ（任意）
- `normalizePositions(lists: List[]): List[]`  
  - `position` を昇順に並び替え、インデックスを振り直して返す。

### 3.2 UI 操作（複数手段 → 同一ロジック呼び出し）
- **D&D（@dnd-kit 等）**
  - `onDragEnd` で `active.id` と `over.id` を取得し、`reorderListsByIds` を呼ぶ。
  - **E2Eはスモーク**（1〜2本）に留める。
- **ショートカット（推奨）**
  - **Alt/Option + ←/→**: アクティブなリストを左/右へ**1つ移動**。
  - **Shift + Alt/Option + ←/→**: 左端/右端へ**ジャンプ**（任意）。
  - フォーカスは**リストヘッダ**に合わせ、移動後も対象リストに**フォーカスを保持**。
  - ARIA: リストコンテナは `aria-roledescription="Board columns"` 等、移動で `aria-live="polite"` を用い「移動しました」を告知。
- **メニュー操作**
  - リストヘッダの「…」メニューに「左へ移動」「右へ移動」「先頭へ」「末尾へ」を配置。
  - いずれも `reorderListsByIds` をコール。

### 3.3 永続化 / 状態更新
1. `reorderListsByIds` の戻り値を **単一のソースオブトゥルース**として `board.lists` に反映。
2. 書き込み前後どちらかで **必ず `normalizePositions` を適用**（二重安全）。
3. 永続化（API / IndexedDB 等）も**正規化後**のデータで行う。

### 3.4 オフライン / 同期（任意採用）
- オフライン時は**ローカルに適用**し、**操作キュー**へ格納。
- 復帰時に**順序操作イベント**を順番にリプレイ（ID 解決できない場合はスキップ・警告）。

### 3.5 ログ / デバッグ
- 開発ビルドでは、`idsByArray !== idsByPositionSort` の場合に `console.warn` を一度だけ出す。

---

## 4. エラーハンドリング / ガード
- `activeId` または `overId` が見つからない → 変更なし。
- `activeId === overId` → 変更なし。
- リスト数 0/1 → 変更なし。
- 正規化により `position` 衝突は常に解消。

---

## 5. テスト戦略（ピラミッド）
- **Unit**（最重要・高速）: `reorderListsByIds` / `normalizePositions` の網羅。
- **Integration**: UI イベント → 状態更新 → 永続化の連携をショートカット／メニュー経路で重点検証。
- **E2E**: クリティカル動線のみ + 代表的エッジ。D&D はスモーク。

### 5.1 Unit（Vitest/Jest）主要ケース
| No | 初期配列 (id:pos) | 操作 | 期待 |
|---:|---|---|---|
| U1 | A:0 B:1 C:2 | A→C | B:0 C:1 A:2 |
| U2 | A:0 B:1 C:2 | C→A | C:0 A:1 B:2 |
| U3 | A:0 B:1 C:2 | B→B | 変更なし |
| U4 | A:0 B:1 C:2 D:3 | D→B | A:0 D:1 B:2 C:3 |
| U5 | A:0 B:1 **X:3(新規)** | X→A | X:0 A:1 B:2 |
| U6 | ID 不在 | A→Z | 変更なし |
| U7 | 単一/空 | - | 変更なし |
- すべての返却配列で `position` が **0..N-1 連番**であることを追加アサート。

### 5.2 Integration（Playwright でもよいが速度重視なら @testing-library）
- メニュー「右へ/左へ」で端・中央・連続移動。
- 追加直後の新規リストを**先頭へ**移動 → 再読込でも順序保持。
- オフライン（モック）→ 復帰で順序が同期。

### 5.3 E2E（Playwright）
- **スモーク（D&D）**: 実際に掴んで 1 ステップだけ移動できること。
- **キーボード**: Alt+→/←、Shift+Alt 端ジャンプ、フォーカス保持、スクリーンリーダ告知（基本）。
- **回帰**: 新規追加混在時の移動が初期リストと**同一挙動**であること。

---

## 6. E2E 実行モード分割仕様（Essential / Feature / Failure / All）

### 6.1 命名/タグ付け規約
- **テストタイトルにタグを埋め込む**（Playwright の `--grep` で抽出）  
  - `@e2e:essential` … PR 時に必ず回す最小集合
  - `@feature:lists`、`@feature:board` など機能別
  - `@failure:dnd`, `@failure:position`, `@failure:offline` など失敗パターン別
  - `@e2e:all` は**全テストに含めない**（All は `--grep` 未指定で網羅実行）

**例:**
```ts
test('リストを右へ移動できる @e2e:essential @feature:lists', async ({ page }) => { ... });
test('新規リスト混在での端ジャンプ @feature:lists', async () => { ... });
test('配列順とposition不整合の再現と回避 @failure:position', async () => { ... });
test('D&D スモーク: 1ステップ移動 @failure:dnd', async () => { ... });
```

### 6.2 Playwright 設定例（`playwright.config.ts`）
```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [['html', { open: 'never' }], ['list']],
  projects: [
    {
      name: 'essential',
      grep: /@e2e:essential/,
    },
    {
      name: 'feature-lists',
      grep: /@feature:lists/,
    },
    {
      name: 'failure',
      grep: /@failure:(dnd|position|offline)/,
    },
    {
      name: 'all', // すべて（grep 指定なし）
    },
  ],
});
```

### 6.3 実行コマンド例（`package.json`）
```json
{
  "scripts": {
    "test:e2e:essential": "playwright test --project=essential",
    "test:e2e:feature:lists": "playwright test --project=feature-lists",
    "test:e2e:failure": "playwright test --project=failure",
    "test:e2e:all": "playwright test --project=all"
  }
}
```

### 6.4 運用方針（CI）
- **PR**: `essential` のみ必須。`feature-*` は変更ディレクトリに応じて任意実行。
- **定時/夜間**: `all` を 1 回。
- フレーク検知: `--repeat-each=2 --retries=2` を `failure` バケットに限定適用。

---

## 7. 受け入れ基準（Acceptance Criteria）
1. どの UI 操作（D&D / ショートカット / メニュー）でも**同一結果**が得られる。
2. 並び替え後の `position` は常に **0..N-1 の連番**。
3. 新規リスト混在時も、初期リストと**挙動差がない**。
4. 再読込後も期待順序を保持（永続化 OK）。
5. E2E 実行モード分割が動作し、 `essential` が 2 分以内（目安）で完走。

---

## 8. 非機能 / アクセシビリティ
- キーボード操作可能（Alt/Option、Shift の組合せ）。
- フォーカスは移動対象に残る。
- SR 告知（`aria-live` 等）で順序変更を伝える。

---

## 9. 実装手順（推奨）
1. `reorderListsByIds` と `normalizePositions` を新規作成（ユニットテスト先行）。
2. D&D `onDragEnd` を上記呼び出しに変更。
3. 「左/右へ」「先頭/末尾へ」メニューとショートカットを追加（Integration テスト）。
4. 永続化直前/直後で正規化を二重化（安全側）。
5. Playwright タグ導入、`projects` 追加、スクリプト分割。
6. E2E 総点検（essential → feature → failure → all）。

---

## 10. サンプルコード

### 10.1 並び替えロジック（TS）
```ts
import { arrayMove } from '@dnd-kit/sortable';

export function normalizePositions(lists: List[]): List[] {
  return [...lists]
    .sort((a, b) => a.position - b.position)
    .map((l, i) => ({ ...l, position: i }));
}

export function reorderListsByIds(lists: List[], activeId: string, overId: string): List[] {
  const oldIndex = lists.findIndex(l => l.id === activeId);
  const newIndex = lists.findIndex(l => l.id === overId);
  if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return normalizePositions(lists);

  const byArray = arrayMove(lists, oldIndex, newIndex);
  // 正規化（戻り値が唯一のソースオブトゥルース）
  return byArray.map((l, i) => ({ ...l, position: i }));
}
```

### 10.2 Vitest 例
```ts
import { describe, it, expect } from 'vitest';
import { reorderListsByIds } from './reorder';

const mk = (ids: string[]) => ids.map((id, i) => ({ id, title: id, position: i }));

describe('reorderListsByIds', () => {
  it('A→C で B,C,A になる @unit', () => {
    const input = mk(['A','B','C']);
    const out = reorderListsByIds(input, 'A', 'C');
    expect(out.map(l => l.id)).toEqual(['B','C','A']);
    expect(out.map(l => l.position)).toEqual([0,1,2]);
  });
  it('新規X混在で X→A が先頭へ', () => {
    const input = mk(['A','B']); input.push({ id: 'X', title: 'X', position: 3 });
    const out = reorderListsByIds(input, 'X', 'A');
    expect(out.map(l => l.id)).toEqual(['X','A','B']);
    expect(out.map(l => l.position)).toEqual([0,1,2]);
  });
});
```

### 10.3 Playwright 例（タグ）
```ts
import { test, expect } from '@playwright/test';

test('ショートカットで右へ移動 @e2e:essential @feature:lists', async ({ page }) => {
  await page.goto('/board/1');
  await page.getByRole('heading', { name: 'Todo' }).click();
  await page.keyboard.down('Alt'); await page.keyboard.press('ArrowRight'); await page.keyboard.up('Alt');
  await expect(page.getByRole('list', { name: 'columns' })).toContainText(['In Progress', 'Todo']);
});

test('D&D スモーク: 掴んで右へ1つ @failure:dnd', async ({ page }) => {
  // 実装に合わせて DnD ユーティリティを使用
});
```

---

## 11. リスクと対策
- **D&D のフレーク**: スモーク化 + 失敗バケットでのみリトライ増加。
- **既存コードとの二重正規化**: 一時的に両方残す → ログ監視後に片側削除。
- **タグ運用の形骸化**: PR テンプレで「追加テストのタグ」をレビュー項目に追加。

---

## 12. 変更履歴
- 2025-10-23: 初版。
