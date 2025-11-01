# ボード読み込み重複fetch削減・p95最適化

**Status**: 🔴 Todo
**Priority**: 🔥 High
**Created**: 2025-11-02
**Assignee**: 未定
**Estimated**: 6 hours

## 概要

ボード読み込み時に3-4回の重複fetchが発生し、p95が5292.8ms（目標3000ms超過）となっている。重複リクエストを削減し、ネットワークオーバーヘッドを改善する。

## 現状分析

### メトリクス計測結果

```
📊 Test Summary (2025-11-01)
   Samples: 4
   Avg:     1647.2 ms
   p95:     5292.8 ms ❌ (threshold: 3000ms)
   Max:     5292.8 ms
```

### ボトルネックの詳細

**最も遅いケース（5292.8ms）の内訳:**

```json
{
  "fetchDurationMs": 5292.5,    // ← ほぼすべてがfetch時間
  "parseDurationMs": 0.1,       // パース処理は高速
  "payloadSizeBytes": 1302,     // ペイロードも小さい
  "server": {
    "durationMs": 163.0,        // サーバー処理は163msで高速 ✅
    "steps": [
      {"label": "membershipQuery", "durationMs": 30.6},
      {"label": "listsQuery",      "durationMs": 53.8},
      {"label": "cardsQuery",      "durationMs": 54.2}
    ]
  }
}
```

**問題の本質:**
- サーバー処理: 163ms（十分高速）
- ネットワーク往復: **約5.1秒**（5292.5ms - 163ms）
- 原因: 各テストで**3-4回の重複fetch**が発生し、最後の1つだけが成功

### 重複fetchのパターン

すべてのテストで以下のパターンが確認されている：

```json
[
  {"status": "cancelled", "reason": "cancelled-after-fetch", "duration": 4362ms},
  {"status": "cancelled", "reason": "cancelled-after-fetch", "duration": 4584ms},
  {"status": "cancelled", "reason": "cancelled-after-fetch", "duration": 5146ms},
  {"status": "success",   "duration": 5292ms}  // ← 最後だけ成功
]
```

## 根本原因

### 1. React Strict Mode の重複レンダリング
- 開発モードで useEffect が2回実行される
- cleanup 関数が適切に実装されていない可能性

### 2. 競合する複数の fetch
- 同時に複数のコンポーネント/エフェクトから fetch が呼ばれる
- 先行リクエストのキャンセル機構がない

### 3. 状態変更による再レンダリング連鎖
- ボードID変更 → fetch
- ユーザー認証完了 → fetch
- 初期化完了 → fetch
- これらが短時間に連続発生

## 目的

- **p95を3000ms以下に改善**（現状5292.8ms → 目標<3000ms）
- 重複fetchを削減（4回 → 1回）
- ネットワークオーバーヘッドを最小化

## 実装内容

### Phase 1: 重複fetch削減（優先度：高）

#### 1.1 AbortController の導入
```typescript
// KanbanBoardClient.tsx
const abortControllerRef = useRef<AbortController | null>(null);

useEffect(() => {
  // 先行リクエストをキャンセル
  if (abortControllerRef.current) {
    abortControllerRef.current.abort();
  }

  const controller = new AbortController();
  abortControllerRef.current = controller;

  fetchBoardData(boardId, { signal: controller.signal });

  return () => {
    controller.abort();
    abortControllerRef.current = null;
  };
}, [boardId]);
```

#### 1.2 fetch デバウンス
```typescript
// 短時間の連続呼び出しを防ぐ
const debouncedFetch = useMemo(
  () => debounce(fetchBoardData, 100),
  []
);
```

#### 1.3 fetch 実行条件の厳格化
```typescript
// 必要な状態がすべて揃ってから fetch
if (!user || !boardId || !isClient) return;
if (isFetching.current) return; // 既に実行中ならスキップ
```

### Phase 2: キャッシュ戦略（優先度：中）

