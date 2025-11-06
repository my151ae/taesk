# コメント読み込みパフォーマンス改善

**日付**: 2025-11-06
**優先度**: High
**ステータス**: 🟡 Ready to Implement
**担当**: Claude

---

## 📋 問題

コメントの読み込みが遅すぎる。特にカードモーダルを開いた時の初回表示に時間がかかる（400-1000ms）。

---

## 🔍 根本原因

### データの二重取得 + 直列フェッチ

1. **CommentsPanel が独自にメンバー情報を再取得**
   - `KanbanBoardClient` で既に `boardMembers` を取得済み
   - `CommentsPanel` が `/api/boards/${boardId}/members` を再度呼び出し
   - **情報の重複取得**

2. **直列2往復のネットワーク遅延**
   - Line 96: `loadComments(cardId)` → `/api/cards/[cardId]/comments`
   - Line 115: `/api/boards/${boardId}/members`
   - **TTFB が 2回分積み上がる**

3. **Realtime の重複リスク**
   - 既存の「ボード単位」購読が comments をカバー
   - Panel 側で追加購読すると二重処理の温床

### 現在のフロー

```
カードモーダル表示
  ↓
CommentsPanel マウント
  ↓ (待ち時間 200-500ms)
コメント取得API
  ↓ (待ち時間 200-500ms)
メンバー取得API ← **KanbanBoardClientで取得済みなのに再取得**
  ↓
表示完了

合計: 400-1000ms の遅延
```

> **重要**: Supabase Realtime は**初期データを配信しない**（変更イベントのみ）。購読を増やしても初期表示速度は改善しない。

---

## 💡 解決策（優先順位順）

### ✅ Option 1: 既存メンバー状態の再利用（最優先・推奨）

**方針**: KanbanBoardClient で保持している `boardMembers` を `CardModal → CommentsPanel` にプロップで受け渡し。

**メリット**:
- ✅ **API変更不要**
- ✅ **追加RTTを0に**（400-1000ms → 200-500ms）
- ✅ 即効性が高い

**実装**:

```typescript
// 1. KanbanBoardClient: ロール込みでメンバーを保持
type BoardMember = { profile: ProfileSummary; role: MemberRole };

function KanbanBoardClient({ boardId }: { boardId: string }) {
  const [boardMembers, setBoardMembers] = useState<BoardMember[]>([]);

  useEffect(() => {
    // 既存のメンバー取得ロジック（ロール込み）
    fetchBoardMembers(boardId).then(setBoardMembers);
  }, [boardId]);

  return <CardModal boardId={boardId} boardMembers={boardMembers} cardId={selectedCardId} />;
}

// 2. CardModal: メンバー情報をCommentsPanelに引き継ぎ
function CardModal({ boardId, boardMembers, cardId }: { boardId: string; boardMembers: BoardMember[]; cardId: string }) {
  return (
    <div>
      {/* Details tab */}
      {/* Comments tab */}
      <CommentsPanel
        boardId={boardId}
        cardId={cardId}
        initialMembers={boardMembers}  // ← 追加
      />
    </div>
  );
}

// 3. CommentsPanel: initialMembers を優先使用
function CommentsPanel({
  boardId,
  cardId,
  initialMembers
}: {
  boardId: string;
  cardId: string;
  initialMembers?: BoardMember[];  // ← 追加
}) {
  const [members, setMembers] = useState<BoardMember[]>(initialMembers ?? []);

  useEffect(() => {
    // initialMembers がある場合はフェッチをスキップ
    if (initialMembers && initialMembers.length > 0) {
      setMembers(initialMembers);
      return;
    }

    // フォールバック: 未提供時のみフェッチ
    fetch(`/api/boards/${boardId}/members`)
      .then(res => res.json())
      .then(data => setMembers(data.members));
  }, [boardId, initialMembers]);

  // 既存のコメント取得ロジックはそのまま
  useEffect(() => {
    loadComments(cardId);
  }, [cardId]);

  // ...
}
```

**変更ファイル**:
- `app/(board)/_components/KanbanBoardClient.tsx` - boardMembers をロール込みで保持
- `app/components/CardModal.tsx` - プロップに `boardMembers` 追加
- `app/(board)/_components/CommentsPanel.tsx` - `initialMembers` 受け取り、フェッチをスキップ

---

### ✅ Option 2: 共通ストア化（中期的改善）

