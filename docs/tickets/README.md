# Tickets - タスク管理

## フォルダ構造

```
docs/tickets/
├── README.md                    # このファイル（ルール説明）
├── YYYY-MM-DD/                  # 日付フォルダ
│   ├── hhmm-slug.md            # タスクチケット
│   ├── hhmm-another-task.md
│   └── ...
└── roadmap.md                   # ロードマップ
```

## チケット作成ルール

### ファイル命名規則

```
docs/tickets/YYYY-MM-DD/hhmm-<slug>.md
```

**例**:
- `docs/tickets/2025-10-09/1430-add-authentication.md`
- `docs/tickets/2025-10-09/1445-implement-realtime-sync.md`
- `docs/tickets/2025-10-10/0900-add-tags-to-cards.md`

**構成要素**:
- `YYYY-MM-DD`: チケット作成日
- `hhmm`: 作成時刻（24時間形式）
- `<slug>`: タスクの簡潔な説明（kebab-case）

### チケットテンプレート

```markdown
# [タイトル]

**Status**: 🔴 Not Started | 🟡 In Progress | 🟢 Completed | ⚫ Cancelled
**Priority**: 🔥 High | 🔵 Medium | ⚪ Low
**Created**: YYYY-MM-DD hhmm
**Assignee**: [担当者]
**Estimated**: [X hours/days]

## 概要

[タスクの概要を1-2文で]

## 目的

[なぜこのタスクが必要か]

## 実装内容

- [ ] タスク1
- [ ] タスク2
- [ ] タスク3

## 技術的詳細

[実装の詳細、使用する技術など]

## 受け入れ基準

- [ ] 基準1
- [ ] 基準2
- [ ] 基準3

## 関連チケット

- [#YYYY-MM-DD/hhmm-related-task](./YYYY-MM-DD/hhmm-related-task.md)

## ノート

[追加のメモ、懸念事項など]
```

## ステータス管理

### ステータス一覧

| アイコン | ステータス | 説明 |
|---------|-----------|------|
| 🔴 | Not Started | 未着手 |
| 🟡 | In Progress | 作業中 |
| 🟢 | Completed | 完了 |
| ⚫ | Cancelled | キャンセル |
| 🔵 | Blocked | ブロック中 |

### 優先度

| アイコン | 優先度 | 説明 |
|---------|--------|------|
| 🔥 | High | 最優先 |
| 🔵 | Medium | 中優先 |
| ⚪ | Low | 低優先 |

## ワークフロー

### 1. チケット作成

```bash
# 1. 日付フォルダ作成（なければ）
mkdir -p docs/tickets/$(date +%Y-%m-%d)

# 2. チケットファイル作成
touch docs/tickets/$(date +%Y-%m-%d)/$(date +%H%M)-task-name.md
```

### 2. チケット記入

テンプレートに従って内容を記入

### 3. ロードマップ更新

`docs/tickets/roadmap.md` にチケットを追加

### 4. 作業開始

ステータスを 🟡 In Progress に変更

### 5. 完了

- ステータスを 🟢 Completed に変更
- 完了日時を記録
- 関連コミットハッシュを記録

## カテゴリー（slugの命名）

推奨されるslugのプレフィックス:

### 機能追加
- `add-*`: 新機能追加
- `feature-*`: 大きな機能
- `implement-*`: 実装タスク

### 改善
- `improve-*`: 既存機能の改善
- `refactor-*`: リファクタリング
- `optimize-*`: パフォーマンス最適化

### 修正
- `fix-*`: バグ修正
- `bugfix-*`: バグフィックス
- `hotfix-*`: 緊急修正

### ドキュメント
- `doc-*`: ドキュメント作成・更新
- `docs-*`: ドキュメント

### テスト
- `test-*`: テスト追加
- `e2e-*`: E2Eテスト

### 設定・環境
- `setup-*`: セットアップ
- `config-*`: 設定変更
- `ci-*`: CI/CD関連

### デザイン
- `ui-*`: UI変更
- `ux-*`: UX改善
- `style-*`: スタイリング

## チケット検索

### 日付で検索

```bash
ls docs/tickets/2025-10-09/
```

### キーワードで検索

```bash
grep -r "authentication" docs/tickets/
```

### ステータスで検索

```bash
grep -r "Status.*In Progress" docs/tickets/
```

## ベストプラクティス

1. **明確なタイトル**: 何をするかが一目でわかるタイトルをつける
2. **小さく分割**: 大きなタスクは複数のチケットに分割
3. **関連付け**: 関連するチケットは相互リンクする
4. **定期的な更新**: 進捗に応じてステータスを更新
5. **完了時の記録**: コミットハッシュやPR番号を記録

## 自動化（将来）

将来的には以下の自動化を検討:

- チケット作成CLIツール
- ステータス更新の自動化
- 完了チケットのアーカイブ
- ロードマップの自動生成

## 例

実際のチケット例:
- [2025-10-09/1430-add-authentication.md](./2025-10-09/1430-add-authentication.md)
- [roadmap.md](./roadmap.md) - 全体ロードマップ
