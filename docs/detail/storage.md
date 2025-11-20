# Storage Strategy (Timeline)

Timeline ボードでは、Kanban 時代の「boardData を localStorage へ保存する」方式から転換し、以下の三層で状態を扱います。

```
React state (TimelineBoardPage)
   ↓  Optimistic updates / derived data (events + A/B buckets)
Supabase API (GET /timeline, PATCH /cards, etc.)
   ↕  Realtime (postgres_changes)
localStorage-backed queues (taesk-sync-queue, comment-queue)
```

## 1. React State

- `TimelineResponse` (`days`, `events`, `abBuckets`, `serverNow`) を `useState` で保持。
- `handleCardChange` が Realtime イベントを変換し、state を直接書き換える。
- DnD などの楽観的更新は state を即更新し、失敗時は `activeDragRef.previousData` でロールバック。
- Timeline ではボード全体の snapshot を localStorage へ書き戻さない。再読み込み時は常に API から取得する。

## 2. Supabase API

- `GET /api/boards/[boardId]/timeline` が Today/Tomorrow + A/B の統合レスポンスを返す。エラーハンドリングは `status` / `errorMessage` で管理。
- ミューテーション（カード DnD、CardModal 保存、コメント追加など）は既存の REST API (`/api/cards/*`, `/api/comments/*`) を経由。Timeline 固有パラメータ (`due_channel`, `due_start`, `due_end`, `due_bucket`, `due_bucket_position`) を payload に含める。
- サーバーは Supabase JS (SSR) を使用し、`board_members` 経由で認可。エラー時は JSON `{ error: { code, message } }` を返し、クライアントでトースト表示。

## 3. localStorage-backed Queues

Timeline で localStorage を使用するのは「オフライン耐性」のためのキューとコメント一時保存のみです。

### Sync Queue (`taesk-sync-queue`)

- ファイル: `lib/syncQueue.ts`
- 保存形式:

```json
{
  "actions": [
    {
      "id": "cards:UPDATE:UUID",
      "table": "cards",
      "type": "UPDATE",
      "payload": { ...card fields... },
      "attempts": 0,
      "lastTriedAt": null
    }
  ],
  "stats": {
    "lastSuccessAt": "2025-11-20T04:12:00.000Z"
  }
}
```

- `useSyncQueue()` が `enqueue(action)` / `flush()` / `stats` を提供。TimelineBoardPage のヘッダーに pending 件数と最後の成功時刻を表示。
- `navigator.onLine` を監視し、オンライン復帰時に順次 API を叩く。失敗時は指数的に `delayMs` を増やしながら再試行。

### Comment Queue (`comment-queue`)

- `useCommentsStore` がコメント投稿/編集/削除を localStorage に蓄積し、接続復帰時に反映。
- キー: `comment-queue`。カード別に pending エントリを保持する。

## Realtime & Consistency

- `useRealtimeBoard` が `supabase.channel('board:<id>')` を開き、`cards` / `comments` の `INSERT/UPDATE/DELETE` を購読。
- 受信イベントは `handleCardChange` で `events`/`abBuckets` を再計算。A/B バケットは `bucketPosition` でソートし、Timeline イベントは `due_date` + `due_start` で昇順ソート。
- コメントは `useCommentsStore.upsertComment` / `.removeComment` を通じて同期し、CardModal のコメントタブへ即反映。

## Typical Write Flow

```
Timeline DnD / CardModal / Comments 操作
        ↓
React state 更新 (optimistic)
        ↓
if (navigator.onLine) call API immediately
else enqueue action to taesk-sync-queue
        ↓
Realtime event arrives → merges server state
```

### DnD 例

```ts
const applyTimelineDrop = async (cardId, targetMinutes) => {
  const payload = {
    id: cardId,
    due_channel: 'timeline',
    due_start: minutesToTime(targetMinutes),
    due_end: minutesToTime(targetMinutes + 60),
    due_bucket: null,
  };

  updateTimelineState(payload); // React state

  enqueue({
    table: 'cards',
    type: 'UPDATE',
    data: payload,
  });
};
```

### コメント例

```ts
await commentsStore.addComment({
  cardId,
  body,
  mentions,
  optimisticId: crypto.randomUUID(),
});
```

`addComment` は `comment-queue` に optimistic entry を追加し、API 成功時に本物の ID へ置き換える。

## Offline Considerations

- Timeline UI は localStorage に完全な board snapshot を持たないため、オフライン中にページをリロードすると `fetchTimeline()` が失敗し空表示になる。再接続後に `Retry` ボタンを押して復旧する。
- 既存の pending アクションは `taesk-sync-queue` から復帰後に一括処理されるため、ユーザーに「最後の同期時刻」を示すことで安心感を与える。
- Comments は pending state をモーダル内にバッジ表示し、同期完了後に `pendingCount` を更新して通知する。

## Testing Tips

- Playwright では `page.context().addCookies` などを使わず既存の認証ストレージ (`playwright/.auth/user.json`) を利用する。
- Sync queue の挙動確認は `page.evaluate(() => localStorage.getItem('taesk-sync-queue'))` を使い JSON をダンプする。Timeline spec (`e2e/timeline.spec.ts`) ではカード作成→削除の後にクリーンアップしている。
- Comments / Notifications など localStorage を読むテストでは `await page.waitForFunction(() => navigator.onLine)` を挟んでリトライする。

## Cleanup Helpers

- `clearSyncQueue()`（lib/syncQueue.ts）がテスト後に queue を初期化。Playwright teardown で実行して差分を残さない。
- コメントキュー初期化は `useCommentsStore.getState().resetQueue()` を使用。

Timeline 以降のストレージ方針は **API = 唯一の真実**, **localStorage = pending actions only** を前提に設計されています。Kanban の `kanban_board_data` キャッシュは relic として残りますが、Timeline UI では参照されません。
