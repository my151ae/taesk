# 00 - TaeskMap 今日/明日レイアウト マスタープラン

**Status**: 🟡 In Progress（UI シェル配備済み、DnD/データ連携を継続）  
**Priority**: 🔥 High  
**Created**: 2025-11-13 14:26 JST  
**Updated**: 2025-11-17  
**Assignee**: 未アサイン（PM/Design 共通タスク）  
**Related Assets**: [00-today_list_layout_canvas.html](./00-today_list_layout_canvas.html), [00-today_list_layout_canvas.png](./00-today_list_layout_canvas.png), [00-recognition-qa.md](./00-recognition-qa.md)

---

## 0. 進捗サマリ（2025-11-17）
- ✅ 新 UI シェルは `app/board/page.tsx` / `app/(board)/b/[short_id]/[[...slug]]/page.tsx` から `TimelineBoardPage` を直接読み込み、旧 Kanban には戻らない流れが確立済み。
- ✅ レイアウト/デザインは `app/(board)/_components/timeline/TimelineBoardPage.tsx` で PNG スケッチどおりに描画できており、Live バッジ/Now ライン/浮遊 A/B カードを含む「最低限の見た目」が揃った。
- ⚠️ DnD とデータ反映は暫定実装。A/B ↔ Timeline 間のドラッグ、`due_bucket` 並び順、`syncQueue` 連動など計画書の要件は未完。
- 🎯 **次ステップ**: このデザインを維持したまま、開発環境で A/B 内ドラッグおよびタイムラインへのドロップを最低限動かし、動線を固めてから詳細機能（通知/繰り返し/週間ビューなど）へ進む。


## 1. 背景と現状整理
- 現行のボードは `KanbanBoardClient` が DnD Kit ベースで全ロジックを抱える完全なカンバン UI（`app/(board)/_components/KanbanBoardClient.tsx:1`）。リスト/カードの CRUD、オフライン同期、メンバー共有、コメントモーダルなど全てが単一ツリー上で管理されている。
- データモデルは `lib/supabase.ts:94` の `Board`/`List`/`Card` インターフェースに依存し、時間ベースのフィールドは `due_date` のみ。タイムライン固有の「開始/終了時刻」「所属日」「セクション種別」は存在しない。
- 最新のテスト状況（`docs/tickets/2025-11-10/01-test-all-split-summary.md`）では `comments` バッチに Flaky が残っており、Card Modal/コメント API を弄る改修と競合する恐れがある。今後の E2E 追加は JSON レポート必須・単一ワーカーなど AGENTS ルールに従う必要がある（`AGENTS.md`）。
- 既存のパフォーマンス/メトリクスは `createClientTrace` や `lib/metrics/{client,server}.ts` で板読み込みに特化しており、時間軸データの遅延を捉える仕組みは無い。
- `00-today_list_layout_canvas.html/.png` が示す UI が今回の完成形。Today/Tomorrow 列、GMT 表示、赤い「Now」ライン、浮遊する A/B リストカード（今日/明日の A/B セクション）が特徴。
- 認識合わせの履歴は [00-recognition-qa.md](./00-recognition-qa.md) に集約し、確定事項/宿題を随時更新する。
- **Legacy を残さない方針**: 旧 Kanban レイアウトは最終的に廃止し、Timeline UI を正規ルートに一本化。QA/ロールアウト用の一時的な Feature Flag は許容するが、遺産として恒久運用しない。

### 1.1 最新決定事項（2025-11-13）
| 項目 | 決定内容 |
| --- | --- |
| スケジューリング粒度 | Google カレンダー同等の **1 分単位**。内部表現も分解能 1 分を維持する |
| タイムゾーン | **常に GMT+09 (JST)** 固定表示。日付は既存 `due_date`、時間は `due_start/due_end` で扱う |
| A/B リスト | 既存リストの流用はせず、`due_bucket` など **独立した A/B メタ**で管理する |
| 所属 | **Timeline と A/B は排他**。移動時に片方へ所属させる（同時所属なし） |
| 繰り返し・通知 | いずれも **後続対応**。今回の MVP では対象外 |
| DnD/リサイズ刻み | **15 分単位でスナップ**。CardModal 等の詳細入力で 1 分単位を保存・描画 |
| レスポンシブ | **デスクトップ優先**。モバイルは後続スプリントで検討 |

