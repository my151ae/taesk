# 00 - TaeskMap 今日/明日レイアウト マスタープラン

**Status**: 🔴 Not Started  
**Priority**: 🔥 High  
**Created**: 2025-11-13 14:26 JST  
**Assignee**: 未アサイン（PM/Design 共通タスク）  
**Related Assets**: [today_list_layout_canvas.html](./today_list_layout_canvas.html), [today_list_layout_canvas.png](./today_list_layout_canvas.png)

---

## 1. 背景と現状整理
- 現行のボードは `KanbanBoardClient` が DnD Kit ベースで全ロジックを抱える完全なカンバン UI（`app/(board)/_components/KanbanBoardClient.tsx:1`）。リスト/カードの CRUD、オフライン同期、メンバー共有、コメントモーダルなど全てが単一ツリー上で管理されている。
- データモデルは `lib/supabase.ts:94` の `Board`/`List`/`Card` インターフェースに依存し、時間ベースのフィールドは `due_date` のみ。タイムライン固有の「開始/終了時刻」「所属日」「セクション種別」は存在しない。
- 最新のテスト状況（`docs/tickets/2025-11-10/01-test-all-split-summary.md`）では `comments` バッチに Flaky が残っており、Card Modal/コメント API を弄る改修と競合する恐れがある。今後の E2E 追加は JSON レポート必須・単一ワーカーなど AGENTS ルールに従う必要がある（`AGENTS.md`）。
- 既存のパフォーマンス/メトリクスは `createClientTrace` や `lib/metrics/{client,server}.ts` で板読み込みに特化しており、時間軸データの遅延を捉える仕組みは無い。
- `docs/tickets/taeskmap/today_list_layout_canvas.html` と PNG が示す UI が今回の完成形。Today/Tomorrow 列、GMT 表示、赤い「Now」ライン、浮遊する A/B リストカード（今日/明日の A/B セクション）が特徴。

## 2. 目標体験サマリ
1. **時間軸 + 日付列のハイブリッド**: 左に 24h の時間軸を固定表示しつつ、中央に Today、右に Tomorrow 列をスクロール。現在時刻の赤ライン/ドットで即座に「今」を把握。
2. **A/B リストモジュール**: Today/Tomorrow それぞれで A=Must / B=Nice-to-have の 2 セクションを浮遊カードとして表示。タイムラインとは別のワークスタックを確保する。
3. **カード/イベントの二面性**: 一部カードは時間ブロックとしてタイムラインに、他は A/B リストに属する。どちらも既存カード/モーダルと連動し、チェックボックスで完了。

## 3. ユースケース
- 朝イチで「今日のブロック」をタイムラインに配置し、A/B リストで未スケジュールタスクをストック。
- クライアント会議など固定時間の予定を Today 列に表示、時間外のリサーチは Tomorrow A/B に逃がす。
- 実行中にカードをドラッグして延長/延期。完了済みは線を引く/淡色化し、モーダルから詳細編集。

## 4. 仕様詳細
### 4.1 レイアウト
- グローバルヘッダーは既存 Kanban の `board-header` を流用しつつ、「Live」ステータスと日付ナビ（Today ボタン、日付ピッカー予備）を追加。
- `calendar-shell` のように 3 カラム（時間軸 + 2 日列）を固定幅で展開。高さは 9h 相当で縦スクロール、ヘッダーは sticky。

### 4.2 時間軸 & Now インジケーター
- CSS `--hour-height` を 40px で固定。Now Dot/Line は JS で位置を算出し、初期スクロールを「Now 付近」に寄せる（HTML モックと同等のロジック）。
- タイムラベルは 00:00〜23:00 を 1h 刻み生成。将来的に 15m/30m 刻みも視野に入るよう分解ロジックを `lib/date-utils` に切り出す案。

### 4.3 日列 & イベント表示
- 各日列は `section.day` の中で時間軸に align。イベント DOM は `div.event` をカード ID で data 属性化し、クリックで `CardModal` を呼ぶ。
- Today 列のみ「赤ライン」を重ね、Tomorrow には出さない仕様（HTML 参照）。
- イベント幅は列幅 - 16px。時間重複がある場合は CSS グリッド/absolute で左右に寄せてオーバーラップを示す。

### 4.4 A/B リストカード
- A/B モジュールは日列上部に `position:absolute` で浮かせる。モバイルでは縦積み。
- Content: タイトル（"A/B Today" 等）、セクション A/B のラベルとチェックリスト。チェック済みは打ち消し線 + 透過 60%。
- 3 ドットメニューに「Open board list」「Convert to timeline block」「Duplicate to Tomorrow」を収録予定。

### 4.5 インタラクション
- Timeline ⇄ A/B リスト間のドラッグ & ドロップが必須。既存の DnD Kit 実装（`app/(board)/_components/KanbanBoardClient.tsx:5-27`）を拡張し、`coordinatesGetter` を時間軸ベースに変更する。
- カードクリックは既存 `CardModal` (`app/components/CardModal.tsx`) を再利用し、`card=<shortId>` クエリもサポート。
- キーボード操作: `↑↓` で 30 分単位移動、`⌘+Enter` で完了切り替え。

