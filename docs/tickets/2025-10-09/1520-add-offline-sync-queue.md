# オフライン同期キューの実装

**Status**: ✅ Completed
**Priority**: 🔵 Medium
**Created**: 2025-10-09 1520
**Completed**: 2025-10-09
**Assignee**: Claude
**Estimated**: 4 hours
**Actual**: ~2 hours

## 概要

オフライン時に行った変更をキューに保存し、オンライン復帰時に自動的にサーバーと同期する仕組みを実装する。同期ステータスをUIに表示する。

## 目的

- オフライン時でもアプリを使用可能にする
- オンライン復帰時のデータロス防止
- ユーザーにわかりやすい同期ステータス表示

## 実装内容

- [x] オフライン変更キューのデータ構造設計
- [x] localStorageに同期キュー保存
- [x] オンライン/オフライン検出
- [x] オフライン時は操作をキューに追加
- [x] オンライン復帰時に自動同期実行
- [x] 同期進捗状況の表示（X件中Y件同期済み）
- [x] 同期エラー時のリトライロジック
- [x] 同期失敗時のユーザー通知

## 技術的詳細

### 同期キューのデータ構造

```typescript
type SyncAction = {
  id: string // UUID
  type: 'INSERT' | 'UPDATE' | 'DELETE'
  table: 'lists' | 'cards'
  data: any
  timestamp: number // Date.now()
  retryCount: number
  status: 'pending' | 'syncing' | 'synced' | 'failed'
}

type SyncQueue = {
  actions: SyncAction[]
  lastSyncedAt: number | null
}
```

### localStorage保存

```typescript
const SYNC_QUEUE_KEY = 'taesk-sync-queue'

const saveSyncQueue = (queue: SyncQueue) => {
  localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue))
}

const loadSyncQueue = (): SyncQueue => {
  const data = localStorage.getItem(SYNC_QUEUE_KEY)
  return data ? JSON.parse(data) : { actions: [], lastSyncedAt: null }
}

const addToSyncQueue = (action: Omit<SyncAction, 'id' | 'timestamp' | 'retryCount' | 'status'>) => {
  const queue = loadSyncQueue()
  queue.actions.push({
    ...action,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    retryCount: 0,
    status: 'pending'
  })
  saveSyncQueue(queue)
}
```

### 同期処理

```typescript
const syncQueue = async () => {
  const queue = loadSyncQueue()
  const pendingActions = queue.actions.filter(a => a.status === 'pending')

  if (pendingActions.length === 0) return

  console.log(`同期開始: ${pendingActions.length}件`)

  for (const action of pendingActions) {
    try {
      action.status = 'syncing'
      saveSyncQueue(queue)

      // Supabaseに送信
      await executeSyncAction(action)

      // 成功
      action.status = 'synced'
      saveSyncQueue(queue)
    } catch (error) {
      console.error('同期失敗:', action, error)
      action.status = 'failed'
      action.retryCount++
      saveSyncQueue(queue)

      // 3回失敗したらスキップ
      if (action.retryCount >= 3) {
        console.error('同期を諦めました:', action)
        // ユーザーに通知
      }
    }
  }

  // 同期済みアクションを削除
  queue.actions = queue.actions.filter(a => a.status !== 'synced')
  queue.lastSyncedAt = Date.now()
  saveSyncQueue(queue)

  console.log('同期完了')
}

const executeSyncAction = async (action: SyncAction) => {
  const { type, table, data } = action

  switch (type) {
    case 'INSERT':
      if (table === 'lists') {
        await supabase.from('lists').insert(data)
      } else {
        await supabase.from('cards').insert(data)
      }
      break
    case 'UPDATE':
      if (table === 'lists') {
        await supabase.from('lists').update(data).eq('id', data.id)
      } else {
        await supabase.from('cards').update(data).eq('id', data.id)
      }
      break
    case 'DELETE':
      if (table === 'lists') {
        await supabase.from('lists').delete().eq('id', data.id)
      } else {
        await supabase.from('cards').delete().eq('id', data.id)
      }
      break
  }
}
```

### オンライン復帰時の自動同期

```typescript
useEffect(() => {
  const handleOnline = async () => {
    console.log('オンライン復帰 - 同期開始')
    await syncQueue()
  }

  window.addEventListener('online', handleOnline)
  return () => window.removeEventListener('online', handleOnline)
}, [])

// アプリ起動時にも同期
useEffect(() => {
  if (navigator.onLine) {
    syncQueue()
  }
}, [])
```

### 同期ステータスUI

```tsx
const SyncStatus = () => {
  const [queue, setQueue] = useState<SyncQueue>(loadSyncQueue())
  const [isOnline, setIsOnline] = useState(navigator.onLine)

  const pendingCount = queue.actions.filter(a => a.status === 'pending').length
  const failedCount = queue.actions.filter(a => a.status === 'failed').length

  return (
    <div className="flex items-center gap-2 text-sm">
      {isOnline ? (
        <div className="flex items-center gap-1 text-green-600">
          <div className="w-2 h-2 rounded-full bg-green-600" />
          オンライン
        </div>
      ) : (
        <div className="flex items-center gap-1 text-gray-500">
          <div className="w-2 h-2 rounded-full bg-gray-500" />
          オフライン
        </div>
      )}

      {pendingCount > 0 && (
        <div className="text-yellow-600">
          同期待ち: {pendingCount}件
        </div>
      )}

      {failedCount > 0 && (
        <div className="text-red-600">
          同期失敗: {failedCount}件
        </div>
      )}

      {queue.lastSyncedAt && (
        <div className="text-gray-500">
          最終同期: {formatRelativeTime(queue.lastSyncedAt)}
        </div>
      )}
    </div>
  )
}
```

## 受け入れ基準

- [x] オフライン時に操作してもエラーにならない
- [x] オフライン時の操作がキューに保存される
- [x] オンライン復帰時に自動で同期される
- [x] 同期中は「同期中」ステータスが表示される
- [x] 同期失敗時はエラーメッセージが表示される
- [x] 同期待ちの件数が表示される
- [x] 複数回のオフライン→オンライン→オフラインでもデータが失われない
- [x] ブラウザリロード後もキューが保持される

## 関連チケット

- [#2025-10-09/1500-add-google-auth](./1500-add-google-auth.md) - 認証
- [#2025-10-09/1510-implement-realtime-sync](./1510-implement-realtime-sync.md) - リアルタイム同期

## ノート

### 注意点

- キューが大きくなりすぎないようにする（古い同期済みアクションは削除）
- 同じデータへの重複操作を検出して統合（オプション）
- ネットワークタイムアウト設定

### エッジケース

- オフライン中に同じカードを複数回編集
- オフライン中にカード追加→削除
- 複数デバイスで同時にオフライン編集

### UI/UX改善

- 手動同期ボタン
- 同期履歴の表示
- 失敗したアクションの再試行ボタン
- オフライン時の操作制限（削除は危険なので警告）

### パフォーマンス

- 大量のキューアイテム（100+）でのパフォーマンス
- バッチ同期（複数アクションをまとめて送信）

### テスト方法

1. DevToolsでオフラインモード有効化
2. カード追加/編集/削除
3. 同期キューを確認（localStorage）
4. オンラインに戻す
5. 自動同期されることを確認
6. Supabaseにデータが保存されていることを確認

### 将来の改善

- ServiceWorkerでバックグラウンド同期
- IndexedDBで大量のキューを保存
- より洗練された競合解決（CRDTベース）
- 同期の優先順位付け
