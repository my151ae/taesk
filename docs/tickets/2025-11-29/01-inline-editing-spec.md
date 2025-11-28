# インライン編集仕様書（2025-11-29 確定版）

## ゴール
- タイムラインと A/B リストのカード本文を Notion 風チェックリストとしてインライン編集できるようにする。
- CardModal との二重編集を避けつつ、リアルタイム更新・オフライン同期と競合しない設計にする。
- ハイドレーション安全（表示制御は Tailwind のユーティリティで完結）、dnd と編集の誤動作を防ぐ。

## スコープ
- 本文は checklist JSON を唯一のソースにし、旧本文フィールドは廃止。
- タイムライン表示・A/B 行数表示・CardModal 編集のすべてで同じ checklist を扱う。
- Playwright 追加は後続タスク候補とし、今回の仕様に実装テスト手順を含める。

## 決定事項（推奨方針を採用済み）
- 保存粒度: 全 JSON 保存（実装をシンプルにして Notion 風入力の軽さを優先）。
- オートセーブ: in-flight 中は追加保存をスキップし、完了後に未反映差分があれば再送。
- DnD 無効化: 編集中のカードのみ dnd を無効化（他カードは操作可）。
- 上限: クライアントで 200 行・各行 500 文字上限。DB は緩め（必要なら後日 CHECK）。
- キーハンドリング: 複数行選択への Tab/Shift+Tab/Enter を全行に適用（Undo 前提で操作性優先）。
- ペースト/サニタイズ: プレーンテキストのみ許可。`- [ ]` / `- [x]` をパースし、HTML/Markdown 装飾は除去。長文は上限でエラー表示。
- 競合解決: 編集中はローカル優先、バナーで「再読み込み/上書き」を提示。マージは行わない。
- A/B 行数表示: 非空行の総数を表示（完了/未完了の区別なし）。
- タイムライン省略表示: 行数 3 行または max-height 固定（目安 120px）。クリックでその場拡張＋内部スクロール。

## データモデル/DB
- checklist スキーマ
  ```ts
  type ChecklistLine = { id: string; level: number; checked: boolean; text: string };
  type Checklist = { version: 1; lines: ChecklistLine[] };
  ```
- DB: `jsonb` カラム `checklist`（既存本文カラムは削除/非使用）。version を保持。
- 文字数/行数上限はアプリ側で弾く（200 行・各行 500 文字）。

## API/型
- API は checklist JSON を受け取り/返却（全量保存）。部分パッチ API は持たない。
- `lib/supabase.ts` の型を checklist ベースに更新し、旧 `description` 参照を除去。
- Card API, board/timeline API が checklist を返すことを保証し、フロントの型を揃える。

## UI/UX（共通）
- インライン編集開始: 本文クリックで `ChecklistEditor`（textarea 拡張）を開く。CardModal との重複編集は同一ソースを用いる。
- 表示: ハイドレーション安全な Tailwind クラスで制御（`hidden`/`line-clamp` 相当）。`window` 依存計測はしない。
- Notion 風入力: 行頭に `- [ ]` を自動付与。Enter で次行生成、Tab/Shift+Tab でインデント変更。
- dnd: 編集中のカードは dnd 無効化し、カーソル/センサーでブロック。他カードの dnd は有効。

## タイムライン UI
- 通常表示: 3 行 or max-height 120px で省略表示（ellipsis）。非編集時は圧縮。
- 編集時: 同位置で高さ拡張、内部スクロール。編集終了で省略表示に戻す。

## A/B UI
- 行数バッジ: 非空行の総数をタイトル横に表示（モバイルも簡易表示）。リアルタイム再計算。
- 本文編集はタイムラインと同じ `ChecklistEditor` を再利用。

## CardModal
- 同じ checklist JSON を直接編集。インライン編集と保存ソースを共有し二重管理しない。

## キーハンドリング詳細
- Enter: 前行の level/checked を継承して新行追加。Shift+Enter も新行扱い（行内改行なし）。
- Tab/Shift+Tab: 選択行すべての level を +1/-1（0 未満にしない）。フォーカス移動は抑止。
- 複数行選択: Tab/Shift+Tab/Enter は選択行すべてに適用。
- IME: `composition` 中の Enter では行分割しない。

## ペースト
- プレーンテキストのみ受付。HTML/リッチテキストは除去。
- 複数行ペースト時は行分割し、`- [ ]` / `- [x]` をパースして checked を反映。未指定は checked=false。
- 上限超過時はエラー表示（保存しない）。

## 保存/オートセーブ
- トリガー: Blur、Cmd/Ctrl+Enter、無入力 1–2 秒の debounce。
- in-flight 中は追加保存をスキップし、完了後に差分があれば再送。
- Esc: 編集キャンセル（保存しない）。
- 保存失敗: 楽観更新をロールバックし、フォーカスは維持して再試行可能に。

## 競合/リアルタイム/オフライン
- 編集中に他クライアント更新を受信: ローカルを保持し、バナーで再読み込み/上書きを提示。
- 非編集時はリアルタイム反映。
- オフライン: `useSyncQueue` でキューイング。再接続時に全量保存。衝突時はバナー方針に従う。

## バリデーション
- 行数 >200、行文字数 >500 の場合は保存前に UI で弾く。サーバーには送らない。
- チェックボックス以外の Markdown 記号や HTML はテキストとして保存（装飾は保持しない）。

## メトリクス
- `timeline.checklist_edit_started` / `timeline.checklist_saved` / `timeline.checklist_auto_saved` / `timeline.checklist_save_failed`。
- ペイロード: `card_id`, `board_id`, `line_count_before/after`, `checked_count_before/after`, `trigger` (`blur|shortcut|auto`).

## テスト方針（実装後）
- Playwright: `PW_WORKERS=1` で `npx playwright test --reporter=json > playwright-report.json`。timeline バッチにインライン編集シナリオを追加予定。
- JSON レポートは `test-results/batches/` に保存し、`jq` で stats を確認。

## 進め方（実装順）
1) 型/DB: `checklist` jsonb カラム追加と旧本文廃止、`lib/supabase.ts` 型更新。
2) API: checklist 入出力を全 API で統一（timeline/A/B/Card）。
3) フロント基盤: `ChecklistEditor` コンポーネント（textarea 拡張 + キーハンドリング + 上限/サニタイズ）。
4) A/B 表示: 行数バッジと編集導線を差し替え。
5) タイムライン表示: 省略表示/拡張、dnd 無効ガード、編集導線実装。
6) CardModal: checklist 編集統合（旧本文 UI を置換）。
7) 保存/同期: オートセーブ、in-flight 抑止、楽観更新・ロールバック、バナー通知。
8) メトリクス埋め込み。
9) テスト追加（timeline バッチにインライン編集ケース）。
10) ドキュメント更新（本書をチケットとして使用可。追加チケット不要ならこのまま進行）。

## 運用メモ
- 本書をそのまま実装チケットとして扱って問題なし。追加チケットが必要ならテスト追加やリファクタ単位で切り出す。
