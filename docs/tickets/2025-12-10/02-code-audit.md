# コード/フロー精査メモ (2025-12-10)

## 現状サマリー
- ボードUI: `app/(board)/_components/timeline/TimelineBoardPage.tsx`（約1725行）がデータ取得・ドラッグ＆ドロップ・フィルター・モーダル連携を一括で担当し、`DesktopTimelineView`（約501行）/`MobileTimelineView`（約803行）を切り替え。`CardModal`（`app/components/CardModal.tsx`, 約1062行）が編集/コメント/同期を担う。
- データ取得: `GET /api/boards/[boardId]/timeline`（`app/api/boards/[boardId]/timeline/route.ts`）がボードの全カードを読み出し、JST変換して `events` / `abBuckets` を生成。`start`/`range` パラメータはあるが SQL レベルの期間絞り込みはない。
- ステート同期: `useRealtimeBoard` で cards/comments を購読し、`handleCardChange`（クライアント）で `events`/`abBuckets` を都度組み立て直す。`useSyncQueue` + localStorage のオフラインキューでミューテーションを再送。
- Google連携: `lib/googleCalendarServer.ts`（約1049行）が OAuth/トークン更新・watch・キャッシュ・pull/push 同期を単一ファイルで実装。`/api/calendar-sync/[cardId]` は保存時に pull→push、Webhook（`/api/integrations/google-calendar/webhook`）も直接 pull を実行。
- Metrics: `createClientTrace('timeline')` を `TimelineBoardPage` で生成し、fetch/render/DnD 単位で送信。Playwright バッチは `test-results/batches/*.json` へ JSON を吐く運用。

## 気づき・懸念点
- Timeline API の負荷と整合性: `app/api/boards/[boardId]/timeline/route.ts` で `board_id` だけをキーに全件取得し、日付範囲や `due_channel`/`archived` をサーバー側で落としていない。大量カード環境だとオーバーフェッチ＋クライアント側フィルタになる。`due_channel` を無視しているためアーカイブ/リスト専用カードが混入するリスク。
- カード→表示データ変換の重複: `handleCardChange` と `handleCardModalSave`（`app/(board)/_components/timeline/TimelineBoardPage.tsx`）がほぼ同じ「カードを events/buckets に移し替えるロジック」をそれぞれ持ち、`normalizeChecklist`/`getIsoDateJst` の扱いや sort 条件が微妙に異なる。`abBuckets` ソートキーも複数箇所に散らばるため、バグが片側だけで起きやすい。
- コンポーネントの肥大化: `TimelineBoardPage.tsx` (約1725行)、`MobileTimelineView.tsx` (約803行)、`CardModal.tsx` (約1062行) と超長大。状態管理・ドラッグ座標・UI描画が混在しており、再レンダリング範囲も広い（`setData` が巨大オブジェクトを毎回差し替え）。
- Google連携の責務集中と同期パス: `lib/googleCalendarServer.ts` で token refresh / watch 管理 / cache / pull 処理が同居し、Webhook からも直接 `syncGoogleCalendarToTaesk` を叩いている。通知スパイク時に API リクエストを同期的に連発し、バックオフやデデュプリケーションがない。差分適用もタイトル＋日時のみで、最新更新優先のメタデータ管理やジョブ記録が薄い。
- 範囲キャッシュの粒度: `useGoogleCalendar` はコンポーネント内の `cacheRef` でのみ保持。Timeline側で日付レンジをスライドすると毎回 fetch し、他コンポーネントとキャッシュ共有できない。
- データモデルのズレ: ドメインメモで `due_channel` による `timeline/ab-list/list-only/archived` の所属が正規化されているが、クライアント/サーバー双方でこのフィールドが無視されている（`lib/api-types/timeline.ts` にも含まれず）。今後のリストUI復活やアーカイブ制御で整合性を損ねる。
- Webhook/手動同期の同時実行リスク: `/api/integrations/google-calendar/webhook` が pull を即実行し、`/api/calendar-sync/[cardId]` も pull→push を同期処理するため、複数通知やユーザー操作が重なると同一カードへの更新競合や rate limit に繋がる。

## リファクタリング方針（優先順）
1. データ取得のスリム化と一貫化  
   - `app/api/boards/[boardId]/timeline/route.ts` を `due_channel` フィルタ・`due_date` の `gte/lte` 範囲条件付きに変更し、JSTレンジだけを取得。`TimelineBoardPage` の realtime/保存処理も共通の `mapCardToTimelineItem` util に寄せて整合性を確保。  
   - `TimelineResponse` 型に `due_channel` を取り込み、アーカイブ/リスト専用カードを UI から除外するルールを一本化。
2. Timeline ステート管理の分割  
   - `TimelineBoardPage.tsx` を data layer（`useTimelineData`: fetch/realtime/applyDiff）と presentation layer（Desktop/Mobile）に分割。`DesktopTimelineView`/`MobileTimelineView` が共有する DnD ロジックを hooks/utility へ抽出し、再レンダリング面積を縮小。  
   - `handleCardChange`/`handleCardModalSave` の重複ロジックを `applyCardUpdate(prev, card)` のような1箇所に集約。
3. Google同期レイヤの再構成  
   - `lib/googleCalendarServer.ts` をモジュール分割（auth/token, watch管理, cache fetch, sync engine）。Webhook は即応せずジョブキュー（現行なら Supabase `google_calendar_sync_logs` ベースのポーリング or cron）へ enqueue し、同一 calendar の連続通知をまとめて処理。  
   - `syncGoogleCalendarToTaesk` に最新更新優先メタ（`google_updated_at` vs `taesk_updated_at`）を明示化し、差分アップデート/ログを記録。bulk update・トランザクション化で N 回 UPDATE を減らす。  
   - 手動「今すぐ同期」API（`/api/calendar-sync/[cardId]`）は pull 成功後に push を実行する順序を保証し、進捗/失敗理由を返す。
4. UI コンポーネントの責務整理  
   - `CardModal.tsx` をタブ単位（概要、期日/割当、コメント、Google sync）でサブルート/サブコンポーネント化し、状態も局所化。Timeline からの props を最小限にする。  
   - Google カレンダー連携表示/トーストを独立したコンポーネントに切り出し、`TimelineBoardPage` 本体の state を軽量化。
5. キャッシュ/プリフェッチ戦略の明示  
   - Googleイベント取得は board 範囲レンジごとに共有キャッシュを導入し、同レンジの再訪問時に `cacheRef` をまたがって使い回す。ネットワークエラー時のフォールバック（stale data 表示）とトーストの UX を決める。
6. 検証とオブザーバビリティ  
   - Timeline API へ日付フィルタを入れた後のレスポンス件数・時間を `createServerTrace` で計測し、Playwright timeline バッチに統計を残す。  
   - Google 同期の webhook/job 成功率・処理時間を `google_calendar_sync_logs` に集計するビュー/エンドポイントを用意し、rate limit や 410 再同期を検知できるようにする。
