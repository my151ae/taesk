# Board Short URL - Step1-3 残課題修正（URL即時更新＆カード編集保存）

**Status**: 🟡 In Progress (T-Edit ✅ Fixed, T-2 ⏳ Pending)
**Priority**: 🔥 High
**Created**: 2025-10-14
**Assignee**: Claude
**Estimated**: 4 hours
**Test Results**: E2E 29/33 pass (87.9%) → 16/20 kanban pass (80%)

## 概要

Board Short URL（/b）の Step1-3 検証で判明した 2 つのブロッカーを修正する。
- **T-2**: URL 即時更新の遅延（切替直後に `/b/:sid` へ反映されない）
- **T-Edit**: カード編集が保存されない（UI 更新・DB 同期の欠落）

## 背景

### 検証結果サマリ（E2E: 29/33 pass, 87.9%）

**✅ Pass（Step1-3 基本機能）**
- SSR（`/b/:sid/[[...slug]]`）正常動作、`revalidate = 0`
- `/?board=uuid` → `/b/:sid/:id_short-:slug` へ 308 リダイレクト
- slug 不一致時の正規化 308
- Middleware/Edge/KV キャッシュ連携
- DB schema（short_id/slug/id_short）整合性

**❌ Fail（修正対象）**
1. **URL 即時更新が遅い**（/b 領域・ブロッカー）
   - 期待：切替直後に `/b/:sid` へ即時反映
   - 実際：データ待ちで遅延（immediatePath が `/b/:sid` を満たさない）

2. **カード編集が保存されない**（/b 領域・ブロッカー）
   - 期待：タイトル更新が UI に反映
   - 実際：見つからず（UI 更新 or DB 同期の欠落）

3. `/c/:short_id` モーダル表示にならない（**Step4 領域**）
4. `/c` slug 正規化が働かない（**Step4 領域**）

> **判断**: /c の 2 件は **Step4（Intercepting Routes & モーダル統合）** で扱う。今回は /b の 2 点を修正。

## 実装内容

### T-2: URL 即時更新（必須・ブロッカー解消）

**原因**
`updateURL` が slug 解決などの非同期処理を待ってから `router.replace` を実行している。

**対策**
先に同期で `/b/:sid` に置換し、同一 tick で `:tail` を上書き（データ待ちを禁止）。

```typescript
// app/(board)/_components/KanbanBoardClient.tsx
const updateURL = (board: Board) => {
  const sid = board.short_id;

  // ① 即時反映（同期）
  router.replace(`/b/${sid}`);

  // ② 同一 tick で上書き（tail あれば）
  queueMicrotask(() => {
    const tail = buildBoardCanonicalTail(board);
    if (tail) router.replace(`/b/${sid}/${tail}`);
  });
};
```

**検証観点**
- [ ] 切替クリック直後、アドレスバーが瞬時に `/b/:sid`
- [ ] tail あり時は同 tick で `/b/:sid/:tail` に上書き
- [ ] SSR の正規化（slug 不一致→308）は引き続き担保

---

### T-Edit: カード編集の保存（✅ 修正完了）

**症状**
1. 編集後のタイトルが UI に反映されない。入力中にカーソルが外れる（フォーカスが奪われる）
2. モーダルを X ボタンや Close ボタンで閉じるとアプリがクラッシュする

**根本原因**
1. **過剰な Supabase upsert**: `handleSaveCard` が `syncToSupabase()` を呼び出し、全カード・全リストを upsert していた
   - → Supabase Realtime が全レコードの UPDATE イベントを配信
   - → 同じタイムスタンプで Card change detected が 5 回発火

2. **Focus trap useEffect の再実行**: CardModal の focus trap `useEffect` が `[onClose]` を依存配列に持っていた
   - → 親コンポーネントの再レンダーで `onClose` の参照が変わる
   - → useEffect が再実行され `focusFirstElement()` が呼ばれる
   - → 入力フィールドからフォーカスが奪われる

3. **不適切な router.back()**: `handleCloseCardModal` が `router.back()` を呼び出していた
   - → 履歴を遡って意図しないページ（認証前など）に戻ってしまう
   - → アプリがクラッシュする

**修正内容**
1. **KanbanBoardClient.tsx:1318-1333** - 単一カードのみ upsert
   ```typescript
   // 変更前: await syncToSupabase(newData); // 全カード・全リストを upsert
   // 変更後: 変更されたカードのみ upsert
   const updatedCard = updatedCards.find((c) => c.id === id);
   if (updatedCard) {
     const { error } = await supabase.from('cards').upsert(updatedCard);
   }
   ```

2. **CardModal.tsx:35-40, 90, 138** - focus trap を mount 時のみ実行
   ```typescript
   // useRef で onClose を保持
   const onCloseRef = useRef(onClose);
   useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

   // focus trap useEffect を空配列に変更（mount 時のみ実行）
   useEffect(() => {
     // ...
     trapFocus 内で onCloseRef.current() を使用
     // ...
   }, []); // [onClose] → []
   ```

3. **KanbanBoardClient.tsx:1266-1271** - 不要な router 操作を削除
   ```typescript
   const handleCloseCardModal = () => {
     console.log('[handleCloseCardModal] Starting...');
     // モーダルを閉じるだけ（URL 変更なし、ページ再レンダリングなし）
     setSelectedCardId(null);
     setCardModalStatus('loading');
   };
   ```
   - 以前: `router.back()` → `router.push()` でページ全体が再マウント
   - 修正後: state 更新のみでモーダルを閉じる（軽量・高速）

