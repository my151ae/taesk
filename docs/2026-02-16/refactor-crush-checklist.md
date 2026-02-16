# 虱潰しリファクタ実行チェックリスト（2026-02-16）

## 目的
- Timeline / CardModal / Calendar API 周辺の負債を段階的に除去し、型安全性・責務分離・保守性を改善する。
- 既存の UI Scope（Timeline + A/B リスト）を維持しつつ、回帰を抑えて進める。

## 対象スコープ
- `app/(board)/_hooks/useTimelineCardActions.ts`
- `app/(board)/_components/timeline/TimelineBoardPage.tsx`
- `app/components/CardModal.tsx`
- `app/api/calendar-sync/[cardId]/route.ts`
- `app/api/calendar/convert/route.ts`
- `lib/googleCalendarServer.ts`

## 実施順（推奨）
1. Timeline actions 分割 + 型強化
2. Calendar API 共通ガード統一
3. CardModal 分割
4. TimelineBoardPage 薄型化
5. 残存 `any` の除去
6. テスト・ドキュメント更新

## Phase 1: `useTimelineCardActions` 分割
- [ ] `save/delete/create/toggle/move` を責務別モジュールへ分離する
- [ ] カード探索処理（event / bucket 横断検索）を `card lookup` ヘルパーへ抽出する
- [ ] 楽観更新処理を `optimistic update` ヘルパーへ抽出する
- [ ] 履歴保存（`postHistorySnapshot` + retry）を独立ユーティリティ化する
- [ ] Google 同期トースト処理を UI 通知層として分離する
- [ ] `setData: React.Dispatch<React.SetStateAction<any>>` を具体型へ置換する
- [ ] `data: any` / `savePayload: any` / `entry: any` を型定義へ置換する
- [ ] 既存 API 契約を変更しないことを確認する

### 完了条件
- [ ] `useTimelineCardActions.ts` の `any` が 0 件
- [ ] 1ファイル肥大化を解消（機能別ファイルに分割済み）
- [ ] 主要操作（保存/削除/作成/チェック/日付移動）が同等挙動

## Phase 2: Calendar API 共通化
- [ ] `calendar-sync` で `requireAuthenticatedUser` を使用する
- [ ] `calendar-sync` で共通エラーハンドリング（`withErrorHandling`）を適用する
- [ ] `getCardAndVerifyAccess` を共通ヘルパー化し重複を排除する
- [ ] `calendar/convert` でも認証・権限・エラー形式を共通ルールに合わせる
- [ ] `slug/id_short` 参照の `as any` を型付きアクセスへ置換する
- [ ] HTTP ステータスと `error.code` の整合性を統一する

### 完了条件
- [ ] `app/api/calendar-sync/[cardId]/route.ts` の `any` が 0 件
- [ ] `app/api/calendar/convert/route.ts` の `any` が 0 件
- [ ] 認証失敗/権限失敗/入力不正の応答形式が API 全体方針に一致

## Phase 3: `CardModal` 分割
- [ ] フォーム状態管理を `useCardModalForm` へ抽出する
- [ ] 履歴一覧/プレビュー/復元を `useCardModalHistory` へ抽出する
- [ ] オートセーブ制御（debounce/max-wait）を専用フックへ抽出する
- [ ] メンバー選択 UI ロジックを分離し、表示コンポーネントを薄くする
- [ ] `onSave` payload の `any` を具体型へ置換する

### 完了条件
- [ ] `app/components/CardModal.tsx` の `any` が 0 件
- [ ] モーダル本体は「構成 + props 受け渡し」中心の実装になる
- [ ] 既存 UX（自動保存、履歴復元、担当者変更）が回帰しない

## Phase 4: `TimelineBoardPage` 薄型化
- [ ] ページ制御ロジックを `useTimelinePageController` 相当へ集約する
- [ ] context menu/focus 復帰処理を独立フック化する
- [ ] board/profile 初期ロード処理を分離する
- [ ] `initialBoard as any` 依存を解消し型付けする
- [ ] props の受け渡し境界を整理し、不要な state を削減する

### 完了条件
- [ ] `app/(board)/_components/timeline/TimelineBoardPage.tsx` の `any` が 0 件
- [ ] 表示責務と制御責務が分離されている
- [ ] Timeline / List 切り替え挙動が維持される

## Phase 5: `any` 全面削減（Timeline/Calendar 境界）
- [ ] `lib/googleCalendarServer.ts` の `any` を段階除去する
- [ ] `lib/calendarSyncService.ts` の `any` を段階除去する
- [ ] Timeline 関連ファイルの `any` 出現を棚卸しし、優先度順に解消する
- [ ] `as any` で回避している箇所を型ガード/スキーマで置き換える

### 完了条件
- [ ] `rg -n "\bany\b" app lib --glob '*.ts' --glob '*.tsx'` の件数を基準値から大幅削減
- [ ] 境界データ（APIレスポンス/Googleイベント）に明示型が付与されている

## 検証チェックリスト
- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] `lsof -i :3000` で dev サーバー残骸が無いことを確認
- [ ] `PW_WORKERS=1 npx playwright test --reporter=json > test-results/playwright-report.json`
- [ ] `cat test-results/playwright-report.json | jq '.stats'`
- [ ] 必要に応じて chrome-devtools MCP でログ/スナップショットを採取

## 完了判定
- [ ] 全 Phase の完了条件を満たす
- [ ] 回帰バグが無い（主要フロー: カード作成/保存/削除/移動/Google連携）
- [ ] 変更内容を `docs/` に反映し、次の着手者が追える状態になっている
