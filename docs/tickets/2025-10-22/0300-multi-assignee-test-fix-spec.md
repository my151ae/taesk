# 0305 マルチアサイニー移行・テスト修正仕様（最新リポジトリ準拠）
更新: 2025-10-22 18:32 (UTC+09:00)

## 目的
- **真実のソースを「マルチアサイニー（`assignee_ids`）に統一」**し、単一（`assignee_id`）の残存を段階的に撤去する。
- 仕様・DB・API・UI・E2E を **最新のリポジトリ実装**と整合させつつ、安全に移行する。

---

## 1. 現状（最新 `my151ae/taesk` リポジトリの事実）
- **アサイン仕様**: 現行コードは **単一アサイニー（`assignee_id`）が主**。UI/保存ロジック/通知ロジックに `assignee_id` が残る。
- **`assignee_ids` 列**: リポジトリ内に **配列列の導入（`assignee_ids uuid[]`）マイグレーションは未確認**。
- **モーダルとURL**: カードモーダルは **`?card=<short_id>` クエリ**で状態同期（Next.js の既知クラッシュ回避の暫定策）。
- **モーダル操作**: **Save しても自動で閉じない**（Esc などで明示クローズ）。
- **E2E 前提**: `Details` タブを**明示選択**してから操作しないと要素が非表示で落ちるため、テストにタブ選択が入っている。

> ※上記はコード上の「実装事実」であり、**本仕様では「マルチを正」として移行**する。

---

## 2. 方針（決定）
- **正**: `assignee_ids: uuid[]`（複数）
- **互換**: 当面 `assignee_id` を **読み取り互換 + 書き込み同期（先頭要素）** とする。
- **撤去**: 安定確認後（1–2 スプリント）に `assignee_id` を **drop**。

---

## 3. 実装タスク
### 3.1 DB（Supabase）
1. **列追加**:  
   ```sql
   alter table cards 
     add column if not exists assignee_ids uuid[] not null default '{}'::uuid[];
   ```
2. **バックフィル**:  
   ```sql
   update cards 
      set assignee_ids = array[assignee_id] 
    where assignee_id is not null 
      and (assignee_ids is null or cardinality(assignee_ids)=0);
   ```
3. **インデックス（任意）**:  
   - 検索要件に応じて `gin` インデックス（`assignee_ids` を `ANY` 検索するクエリがある場合）。
4. **書き込み同期（暫定）**: API 層で `assignee_ids` 書き込み時に `assignee_id = assignee_ids[1]` を同期。
5. **撤去**: 監視期間後に `alter table cards drop column assignee_id;`

### 3.2 型／API
- **型更新**: `Card.assignee_ids: string[]` を追加、`assignee_id` は将来非推奨。
- **DTO**: `updateCard` / `upsertCard` の payload に `assignee_ids: string[]` を採用（移行期間は `assignee_id` 同期）。
- **読み取り順序**: `assignee_ids` 優先。空配列のみ `assignee_id` をフォールバック。

### 3.3 UI（CardModal）
- **state**: `assigneeIds: string[]` に変更。
- **UI**: 複数選択（検索 + チップ＋×除去）。選択順を保持（先頭=代表）。
- **保存**: `onSave(..., assigneeIds)` に変更。互換期間は API 層で `assignee_id` 同期。

### 3.4 通知/副作用
- `assignee_changed` 等の通知は **配列差分**に対応（追加・削除ごとに通知／もしくはまとめて 1 通知）。
- 既存の `assignee_id` 参照箇所は **`assignee_ids[1]` 互換** or **ループ**へ置換。

### 3.5 E2E（Playwright）
- **タブ活性**: 操作前に `Details` タブを明示クリック（共通ヘルパ化）。
- **URL 検証**: `?card=<short_id>` を前提。`/c/...` は **説明上の正規化ルート**だが、現状はクエリ運用を継続。
- **保存/クローズ**: Save→DB反映待ち（`expect.poll` 推奨）→`Escape` でクローズ→非表示アサート。
- **検証**: 単一→**配列**（`toEqual(expect.arrayContaining([uid1, uid2]))`）。
- **メンバー選択**: 複数選択の UI 操作（検索→選択→チップ生成→Save）に置換。

---

## 4. ロールアウト
1) **Step1**: DB 追加 + バックフィル + 書き込み同期（`assignee_ids` 正式採用の下準備）  
2) **Step2**: 型/DTO + UI + API を `assignee_ids` へ切替、E2E を配列基準に更新  
3) **Step3**: 1–2 スプリント監視（メトリクス: assignee 変更イベント／エラー）  
4) **Step4**: `assignee_id` を drop、コードから参照を削除

---

## 5. 既知仕様（テスト観点の要点）
- **モーダルURL**: `?card=<short_id>` を使用（Next.js 15.5.x のクラッシュ回避）。
- **Save後挙動**: **自動クローズしない** → テストは Save の後に **Esc** で閉じる。
- **タブ構造**: `Details` / `Comments`。フォーム要素は `Details` 内にあるため **タブの明示選択が必須**。

---

## 6. 影響範囲・リスク
- **DB互換**: 一時的な二重運用（`assignee_ids` 正 / `assignee_id` 同期）でリスク低減。
- **UI変更**: 単一→複数選択 UI の学習コスト。
- **通知**: 配列差分のロジックが増えるため、重複通知を避けるデデュープ鍵の設計に注意。

---

## 7. チェックリスト
- [ ] `assignee_ids` 列追加・バックフィル・同期実装
- [ ] 型再生成（Supabase）／DTO 差し替え
- [ ] CardModal の複数選択 UI 実装
- [ ] 通知ロジック：配列対応 + デデュープ
- [ ] E2E：配列検証＋`Details` タブ活性＋`?card=` 前提
- [ ] モニタリング設定（エラー/通知件数）
- [ ] `assignee_id` 撤去（安定後）

---

## 付録A：SQLサンプル（安全版）
```sql
begin;

alter table cards 
  add column if not exists assignee_ids uuid[] not null default '{}'::uuid[];

update cards 
   set assignee_ids = array[assignee_id]
 where assignee_id is not null
   and (assignee_ids is null or cardinality(assignee_ids)=0);

commit;
```

## 付録B：E2E 断片（概念）
```ts
// Activate Details tab (common helper)
await page.getByRole('button', { name: 'Details' }).click();

// Assign multiple members
await page.getByLabel('Assignees').click();
await page.getByLabel('Assignee search').fill('alice');
await page.getByRole('option', { name: /Alice/ }).click();
await page.getByLabel('Assignee search').fill('bob');
await page.getByRole('option', { name: /Bob/ }).click();

// Save, then close
await page.getByRole('button', { name: 'Save' }).click();
await expect.poll(async () => /* fetch DB `assignee_ids` */).toContain('ALICE_ID');
await expect.poll(async () => /* fetch DB `assignee_ids` */).toContain('BOB_ID');
await page.keyboard.press('Escape');
await expect(page.getByRole('dialog')).toHaveCount(0);
```

---

### 備考
- 本仕様は **最新の実装（単一）を事実認定**したうえで、**望ましい仕様（マルチ）へ移行**するための実行計画です。
- `/c/:short_id` の正規化は **将来再導入**（Next.js 修正後）。現状は `?card=` 方式で安定運用。
