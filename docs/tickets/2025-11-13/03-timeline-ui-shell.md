# タイムライン UI シェル実装

**Status**: 🔴 Not Started  
**Priority**: 🔥 High  
**Created**: 2025-11-13 14:36 JST  
**Assignee**: Frontend  
**Estimated**: 3d

## 概要
HTML モック（`00-today_list_layout_canvas.html`）のレイアウトを Next.js/Tailwind コンポーネントへ移植し、時間軸・日列・A/B 浮遊カードを描画できるシェルを構築する。旧 Kanban レイアウトは最終的に残さず、本 UI を新デフォルトにする前提で進める。

## 目的
- デザイン基盤を整え、以降のインタラクションやデータ連携タスクが UI に接続できる状態を作る。
- QA 期間を除き旧 Kanban レイアウトへ戻さない。`app/(board)` ルートそのものを Timeline ベースに置き換える準備をする。

## 実装内容
- [ ] `app/(board)/timeline/page.tsx`（仮）を追加し、Feature Flag でアクセス制御（Flag は QA 用に短期で保持。遺産として残さない）。
- [ ] `TimelineBoardShell`, `TimeAxis`, `DayColumn`, `ABListCard` などのコンポーネントを `app/(board)/_components/timeline/` に新設。
- [ ] Tailwind テーマへカスタムカラー/スペーシングを追加（`tailwind.config.ts`）。
- [ ] スクロール連動と sticky ヘッダーを CSS で再現。`prefers-reduced-motion` 対応。
- [ ] `NowIndicator` コンポーネントで赤ライン/ドットを計算し、`useEffect` でスクロール位置を調整。`serverNow` (JST) を初期オフセットに使用。
- [ ] MVP はデスクトップ専用スタイルとし、モバイルでは利用不可である旨を UI 上で案内。

## 技術的詳細
- 既存の `KanbanBoardClient` は巨大なクライアントコンポーネントのため、新 UI は分離した `useTimelineBoard` フックでデータを取得し、`Suspense` + `Loading skeleton` を持たせる。旧 UI へ依存する import を段階的に除去できる構造にする。
- スタイルは Tailwind + CSS Modules で構成。`hour-height` は `rem` ベースで計算し、レスポンシブで 32px / 40px を切替。
- テストは Storybook が無いので、`playwright/component` ではなく E2E で確認する。UI スナップ差分は Percy 等外部ツール無し。

## 受け入れ基準
- [ ] Timeline ページにアクセスすると PNG と同等の骨格が表示される（ダミーデータで可）。
- [ ] `npm run lint` / `npm run build` が通る。
- [ ] Lighthouse で CLS < 0.01（タイムライン初期表示）。
- [ ] 旧 Kanban への戻りリンクや UI が存在しない（Feature Flag 以外）。

## 関連チケット
- [00- TaeskMap マスタープラン](./00-today-list-layout.md)
- [02-timeline-query-endpoints.md](./02-timeline-query-endpoints.md)
- [04-timeline-drag-drop.md](./04-timeline-drag-drop.md)
