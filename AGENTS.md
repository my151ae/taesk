# 基本ルール（ローカルコード実行禁止）

> **このリポジトリのSSOT（単一の真実）**:
> - 運用ルール/制約/禁止事項は `AGENTS.md`
> - 仕様・設計・手順の詳細は `docs/`（例: `docs/index.md`）

> - Python をはじめとしたローカルでのスクリプト／コード実行を **全面禁止** します。
> - 解析や変換、計算が必要な場合は CLI ツールや既存スクリプト、MCP ツール（例: Supabase MCP など）を優先的に利用してください。
> - git やシェルコマンド等の通常オペレーションは従来どおり許可されますが、目的達成のために新たな Python/Node などのワンオフ実行を作らないでください。
> - Playwright テストは **常に単一ワーカー（`PW_WORKERS=1`）** で順番に実行すること。並列実行や同時多発的なテスト起動は禁止。

# Repository Guidelines

> **最優先ルール（テスト・ログ取得）**
> - `npm run dev` / `NODE_ENV=test npm run dev` の起動前には、既存の Next.js 開発サーバーが残っていないか確認すること。意図せず `3001`, `3002` などへ退避起動させない。
> - すべての検証・テストは `npx playwright test --reporter=json` のように **必ず JSON レポートを出力**して解析すること。
> - テスト結果やログ確認で停止せずに済むよう、JSON ファイルを生成したうえで内容を確認し、失敗時は詳細を抽出する。

## Design & Responsive Guidelines
> **ハイドレーションエラー回避の鉄則**
> - Next.js (App Router) では `window.innerWidth` による条件付きレンダリングを避け、**Tailwind CSS のユーティリティクラス (`hidden`, `md:block` 等)** で表示制御を行うこと。
> - 詳細な実装パターンやAIへの指示テンプレートは [docs/spec/design-guidelines.md](docs/spec/design-guidelines.md) を参照。

## Communication Rules
対話は常に日本語で回答してください。返信時に英語へ切り替えないよう徹底し、必要に応じて専門用語のみ英語を併記します。

## UI Scope (Timeline / List / Month)
現在の運用UIは **Timeline / List / Month + A/B リスト** を正とする。`/b/...` ルートでは Kanban 画面は使用しない。
- Kanban 関連（`KanbanBoardClient` 等）の修正・言及は、明示的な依頼がない限り行わない。
- 不具合報告が `/b/...` に関する場合、Timeline 側のみを対象に調査・修正する。
- CardModal のタイトル/本文境界は、矢印によるフォーカス移動に加えて、タイトル欄の通常の `Enter` で本文1行目へ標準 paragraph を追加して本文へ移す。本文先頭行頭の `Backspace` は、先頭が空の top-level paragraph の場合だけその段落を削除してタイトル末尾へ戻し、それ以外は本文を変えずタイトル末尾へ戻す。IME 確定中の `Enter` は除外する。詳細は `docs/spec/keyboard-navigation.md` を参照すること。
- 左パネルのセクション追加は、**別ページを新設せず** `/b/...` の既存レイアウト内で完結させることをデフォルトとする。
- board navigation の canonical URL は `lp` / `rp` を使い、旧 `view` / `before` / `after` / `range` / `time` 契約は救済しない。契約外 URL は invalid URL として扱う。
- board navigation は no-exception contract を採用し、`lp` は left section、`rp` は right panel mode のみを表す。`lp` が `rp` を暗黙変更してはいけない。
- canonical default は `lp=overdue&rp=timeline` とする。invalid URL からの reset 先も同一 canonical URL とする。
- `rp` は `timeline` / `list` / `month` を正とし、desktop / mobile は同じ `BoardUiState` を共有する。viewport を理由に `rp` を別 mode へ書き換えてはいけない。
- `Search` / `Overdue` / `Tags` は left self-contained とし、入力・選択・結果表示は左パネル内で完結させる。
- 右パネル上部は今後も 2 段構成をデフォルトとし、1段目はレイアウト種別（例: `Timeline` / `List` / `Month`）、2段目はその左パネル項目に対応する専用メニューを配置する。行高・余白は既存 Timeline / List / Month ヘッダーに合わせて統一する。

## Build, Test, and Development Commands
- `npm run dev` は使用可能。ただし起動前に既存プロセスを確認し、不要な dev サーバーを残したまま別ポートへ退避起動させないこと。
- ビルドエラー確認のための `npm run build` は実行可能。
- Codex / MCP 経由のシェルでは `PATH` が最小化され、`node` / `npm` / `npx` が見えないことがある。**Node 系コマンドは必ず `zsh -lic '...'` で実行**して `~/.zprofile` / `~/.zshrc`（`nvm` 含む）を読み込むこと。
- `command not found: npm` が出た場合も、環境破損と断定せず次を先に実行して確認すること: `zsh -lic 'node -v && npm -v && npx -v'`

```bash
lsof -i :3000
zsh -lic 'npm run lint'
zsh -lic 'npm run build'
zsh -lic 'PW_WORKERS=1 npx playwright test --reporter=json > test-results/playwright-report.json'
cat test-results/playwright-report.json | jq '.stats'
```

## Testing Guidelines
- `npm run dev` や Playwright 実行前に `lsof -i :3000` で Next.js サーバーが残っていないか確認すること。
- 既存サーバーを使い回さない場合は、先に停止してから起動すること。`3001` 以降への自動退避を許容しない。
- 検証が必要な場合は Playwright 実行後に chrome-devtools MCP を使ってログ・スナップショットを取得する。
- Playwright が pass しても完了扱いにせず、**必ず browser console の runtime error / hydration error / React error (`Maximum update depth exceeded` など) を確認すること。** console error が残っている場合は、原因特定と解消、または未解消理由の明記まで行う。
- Timeline / List / Month の UI 変更では、focused E2E 実行後に browser console を確認し、エラー 0 件を確認するまで終了しないこと。
- CardModal 本文の Tiptap / ProseMirror block action を検証するときは `docs/spec/tiptap-block-action-testing.md` を参照し、見た目 DOM 件数より handle metadata と保存 JSON を優先すること。
- 一時的な実行結果や日時付きのテスト状況は `AGENTS.md` ではなく `docs/tickets/<date>/` に残すこと。`AGENTS.md` には恒久ルールだけを書く。

## Supabase MCP 接続手順（運用）
- Supabase MCP の認証・疎通手順は `docs/spec/supabase-mcp-auth.md` を SSOT とする。
- 認証が切れた場合は `codex mcp login supabase` を実行し、ブラウザで OAuth を完了する。
- 接続確認は `mcp__supabase__list_projects`（MCP ツール呼び出し）を最初に実行する。
- `list_mcp_resources(server=\"supabase\")` は Supabase 側で未実装のため `Method not found` でも異常とは限らない。
- **DB スキーマを変える修正では、コード変更だけで終えず必ず migration を作成・適用すること。** `supabase/migrations/` に migration を追加しただけでは完了扱いにしない。
- schema 追加/削除/カラム変更を含む修正では、作業完了前に「対象環境へ migration が適用済みであること」を確認すること。未適用のまま fetch / select が壊れる変更は完了扱いにしてはいけない。
- API や UI が新カラムを参照する変更では、migration 適用後に該当 fetch / mutation まで確認し、migration 未適用起因のエラーを残したまま終了しないこと。

## Commit & Pull Request Guidelines
短い命令形のコミットメッセージを推奨。ユーザーの承認なしで push しない。破壊的な git コマンドはユーザー指示がある場合のみ実行すること。
