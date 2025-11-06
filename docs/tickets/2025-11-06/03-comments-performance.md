# コメント読み込みパフォーマンス改善

**日付**: 2025-11-06
**優先度**: High
**ステータス**: 🟡 In Progress
**担当**: Claude

## 📋 問題

コメントの読み込みが遅すぎる。特にカードモーダルを開いた時の初回表示に時間がかかる。

## 🔍 原因分析

### 現在の実装

1. **CommentsPanel** (`app/(board)/_components/CommentsPanel.tsx`)
   - Line 96: `loadComments(cardId)` → `/api/cards/[cardId]/comments` を呼び出し
   - Line 115: `/api/boards/${boardId}/members` を呼び出し
   - **合計2往復のネットワーク遅延が発生**

2. **API構造**
   - `/api/cards/[cardId]/comments` (Line 24-39)
     - コメント取得時に既に `author` の情報を JOIN で取得済み
     - `id, username, display_name, full_name, avatar_url, email`
   - `/api/boards/${boardId}/members`
     - メンバー全員の profile 情報を取得
     - **コメントAPIと情報が重複**

3. **Realtime subscriptionなし**
   - 新しいコメントが投稿されても自動更新されない
   - ページリロードが必要

### パフォーマンスボトルネック

```
カードモーダル表示
  ↓ (待ち時間)
コメント取得API ← 200-500ms
  ↓ (待ち時間)
メンバー取得API ← 200-500ms
  ↓
表示完了

合計: 400-1000ms の遅延
```

## 💡 解決策

### Option 1: メンバー情報をコメントAPIから取得（推奨）

**変更箇所**:
- `app/api/cards/[cardId]/comments/route.ts`
  - コメント取得時に、ボードの全メンバー情報も返す
  - 新フィールド追加: `{ comments: [...], members: [...] }`

- `lib/api/comments.ts`
  - `FetchCommentsResult` 型に `members` フィールド追加

- `app/(board)/_components/CommentsPanel.tsx`
  - メンバーAPI呼び出しを削除
  - `loadComments()` のレスポンスから `members` を取得

**効果**:
- ✅ API呼び出しが **2回 → 1回** に削減
- ✅ 待ち時間が **50%削減**（400-1000ms → 200-500ms）
- ✅ コード簡潔化

### Option 2: 並列取得

**変更箇所**:
- `CommentsPanel.tsx`
  ```typescript
  useEffect(() => {
    Promise.all([
      loadComments(cardId),
      fetch(`/api/boards/${boardId}/members`)
    ]);
  }, [cardId, boardId]);
  ```

**効果**:
- ⚠️ 往復は2回のまま（並列実行で体感速度向上）
- ⚠️ 情報重複は解決されない

### Option 3: Realtime subscription追加

**変更箇所**:
- `app/(board)/_components/CommentsPanel.tsx`
  - Supabase Realtime で `comments` テーブルを購読
  - `INSERT`, `UPDATE`, `DELETE` イベントで自動リフレッシュ

**効果**:
- ✅ リアルタイム更新
- ⚠️ 初回読み込み速度は変わらない

## 🎯 実装計画（推奨: Option 1 + Option 3）

### Phase 1: API統合（Option 1）

1. **`app/api/cards/[cardId]/comments/route.ts` 修正**
   ```typescript
   // GET /api/cards/[cardId]/comments
   // 既存のコメント取得に加えて、メンバー情報も返す

   // 1. コメント取得（既存）
   const { data: comments } = await supabase.from('comments')...

   // 2. ボードメンバー取得（新規）
   const { data: card } = await supabase.from('cards')
     .select('board_id').eq('id', cardId).single();

   const { data: members } = await supabase.from('board_members')
     .select('profile_id, role, profile:profile_id(*)')
     .eq('board_id', card.board_id);

   // 3. レスポンス
   return NextResponse.json({
     comments: transformedComments,
     members: members.map(m => ({ ...m.profile, role: m.role }))
   });
   ```

2. **`lib/api/comments.ts` 型定義更新**
   ```typescript
   export interface FetchCommentsResult {
     comments: CommentWithAuthor[];
     members?: Array<ProfileSummary & { role: MemberRole }>;
     error?: { code: string; message: string };
   }
   ```

3. **`app/(board)/_stores/comments-store.ts` 修正**
   ```typescript
   loadComments: async (cardId, force = false) => {
     const result = await fetchComments(cardId);

     set(prev => ({
       cards: {
         ...prev.cards,
         [cardId]: {
           comments: result.comments,
           members: result.members,  // 新規
           status: 'ready',
         },
       },
     }));
   }
   ```

4. **`CommentsPanel.tsx` 修正**
   ```typescript
   // メンバー取得部分を削除（Line 108-142）
   const commentsState = useCommentsStore(state => state.cards[cardId]);
   const members = commentsState?.members ?? [];  // store から取得
   ```

### Phase 2: Realtime追加（Option 3）

5. **`CommentsPanel.tsx` に Realtime subscription 追加**
   ```typescript
   useEffect(() => {
     const channel = supabase
       .channel(`comments:${cardId}`)
       .on('postgres_changes',
         { event: '*', schema: 'public', table: 'comments', filter: `card_id=eq.${cardId}` },
         () => loadComments(cardId, true)  // force reload
       )
       .subscribe();

     return () => { channel.unsubscribe(); };
   }, [cardId]);
   ```

## ✅ 期待される効果

- **初回表示速度**: 400-1000ms → 200-500ms（50%改善）
- **リアルタイム性**: ページリロード不要で最新コメント表示
- **コード品質**: API呼び出し削減でメンテナンス性向上

## 📝 実装メモ

- [ ] Phase 1: API統合（メンバー情報をコメントAPIに含める）
- [ ] Phase 2: Realtime subscription追加
- [ ] E2Eテスト更新（必要に応じて）
- [ ] パフォーマンス計測（Before/After）

## 🔗 関連ファイル

- `app/api/cards/[cardId]/comments/route.ts` - コメント取得API
- `lib/api/comments.ts` - コメントAPI型定義
- `app/(board)/_stores/comments-store.ts` - コメントstore
- `app/(board)/_components/CommentsPanel.tsx` - コメントUI

---

**作成日**: 2025-11-06
**最終更新**: 2025-11-06
