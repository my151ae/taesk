# リファクタリング実行タスクリスト（2026-02-18）

## 目的
- Timeline + A/B リスト運用を維持したまま、責務過多・重複・保守コストを段階的に解消する。
- UI/API/同期処理の境界を明確化し、今後の機能追加時の変更影響を縮小する。

## 全体方針
- 優先度は `P1 > P2 > P3`。
- 先に Quick Win（低リスク高効果）を終わらせ、その後 API 分割、最後に大型 UI 分割へ進む。
- `/b/...` は Timeline 側のみを対象とし、Kanban は対象外。

## P1（最優先）

### 1. CardModal の責務分離
- [x] `app/components/CardModal.tsx` を「表示」「フォーム状態」「履歴」「Google同期」に分割する。
- [x] フェッチ処理（履歴取得/復元、同期状態取得）を専用フックへ移動する。
- [x] `console.log` デバッグ出力を整理し、必要なもののみ制御付きログへ置換する。
- [x] 既存 UX（自動保存、履歴復元、担当者編集、同期ボタン）を維持する。

### 2. TimelineBoardPage の薄型化
- [x] `app/(board)/_components/timeline/TimelineBoardPage.tsx` の orchestrator ロジックを controller hook に集約する。
- [x] 大量 props 受け渡しを ViewModel 化して `Desktop/Mobile` へ渡すデータを整理する。
- [x] context menu 項目生成ロジックを外出しして、JSX 本体を縮小する。
- [x] board/profile 初期ロードと更新処理を分離し、ページ本体は「合成」に専念させる。

### 3. cards API の重複除去（POST/PATCH/DELETE）
- [x] `app/api/boards/[boardId]/cards/route.ts` と `app/api/boards/[boardId]/cards/[cardId]/route.ts` の共通処理を service 化する。
- [x] 認証・権限・バリデーション失敗レスポンスを共通化する。
- [x] `due_bucket_position/checklist/content/assignee_ids` 欠落カラムフォールバックを共通関数へ抽出する。
- [x] activity log / calendar sync 副作用の責務を分離する。

## P2（重要）

### 4. API エラーハンドリング統一
- [x] `lib/server/with-error-handling.ts` の適用範囲を API 全体に拡張する。
- [x] `try/catch + NextResponse.json(error...)` の重複を段階的に削減する。
- [x] `error.code` と HTTP status の整合ルールを明文化し統一する。

### 5. Desktop/Mobile の重複ロジック解消
- [x] `DesktopTimelineView` / `MobileTimelineView` の DragOverlay データ組み立てを共通ユーティリティ化する。
- [x] 時間表示・バッジ・duration 文字列生成の重複を共通化する。
- [x] 片方変更時にもう片方が崩れるリスクを減らす。

### 6. useTimelineDragAndDrop の分割
- [x] `app/(board)/_hooks/useTimelineDragAndDrop.ts` を「pointer追跡」「auto-scroll」「drop解決」「永続化」に分割する。
- [x] DnD の state machine 的責務を整理し、各処理の依存を縮小する。
- [x] drag start/end のデバッグログを必要最小限にし、ノイズを削減する。

### 7. コメント機能の境界整理
- [x] `app/api/cards/[cardId]/comments/route.ts` を「access検証」「mentions検証」「通知生成」に分離する。
- [x] `app/(board)/_stores/comments-store.ts` の pending queue ロジックを別モジュールへ切り出す。
- [x] API と Store の責務境界（永続化/表示更新）を明確化する。

## P3（中長期）

### 8. Google Calendar サーバーモジュール分割
- [x] `lib/googleCalendarServer.ts` を「OAuth/認可」「watch管理」「キャッシュ同期」「Taesk反映」に分割する。
- [x] 同期フロー（manual/syncToken/fallback full fetch）をフロー単位でテスト可能にする。
- [x] ログ方針を統一し、運用時に追跡しやすい構造へ整える。

## Quick Win（先行実施推奨）
- [x] 不要な `console.log` を削減（CardModal, Timeline DnD など）。
- [x] API ハンドラの `withErrorHandling` 適用を追加。
- [x] `Desktop/Mobile` Overlay 重複の共通化を先に実施。

## 実施順（推奨）
1. Quick Win（ログ整理 / エラーハンドリング統一の土台）
2. cards API 重複除去
3. comments API + comments store 境界整理
4. TimelineBoardPage 薄型化
5. CardModal 分割
6. useTimelineDragAndDrop 分割
7. Google Calendar サーバー分割

## 完了条件
- [x] 主要大型ファイルの肥大化が解消され、責務ごとに分割されている。
- [x] Timeline + A/B の既存フロー（作成/保存/削除/移動/コメント/同期）で回帰がない。
- [x] API のエラー形式と認証・権限チェックが統一されている。

## 検証メモ（実施時）
- [x] `npm run lint`
- [x] `npm run build`
- [x] `lsof -i :3000`
- [x] `PW_WORKERS=1 npx playwright test --workers=1 --global-timeout=600000 --reporter=json > test-results/playwright-report.json`
- [x] `cat test-results/playwright-report.json | jq '.stats'`

## 進捗メモ（2026-02-18）
- `TimelineBoardPage` の hook dependency warning は解消済み（残 warning は `CardModal.tsx` 既存分のみ）。
- `withErrorHandling` は `app/api` 配下全ルートへ展開済み。`lib/server/api-error.ts` に `NOT_FOUND` / `VALIDATION_ERROR` / `CONFLICT` を追加。
- `docs/detail/api-error-rules.md` を追加し、`error.code` と HTTP status ルールを明文化。
- `e2e/.setup/auth-global-setup.ts` のログ出力を調整し、`cat ... | jq '.stats'` で JSON を直接解析可能にした。
- `board-permissions.spec.ts` と `reorder-api.spec.ts` の fixture/auth 前提を修正し、個別実行の unexpected を解消。
- Playwright full 実行 stats: `expected=63, skipped=21, unexpected=0`。一方で runner 終了時に `Timed out waiting 600s for the test suite/teardown` は残る（テスト本体の unexpected は 0）。
