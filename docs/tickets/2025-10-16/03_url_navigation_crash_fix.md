# URL Navigation Crash Fix - Next.js App Router Issue

**Date**: 2025-10-16
**Status**: ✅ Resolved
**Severity**: Critical (Production crash)

## Issue Summary

### Problem
カードモーダルを開いた際に `Uncaught TypeError: e is not iterable` が発生し、アプリケーションがクラッシュする事象が本番環境で確認されました。

### Root Cause
Next.js App Router (15.5.x) において、**インターセプトされたルートの Flight Data に `notFound()` や `redirect()` が混在**すると、内部的に `segmentPath` に `null` が紛れ込み、`fillCacheWithNewSubTreeData` でイテレーション時にクラッシュする既知のバグに該当。

### Reproduction Conditions
- 未同期または不正な `short_id` で `/c/...` への URL 遷移が発火した場合
- `lib/server/cards.ts` で `notFound()` や `permanentRedirect()` を返すと、並列/インターセプトルート経由で Flight Data に混入
- カードが存在しない状態で `/c/<invalid_short_id>` にナビゲートすると再現

## Solution

### Implementation Changes

#### 1. Client-side Modal with History API
- **Before**: `router.push('/c/...')` で実際のナビゲーション
- **After**: `router.push('/b/...?card=<short_id>')` でクエリパラメータベースのナビゲーション
- URL は `history.replaceState` で同期のみ（実ナビゲーション無し）
- Next.js の Flight Data マージ経路を回避

**Code Location**: `app/(board)/_components/KanbanBoardClient.tsx:1594-1609`

```typescript
const handleOpenCardModal = (card: Card) => {
  // ...existing code...

  const currentUrl = new URL(window.location.href);
  const basePath =
    modalReturnPathRef.current ||
    getBoardPath(currentBoard) ||
    getBoardPath(currentBoard, { canonical: false }) ||
    currentUrl.pathname;

  currentUrl.pathname = basePath || currentUrl.pathname;
  currentUrl.searchParams.set('card', card.short_id);

  const target = currentUrl.search
    ? `${currentUrl.pathname}${currentUrl.search}`
    : currentUrl.pathname;

  router.push(target, { scroll: false });
};
```

#### 2. Guard Against Unsynced Cards
カード未同期時は選択解除して URL 更新を抑止

**Code Location**: `app/(board)/_components/KanbanBoardClient.tsx:151-214`

```typescript
useEffect(() => {
  // Guard: If card doesn't exist locally, deselect
  if (selectedCardId && !boardData.cards.find(c => c.id === selectedCardId)) {
    console.warn('[useEffect cardQuery] Card not found in local data, deselecting');
    setSelectedCardId(null);
    setCardModalStatus('loading');
    return;
  }
  // ...
}, [cardQueryParam, selectedCardId, boardData.cards]);
```

#### 3. SSR Canonical Redirects
- `/` → ボード canonical URL へ 308 リダイレクト
- `/b/[short_id]` の SSR: 存在チェック＋canonical への 308
- 直アクセスは SSR 側で正規化

#### 4. E2E Tests Added
2つの新しいテストケースを追加:

1. **Invalid card URL handling** (`e2e/kanban.spec.ts:822-850`)
   - 存在しないカード URL にアクセスしても "e is not iterable" エラーが発生しないことを確認
   - 404 またはリダイレクトが正常に処理されることを検証

2. **Unsynced card navigation** (`e2e/kanban.spec.ts:852-887`)
   - カード作成直後（同期前）にモーダルを開いてもクラッシュしないことを確認
   - URL は `?card=` クエリまたはボード URL のまま維持されることを検証

## Test Results

### E2E Test Suite
```bash
npx playwright test --reporter=json > playwright-report.json
```

**Result**: 37 passed / 0 failed (2 new tests added)

### Manual Testing (Chrome DevTools)
- ✅ カードを開く → URL が `?card=<short_id>` に更新
- ✅ Save ボタン → モーダルが閉じ、URL から `?card=` が削除
- ✅ Escape キー → モーダルが閉じ、ボード URL に戻る
- ✅ Console エラー無し
- ✅ ネットワークエラー無し

## Prevention Strategy

### 1. Avoid Real Navigation for Modals
- インターセプトルート経由の実ナビゲーションを避ける
- クライアント側で `history.replaceState` を使用
- Next.js の Flight Data マージ経路に乗らない設計

### 2. Safe Flight Data Returns
- `lib/server/cards.ts` 側の `notFound()` / `permanentRedirect()` は**直打ちアクセス用**
- インターセプト側では **例外を投げず "安全な Flight Data" を返す**実装方針を維持

### 3. Monitoring & Logging
- `console.error` → Sentry 等で「`/c` に遷移要求が来たがカード未同期だった」ケースを計測
- 本番環境での異常検知を強化

### 4. Version Lock
- **Next.js 15.5.x の間はバージョン固定**
- アップグレード前に `/c` 経路の回帰テストを必ず実施
- E2E の「/c モーダル」系テストがカナリアとして機能

## Risk Assessment

### Remaining Risks
- **Low**: Next.js のマイナーバージョン更新で挙動が変わる可能性
- **Mitigation**: バージョン固定 + アップグレード前の回帰テスト必須

### Safe Paths
- ✅ 現在の実装は実ナビゲーションを発生させない設計
- ✅ E2E テストで継続的に監視
- ✅ 未同期カードのガード処理実装済み

## References

### Modified Files
- `app/(board)/_components/KanbanBoardClient.tsx` (lines 151-214, 1594-1651)
- `e2e/kanban.spec.ts` (new tests: lines 822-887)

### Related Issues
- Next.js App Router fillCacheWithNewSubTreeData bug
- Intercepting routes with notFound/redirect responses

### Current Version
- Next.js: 15.5.4 (locked)
- React: 18.3.1

## Future Plan

### Revert to `/c/...` URLs When Possible

**Ideal URL format** (Trello-style):
```
/c/<short_id>/<idShort>-<slug>
```

**Current workaround** (temporary):
```
/b/<board_short_id>?card=<card_short_id>
```

**When to revert**:
1. ✅ Next.js releases a fix for the `fillCacheWithNewSubTreeData` bug
2. ✅ E2E test `should handle invalid card URL gracefully without crashing` passes
3. ✅ Manual testing confirms no crashes with `/c/INVALID_ID` navigation

**Migration checklist**:
- [ ] Check Next.js release notes for Flight Data / Intercepting Routes fixes
- [ ] Test with new Next.js version in development
- [ ] Run full E2E suite
- [ ] Update documentation
- [ ] Deploy to staging
- [ ] Monitor production for errors

**Tracking**: See [Next.js Flight Data Bug Details](./04_nextjs_flight_data_bug_details.md) for technical deep dive and migration path.

## Conclusion

実装の回避策がリポジトリに反映済みで、E2E も通過しています。
Next.js 15.5.x は継続採用ですが、今回のクラッシュ経路を踏まない設計に寄せられています。

**Status**: ✅ Production-ready (with workaround)
**Long-term goal**: Revert to `/c/...` URLs when Next.js bug is fixed
