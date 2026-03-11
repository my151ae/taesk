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

## UI Scope (Timeline Only)
現在の運用UIは **Timeline + A/B リスト** のみ。`/b/...` ルートでは Kanban 画面は使用しない。
- Kanban 関連（`KanbanBoardClient` 等）の修正・言及は、明示的な依頼がない限り行わない。
- 不具合報告が `/b/...` に関する場合、Timeline 側のみを対象に調査・修正する。
- CardModal のタイトル/本文境界は「矢印によるフォーカス移動のみ」を正とする。詳細は `docs/spec/keyboard-navigation.md` を参照すること。

## Build, Test, and Development Commands
- `npm run dev` は使用可能。ただし起動前に既存プロセスを確認し、不要な dev サーバーを残したまま別ポートへ退避起動させないこと。
- ビルドエラー確認のための `npm run build` は実行可能。

```bash
lsof -i :3000
npm run lint
npm run build
npx playwright test --reporter=json > test-results/playwright-report.json
cat test-results/playwright-report.json | jq '.stats'
```

## Testing Guidelines
- `npm run dev` や Playwright 実行前に `lsof -i :3000` で Next.js サーバーが残っていないか確認すること。
- 既存サーバーを使い回さない場合は、先に停止してから起動すること。`3001` 以降への自動退避を許容しない。
- 検証が必要な場合は Playwright 実行後に chrome-devtools MCP を使ってログ・スナップショットを取得する。

## Supabase MCP 接続手順（運用）
- Supabase MCP の認証・疎通手順は `docs/spec/supabase-mcp-auth.md` を SSOT とする。
- 認証が切れた場合は `codex mcp login supabase` を実行し、ブラウザで OAuth を完了する。
- 接続確認は `mcp__supabase__list_projects`（MCP ツール呼び出し）を最初に実行する。
- `list_mcp_resources(server=\"supabase\")` は Supabase 側で未実装のため `Method not found` でも異常とは限らない。

## Commit & Pull Request Guidelines
短い命令形のコミットメッセージを推奨。ユーザーの承認なしで push しない。破壊的な git コマンドはユーザー指示がある場合のみ実行すること。
