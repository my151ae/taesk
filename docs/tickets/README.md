# Tickets - タスク管理

## フォルダ構造

```
docs/tickets/
├── README.md                    # このファイル（ルール説明）
├── YYYY-MM-DD/                  # 日付フォルダ（日本時間）
│   ├── 01-slug.md              # タスクチケット（連番）
│   ├── 02-another-task.md
│   └── ...
└── roadmap.md                   # ロードマップ
```

## チケット作成ルール

### ファイル命名規則

```
docs/tickets/YYYY-MM-DD/NN-<slug>.md
```

**例**:
- `docs/tickets/2025-10-09/01-add-authentication.md`
- `docs/tickets/2025-10-09/02-implement-realtime-sync.md`
- `docs/tickets/2025-10-10/01-add-tags-to-cards.md`

**構成要素**:
- `YYYY-MM-DD`: チケット作成日（**日本時間 JST/Asia/Tokyo**）
- `NN`: その日の連番（2桁ゼロパディング: 01, 02, 03...）
- `<slug>`: タスクの簡潔な説明（kebab-case）

**重要**:
- 日付・時刻は必ず**日本時間（JST）**を使用すること
- 連番は同じ日付フォルダ内で重複しないように採番
- 既存チケットを確認して次の番号を使用する

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
# 1. 日本時間で日付フォルダ作成（なければ）
mkdir -p docs/tickets/$(TZ='Asia/Tokyo' date +%Y-%m-%d)

# 2. 既存チケットを確認して次の連番を取得
DATE_DIR=docs/tickets/$(TZ='Asia/Tokyo' date +%Y-%m-%d)
NEXT_NUM=$(printf "%02d" $(($(ls $DATE_DIR/*.md 2>/dev/null | wc -l) + 1)))

# 3. チケットファイル作成
touch $DATE_DIR/${NEXT_NUM}-task-name.md
```

**簡易版**（連番を手動で確認）:
```bash
# 既存ファイルを確認
ls docs/tickets/$(TZ='Asia/Tokyo' date +%Y-%m-%d)/

# 次の番号でファイル作成
touch docs/tickets/$(TZ='Asia/Tokyo' date +%Y-%m-%d)/01-task-name.md
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
- [2025-10-09/01-add-google-auth.md](./2025-10-09/01-add-google-auth.md)
- [2025-10-09/02-implement-realtime-sync.md](./2025-10-09/02-implement-realtime-sync.md)
- [roadmap.md](./roadmap.md) - 全体ロードマップ

## 日本時間の取得方法

Claudeがチケットを作成する際は、以下の方法で日本時間を取得すること:

```bash
# 日付取得（YYYY-MM-DD）
TZ='Asia/Tokyo' date +%Y-%m-%d

# 時刻取得（HH:MM）
TZ='Asia/Tokyo' date +%H:%M

# フルタイムスタンプ
TZ='Asia/Tokyo' date '+%Y-%m-%d %H:%M'
```

**注意**: システムのデフォルトタイムゾーンに依存せず、必ず `TZ='Asia/Tokyo'` を明示的に指定すること。
