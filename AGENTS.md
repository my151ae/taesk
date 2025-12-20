# 基本ルール（ローカルコード実行禁止）

> **このリポジトリのSSOT（単一の真実）**:
> - 運用ルール/制約/禁止事項は `AGENTS.md`
> - 仕様・設計・手順の詳細は `docs/`（例: `docs/index.md`）

> - Python をはじめとしたローカルでのスクリプト／コード実行を **全面禁止** します。
> - 解析や変換、計算が必要な場合は CLI ツールや既存スクリプト、MCP ツール（例: Supabase MCP など）を優先的に利用してください。
> - git やシェルコマンド等の通常オペレーションは従来どおり許可されますが、目的達成のために新たな Python/Node などのワンオフ実行を作らないでください。
> - Playwright テストは **常に単一ワーカー（`PW_WORKERS=1`）** で順番に実行すること。まず失敗しているバッチを個別スクリプト (`npm run test:timeline` など) で通し、その後 `npm run test:all-split` を回して最終確認する。並列実行（デフォルト workers>1）や同時多発的なテスト起動は禁止。

# Repository Guidelines

> **最優先ルール（テスト・ログ取得）**
> - いかなる理由でも `npm run dev` および `NODE_ENV=test npm run dev` を **絶対に実行しない**。サーバーを直接起動しての手動検証・ログ確認も禁止。
> - Playwright を含むすべての検証・テストは `npx playwright test --reporter=json` のように **必ず JSON レポートを出力**して解析すること。
> - テスト結果やログ確認で停止せずに済むよう、JSON ファイルを生成したうえで内容を確認し、失敗時は解析用スクリプト（例: `python - ... json.loads`）で詳細を抽出する。
> - 上記方針に反するコマンド・手順は今後一切行わない。
> - `npx playwright test --reporter=list` など JSON を生成しないレポーターは **使用禁止**。
> - `npx playwright test --reporter=list` など JSON を生成しないレポーターは **使用禁止**。
- Playwright の `webServer.command` が内部で `NODE_ENV=test npm run dev` を起動する点のみ例外扱いとし、手動で `npm run dev` を叩かない。実行前にポート 3000 が空いているか確認し、孤立した `next dev`/`playwright test` プロセスは必ず停止させてからテストを開始する。

## Design & Responsive Guidelines
> **ハイドレーションエラー回避の鉄則**
> - Next.js (App Router) では `window.innerWidth` による条件付きレンダリングを避け、**Tailwind CSS のユーティリティクラス (`hidden`, `md:block` 等)** で表示制御を行うこと。
> - 詳細な実装パターンやAIへの指示テンプレートは [docs/design-guidelines.md](docs/design-guidelines.md) を参照。

## 現状メモ（2025-11-20 JST）

- ボード UI は **Timeline Board** が唯一の正史。旧 Kanban UI は `app/(board)/_components/KanbanBoardClient.tsx` に残るが参照用で、ルーティングからは呼ばれない。
- Timeline 専用フィールド (`due_channel`, `due_start`, `due_end`, `due_bucket`, `due_bucket_position`) を利用する Supabase migration は適用済み。カード/リスト API、CardModal、Playwright spec はすべて新フィールドを前提に動作。
- `app/board/page.tsx` が `TimelineBoardPage` を直接レンダリングし、`getBoardById(MAIN_BOARD_ID)` でメインボードを取得する構成に切り替わっている。
- リアルタイム更新とオフライン同期は `useRealtimeBoard` / `useSyncQueue` フックを通じて Timeline に統合済み。`useBoardFilters` でフィルター/検索も共通化。
- テストバッチは `auth`, `timeline`, `comments`, `notifications`, `reorder`, `permissions`, `rls` の 7 セットを維持。`timeline` バッチは `e2e/timeline.spec.ts` を中心に Today/Tomorrow カラムと A/B リストの描画、メトリクス発火を確認する。
- 最新 Playwright サマリーのログは `docs/tickets/2025-11-10/01-test-all-split-summary.md` 以降を参照。`comments` バッチに Flaky が残る場合は同ファイルの手順で個別再実行してから `npm run test:all-split` を回す。
- `tsconfig.tsbuildinfo` はビルド生成物のため常に差分が残っている。コミット対象外とする。

## Communication Rules
対話は常に日本語で回答してください。返信時に英語へ切り替えないよう徹底し、必要に応じて専門用語のみ英語を併記します。

## Project Structure & Module Organization
- ルート `/board` は `app/board/page.tsx` を通じて `TimelineBoardPage` を描画し、Today/Tomorrow の時間軸および A/B リストを一体的に扱う。
- Timeline UI は `app/(board)/_components/timeline/TimelineBoardPage.tsx` に集約され、以下を実装:
  - JST 基準のスケール描画（24h×40px）、A/B カード描画、Now ライン、フィルター/検索 UI
  - `@dnd-kit` によるイベントブロックのドラッグ移動と A/B ⇄ Timeline の所属切り替え
  - `CardModal` や `CommentsPanel` を開くための URL シンク（`?card=SHORTID`, `/c/SHORTID`）
  - `createClientTrace('timeline')` によるメトリクス送信