**方針**: `useBoardMembersStore` を作成し、ボード切替時に1度だけロード → どの子コンポーネントからも購読。

**実装**:

```typescript
// app/(board)/_stores/board-members-store.ts
import { create } from 'zustand';

type BoardMember = { profile: ProfileSummary; role: MemberRole };
type State = {
  byBoardId: Record<string, BoardMember[]>;
  loadedAt: Record<string, number>;
};
type Actions = {
  setMembers: (boardId: string, members: BoardMember[]) => void;
  getMembers: (boardId: string) => BoardMember[] | undefined;
};

export const useBoardMembersStore = create<State & Actions>((set, get) => ({
  byBoardId: {},
  loadedAt: {},

  setMembers: (boardId, members) => set(state => ({
    byBoardId: { ...state.byBoardId, [boardId]: members },
    loadedAt: { ...state.loadedAt, [boardId]: Date.now() }
  })),

  getMembers: (boardId) => get().byBoardId[boardId],
}));

// KanbanBoardClient: ストアに保存
const { setMembers } = useBoardMembersStore();
useEffect(() => {
  fetchBoardMembers(boardId).then(members => setMembers(boardId, members));
}, [boardId]);

// CommentsPanel: ストアから取得
const members = useBoardMembersStore(state => state.byBoardId[boardId] ?? []);
```

**メリット**:
- ✅ キャッシュ戦略を明示的に管理
- ✅ どのコンポーネントからもアクセス可能
- ✅ 古いデータの再検証（`loadedAt`）が容易

---

### ✅ Option 3: Realtime は既存チャネルに統一

**方針**: **ボード単位チャネル1本**に集約し、comments の `INSERT/UPDATE/DELETE` をハンドリング。

**実装**:

```typescript
// KanbanBoardClient で既存のボードチャネルを拡張
useEffect(() => {
  const channel = supabase
    .channel(`board:${boardId}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'lists', filter: `board_id=eq.${boardId}` },
      handleListChange
    )
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'cards', filter: `board_id=eq.${boardId}` },
      handleCardChange
    )
    .on('postgres_changes',  // ← 追加
      { event: '*', schema: 'public', table: 'comments', filter: `board_id=eq.${boardId}` },
      (payload) => {
        // useCommentsStore の upsertComment / removeComment を呼び出し
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          useCommentsStore.getState().upsertComment(payload.new.card_id, payload.new);
        } else if (payload.eventType === 'DELETE') {
          useCommentsStore.getState().removeComment(payload.old.card_id, payload.old.id);
        }
      }
    )
    .subscribe();

  return () => void supabase.removeChannel(channel);
}, [boardId]);
```

**メリット**:
- ✅ 購読の重複を回避
- ✅ リアルタイム更新（初期表示速度には影響なし）
- ✅ イベントハンドラを idempotent に実装可能

**注意点**:
> CommentsPanel で個別に `channel(`comments:${cardId}`)` を購読しない。既存のボードチャネルで一元管理。

---

### ⚠️ Option 4: API側の最小統合（最終手段）

**方針**: どうしてもAPI集約が必要な場合、**PostgREST のリソース埋め込み**で著者プロフィールのみを同梱。

**実装例**:

```typescript
// GET /api/cards/:cardId/comments
const { data: comments } = await supabase
  .from('comments')
  .select(`
    *,
    author:profiles!author_id(id, display_name, avatar_url)
  `)
  .eq('card_id', cardId)
  .is('deleted_at', null);