#### 2.1 短期キャッシュの実装
```typescript
const boardCacheRef = useRef<Map<string, {
  data: BoardData;
  timestamp: number;
}>>(new Map());

const CACHE_TTL = 5000; // 5秒

const getCachedData = (boardId: string) => {
  const cached = boardCacheRef.current.get(boardId);
  if (!cached) return null;

  if (Date.now() - cached.timestamp > CACHE_TTL) {
    boardCacheRef.current.delete(boardId);
    return null;
  }

  return cached.data;
};
```

#### 2.2 SWR (Stale-While-Revalidate) パターン
```typescript
// キャッシュがあれば即座に表示、バックグラウンドで更新
const cachedData = getCachedData(boardId);
if (cachedData) {
  setBoardData(cachedData);
}

// 並行してfresh dataを取得
fetchBoardData(boardId).then(freshData => {
  setBoardData(freshData);
  updateCache(boardId, freshData);
});
```

### Phase 3: リアルタイム更新の最適化（優先度：低）

#### 3.1 Realtime イベントのデバウンス
```typescript
// 短時間に複数のイベントが来ても、最後の1つだけ処理
const debouncedRealtimeHandler = useMemo(
  () => debounce(handleRealtimeChange, 200),
  []
);
```

## 受け入れ基準

- [ ] **board-load p95 が 3000ms 以下**（Playwright test-summary.js で ✅）
- [ ] 重複 fetch が 1 回に削減（cancelled traces が 0 件）
- [ ] 既存の E2E テストがすべて pass
- [ ] 開発モード（React Strict Mode）でも正常動作
- [ ] オフライン → オンライン復帰時も正常動作

## 技術的詳細

### AbortController のベストプラクティス

```typescript
// ❌ 悪い例: cleanup なし
useEffect(() => {
  fetchData(id);
}, [id]);

// ✅ 良い例: cleanup で abort
useEffect(() => {
  const controller = new AbortController();
  fetchData(id, { signal: controller.signal });

  return () => controller.abort();
}, [id]);
```

### デバウンス実装

```typescript
function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}
```

## テスト計画

### 1. ユニットテスト
- AbortController の正常動作
- デバウンス機能
- キャッシュの TTL

### 2. E2E テスト
- 既存の `@e2e:essential` テストが pass
- メトリクス収集で p95 が閾値以下
- 重複 fetch の発生回数

### 3. 手動テスト
- ボード切り替え時の挙動
- ネットワーク遅延時の挙動
- オフライン → オンライン復帰

## 実装優先度

1. **Phase 1.1 - AbortController**（必須）
   - 最も効果が高い
   - 実装コストが低い
   - 即座に重複fetchを削減

2. **Phase 1.2 - デバウンス**（推奨）
   - 連続呼び出しを防ぐ
   - ユーザー操作の体感速度向上

3. **Phase 1.3 - 実行条件の厳格化**（推奨）
   - 不要な fetch を防ぐ
   - バグの温床を減らす

4. **Phase 2 - キャッシュ戦略**（オプション）
   - p95 目標達成後に検討
   - より高度な最適化

## 関連チケット

- [#2025-11-01/01-board-load-metrics-followup](../2025-11-01/01-board-load-metrics-followup.md) - 計測基盤の整備
- [#2025-10-31/01-refactor-storage-performance](../2025-10-31/01-refactor-storage-performance.md) - ストレージパフォーマンス

## ノート

### メトリクス分析の詳細

- **高速なケース**: 306-604ms（サーバー: 109-158ms）
- **遅いケース**: 5292ms（サーバー: 163ms）
- **差分**: ネットワーク往復のオーバーヘッド（約5秒）

### サーバー側は最適化済み

すべてのクエリが30-54ms で完了しており、サーバー側のボトルネックはない：
- membershipQuery: 30-52ms
- listsQuery: 38-54ms
- cardsQuery: 34-54ms

**結論**: クライアント側の重複 fetch 削減に注力すべき

## 参考リンク

- [React useEffect cleanup](https://react.dev/learn/synchronizing-with-effects#how-to-handle-the-effect-firing-twice-in-development)
- [AbortController MDN](https://developer.mozilla.org/en-US/docs/Web/API/AbortController)
- [Debouncing and Throttling](https://css-tricks.com/debouncing-throttling-explained-examples/)
