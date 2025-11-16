# タイムライン API / クエリ整備

**Status**: 🟡 In Progress（GET エンドポイント雛形は稼働、最適化と Realtime が未実装）  
**Priority**: 🔥 High  
**Created**: 2025-11-13 14:33 JST  
**Updated**: 2025-11-17  
**Assignee**: Backend/Fullstack  
**Estimated**: 2d

## 概要
Timeline UI 専用のデータ取得/更新 API を追加し、Today/Tomorrow + A/B バケットを一括して返せるようにする。Now インジケーター用のサーバ時刻（JST 固定）も提供し、旧レイアウトに依存しない最小構成を整える。

## 進捗メモ（2025-11-17）
- ✅ `app/api/boards/[boardId]/timeline/route.ts` は実装済みで、Today/Tomorrow + `abBuckets` を返却。`TimelineBoardPage` から利用している。
- ⚠️ Supabase クエリは `due_date IN (today, tomorrow)` の絞り込みや `ORDER BY position` が未適用で、全カード読み込み → クライアント側でフィルタしている状態。
- ⚠️ `s-maxage` キャッシュ/Realtime 配信/`syncQueue` 統合が未対応。A/B 順序や mock fallback も暫定実装。
- ⚠️ API レスポンスと型宣言の共通化（例: `TimelineResponse` 型を `/lib/api-types` で共有）はまだ無い。
- 🎯 Next: 1) Supabase クエリ最適化 + `due_channel` 整合性検証、2) Realtime/キャッシュ設定、3) PATCH 更新時のエントリーポイント整理（`syncQueue` 経由 or 軽量 RPC）。

## 目的
- 既存の `BoardData` (`lists` + `cards`) レスポンスだけでは時間軸レンダリングに必要な情報が不足するため、最小クエリでレイアウトに必要なデータを揃える。
- 将来的な Feature Flag 切替に備え、`timeline` モードのエンドポイントを分離する。

## 実装内容
- [ ] `app/api/boards/[boardId]/timeline/route.ts`（仮）を追加し、以下を返す:
  - `days`: Today/Tomorrow の ISO 日付、タイムゾーン、ローカル表示用メタ
  - `events`: `card_id`, `due_date`, `due_start/due_end`（分解能 1 分）, `durationMinutes`, `status`
  - `abBuckets`: `today_a`, `today_b`, `tomorrow_a`, `tomorrow_b` のカード配列（`due_bucket` ベース）
  - `serverNow`: JST の現在時刻（offset 固定）
- [ ] Supabase クエリを `board_id` + `due_date IN (today, tomorrow)` で絞り、`due_channel` に応じて振り分け。
- [ ] キャッシュヘッダー（`s-maxage=15`）と Realtime チャンネルを設定。Realtime payload に `due_*` フィールドを含める。
- [ ] 既存 `BoardData` API と `syncQueue` を流用して更新（PATCH）する共通ロジックを整理。
- [ ] MVP では Timeline API を既存 Kanban に優先させ、Feature Flag は QA 用に短期保持するのみとする。

## 技術的詳細
- Now 判定は最終的にクライアントで `Date.now()` を使うが、UI 初期化時にサーバ基準の `serverNow` (JST) を基準化し、ローカル時計ずれを補正する。
- A/B バケットの順序は `position` で制御。`due_bucket` が null のカードは `unplanned` 配列で返し、UI で折りたたむ。
- 既存の `buildBoardCanonicalUrl` (`app/(board)/_components/KanbanBoardClient.tsx:47`) を流用して timeline への遷移 URL を生成。
- 同時所属禁止のため、Timeline payload では `due_channel` の整合性を検証し、A/B 配列と重複しないようサーバ側でフィルタリングする。

## 受け入れ基準
- [ ] `GET /api/boards/:boardId/timeline` が 200 を返し、JSON 構造が仕様通り。
- [ ] `npx ts-node scripts/diagnose-api.ts` のような既存診断スクリプトでもエラー無し（※ CLI で代替コマンドを使用）。
- [ ] Feature Flag `enableTimeline` を false にすると、新エンドポイントを叩かない。将来的に旧 Kanban は削除される前提で、Flag は QA 期間のみ使用する。

## 関連チケット
- [01-schedule-data-model.md](./01-schedule-data-model.md)
- [03-timeline-ui-shell.md](./03-timeline-ui-shell.md)
- [00- TaeskMap マスタープラン](./00-today-list-layout.md)
