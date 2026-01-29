# 2026-01-29 大規模リファクタリング計画（Timeline）

## 0. 前提・制約（AGENTS / docs 準拠）
- `npm run dev` / `NODE_ENV=test npm run dev` は手動実行禁止（Playwright の `webServer.command` のみ例外）。
- 検証は Playwright JSON レポート必須、`PW_WORKERS=1` を厳守。
- UI スコープは **Timeline + A/B リストのみ**（Kanban はレガシー扱い）。
- Next.js App Router では `window.innerWidth` 条件レンダリング禁止（Tailwind のレスポンシブのみ）。
- 仕様の SSOT は `docs/` と `AGENTS.md`。

## 1. 現行機能インベントリ（主要エントリ）
- **Timeline ボード本体**: `app/(board)/_components/timeline/TimelineBoardPage.tsx`
  - Timeline View (DnD) + List View（range 切替）
  - Day range / list range の切替、URL 同期、ショートカット
- **Timeline 描画**: `DesktopTimelineView.tsx`, `MobileTimelineView.tsx`, `DaySection.tsx`, `TimelineColumn.tsx`
- **List View**: `DesktopListView.tsx`, `MobileListView.tsx`
- **A/B Buckets**: `app/(board)/_utils/timeline-helpers.ts`（bucket key 生成）
- **フィルタ／検索**: `useTimelineFiltering.ts`, `useBoardFilters.ts`
- **DnD / 位置計算**: `useTimelineDragAndDrop.ts`, `timeline-helpers.ts`
- **Card Modal**: `app/components/CardModal.tsx` + `app/components/card-modal/*`
- **コメント / メンション**: `CommentsPanel.tsx`, `useCommentsStore`, `app/api/comments/*`
- **通知（in-app / Web Push / 音）**: `NotificationSettings.tsx`, `NotificationsBell.tsx`, `NotificationSoundPlayer.tsx`, `public/sw.js`, `app/api/notifications/*`
- **バッジ（App Badging / favicon）**: `lib/unified-badge.ts`, `NotificationBadgeListener.tsx`
- **ボード権限／共有**: `ShareDialog.tsx`, `app/api/boards/[boardId]/members`
- **認証**: `AuthContext.tsx`, `app/login`, `app/auth/callback`
- **Realtime**: `useRealtimeBoard.ts`
- **Offline Sync Queue**: `lib/syncQueue.ts`, `useSyncQueue.ts`
- **メトリクス**: `lib/metrics/*`, `createClientTrace`, `createServerTrace`
- **Google Calendar 連携**: `useGoogleCalendar.ts`, `useTimelineCalendar.ts`, `lib/googleCalendarServer.ts`, `lib/calendarSyncService.ts`, `app/api/calendar/*`, `app/api/integrations/google-calendar/*`
- **URL / ルーティング**: `/b`・`/c` ルート、@modal intercept (`app/(board)/@modal/...`), `lib/board-url.ts`, `lib/card-url.ts`
- **E2E**: `e2e/*`（timeline / comments / notifications / permissions / reorder / rls）

## 2. レガシー／技術負債の棚卸し（コード残存）
- **Kanban UI**（実運用対象外）
  - `app/(board)/_components/KanbanBoardClient.tsx`
  - `kanban_board_data` localStorage キャッシュ
- **Kanban API / lists API**
  - `app/api/boards/[boardId]/data`（lists + cards）
  - `app/api/boards/[boardId]/lists/*`
  - `app/api/boards/[boardId]/cards/reorder` / `cards/renumber`
- **データモデルのドリフト**
  - `due_channel` / `today_a` などが docs に残存（実コードは `due_bucket = 'a'|'b'` 前提）
  - `supabase/migrations/20251125000000_update_bucket_schema.sql` の扱い不明（DB 実態とのズレ懸念）
  - `docs` と `app/api/boards/[boardId]/timeline/route.ts` の契約差
- **アサイン関連の互換コード**
  - `assigned_to`（文字列）と `assignee_id`（単数 UUID）互換
  - `assignee_ids` との多重分岐（`CardModal`, `lib/syncQueue.ts`, `lib/supabase.ts`）
- **BlockNote 互換**
  - `lib/tiptap.ts` の legacy array 入力（旧データ残存前提）
