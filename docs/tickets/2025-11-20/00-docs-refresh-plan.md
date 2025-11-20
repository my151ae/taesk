# 2025-11-20 ドキュメント刷新タスク計画

## 目的
- Kanban 前提で書かれている `AGENTS.md` と `docs/` 以下を Timeline 仕様へ全面更新
- 今日以降の作業ログと意思決定をチケットフォルダに集約
- ドキュメント刷新後に Timeline 向け E2E テストを作成・成功まで完了させる

## 現状整理（完了）
1. `docs/` の配下構造（`index`, `detail/*`, `setup`, `releases`, `tickets`）を確認し、Kanban 用語が散在している箇所を `rg` で洗い出し済み
2. Timeline 関連チケット（2025-11-17/19 フォルダ）に最新仕様が存在することを把握
3. `AGENTS.md` にも Kanban 固有の説明が多い点を確認

## 今後の作業方針
### フェーズA: ドキュメント更新計画の確定
- `docs/index.md`: プロダクト概要を「Timeline Board」に差し替え、Quick Start、Features、Architecture の図解を Timeline ベースに刷新
- `docs/detail/`: 8 ファイル（`architecture`, `components`, `database`, `deployment`, `notifications`, `routing`, `storage`, `testing`）を Timeline 視点で再構成  
  - 例: `KanbanBoardClient`→`TimelineBoardClient`/`useTimelineBoard` など現行コードへ合わせる
- `docs/setup/local-dev.md`: Timeline 前提のセットアップ手順（Feature Flag, Env）を追記
- `docs/releases/2025-10-phase3...`: Kanban→Timeline の移行ノートを反映させ、必要なら新しいリリースノートも追加
- `docs/tickets/`: 既存チケットのうち Kanban 参照が残っているものに注記を追加し、今日の成果を 2025-11-20 配下に追記
- `AGENTS.md`: Timeline を基準とした作業ルール／構成説明へリライト

### フェーズB: ドキュメント実装
1. `AGENTS.md` → Timeline 向けガイドラインに更新
2. `docs/index.md` → 全セクションを Timeline 設計で書き直し
3. `docs/detail/*` → ファイル単位で Kanban 用語を置換しつつ内容を再取材（Timeline のデータモデル・UI構造）
4. `docs/setup` / `docs/releases` / `docs/tickets` → 必要な追加ドキュメント（例: Timeline rollout メモ、tests & metrics）

### フェーズC: テスト計画と実行
1. Timeline 特有の E2E シナリオを決定（例: 日付バケット移動、A/B リスト⇔タイムライン間 DnD、カードモーダル URL 連携）
2. 新テスト spec 追加 & 既存 spec を Timeline 仕様へアップデート
3. Playwright テストを JSON レポート付きで実行 (`PW_WORKERS=1`, バッチ順守) し、`test-results/batches` へ保存

## タスク分担 & 優先度
| 優先 | タスク | 詳細 | 依存 |
| --- | --- | --- | --- |
| P0 | `AGENTS.md` 更新 | Timeline 前提の作業ルール・構造説明へ刷新 | フェーズA |
| P0 | `docs/index.md` 再執筆 | Timeline UI/機能説明、最新チケットへのリンク | フェーズA |
| P1 | `docs/detail/components.md` | `KanbanBoardClient` 依存を抽出し、Timeline 実装に置き換え | フェーズA |
| P1 | `docs/detail/architecture.md` | データフロー図・リアルタイム同期を Timeline ベースへ | フェーズA |
| P1 | `docs/detail/testing.md` | テスト戦略を Timeline spec 中心に再定義 | フェーズA |
| P2 | `docs/detail/storage.md` / `database.md` | Timeline 用フィールド (`due_start`, `due_end`, `due_bucket` etc.) を記載 | フェーズA |
| P2 | `docs/releases` / `docs/setup` | Timeline rollout の経緯とセットアップ差分をまとめる | フェーズA |
| P3 | `docs/tickets` 追加 | 2025-11-20 の成果ログ、今後の follow-up を記載 | フェーズB |
| P3 | Timeline E2E テスト | spec 追加 → 実行 → JSON レポート解析 | フェーズC |

## 成果物
- Timeline を唯一の正史とした `AGENTS.md` と `docs/` 一式
- Timeline 用 E2E テスト（Playwright JSON レポート + 解析ログ）
- `docs/tickets/2025-11-20/` 配下に進捗メモとテスト結果を追記予定

## 次アクション
1. フェーズAで列挙した各ファイルの更新要件を詳細化し、実際のリライトに着手
2. ドキュメント更新後、Timeline シナリオを網羅する Playwright テストを作成
3. JSON レポートとログを `test-results/` に保存し、docs/tickets に結果を書き残す