- 共通フック/ストア:
  - `app/(board)/_hooks/useRealtimeBoard.ts`: Supabase Realtime でカード更新を購読し、Timeline 形式に変換
  - `app/(board)/_hooks/useSyncQueue.ts`: オフラインキューとロールバック処理
  - `app/(board)/_hooks/useBoardFilters.ts`: タグ・優先度・文字列検索フィルター
  - `app/(board)/_stores/comments-store.ts`: コメントパネルの状態管理
- `app/(board)/@modal/(...)c/[short_id]/[[...slug]]/page.tsx` は Timeline からのインターセプトモーダルとカード詳解を描画する。`CardModal` は `due_*` フィールド編集をサポート。
- API ルートは `app/api/boards/[boardId]/timeline/route.ts` が Today/Tomorrow + A/B の統合レスポンスを返す。従来のリスト/カード API (`app/api/boards/...`) も Timeline から呼ばれる。
- `lib/` では `lib/supabase.ts` が Timeline 用フィールドを含む型を定義し、`lib/metrics/{client,server}.ts` が `timeline` トレースを共通化。

### Recent Architectural Notes
- `due_channel` によって `timeline` / `ab-list` / `list-only` / `archived` の所属を排他制御。A/B カードには `due_bucket` と `due_bucket_position` を付与。
- `TimelineBoardPage` は `useRealtimeBoard` 経由で受け取ったカード変更を `events` と `abBuckets` に反映し、`useSyncQueue` でローカル変更→API→ロールバックの流れを統合。
- `CardModal` では `due_start`/`due_end` の 1 分単位編集、`due_bucket` 切り替え、コメントタブ、メンバー設定が可能。保存後は Timeline 側に Optimistic Update を行い、必要に応じて再フェッチ。
- 通知音は `lib/notification-audio.ts` + `NotificationSoundPlayer.tsx` を利用し、Timeline でも「音声を有効化」→「テスト音を再生」で検証する。

## Build, Test, and Development Commands
- `npm run dev` は全面禁止。Playwright の `webServer.command` 以外で Next.js サーバーを起動しない。
- **更新**: `npm run build` はビルドエラー確認のため実行してよい。
- ビルド/検証の代表コマンド:

```bash
npm run lint
npm run build
npx playwright test --reporter=json > test-results/playwright-report.json
cat test-results/playwright-report.json | jq '.stats'
```

- `.env.test` は `playwright.config.ts` が自動で読み込む。`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` を必ず設定。
- JSON だけ確認したい場合も `npx playwright test --reporter=json` を徹底し、`jq` か `tail` で `expected/unexpected/skipped/flaky` を抽出。
- HTML レポートが必要なら `npx playwright show-report --port=0` を使い、プロセス終了を忘れない。

## Testing Guidelines
- テスト実行前に `lsof -i :3000` で Next.js dev サーバーが残っていないか確認し、残っていたら `pkill -f 'node .*next dev'` / `pkill -f 'playwright test'` を実行してから再試行する。
- `npm run test:all-split` が必須フロー。内部で `scripts/test-all-batches.sh` が `PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/batches/<timestamp>-<batch>.json` をセットし、`test-results/batches/` に JSON を保存。
- 個別検証は `npm run test:timeline`, `npm run test:comments` などスクリプトを利用し、`PW_WORKERS=1` を守る。Timeline バッチでは Today/Tomorrow 列の表示、A/B リストの所属変更、`dumpClientMetrics`（`timeline` トレース）の呼び出しを検証。
- JSON レポートを解析するときは `sed -n '/^{/,$p' test-results/playwright-report.json | jq '.stats'` のように余計なログを除去してから `jq` へ渡す。
- `playwright/.auth/user.json` はグローバルセットアップで作成される。トークン失効時のみ削除してフローをやり直す。
- `test-results/` 以外にレポートを生成しない。旧ログを参照する際は `test-results/archive/` へ退避してから扱う。
- 通知音やカードモーダルなど UI の確認が必要な場合は Playwright 実行後に chrome-devtools MCP を使ってログ・スナップショットを取得する（直接 `npm run dev` で確認しない）。

## Commit & Pull Request Guidelines
短い命令形のコミットメッセージ（例: `Switch board docs to timeline`）を推奨。1コミット1トピックを守り、PR ではユーザー向け影響・主要変更点・関連チケット (`docs/tickets/...`)・必要なスクリーンショットや Playwright トレースを記載する。ユーザーの承認なしで push しない。

## Security & Configuration Tips
Supabase の service-role key をコミットしない。`.env.example` に新規変数を追加したら説明を添える。破壊的な git コマンド（`git reset --hard` など）はユーザー指示がある場合のみ実行。既存の作業ツリー差分は勝手に触らず、必要なファイルのみ編集する。

## Workflow Reminders
作業前に関連 `docs/` や `docs/tickets/` を読み、Timeline の仕様差分を把握する。開発中は Playwright JSON レポートを常に確認し、失敗時はログ解析・個別バッチ再実行を優先する。最終引き渡し前に必要な npm スクリプト（lint/test 等）を実行し、得られたログは `docs/tickets/` へ整理して共有する。
