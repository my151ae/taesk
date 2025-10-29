# テスト分割戦略の実装

**日付**: 2025-10-29
**ステータス**: ✅ 完了

## 背景

全テスト実行 (`npm run test:full`) がタイムアウト（10分以上）するため、テストを分割して管理可能なバッチで実行できるようにする必要があった。

## 実装内容

### 1. ファイル別テストスクリプト

各テストファイルを個別に実行できるnpmスクリプトを追加：

```json
{
  "test:auth": "playwright test e2e/auth.spec.ts --project=core --reporter=list --reporter=json",
  "test:kanban": "playwright test e2e/kanban.spec.ts --project=core --reporter=list --reporter=json",
  "test:reorder": "playwright test e2e/reorder-api.spec.ts --project=core --reporter=list --reporter=json",
  "test:comments": "playwright test e2e/comments.spec.ts --project=core --reporter=list --reporter=json",
  "test:notifications": "playwright test e2e/notifications.spec.ts --project=core --reporter=list --reporter=json",
  "test:permissions": "playwright test e2e/board-permissions.spec.ts --project=core --reporter=list --reporter=json",
  "test:rls": "playwright test e2e/rls.spec.ts --project=core --reporter=list --reporter=json"
}
```

**メリット**:
- 問題のある特定のテストファイルだけを素早く実行できる
- デバッグが容易
- CI/CDで並列実行可能

### 2. バッチ実行スクリプト

全テストをファイル単位で順次実行し、結果を集約するシェルスクリプト `scripts/test-all-batches.sh` を作成：

```bash
npm run test:all-split
```

**特徴**:
- 各テストファイルを順次実行（auth → kanban → reorder → ... → rls）
- 各バッチの成功/失敗を記録
- 最終的なサマリーを表示（Passed / Failed テストファイル一覧）
- いずれかのバッチが失敗した場合、exit code 1 を返す（CI連携可能）

**出力例**:
```
==========================================
Running all tests in batches...
==========================================

----------------------------------------
Running: auth
----------------------------------------
✅ auth PASSED

----------------------------------------
Running: kanban
----------------------------------------
❌ kanban FAILED

...

==========================================
BATCH TEST SUMMARY
==========================================

Total test files: 7
Passed: 6
Failed: 1

✅ Passed tests:
  - auth
  - reorder
  - comments
  - notifications
  - permissions
  - rls

❌ Failed tests:
  - kanban
```

### 3. ドキュメント更新

`docs/detail/testing.md` に以下を追加：

- ファイル別テストスクリプトの説明
- バッチ実行の使い方
- コマンド例テーブルの更新（ファイル別テスト行を追加）

## テスト実行方法

### 個別ファイル実行

```bash
# 認証テストのみ
npm run test:auth

# コメント機能のみ
npm run test:comments

# RLSポリシーのみ
npm run test:rls
```

### 全テスト（バッチモード）

```bash
# 全テストをファイル単位で順次実行
npm run test:all-split
```

### 既存の方法（タグベース）も引き続き利用可能

```bash
# 必須テストのみ
npm test

# 機能別
npm run test:feature:comments
npm run test:feature:notifications

# 異常系
npm run test:failure
```

## 利点

1. **タイムアウト回避**: 全テストを一度に実行せず、ファイル単位で実行することでタイムアウトを回避
2. **デバッグ効率**: 特定のテストファイルだけを素早く実行可能
3. **CI/CD柔軟性**: 各ファイルを並列実行したり、順次実行したりを選択可能
4. **明確なフィードバック**: どのファイルが失敗したかが一目瞭然
5. **既存タグとの共存**: 既存の `@e2e:essential` や `@feature:*` タグベースの実行も引き続き利用可能

## ファイル構成

```
taesk/
├── scripts/
│   ├── test-all-batches.sh          # 新規: バッチ実行スクリプト
│   └── test-rerun-failed.sh         # 既存: 失敗テスト再実行
├── package.json                     # 更新: 新しいnpmスクリプト追加
└── docs/
    ├── detail/
    │   └── testing.md               # 更新: 新しい実行方法を追加
    └── tickets/
        └── 2025-10-29/
            └── 02-test-splitting-strategy.md  # 本ドキュメント
```

## 今後の改善案

1. **並列実行**: `test:all-split` で並列実行オプションを追加（`--parallel` フラグなど）
2. **進捗表示**: 各バッチの進捗をリアルタイム表示
3. **結果集約**: 各バッチの JSON レポートを統合して全体サマリーを生成
4. **CI設定**: GitHub Actions などで並列ジョブとして実行

## 関連チケット

- `01-mentions-display-cleanup.md` - TipTap メンション機能実装（テスト追加のきっかけ）
- `01-01-inline-mention-display.md` - インライン表示実装

## 実装完了

✅ package.json に7つのファイル別テストスクリプトを追加
✅ scripts/test-all-batches.sh を作成
✅ docs/detail/testing.md を更新
✅ 本チケットドキュメントを作成

全テスト実行がタイムアウトする問題を解決し、柔軟なテスト実行戦略を確立しました。