- **UI コピーのレガシー**
  - `app/layout.tsx` / `app/login/page.tsx` の “Kanban” 文言
- **コメント / ストアの Kanban 前提コメント**
  - `CommentsPanel.tsx` 内コメントなど
- **Playground**
  - `app/playground/*`（内部検証用、運用 UI では非公開扱いなら整理対象）

## 3. リファクタリングのゴール
1. **Timeline 専用の一貫したデータモデル**（due_bucket / day range / list range / assignee 仕様を確定）
2. **Timeline UI の責務分離と可読性向上**（巨大コンポーネントの分割・ViewModel 化）
3. **Legacy 互換コードの段階的撤去**（Kanban / list 系、assignee 互換、BlockNote 互換）
4. **Docs とコードの整合**（仕様の SSOT を最新化）
5. **テスト容易性の向上**（E2E と型の整合、JSON レポートの安定化）

## 4. フェーズ別計画

### Phase 1: 現状確定 & 仕様凍結
- 目的: **スキーマと契約の最終決定**
- 作業:
  - 既存 DB で `due_bucket` / `due_channel` の実態を確認（Supabase で確認）。
  - Timeline API (`/api/boards/[boardId]/timeline`) の契約を確定。
  - `docs/detail/*` の修正対象を洗い出し（差分リスト化）。
- 成果物:
  - 仕様確定メモ（この doc の付録 or 追記）
  - 影響範囲マトリクス（API / UI / DB / E2E）

### Phase 2: データモデル・API・型の整合
- 目的: **コードと型の単一真実化**
- 作業:
  - `lib/supabase.ts`・`lib/api-types/timeline.ts` を統一仕様に合わせる。
  - `TimelineResponse` の day key / bucket key / range 仕様を更新。
  - `app/api/boards/[boardId]/timeline/route.ts` の互換フォールバック整理。
  - `due_channel` / `list-only` など未使用概念の削除 or 明示的な互換層化。
- 成果物:
  - 型定義の統一
  - API 契約の明文化

### Phase 3: UI / State 再構成
- 目的: **TimelineBoardPage の分割と ViewModel 化**
- 作業:
  - `TimelineBoardPage` の責務を Container / Presenter に分割。
  - ViewMode（timeline/list）切替ロジックを専用 hook に切り出し。
  - `eventsByDay`, `abBuckets` 等の整形ロジックを共通化。
  - DnD / List / Mobile の責務境界を明確化。
- 成果物:
  - 小さな hook / component 群
  - prop drilling の削減

### Phase 4: レガシー削除・隔離
- 目的: **Kanban 遺産の計画的撤去**
- 作業:
  - `KanbanBoardClient` と list 系 API の参照状況を確認 → 未使用なら削除。
  - `lists` / `position` を Timeline で必要最小限に縮退（必要なら default list 固定）。
  - `assigned_to` / `assignee_id` の移行計画（DB migration + UI / API 更新）。
  - `lib/tiptap.ts` の BlockNote 互換を削除可能か判定。
- 成果物:
  - Legacy コード撤去 or `legacy/` への隔離
  - DB migration 計画

### Phase 5: Docs / テスト更新
- 目的: **ドキュメントとテストの整合**
- 作業:
  - `docs/index.md` / `docs/detail/*` を最新仕様に更新。
  - E2E の期待値を更新（timeline range / bucket / list view）。
  - Playwright JSON レポートで回帰確認。
- 成果物:
  - 最新仕様ドキュメント
  - テスト更新ログ

## 5. リスク・依存・未決事項
- `list_id` がカードに必須 → 既存 UI との互換をどう維持するか。
- `due_bucket` スキーマが実 DB と一致しているか要確認（`20251125000000_update_bucket_schema.sql` の扱い）。
- assignee の移行が UI / API / DB / RLS に影響。
- Playwright テストが Kanban API を前提にしていないか再確認。

## 6. 実行チェックリスト（抜粋）
- [ ] `docs/detail/*` の旧仕様（today/tomorrow, due_channel）を現仕様へ更新
- [ ] `lib/supabase.ts` / `lib/api-types/timeline.ts` / API の契約一致
- [ ] TimelineBoardPage の責務分割
- [ ] Kanban / list 系コードの使用箇所ゼロ化
- [ ] Playwright JSON レポートで全バッチ成功

