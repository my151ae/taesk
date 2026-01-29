# Phase 5: E2E テスト棚卸し（2026-01-29）

## 目的
- 既存 E2E が「運用実態」と乖離している前提で、**1本ずつ生存確認と仕様ズレを洗い出す**。
- 修正 / 廃止 / 将来の再開を区別し、段階的に再構築する。

## 全体方針
- まずは **テストの意味が現在の Timeline 運用に合うか** を確認。
- DB 直操作や固定 ID 依存が強いものは優先的に点検。
- 実行は `PW_WORKERS=1` + JSON レポート必須。
- 既存テストが完走しない場合は「解消すべき理由」を先に記録し、修正計画へ。

## 現状メモ（実行環境）
- 直近の `npx playwright test --reporter=json` はタイムアウトし、`test-results/playwright-report.json` に JSON ではないログが残る。
- `PW_WORKERS=1` で 15 分実行も完走せず。
- → **フル一括実行は現状困難**。1 spec 単位の棚卸しを優先。

---

## テスト別棚卸し

### 1) `e2e/timeline.spec.ts`
- **目的**: Timeline 表示・A/B 追加・メトリクス送信の確認。
- **依存**:
  - Supabase service role (`SUPABASE_SERVICE_ROLE_KEY`) 必須。
  - `cards.due_*` カラムが存在しないと skip。
-  - `boards` / `lists` を作成して UI から検証。
- **現状リスク**:
  - `due_bucket` の存在チェックが `select('due_bucket')` のみで薄い。
- **整理方針（案）**:
  - 固定 ID を廃止し、UUID 生成で board/list を作成（対応済み）。
  - metrics 依存を削除して UI 可視確認に絞る（対応済み）。

### 2) `e2e/comments.spec.ts`
- **目的**: コメント/メンション/リアルタイム/性能の確認。
- **依存**:
  - Supabase service role。
  - `profiles` を upsert して mention 候補を作る。
  - UI セレクタ（`.ProseMirror` / `.mention` / `[data-testid]`）依存が強い。
- **現状リスク**:
  - `Test Display Name Updated` に固定依存（profiles とのズレが出やすい）。
  - 性能テスト（2s以内）の閾値が厳しく CI/環境差に弱い。
  - リアルタイムは flaky になりやすい（複数 context + リトライ）。
- **整理方針（案）**:
  - UI 依存の固定表示名は `profiles` をテスト内で確実に作る（対応済み）。
  - パフォーマンステストは別グループへ分離（@perf 等）または暫定 skip。
  - realtime は「同期確認」ではなく「イベント到達」の最小確認に縮小検討。

### 3) `e2e/notifications.spec.ts`
- **目的**: 通知設定 UI / 未読バッジ / 既読化。
- **依存**:
  - API を全部 `page.route` でモック（実 DB 不要）。
- **現状リスク**:
  - UI 文言（英語/日本語混在）に強く依存。
  - `Notification Settings` / `Browser Notifications` 表記が変わると即壊れる。
- **整理方針（案）**:
  - 文言依存を `data-testid` 中心に変更（設定モーダル検知を `enable-push-button` へ変更済み）。
  - モックは問題なし（むしろ安定）。

### 4) `e2e/board-permissions.spec.ts`
- **目的**: ShareDialog / メンバー権限変更 / 削除。
- **依存**:
  - `supabase` クライアントで `boards` を作成（service role ではない）。
  - `/api/boards/*/members` をモック。
- **現状リスク**:
  - `supabase`（anon）でボード作成に失敗する可能性。
  - UI の `Share Board` / role combobox の文言依存。
  - 役割変更は API を `page.evaluate(fetch)` で直接叩いていて UI 操作になっていない。
- **整理方針（案）**:
  - ボード作成は service role に寄せる（対応済み）。
  - role 変更は UI 操作（select change）で完結するよう修正。

### 5) `e2e/reorder-api.spec.ts`
- **目的**: Cards reorder / renumber API を API-only で検証。
- **依存**:
  - `E2E_SECRET` が必要（デフォルト `redacted-e2e-secret`）。
  - `/api/boards` / `/api/boards/:id/cards` が有効であること。
- **現状リスク**:
  - 仕様のバリデーションエラーメッセージに依存。
  - list を API によって自動生成される前提。
- **整理方針（案）**:
  - validation エラーは「code のみ」など緩める（対応済み）。
  - `cards/renumber` 依存の listId が必須なので listId の保証方法を明文化。

### 6) `e2e/rls.spec.ts`
- **目的**: RLS のドキュメント化（実質テストなし）。
- **依存**: なし（コメントのみ）。
- **現状リスク**:
  - 実際に検証していないため CI 的には無意味。
  - 現在のプロダクトが「共有ボード」設計なら RLS 仕様自体がズレる可能性。
- **整理方針（案）**:
  - 「ドキュメント」なら `docs/` へ移動して spec 化。
  - 実テストにするなら Supabase admin で policy を確認する仕組みが必要。

### 7) `e2e/auth.spec.ts`
- **目的**: 未ログイン遷移、ログイン画面、callback エラー。
- **依存**: UI 文言。
- **現状リスク**:
  - OAuth 仕様変更で脆いが最小限。
- **整理方針（案）**:
  - 文言依存を `data-testid` ベースに寄せる（当面は `Google` 文言で緩める対応済み）。

---

## 当面の優先度
1. `timeline.spec.ts` / `comments.spec.ts` の整合（Timeline コア）
2. `notifications.spec.ts` / `board-permissions.spec.ts` の安定化
3. `reorder-api.spec.ts` のバリデーション期待値を緩くする
4. `auth.spec.ts` の文言依存縮小
5. `rls.spec.ts` を docs へ移動 or 実テスト化

## 次の具体アクション（候補）
- [ ] `timeline.spec.ts` の固定 ID を廃止して UUID 化
- [ ] `comments.spec.ts` の表示名固定依存を seed に統合
- [ ] `notifications.spec.ts` を `data-testid` 依存に切替
- [ ] `board-permissions.spec.ts` を service role ベースに変更
- [ ] `rls.spec.ts` を docs 化 or 削除判断
