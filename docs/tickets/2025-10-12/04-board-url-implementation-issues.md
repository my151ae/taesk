# ボードURL実装の問題点と対応

**作成日**: 2025-10-12
**ステータス**: 実装完了（問題あり・要改善）
**優先度**: 高
**関連チケット**: #03-board-url-structure

## 実装内容

### ✅ 完了した実装

1. **データベース変更**
   - `boards` テーブルに `short_id`, `id_short`, `slug` カラムを追加
   - マイグレーション実行完了

2. **バックエンド実装**
   - `lib/board-utils.ts`: ボード用ユーティリティ関数
     - `createUniqueBoardShortId()`: Base62 8文字ID生成
     - `getNextBoardIdShort()`: 連番生成
     - `getBoardByShortId()`: short_idでボード取得
     - `slugifyBoardName()`: URL用slug生成
   - `lib/board-url.ts`: URL生成関数
     - `buildBoardUrl()`: `/b/short_id/id_short-slug` 形式
     - `buildBoardShortUrl()`: `/b/short_id` 短縮版

3. **データ移行**
   - `scripts/backfill-board-short-ids.ts` 作成
   - 既存4ボード全てに `short_id`, `id_short`, `slug` を生成完了
     - Main Board: `4WvvAVw1`, id_short=1
     - Test Board: `XKx0tqS0`, id_short=1
     - User A Test Board (x2): `apnrmZrx`, `br2fa0Xa`, id_short=1

4. **ルーティング**
   - `app/b/[short_id]/[[...slug]]/page.tsx` 作成
     - slug正規化（不一致時に308リダイレクト）
     - 現状：`/?board=uuid` への互換リダイレクト

5. **新規ボード作成**
   - `handleCreateBoard` で `short_id`, `id_short`, `slug` を自動生成
   - 型定義 `Board` インターフェースに追加

### ⚠️ 発見された問題点

#### 問題1: URL構造が維持されない

**症状:**
- `/b/XKx0tqS0/1-test-board` にアクセス
- → 308リダイレクトで `/?board=uuid` に遷移
- **結果**: ブラウザのURLバーに短いURLが表示されない

**原因:**
```tsx
// app/b/[short_id]/[[...slug]]/page.tsx:39
redirect(`/?board=${board.id}`);
```

現在の実装では、`/b/xx` ページが最終的に `/?board=uuid` にリダイレクトしているため、短いURL構造の意味がない。

**ログ:**
```
GET /b/XKx0tqS0/1-test-board 307 in 334ms
GET /?board=87a1a045-29e6-40ab-b266-2f4f941bdb63 200 in 136ms
```

#### 問題2: ボード切り替え時にConnectingで止まる

**症状:**
- ボードメニューから別のボードを選択
- 画面が "Connecting..." のまま表示されない

**原因（推測）:**
- ボード切り替えロジックが `/?board=uuid` のまま
- Realtime subscriptionのクリーンアップと再接続のタイミング問題
- 無限ループのような状態

**コンソールログ:**
```
page.tsx:762 [Realtime] Cleaning up subscription for board: ...
page.tsx:753 Realtime subscription status: CLOSED
page.tsx:764 [Realtime] Channel removed successfully
page.tsx:632 アプリ起動時 - 同期キューをチェック
```

#### 問題3: ルート `/` が空になる

**症状:**
- `http://localhost:3000/` にアクセスすると空の画面

**原因（推測）:**
- `/b/xx` ルートとの競合
- ルーティング設定の問題

### 🔧 暫定対応（実施済み）

1. **ボード切り替えロジックを元に戻した**
   ```tsx
   // Before (問題あり)
   if (board.short_id) {
     router.push(buildBoardUrl(board));
   } else {
     updateURL(board.id);
   }

   // After (暫定)
   updateURL(board.id);
   ```

2. **新規ボード作成も元に戻した**
   ```tsx
   // Before (問題あり)
   router.push(buildBoardUrl(newBoard));

   // After (暫定)
   updateURL(newBoard.id);
   ```

### ✅ 動作確認（暫定対応後）

- `/b/XKx0tqS0/1-test-board` → slug正規化 → `/?board=uuid` にリダイレクト
- `/b/XKx0tqS0` → `/b/XKx0tqS0/1-test-board` → `/?board=uuid`
- 新規ボード作成で `short_id` 等が自動生成される
- データベースには正しく保存されている

## 根本原因の分析

### アーキテクチャの制約

現在の `app/(board)/page.tsx` は：
- **クライアントコンポーネント** (`"use client"`)
- すべての状態管理（boards, cards, lists）をクライアント側で実行
- URLパラメータ `?board=uuid` を読み取ってボードを切り替え
- Realtime subscriptionをクライアント側で管理