以降のチケットと仕様はこの決定を前提に最小構成へリライト済み。

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
- タイムラベルは 00:00〜23:00 を 1h 刻み表示。内部スケジュールは **1 分単位** を保持するが、UI グリッド/スナップは 15 分刻み。詳細編集で 1 分単位を入力すると表示高さも追随する（Google カレンダーと同様）。日付は `due_date`、時間は `due_start/due_end` を使用。
- タイムゾーンは **JST 固定**（GMT+09を明示）。サーバから受け取る `serverNow` でローカル時計のズレを補正し、Now ライン/スクロール初期位置に反映する。

### 4.3 日列ヘッダー & 日付ナビ
- Today/Tomorrow ヘッダーは `calendar-header` と同期し、日付ナビ（Today ボタン、日付ピッカー）で `due_date` の基準日を切り替える。
- 週次ビューへの拡張に備え、ヘッダー/列レンダリングは Today〜+6 日まで可変長で描画できる API を設計する。

### 4.4 日列 & イベント表示
- 各日列は `section.day` の中で時間軸に align。イベント DOM は `div.event` をカード ID で data 属性化し、クリックで `CardModal` を呼ぶ。
- Today 列のみ「赤ライン」を重ね、Tomorrow には出さない仕様（HTML 参照）。将来的に Today〜+6 日まで 7 列を展開できる拡張性を前提にレイアウトを設計。
- 列所属判定は `due_date` に基づき、自動で対応列へカードを配置する。
- イベント幅は列幅 - 16px。時間重複がある場合は CSS グリッド/absolute で左右に寄せてオーバーラップを示す。

### 4.5 日跨ぎルール
- MVP では **1 日内に完結するイベントのみ許容**。`due_start/due_end` は同日の範囲に収める。23:30→25:00 のような日跨ぎは非対応で、必要な場合は複数イベントへ分割する。
- 週次/月次ビュー実装時に跨ぎ対応を再検討する。

### 4.6 A/B リストカード
- A/B モジュールは日列上部に `position:absolute` で浮かせる。MVP はデスクトップ専用、モバイルは後続対応。
- Content: タイトル（"A/B Today" 等）、セクション A/B のラベルとチェックリスト。チェック済みは打ち消し線 + 透過 60%。
- 3 ドットメニューは Timeline との移動導線（Convert/Move/Duplicate）に絞り、旧 Kanban リストを開く導線は削除。
- データ源は `due_channel='ab-list'` と `due_bucket`（`today_a`, `today_b`, ...）で管理し、既存カンバン list_id とは無関係。

### 4.7 インタラクション
- Timeline ⇄ A/B リスト間のドラッグ & ドロップが必須。既存の DnD Kit 実装（`app/(board)/_components/KanbanBoardClient.tsx:5-27`）を拡張し、`coordinatesGetter` を時間軸ベースに変更する。
- DnD/リサイズのスナップは **15 分刻み**。ドラッグ完了時に内部値も 15 分に丸める。CardModal の詳細フォームで 1 分単位を入力すると、その値が保存されイベント高さも更新される。
- カードクリックは既存 `CardModal` (`app/components/CardModal.tsx`) を再利用し、`card=<shortId>` クエリもサポート。
- キーボード操作: `↑↓` の移動刻みも **15 分に統一**。Shift + `↑↓` で 5 分刻みの微調整を行い、1 分刻み編集は CardModal でのみ許可する。

### 4.8 パフォーマンス/メトリクス
- ロード時に `createClientTrace`（`app/(board)/_components/KanbanBoardClient.tsx:52`）へ新しい `phase: "timeline"` を送信し、`metricsJson` に「timeline-render-ms」「timeline-events-count」を追加。
- 既存の `test-summary.js` の `board-load` p95 監視に時間軸描画を加味する。

### 4.9 アクセシビリティ/レスポンシブ
- タブ順は時間軸→Today 列→Tomorrow 列→A/B カード。
- スクロール連動は `aria-live="polite"` で Now 変化を読み上げ。ハイコントラスト配色も CSS カスタムプロパティで切替。