### 4.6 パフォーマンス/メトリクス
- ロード時に `createClientTrace`（`app/(board)/_components/KanbanBoardClient.tsx:52`）へ新しい `phase: "timeline"` を送信し、`metricsJson` に「timeline-render-ms」「timeline-events-count」を追加。
- 既存の `test-summary.js` の `board-load` p95 監視に時間軸描画を加味する。

### 4.7 アクセシビリティ/レスポンシブ
- タブ順は時間軸→Today 列→Tomorrow 列→A/B カード。
- スクロール連動は `aria-live="polite"` で Now 変化を読み上げ。ハイコントラスト配色も CSS カスタムプロパティで切替。

## 5. データ & API 要件
1. **新フィールド**: `cards` テーブルに `scheduled_date (date)`, `scheduled_start (time)`, `scheduled_end (time)`, `schedule_channel ('timeline' | 'ab-list')`, `schedule_bucket ('today-a' | 'today-b' | ...)` を追加。型は `NOT NULL` ではなく null 可にし、既存 Kanban との互換性を確保。
2. **派生テーブル案**: 「繰り返し」や複数ボード共有が必要なら `timeline_events` (card_id, board_id, date, start_at, end_at, column, source) を検討。
3. **API 拡張**: `app/api/boards/[boardId]/cards` 取得時に新フィールドを返し、`sanitizeCardsForUpload` (`lib/supabase.ts:137`) でも落とさないよう更新。
4. **Migration/Backfill**: 既存カードは `schedule_channel='list-only'` として扱い、今回のビューでは非表示 or A/B backlog にまとめる方針をチケットで決める。
5. **オフライン同期**: `syncQueue` (`app/(board)/_components/KanbanBoardClient.tsx:43`) の payload schema を広げ、ローカルキャッシュ (`STORAGE_KEY`) にも新フィールドを保存。

## 6. 実装チケット一覧
| Ticket | Scope | 目的/概要 |
| --- | --- | --- |
| [2025-11-13/01-schedule-data-model.md](../2025-11-13/01-schedule-data-model.md) | DB/型拡張 | Supabase schema と型定義(`lib/supabase.ts`)に時間軸フィールドを追加し、移行 & バックフィル戦略を決める |
| [2025-11-13/02-timeline-query-endpoints.md](../2025-11-13/02-timeline-query-endpoints.md) | API/Server | 新フィールドを含む Board/Timeline 取得 API、A/B バケットのフィルタリング、Now インジケータのためのサーバ時刻エンドポイントを整備 |
| [2025-11-13/03-timeline-ui-shell.md](../2025-11-13/03-timeline-ui-shell.md) | UI/Design System | HTML モックを Next/Tailwind に移植し、時間軸/列/A/B コンポーネントのスタイル基盤を作る |
| [2025-11-13/04-timeline-drag-drop.md](../2025-11-13/04-timeline-drag-drop.md) | Interaction | DnD Kit のセンサー、カード ↔ イベント変換ロジック、スナップ/制約/アクセシビリティを実装 |
| [2025-11-13/05-floating-list-card-modal.md](../2025-11-13/05-floating-list-card-modal.md) | UX/Modal | A/B カードと CardModal の連動、チェックリスト、完了ステータス同期、コメント/通知整合を担保 |
| [2025-11-13/06-metrics-and-tests.md](../2025-11-13/06-metrics-and-tests.md) | QA/Metrics | Timeline 用メトリクス、Playwright シナリオ、Flaky 対策、`npm run test:all-split` への組み込み |

## 7. 確認が必要なポイント
1. **スケジューリングの粒度**: 30 分単位固定か、ユーザー指定の任意分単位か。UX/実装コストに直結。
2. **タイムゾーン**: 表示は常に `GMT+09` 固定か、ユーザー設定に応じて可変にするか。サーバ/DB 保存の基準時刻も要確認。
3. **A/B リストのデータ源**: 既存リストをマッピングするのか、新たに `ab_sections` 的なデータを足すのか。
4. **カード多重所属**: 1 カードがタイムラインと A/B に同時所属できるか（例: 時間ブロック + backlog チェック）。
5. **繰り返し予定/ドラッグ複製**: 毎週の定例をどう表現するか。
6. **モバイル対応優先度**: MVP でレスポンシブ必須か、デスクトップ優先で良いか。
7. **通知/同期**: Timeline 変更を他メンバーへどう通知するか（Realtime チャンネルのチャネル種別拡張が必要）。

## 8. リスク & 次アクション
- `KanbanBoardClient` の肥大化：時間軸専用の `TaeskMapTimelineClient` を分離しないと管理不能になる恐れ。`app/(board)/b/...` ルートを分岐して A/B/Timeline の feature flag を掛ける案を検討。
- コメント/カード API の Flaky が残存しているため（`docs/tickets/2025-11-10/01-test-all-split-summary.md`）、CardModal を触るタスク（Ticket 05）はテスト安定化後に着手。
- Schema 変更は Supabase migration で対応し、`tsconfig.tsbuildinfo` のノイズは commit 対象から外す。

**次ステップ**: 上表の 6 チケットをキックオフし、仕様未定点のヒアリングを完了 → UI プロトタイプ（Next.js）→ Supabase migration → Timeline beta を Feature Flag で限定提供。
