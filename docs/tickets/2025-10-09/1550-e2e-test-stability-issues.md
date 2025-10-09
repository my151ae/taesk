# E2Eテストの安定性問題の整理と対策

**Status**: 📝 In Progress
**Priority**: 🔵 Medium
**Created**: 2025-10-09 1550
**Assignee**: Claude
**Estimated**: 4 hours

## 概要

E2Eテストスイート全体（28テスト）で、並列実行時に3-5件のテストが不安定（flaky）になる問題を整理し、対策を立てる。

## テスト実行結果

### 最新の実行結果（2025-10-09）

```
Running 28 tests using 4 workers

Results:
- ✅ 22 passed (35.1s)
- ❌ 3 failed
- ⏭️  3 skipped

失敗したテスト:
1. auth.spec.ts: should redirect to login page when not authenticated
2. auth.spec.ts: should show login page after visiting any protected route
3. kanban.spec.ts: should delete a list
```

### テスト安定性の傾向

| テスト | 単独実行 | 並列実行 | 原因 |
|--------|----------|----------|------|
| auth tests (2件) | ✅ Pass | ❌ Fail | BYPASS_AUTH環境変数の競合 |
| delete list | ✅ Pass | ❌ Fail | Realtime subscription race condition |
| delete card | ✅ Pass | ⚠️ 時々Fail | Realtime subscription race condition |
| drag to different list | ⏭️ Skip | ⏭️ Skip | Known issue (#1530) |

## 問題の分類

### 1. 認証バイパスの問題（Auth Tests）

#### 症状

```
Expected: "http://localhost:3000/login"
Received: "http://localhost:3000/"
```

認証が必要なテストで、`NEXT_PUBLIC_BYPASS_AUTH=true`が有効になってしまい、ログインページにリダイレクトされない。

#### 根本原因

Playwright設定で`NEXT_PUBLIC_BYPASS_AUTH=true`が**グローバルに**設定されている：

```typescript
// playwright.config.ts:23
webServer: {
  command: 'NODE_ENV=test NEXT_PUBLIC_BYPASS_AUTH=true npm run dev',
  url: 'http://localhost:3000',
  reuseExistingServer: !process.env.CI,
}
```

これにより：
- `kanban.spec.ts`（バイパスが必要）→ ✅ 正常動作
- `auth.spec.ts`（バイパスが不要）→ ❌ 認証がバイパスされて失敗

#### 影響範囲

- `e2e/auth.spec.ts`の2テスト
- 実際の認証フローのE2Eカバレッジが不足

#### 対策案

**Option A: テストファイルごとにプロジェクトを分ける**

```typescript
// playwright.config.ts
projects: [
  {
    name: 'kanban-tests',
    testMatch: '**/kanban.spec.ts',
    use: {
      ...devices['Desktop Chrome'],
      baseURL: 'http://localhost:3000',
    },
  },
  {
    name: 'auth-tests',
    testMatch: '**/auth.spec.ts',
    use: {
      ...devices['Desktop Chrome'],
      baseURL: 'http://localhost:3001', // 別ポートで認証あり環境
    },
  },
],
webServer: [
  {
    command: 'NEXT_PUBLIC_BYPASS_AUTH=true npm run dev',
    port: 3000,
  },
  {
    command: 'npm run dev',
    port: 3001,
  },
]
```

**Option B: Auth testsを別ディレクトリに移動してスキップ**

認証テストは手動テストまたはCI専用として、ローカル実行からは除外。

**Option C: ランタイムで環境変数を切り替え**

テスト内で`process.env.NEXT_PUBLIC_BYPASS_AUTH`を動的に変更（Next.jsのビルドタイムバインディングのため困難）。

**推奨**: Option B（短期）+ Option A（長期）

### 2. Realtime Subscription Race Condition

#### 症状

```
Locator: getByRole('button', { name: /New List/i })
Expected: 0
Received: 6

削除後、リストが増え続ける（他のテストからのINSERTイベントを受信）
```

#### 根本原因

Supabase Realtimeの購読が**テスト間で分離されていない**：

1. Test A: リストを追加 → Realtime INSERT イベント発火
2. Test B: 実行中
3. Test B: Test AのINSERTイベントを受信 → UIに反映
4. Test B: 期待値と一致せず失敗

現在の実装（app/page.tsx:523-615）:

```typescript
useEffect(() => {
  if (!user || !currentBoardId) return;

  const subscription = supabase
    .channel('board-changes')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lists', filter: `board_id=eq.${currentBoardId}` }, ...)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'lists', filter: `board_id=eq.${currentBoardId}` }, ...)
    // ...
    .subscribe();

  return () => {
    subscription.unsubscribe();
  };
}, [user, currentBoardId]);
```

**問題点**:
- `board_id`でフィルタしているが、テストボード(`00000000-0000-0000-0000-000000000002`)で**全テストが共有**
- Realtime channelの購読解除が遅延する場合がある
- `beforeEach`でデータをクリアしても、購読は残る

#### 影響範囲

- `kanban.spec.ts`の削除系テスト（3-5件）
- ドラッグ&ドロップテスト（カウント不一致）

#### 既存の緩和策

チケット#1530で実施済み:
- `beforeEach`でのクリーンアップタイミング改善
- Upsertロジックで重複INSERT対応
- 厳密な購読クリーンアップ

→ 完全には解決せず

#### 対策案

**Option A: テストボードを動的に作成（推奨）**

```typescript
test.beforeEach(async ({ page }) => {
  // Generate unique test board ID per test
  const testBoardId = crypto.randomUUID();

  // Create test board in Supabase
  await supabase.from('boards').insert({
    id: testBoardId,
    name: `Test Board ${testBoardId.slice(0, 8)}`
  });

  // Navigate and switch to this board
  await page.goto('/');
  await switchToBoard(page, testBoardId);
});

test.afterEach(async () => {
  // Clean up test board
  await supabase.from('boards').delete().eq('id', testBoardId);
});
```

メリット:
- ✅ 完全なテスト分離
- ✅ Realtime競合なし

デメリット:
- ⚠️ ボード切り替えUIが必要
- ⚠️ テスト時間が若干増加

**Option B: Realtime購読を無効化（テスト環境のみ）**

```typescript
// app/page.tsx
const DISABLE_REALTIME = process.env.NEXT_PUBLIC_DISABLE_REALTIME === 'true';

useEffect(() => {
  if (DISABLE_REALTIME || !user || !currentBoardId) return;
  // ... Realtime subscription
}, [user, currentBoardId]);
```

メリット:
- ✅ シンプルな実装
- ✅ すぐに適用可能

デメリット:
- ❌ Realtimeのテストカバレッジがなくなる

**Option C: Sequential実行（CI環境）**

```typescript
// playwright.config.ts
workers: process.env.CI ? 1 : 4, // CI: 順次実行、ローカル: 並列
```

メリット:
- ✅ 設定変更のみ
- ✅ 確実に安定

デメリット:
- ❌ CI実行時間が4倍に増加（35s → 140s）

**推奨**: Option A（根本解決）+ Option C（短期緩和）

### 3. スキップされているテスト

#### 現在スキップ中

1. **Drag to different list** (kanban.spec.ts:193)
   - Reason: Realtime timing issues (#1530)
   - Status: 手動テストでは動作確認済み

2. **Data isolation tests** (auth.spec.ts:59, 64)
   - Reason: Manual setup required
   - Status: 実際のユーザーアカウントが必要

#### 対策

- Drag test: Option Aでテストボード分離すれば有効化可能
- Data isolation: モックユーザーでの自動テスト化を検討

## 実装タスク

### Phase 1: 短期的な安定化（優先度: 高）

- [ ] CI環境でSequential実行を有効化（workers: 1）
- [ ] Auth testsを一時的にスキップまたは分離
- [ ] フラキーテスト実行時の待機時間を調整

### Phase 2: 根本的な解決（優先度: 中）

- [ ] テストボードの動的生成機能を実装
- [ ] Realtime購読の完全な分離
- [ ] Drag testの有効化

### Phase 3: カバレッジ拡大（優先度: 低）

- [ ] Auth testsの自動化（モックOAuth）
- [ ] Data isolationテストの自動化
- [ ] E2Eテストのリトライ戦略最適化

## 受け入れ基準

- [ ] CIでE2Eテストが95%以上の成功率
- [ ] 並列実行でフラキーエラーが発生しない
- [ ] テスト実行時間が60秒以内
- [ ] 全28テストが有効化されている

## 関連チケット

- [#1530-flaky-drag-drop-test](./1530-flaky-drag-drop-test.md) - Realtime問題の調査
- [#1520-add-offline-sync-queue](./1520-add-offline-sync-queue.md) - 同期ロジック
- [#1540-fix-offline-drag-drop-sync](./1540-fix-offline-drag-drop-sync.md) - ドラッグ同期修正

## 参考資料

### Playwright Best Practices

- [Test Isolation](https://playwright.dev/docs/test-isolation)
- [Parallelism and Sharding](https://playwright.dev/docs/test-parallel)
- [Flaky Tests](https://playwright.dev/docs/test-retries#flaky-tests)

### Supabase Realtime

- [Realtime Subscriptions](https://supabase.com/docs/guides/realtime/subscriptions)
- [Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes)

## メトリクス

### 現在

- Total tests: 28
- Pass rate (parallel): 78.6% (22/28)
- Pass rate (sequential): ~100%
- Avg duration (parallel): 35s
- Flaky tests: 5 (17.9%)

### 目標（Phase 2完了後）

- Total tests: 28
- Pass rate (parallel): 95%+
- Pass rate (sequential): 100%
- Avg duration (parallel): <60s
- Flaky tests: <2 (7%)

## ノート

### なぜAuth testsが失敗するのか？

`NEXT_PUBLIC_BYPASS_AUTH`は**ビルドタイム**の環境変数（Next.jsの仕様）。
Playwrightが起動する開発サーバーで設定されると、全テストに影響する。

### なぜRealtime問題が難しいのか？

Supabase Realtimeは**グローバルなpub/sub**システム。
同じチャンネルを購読している全てのクライアント（=全テスト）がイベントを受信する。
テストボードIDでフィルタしても、ボードを共有していれば競合する。

### CI vs ローカル実行の違い

- **CI**: Sequential (workers: 1) → 安定
- **Local**: Parallel (workers: 4) → フラキー

CIでは問題が隠れるため、ローカルでの並列テストが重要。