## 5. データ & API 要件
1. **新フィールド**: 既存 `due_date (date)` を Timeline の基準日として継続利用しつつ、`due_start`/`due_end` (time without time zone, 分解能 1 分), `due_channel ('timeline' | 'ab-list' | 'list-only' | 'archived')`, `due_bucket ('today_a' | 'today_b' | 'tomorrow_a' | 'tomorrow_b' | null)` を追加。既存 Kanban データとは独立して管理しつつ、`due_date` は UI から参照し続ける。
2. **派生テーブル案**: 「繰り返し」や複数ボード共有が必要なら `timeline_events` (card_id, board_id, date, start_at, end_at, column, source) を検討。
3. **API 拡張**: `app/api/boards/[boardId]/cards` 取得時に新フィールドを返し、`sanitizeCardsForUpload` (`lib/supabase.ts:137`) でも落とさないよう更新。
4. **Migration/Backfill**: 既存カードは MVP では無視してよい（空ボード前提）。必要なら `due_channel='list-only'` として退避するが、初期リリースではデータ移行を行わない。
5. **オフライン同期**: `syncQueue` (`app/(board)/_components/KanbanBoardClient.tsx:43`) の payload schema を広げ、ローカルキャッシュ (`STORAGE_KEY`) にも新フィールドを保存。

## 6. 実装チケット一覧
| Ticket | Scope | 目的/概要 |
| --- | --- | --- |
| [2025-11-13/01-schedule-data-model.md](../2025-11-13/01-schedule-data-model.md) | DB/型拡張 | Supabase schema と型定義(`lib/supabase.ts`)に due_* フィールドを追加し、移行 & バックフィル戦略を決める |
| [2025-11-13/02-timeline-query-endpoints.md](../2025-11-13/02-timeline-query-endpoints.md) | API/Server | 新フィールドを含む Board/Timeline 取得 API、A/B バケットのフィルタリング、Now インジケータのためのサーバ時刻エンドポイントを整備 |
| [2025-11-13/03-timeline-ui-shell.md](../2025-11-13/03-timeline-ui-shell.md) | UI/Design System | HTML モックを Next/Tailwind に移植し、時間軸/列/A/B コンポーネントのスタイル基盤を作る |
| [2025-11-13/04-timeline-drag-drop.md](../2025-11-13/04-timeline-drag-drop.md) | Interaction | DnD Kit のセンサー、カード ↔ イベント変換ロジック、スナップ/制約/アクセシビリティを実装 |
| [2025-11-13/05-floating-list-card-modal.md](../2025-11-13/05-floating-list-card-modal.md) | UX/Modal | A/B カードと CardModal の連動、チェックリスト、完了ステータス同期、コメント/通知整合を担保 |
| [2025-11-13/06-metrics-and-tests.md](../2025-11-13/06-metrics-and-tests.md) | QA/Metrics | Timeline 用メトリクス、Playwright シナリオ、Flaky 対策、`npm run test:all-split` への組み込み |

- ✅ スケジューリング粒度: **DnD/リサイズ15分刻み**、詳細編集は1分単位。
- ✅ タイムゾーン: **JST 固定**で表示・保存。
- ✅ A/B データ源: **専用 `due_bucket`** で管理（既存リスト流用なし）。
- ✅ 所属: **Timeline/A-B は排他**。
- ⏸ 繰り返し/複製: 今後のスプリントで検討。
- ✅ レスポンシブ: **デスクトップ優先**（MVP 範囲）。
- ⏸ 通知/同期: 将来対応。Realtime 拡張はスコープ外。
- ⚠️ 7日ビュー/週・月ビュー: 情報設計を別途検討。
- ⚠️ 通知/繰り返し: Phase 2 以降に再検討。

## 8. MVP スコープと段階
1. **Phase 0 (触れる状態)** — Tickets 01〜04
   - 新フィールド/型, Timeline API, UI シェル, 基本 DnD。ここまでで Today/Tomorrow タイムライン + A/B を触れる最小構成。
2. **Phase 1** — Ticket 05
   - CardModal 連携とチェックリスト整備（Flaky テスト影響が無いタイミングで実装）。
3. **Phase 2** — Ticket 06
   - Metrics/Test 強化。将来の通知・繰り返しを見据えた計測を追加。

## 9. リスク & 次アクション
- `KanbanBoardClient` の肥大化：時間軸専用の `TaeskMapTimelineClient` を分離しないと管理不能になる恐れ。`app/(board)/b/...` ルートを分岐して A/B/Timeline の feature flag を掛ける案を検討。
- コメント/カード API の Flaky が残存しているため（`docs/tickets/2025-11-10/01-test-all-split-summary.md`）、CardModal を触るタスク（Ticket 05）はテスト安定化後に着手。
- Schema 変更は Supabase migration で対応し、`tsconfig.tsbuildinfo` のノイズは commit 対象から外す。

**次ステップ**: 上表の 6 チケットをキックオフし、仕様未定点のヒアリングを完了 → UI プロトタイプ（Next.js）→ Supabase migration → Timeline beta を Feature Flag で限定提供。