これに対し、`/b/[short_id]/[[...slug]]/page.tsx` は：
- **サーバーコンポーネント**
- DBからボードを取得してslug正規化
- 最終的にクライアントコンポーネントにデータを渡す必要がある

**問題**: この2つのアーキテクチャは統合が困難

### Trello/カードURLとの違い

カードURLは `/c/xxx` で動作していますが、これは：
- カードモーダルは既存のボードページの**上に表示される**
- ベースのボードページは `/?board=uuid` のまま維持
- URLだけ `/c/xxx` に変わる（Intercepting Routes的な挙動）

ボードURLは：
- **ページ全体**を `/b/xxx` に切り替える必要がある
- 既存の `app/(board)/page.tsx` との統合が必要

## 解決策（今後の実装方針）

### Option A: Intercepting Routes（推奨・段階的）

**概要**: Next.js のIntercepting Routesを使い、`/b/xxx` でもベースは `/?board=uuid` のまま

**実装:**
1. `app/(.)b/[short_id]/[[...slug]]/page.tsx` を作成
2. URLは `/b/xxx` に変わるが、レンダリングは既存の `app/(board)/page.tsx`
3. `searchParams` を書き換えて `board=uuid` を注入

**メリット:**
- 既存のクライアントコンポーネント構造を維持
- URL構造だけ変更可能
- 段階的に実装可能

**デメリット:**
- Intercepting Routesの挙動が複雑
- リロード時の処理が必要

### Option B: 完全リファクタリング（理想・大規模）

**概要**: `app/(board)/page.tsx` をサーバーコンポーネント化

**実装:**
1. ボードデータ取得をサーバー側に移行
2. クライアントコンポーネントはUI操作のみ
3. `/b/xxx` で直接ボードをレンダリング
4. `/?board=uuid` は `/b/xxx` にリダイレクト

**メリット:**
- 完全なSSR/ISR対応
- SEO最適化
- 理想的なURL構造

**デメリット:**
- 大規模なリファクタリングが必要
- Realtime subscriptionの再設計
- 既存機能への影響大

### Option C: Middleware リダイレクト（最小限・互換性重視）

**概要**: `/b/xxx` を `/?board=uuid` に完全にリダイレクト（現状維持）

**実装:**
1. `middleware.ts` で `/b/xxx` → `/?board=uuid` に308リダイレクト
2. short_id → uuid の逆引きをキャッシュ
3. UI上は短縮URLをコピー可能にする

**メリット:**
- 最小限の変更
- 既存機能に影響なし
- 短縮URL自体は機能する

**デメリット:**
- URLバーには `/?board=uuid` が表示される
- Trello準拠の体験ではない

## 推奨実装順序

### Phase 1: 短縮URLの共有機能（即時）
- ボードに「URLをコピー」ボタンを追加
- `/b/xxx/yyy` 形式をクリップボードにコピー
- 実際のアクセスは `/?board=uuid` のまま

### Phase 2: Middleware リダイレクト（中期）
- `/b/xxx` → `/?board=uuid` の逆引き実装
- 外部からの短縮URLアクセスに対応

### Phase 3: Intercepting Routes（長期）
- URLバーに `/b/xxx` を表示
- 内部は既存の `/?board=uuid` 構造を維持

### Phase 4: 完全リファクタリング（将来）
- サーバーコンポーネント化
- 真のTrello準拠URL

## 現時点での成果

### ✅ 実装できたこと
- データベーススキーマ拡張
- short_id/id_short/slug生成ロジック
- URL生成ユーティリティ
- データ移行完了
- 動的ルーティングの基礎

### ⚠️ 未完成のこと
- URLバーへの短縮URL表示
- 既存システムとのシームレスな統合
- ボード切り替えの安定性

### 📝 学んだこと
- Next.js App RouterのSSR/CSRの制約
- Intercepting Routesの必要性
- 段階的リファクタリングの重要性

## 次のアクション

1. **チケット05**: 短縮URLコピー機能（UI追加）
2. **チケット06**: Middleware リダイレクト実装
3. **チケット07**: Intercepting Routes実装（Option A）

## 参考資料

- [Next.js Intercepting Routes](https://nextjs.org/docs/app/building-your-application/routing/intercepting-routes)
- [Trello URL Scheme](https://support.atlassian.com/trello/docs/automate-with-url-scheme/)
- チケット03: 詳細な設計仕様

## 備考

この実装は「学習のプロセス」として価値があります。理想的なURL構造を実現するには、アプリケーション全体のアーキテクチャ変更が必要であることが明確になりました。

段階的なアプローチ（Phase 1→2→3）により、リスクを最小限に抑えつつ、最終的にTrello準拠のURL体験を実現できます。
