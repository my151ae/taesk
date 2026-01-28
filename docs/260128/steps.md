# 260128 修正メモ（段階整理）

このファイルは「今回の修正内容」をステップ単位で整理したメモです。
現在はロールバック前提で検証をやり直すため、内容は“こう触った”記録です。

## Step 1: Kanban側（※/b ルートでは未使用）
目的: カード表面の2行目を表示、モーダル本文の取りこぼしを防ぐ
- 変更内容
  - `app/(board)/_components/KanbanBoardClient.tsx`
    - カード表面表示で `excerpt` から本文行を抽出（タイトル行は除外）
    - モーダル表示時に `/api/cards/:shortId` で本文を取得し、`isLoading` を渡す
    - auto-save 時にモーダルを閉じないよう制御
- 注意
  - `/b/...` は Timeline ルートなのでこの変更は効かない（Kanban 側のみ）

## Step 2: Timeline側モーダルの安定化
目的: fullカード取得後に“部分データ”で上書きされるのを防ぐ
- 変更内容
  - `app/(board)/_hooks/useCardModal.ts`
    - fullカード取得済みのときは `modalCardFromData` で上書きしない
    - 開いたカードと短IDが変わったら override をリセット
    - fetch のタイムアウト処理追加

## Step 3: Timeline APIの補完
目的: excerpt/タイトルが空でもカード表面で2行目が出るようにする
- 変更内容
  - `app/api/boards/[boardId]/timeline/route.ts`
    - `content` を select に追加
    - `content` から excerpt と title を補完（`excerpt` や `title` が空の場合）

## Step 4: CardModal 本文同期の見直し
目的: 本文が後から来たときの同期漏れを減らす
- 変更内容
  - `app/components/CardModal.tsx`
    - `ensureTitleTask` を使って content を補正
    - ユーザー編集済み判定を ref で保持

## ロールバック方針
- まず上記 Step をすべて戻し、動作確認しながら段階的に再適用する
- どの時点で改善/悪化するかを確認して原因を特定する

## 段階的復元ログ（実施中）
- 2026-01-28: 現在の変更を `git stash push -m "wip-freeze-investigation"` で退避
- Step A1: `TiptapEditor.tsx` / `TiptapEditor.module.css` / `lib/tiptap.ts` を適用 → フリーズ継続のため戻す
- Step A2: `CardModal.tsx` のみ適用 → モーダルは開く（フリーズ解消）
- Step A3: `TimelineCard.tsx` を適用（確認待ち）
- Step A4: `app/api/boards/[boardId]/cards/[cardId]/route.ts` を適用（確認待ち）
- Step A5: `app/api/boards/[boardId]/cards/route.ts` を適用（確認待ち）
- Step A6: `lib/tiptap.ts` を適用（確認待ち）
- Step A7: `app/(board)/_components/tiptap/TiptapEditor.tsx` を適用（確認待ち）
- Step A7-rollback: `TiptapEditor.tsx` 適用でフリーズ再発 → 元に戻す
- Step A7-rollback補足: 変更がステージに残っていたため再度リバート。`TitleRowMarker` 追加と同期ロジック更新がフリーズ原因の可能性大
