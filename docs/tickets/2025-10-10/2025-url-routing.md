# Ticket 2025: URL Routing for Boards and Cards

**Date**: 2025-10-10
**Priority**: 🔵 Medium
**Status**: 🟡 In Progress
**Phase**: 2.5

## 概要

ボードとカードごとに個別のURLを持たせ、直接リンクで共有できるようにする。

## 背景

現在、すべてのボードが `/` で表示され、URLでボードやカードを指定できない。
これにより以下の問題がある：

1. 特定のボードを直接開けない
2. カードへのリンクを共有できない
3. ブラウザの戻る/進むボタンが機能しない
4. ブックマークが使えない

## 目標

- ボードごとに個別URL: `/board/[boardId]`
- カードごとに個別URL: `/board/[boardId]/card/[cardId]`
- URLからボード/カードを自動的に開く
- ブラウザの戻る/進むボタンに対応
- URLをコピーして共有可能

## 実装方針

### URL構造

```
/ または /board/[defaultBoardId]  → デフォルトボード（Main Board）
/board/[boardId]                  → 指定されたボード
/board/[boardId]?card=[cardId]    → 指定されたボード + カードモーダル
```

### 技術的アプローチ

1. **Next.js App Router Dynamic Routes**を使用
   - 現在の `app/page.tsx` を維持
   - URL query parameters (`?board=xxx&card=xxx`) でボード/カード管理

2. **useSearchParams + useRouter**
   - `searchParams.get('board')` でボードID取得
   - `searchParams.get('card')` でカードID取得
   - `router.push()` でURL更新

3. **ボード切り替え時**
   - `router.push('/?board=' + boardId)` でURL更新
   - URLが変わったら自動的にボードをロード

4. **カードモーダル**
   - カード編集時に `?card=cardId` を追加
   - モーダルを閉じたら `?card` を削除
   - URLからカードを開く

## 実装タスク

- [x] Roadmap更新
- [x] チケット作成
- [ ] useSearchParams導入
- [ ] ボード切り替え時のURL更新
- [ ] URL変更時のボード自動切り替え
- [ ] カードモーダルのURL対応
- [ ] ブラウザ戻る/進むボタン対応
- [ ] テスト（手動確認）
- [ ] コミット

## 関連ファイル

- `app/page.tsx` - メインコンポーネント、URL管理追加
- `docs/tickets/roadmap.md` - Phase 2.5追加

## 参考

- Next.js App Router: https://nextjs.org/docs/app/building-your-application/routing
- useSearchParams: https://nextjs.org/docs/app/api-reference/functions/use-search-params
- useRouter: https://nextjs.org/docs/app/api-reference/functions/use-router

## 完了条件

- [ ] ボードURLで直接ボードを開ける
- [ ] カードURLでカードモーダルが開く
- [ ] URLをコピーして共有できる
- [ ] ブラウザの戻る/進むボタンが機能する
- [ ] 既存のE2Eテストが通る
