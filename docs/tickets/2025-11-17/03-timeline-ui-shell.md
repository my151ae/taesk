# タイムライン UI シェル実装

**Status**: 🟡 In Progress（単一コンポーネントで骨格完成、分割と Suspense 未着手）  
**Priority**: 🔥 High  
**Created**: 2025-11-13 14:36 JST  
**Updated**: 2025-11-17  
**Assignee**: Frontend  
**Estimated**: 3d

## 概要
HTML モック（`00-today_list_layout_canvas.html`）のレイアウトを Next.js/Tailwind コンポーネントへ移植し、時間軸・日列・A/B 浮遊カードを描画できるシェルを構築する。旧 Kanban レイアウトは最終的に残さず、本 UI を新デフォルトにする前提で進める。

## 進捗メモ（2025-11-17）
- ✅ `TimelineBoardPage` が `app/(board)/_components/timeline/` に存在し、PNG 相当のレイアウト（時間軸/Live バッジ/A/B 浮遊カード/Now ライン）が Next.js + Tailwind で再現済み。
- ✅ ルーティングも `app/board/page.tsx` で Timeline UI を常時レンダリングするよう切り替え済み。
- ⚠️ コンポーネント分割（`TimelineBoardShell`, `DayColumn`, `ABListCard` など）は未実施で、巨大コンポーネントのまま。
- ⚠️ Feature Flag や Suspense/Loading skeleton、`useTimelineBoard` フックは未実装。`dataMode !== 'api'` でモック fallback しており、本番動線と整合していない。
- ⚠️ モバイル不可の案内や 7 列対応の余白など、仕様書で触れていた要素も未反映。
- 🎯 Next: 最初に DnD 動線を固める（ユーザー要望）→ その後コンポーネント分解 + Suspense 化 + Flag 整備に着手。

## 目的
- デザイン基盤を整え、以降のインタラクションやデータ連携タスクが UI に接続できる状態を作る。
- QA 期間を除き旧 Kanban レイアウトへ戻さない。`app/(board)` ルートそのものを Timeline ベースに置き換える準備をする。
- 将来は Today/Tomorrow から 7 日間ビュー、さらには「This week」「This month」のA/Bビューへ拡張できるよう、コンポーネントの列数/データモデルを柔軟にしておく。

## 実装内容
- [ ] `app/(board)/timeline/page.tsx`（仮）を追加し、Feature Flag でアクセス制御（Flag は QA 用に短期で保持。遺産として残さない）。
- [ ] `TimelineBoardShell`, `TimeAxis`, `DayColumn`, `ABListCard` などのコンポーネントを `app/(board)/_components/timeline/` に新設。
- [ ] Tailwind テーマへカスタムカラー/スペーシングを追加（`tailwind.config.ts`）。
- [ ] スクロール連動と sticky ヘッダーを CSS で再現。`prefers-reduced-motion` 対応。
- [ ] `NowIndicator` コンポーネントで赤ライン/ドットを計算し、`useEffect` でスクロール位置を調整。`serverNow` (JST) を初期オフセットに使用。
- [ ] MVP はデスクトップ専用スタイルとし、モバイルでは利用不可である旨を UI 上で案内。
- [ ] 7列表示・週間/今月A/Bビューを想定し、`DayColumn` を動的本数でレンダリングできるようにする（MVPでは2列のみ有効化）。

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
