# リアルタイム同期の実装

**Status**: 🔴 Not Started
**Priority**: 🔥 High
**Created**: 2025-10-09 1510
**Assignee**: TBD
**Estimated**: 6 hours

## 概要

Supabase Realtimeを使用して、複数デバイス間でボードの変更をリアルタイムに同期する。競合検出と解決メカニズムも実装する。

## 目的

- 複数デバイスで同じボードを同時編集可能にする
- 変更が即座に他のデバイスに反映される
- データの不整合を防ぐ

## 実装内容

- [ ] Supabase Realtimeサブスクリプション設定
- [ ] lists/cardsテーブルの変更をリアルタイム購読
- [ ] 他デバイスからの変更を受信して状態更新
- [ ] ローカル変更とリモート変更の競合検出
- [ ] 競合解決ロジック（Last Write Wins or Manual Merge）
- [ ] 楽観的UI更新（即座に反映、エラー時はロールバック）
- [ ] 同期ステータス表示（オンライン/オフライン、同期中）
- [ ] エラーハンドリング（接続切断、再接続）

## 技術的詳細

### Realtime購読

```typescript
import { createClient } from '@/lib/supabase'

// listsテーブルの変更を購読
const supabase = createClient()
const channel = supabase
  .channel('board-changes')
  .on(
    'postgres_changes',
    {
      event: '*', // INSERT, UPDATE, DELETE
      schema: 'public',
      table: 'lists',
      filter: `user_id=eq.${userId}` // 自分のデータのみ
    },
    (payload) => {
      handleListChange(payload)
    }
  )
  .on(
    'postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'cards',
      // cardsはlist_id経由でフィルタする必要あり
    },
    (payload) => {
      handleCardChange(payload)
    }
  )
  .subscribe()

// クリーンアップ
// channel.unsubscribe()
```

### 状態管理

```typescript
type SyncStatus = 'online' | 'offline' | 'syncing' | 'error'

const [syncStatus, setSyncStatus] = useState<SyncStatus>('online')
const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)
```

### 競合解決

**戦略**: Last Write Wins (LWW)
- `updated_at`タイムスタンプで最新を判定
- サーバーのタイムスタンプを信頼
- クライアント側は常にサーバーの値を優先

```typescript
const handleListChange = (payload: RealtimePayload) => {
  const { eventType, new: newData, old: oldData } = payload

  switch (eventType) {
    case 'INSERT':
      // 新しいリストが追加された
      addListToState(newData)
      break
    case 'UPDATE':
      // リストが更新された
      // ローカルのupdated_atと比較して新しければ更新
      if (new Date(newData.updated_at) > new Date(localList.updated_at)) {
        updateListInState(newData)
      }
      break
    case 'DELETE':
      // リストが削除された
      removeListFromState(oldData.id)
      break
  }
}
```

### 楽観的更新

```typescript
const handleDragEnd = async (event: DragEndEvent) => {
  // 1. 即座にUIを更新（楽観的）
  const optimisticData = updateLocalState(event)
  setBoardData(optimisticData)

  try {
    // 2. サーバーに保存
    await saveToSupabase(optimisticData)
  } catch (error) {
    // 3. エラー時はロールバック
    console.error('Sync failed:', error)
    setBoardData(previousData) // 元に戻す
    showErrorToast('変更の保存に失敗しました')
  }
}
```

### 接続ステータス監視

```typescript
useEffect(() => {
  // オンライン/オフライン検出
  const handleOnline = () => setSyncStatus('online')
  const handleOffline = () => setSyncStatus('offline')

  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)

  return () => {
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
  }
}, [])
```

## 受け入れ基準

- [ ] 複数ブラウザタブで同じボードを開いた際、変更が即座に反映される
- [ ] デバイスAでカード追加→デバイスBで即座に表示される
- [ ] デバイスAでリスト削除→デバイスBで即座に消える
- [ ] ドラッグ&ドロップの変更も同期される
- [ ] 同期ステータスが画面に表示される
- [ ] オフライン時はステータスが「オフライン」になる
- [ ] オンライン復帰時に自動で再接続される
- [ ] 競合が発生した場合でもデータが壊れない
- [ ] E2Eテストで2つのブラウザ間同期を確認

## 関連チケット

- [#2025-10-09/1500-add-google-auth](./1500-add-google-auth.md) - 認証（Realtime前提条件）
- [#2025-10-09/1520-add-offline-sync-queue](./1520-add-offline-sync-queue.md) - オフライン同期

## ノート

### 注意点

- Realtime接続は有料プランで制限あり（Free: 200 concurrent connections）
- 大量の同時編集では競合が頻発する可能性
- updated_atタイムスタンプの精度に依存

### パフォーマンス考慮

- 大量のカード（100+）での同期パフォーマンス
- debounce/throttleでサーバー負荷軽減
- 必要な変更のみ送信（差分同期）

### UI/UX

- 同期中インジケーター表示
- 他ユーザーの編集中カーソル表示（将来）
- 競合時のユーザー通知

### Supabase Realtime有効化

Supabase Dashboard → Database → Tables → lists/cards → Enable Realtime

### テスト方法

1. 2つのブラウザタブを開く
2. タブAでカード追加
3. タブBで即座に表示されることを確認
4. タブBでカード編集
5. タブAで変更が反映されることを確認

### 将来の改善

- OT (Operational Transformation) または CRDT 導入
- より洗練された競合解決UI
- プレゼンスAPI（誰が編集中か表示）