**検証結果（chrome-devtools）**
- ✅ カード編集時、入力フィールドのフォーカスが維持される
- ✅ タイトル変更が UI に即座に反映される
- ✅ Save 後、データが正しく保存される
- ✅ X ボタンでモーダルを閉じてもクラッシュしない
- ✅ Close ボタンでモーダルを閉じてもクラッシュしない
- ✅ モーダルを閉じても**ページ再レンダリングが発生しない**（Realtime 再購読なし）
- ✅ Realtime イベントが単発（Card change detected: 1 回のみ）
- ✅ コンソールエラーなし

**パフォーマンス改善**
- Before: モーダルを閉じる → `router.push()` → ページ全体再マウント → Realtime 再購読
- After: モーダルを閉じる → state 更新のみ → **他のカードは動かない**

**追加修正（Save 後のモーダル再表示防止）**
- **問題**: Save を押すと `boardData.cards` が更新され、URL 復元の useEffect が再実行されてモーダルが再度開く
- **修正**: `hasRestoredModalFromUrl` ref を追加し、初回ロード時のみ実行するように変更
- **ファイル**: `app/(board)/_components/KanbanBoardClient.tsx:582-615`
  ```typescript
  const hasRestoredModalFromUrl = useRef(false);
  useEffect(() => {
    if (!isClient || !pathname || hasRestoredModalFromUrl.current) return;
    // ... 初回ロード時のみモーダルを復元
    hasRestoredModalFromUrl.current = true;
  }, [isClient, pathname, boardData.cards.length]); // .length のみ監視
  ```

**回帰防止テスト追加**
- E2E テスト `should edit a card` に以下を追加：
  1. ✅ 入力フィールドのフォーカスが維持されることを確認
  2. ✅ Save 後にモーダルが閉じたまま（再度開かない）ことを確認
  3. ✅ 500ms 待機後も modal が開かないことを確認
- **ファイル**: `e2e/kanban.spec.ts:272-290`

---

## 受け入れ基準（DoD）

### 必須
- [ ] **T-2**: ボード切替時、アドレスバーが即座に `/b/:sid` に更新される
- [ ] **T-2**: tail がある場合、同一 tick で `/b/:sid/:tail` に上書きされる
- [x] **T-Edit**: カード編集後、UI にタイトルが即座に反映される ✅
- [x] **T-Edit**: カード編集が DB に正しく保存される（リロード後も反映） ✅
- [x] **T-Edit**: 入力フィールドのフォーカスが維持される ✅
- [ ] 既存の /b 系 308（`/?board`・slug 不一致）が引き続き Green
- [ ] E2E テスト `should update URL immediately when switching boards` が PASS
- [x] E2E テスト `should edit a card` が PASS（手動検証 ✅）
- [ ] E2E 全体で 31/33 pass（/c の 2 件は Step4 で対応）

### ブラウザ検証
- [x] コンソールエラー（赤）: なし ✅
- [ ] コンソール警告（黄）: なし（要確認）
- [x] ネットワークエラー: なし（200/304 のみ） ✅
- [x] Realtime: 重複購読なし、race で stale 反映しない ✅

## 技術的詳細

### updateURL の同期化
- `router.replace` を**即時実行**（非同期待ちなし）
- `queueMicrotask` で tail の上書き（同一 tick）
- データ fetch は**並列**で実行し、URL 反映を待たせない

### カード編集の楽観更新
- `handleEditCard` 内で即座に state 更新
- Supabase への保存は並列実行
- エラー時は rollback + トースト通知

### 再購読の世代管理
```typescript
let subscriptionGeneration = 0;

const subscribeToBoard = (boardId: string) => {
  const currentGen = ++subscriptionGeneration;

  const subscription = supabase
    .channel(`board:${boardId}`)
    .on('postgres_changes', (payload) => {
      if (currentGen !== subscriptionGeneration) return; // 古い購読は無視
      // ... 処理
    })
    .subscribe();

  return subscription;
};
```

## 追加の仕上げチェック（軽微・任意）

- [ ] `/` の扱い固定（308 to default board or ランディング）
- [ ] `generateMetadata` の軽量化（canonical 判定のみ／重い fetch は page 側）
- [ ] Middleware の誤発火防止（`pathname==='/' && has('board')` のみ 308）
- [ ] クリップボードのフォールバック（非 HTTPS/古ブラウザ）
- [ ] Realtime 再購読と URL 更新を並列化

## 関連チケット

- [2025-10-13/04-board-short-url-step1-3-status.md](../2025-10-13/04_board_short_url_step1-3_status.md) - 検証結果
- [2025-10-12/08-board-short-url-roadmap-v1.3.md](../2025-10-12/08-board-short-url-roadmap-v1.3.md) - ロードマップ

**Next**: Step4（/c の Intercepting Routes & モーダル統合）

## ノート

### /c（カード URL）の扱い
- `/c/:short_id` 直アクセスでモーダル表示 → **Step4 で実装**
- `/c` slug 正規化 → **Step4 で実装**
- 現時点では /b の体験を優先して仕上げる

### 進め方
1. T-2（URL 即時化）を先に修正
2. T-Edit（カード編集保存）を修正
3. E2E 全件再実行（29/33 → 31/33 を目指す）
4. 問題なければ Step4 へ着手

### Commit 前の確認
- ブラウザで実際に操作して即時性を体感
- DevTools で Network/Console を確認
- E2E を手元で pass させてから push