```

**注意点**:
- ⚠️ **ボードメンバー全員を毎回返すのは冗長**（転送量増）
- ⚠️ メンバー情報は別途キャッシュすべき
- ✅ 著者プロフィールの埋め込みは OK（コメント数分のみ）

---

### ❌ Option 5: 並列取得（非推奨）

直列→並列にしても**根治ではない**。Option 1〜3 を優先。

---

## 🎯 実装計画（推奨順）

### Phase 1: 既存メンバー状態の再利用（即効性）

- [ ] **Step 1**: `KanbanBoardClient` で `boardMembers` をロール込みで保持
- [ ] **Step 2**: `CardModal` に `boardMembers` プロップ追加
- [ ] **Step 3**: `CommentsPanel` に `initialMembers` プロップ追加、フェッチロジックを条件分岐
- [ ] **Step 4**: パフォーマンス計測（Before/After）

**期待効果**: 400-1000ms → 200-500ms（**50%改善**）

### Phase 2: 共通ストア化（中期的）

- [ ] **Step 1**: `useBoardMembersStore` 作成
- [ ] **Step 2**: `KanbanBoardClient` でストアに保存
- [ ] **Step 3**: `CommentsPanel` でストアから取得
- [ ] **Step 4**: 古いデータの再検証ロジック追加（`loadedAt` を使用）

### Phase 3: Realtime 統一（リアルタイム性向上）

- [ ] **Step 1**: `KanbanBoardClient` の既存ボードチャネルに `comments` イベント追加
- [ ] **Step 2**: `useCommentsStore` の `upsertComment` / `removeComment` を idempotent に
- [ ] **Step 3**: CommentsPanel の個別購読を削除（あれば）

---

## 📊 パフォーマンス計測

### 計測指標

1. **TTI (Time to Interactive)**: モーダル open → 初回コメント描画まで
2. **TTC (Time to Complete)**: モーダル open → 全コメント描画完了まで
3. **Network**: モーダル初回開閉でのリクエスト本数・総サイズ

### 実装

```typescript
// CommentsPanel.tsx
useEffect(() => {
  performance.mark('cmt-modal-open');
}, []);

useEffect(() => {
  if (comments.length > 0) {
    performance.mark('cmt-first-render');
    performance.measure('cmt_TTI', 'cmt-modal-open', 'cmt-first-render');
  }
}, [comments]);

useEffect(() => {
  if (commentStatus === 'ready') {
    performance.mark('cmt-all-rendered');
    performance.measure('cmt_TTC', 'cmt-modal-open', 'cmt-all-rendered');

    // ログ出力
    const tti = performance.getEntriesByName('cmt_TTI')[0]?.duration;
    const ttc = performance.getEntriesByName('cmt_TTC')[0]?.duration;
    console.log(`[Perf] Comments TTI: ${tti}ms, TTC: ${ttc}ms`);
  }
}, [commentStatus]);
```

**Before/After 比較**:
- Before: TTI ~600ms, TTC ~800ms, Network 2 requests
- After (目標): TTI ~300ms, TTC ~400ms, Network 1 request

---

## ⚠️ リスクと対処

### 1. 古いメンバー情報のまま表示

**対処**:
- ストアに `loadedAt` タイムスタンプを保持
- 一定時間経過（例: 5分）で**サイレント再検証**（UI ブロックしない）

```typescript
const CACHE_TTL = 5 * 60 * 1000; // 5分

const shouldRefetch = (loadedAt: number) => Date.now() - loadedAt > CACHE_TTL;

useEffect(() => {
  const loadedAt = useBoardMembersStore.getState().loadedAt[boardId];
  if (!loadedAt || shouldRefetch(loadedAt)) {
    fetchBoardMembers(boardId, { silent: true });
  }
}, [boardId]);
```

### 2. Realtime イベント重複

**対処**:
- ハンドラで `updated_at` を比較し **idempotent** に適用
- 既存コメントより古いイベントは無視

```typescript
upsertComment: (cardId, comment) => {
  set(prev => {
    const existing = prev.cards[cardId]?.comments.find(c => c.id === comment.id);
    // 既存の方が新しければスキップ
    if (existing && new Date(existing.updated_at) >= new Date(comment.updated_at)) {
      return prev;
    }
    // ...
  });
}
```

### 3. payload 増加（API統合時）

**対処**:
- ボードメンバー全員を毎回返さない
- 著者プロフィールのみ埋め込む（最小限）

---

## 🔗 関連ファイル

- `app/(board)/_components/KanbanBoardClient.tsx` - ボード管理
- `app/components/CardModal.tsx` - カードモーダル
- `app/(board)/_components/CommentsPanel.tsx` - コメントUI
- `app/(board)/_stores/comments-store.ts` - コメントstore
- `app/(board)/_stores/board-members-store.ts` - メンバーstore（新規）
- `app/api/cards/[cardId]/comments/route.ts` - コメント取得API

---

## 📚 参考資料

- [Supabase Realtime - Subscribing to Database Changes](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes)
- [PostgREST - Resource Embedding](https://docs.postgrest.org/en/v12/references/api/resource_embedding.html)
- [MDN - Performance API](https://developer.mozilla.org/ja/docs/Web/API/Performance/measure)
- [Zenn - Supabase Realtime の仕様](https://zenn.dev/k_kind/articles/supabase-realtime-postgres)

---

**作成日**: 2025-11-06
**最終更新**: 2025-11-06
