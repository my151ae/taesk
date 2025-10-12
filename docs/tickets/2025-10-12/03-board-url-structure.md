# ボードURL構造の変更（Trello準拠）

**作成日**: 2025-10-12
**ステータス**: 仕様確定・実装待ち
**優先度**: 中

## 概要

カードURLと同様に、ボードURLも短くて人間が読みやすい形式に変更する（Trello準拠）。

## 現在の仕様

- カード: `/c/short_id/id_short-slug` (例: `/c/hDdQN3jl/1-テスト2`)
- ボード: `/?board=uuid` (例: `/?board=87a1a045-29e6-40ab-b266-2f4f941bdb63`)

## 変更後の仕様（確定）

### URL形式
- ボード: `/b/short_id/id_short-slug` (例: `/b/aBcD1234/1-main-board`)
- 短縮版: `/b/short_id` (共有用・壊れにくい)

### 設計方針（確定事項）
1. **メインボードもルートではなく `/b/xxx/xxx` に統一**
2. **カードモーダルは `/c/xxx` で開く、閉じたら `/b/xxx` に戻る**
3. **カードURL実装と完全に対称的な構造にする**

### slug 正規化
- `/b/short_id` → `/b/short_id/id_short-slug` (308リダイレクト)
- `/b/short_id/wrong-slug` → `/b/short_id/id_short-correct-slug` (308リダイレクト)
- カードと同様の canonical URL 処理

## 実装タスク

### 1. データベース変更 ✅
- [x] `boards` テーブルに以下のカラムを追加
  - `short_id` VARCHAR(12) UNIQUE
  - `id_short` INTEGER
  - `slug` TEXT

### 2. バックエンド実装

#### 2.1 ユーティリティ関数 (`lib/board-utils.ts`)
- [ ] `createUniqueBoardShortId()`: カード版と同等のBase62 8文字生成（`boards`テーブルで重複チェック）
- [ ] `getNextBoardIdShort()`: 全ボードの最大`id_short` + 1を返す
- [ ] `getBoardByShortId(short_id)`: short_idからボードを取得

#### 2.2 URL生成 (`lib/board-url.ts`)
- [ ] `buildBoardUrl(board)`: 正規URL `/b/short_id/id_short-slug` を生成
- [ ] `buildBoardShortUrl(board)`: 短縮URL `/b/short_id` を生成（共有用）

#### 2.3 データ移行
- [ ] `scripts/backfill-board-short-ids.ts`: 既存ボードに `short_id`, `id_short`, `slug` を生成・保存
- [ ] 新規ボード作成時の自動生成処理を追加（`handleCreateBoard` 内）

### 3. ルーティング (Next.js App Router)

#### 3.1 動的ルート
- [ ] `app/b/[short_id]/[[...slug]]/page.tsx` を新規作成
  - `short_id` でボード取得
  - 正規パス生成 → slug不一致/欠落なら308リダイレクト
  - 一致ならボード表示（既存 `KanbanBoard` に `initialBoardId` を渡す）

#### 3.2 互換性対応（middleware.ts - 任意）
- [ ] `/?board=uuid` を `/b/short_id` へ308リダイレクト
  - UUID→short_id の逆引き（Supabase Edge Function or キャッシュ）

### 4. フロントエンド更新

#### 4.1 ボード切り替えロジック
- [ ] `updateURL(boardId)` → `router.push(buildBoardUrl(board))` に置換
- [ ] 全ての `/?board=` 生成箇所を `/b/...` に変更

#### 4.2 カードモーダル連携
**段階的実装（A→B）:**
- [ ] **Phase A (最小差分)**: `/c/xxx` → `/?board=...&card=...` の現行動作を維持
- [ ] **Phase B (推奨・将来)**: Intercepting Routes (`app/(.)c/[short_id]/[[...slug]]/page.tsx`) でモーダル表示
  - バックグラウンドで `/b/...` を保持
  - Trelloライクな体験

#### 4.3 共有UI
- [ ] ボードにも「短縮リンクコピー」「読みやすいリンクコピー」ボタンを追加（カードと同様）

### 5. SEO / メタデータ
- [ ] `/b/...` に `<link rel="canonical">` 設定（`id_short-slug` 含む正規URL）
- [ ] Open Graph の `og:url` を正規URLで出力
- [ ] 短縮版 `/b/short_id` も併記（リンクの堅牢性担保）

### 6. テスト

#### 6.1 E2E (Playwright)
- [ ] `/b/short_id` → `/b/short_id/id_short-slug` へリダイレクト
- [ ] slug 不一致 → 正規化
- [ ] ボード切替でURLが `/b/...` に更新
- [ ] 旧 `/?board=uuid` → `/b/...` へ308（middleware有効時）
- [ ] カードモーダル開閉とURL同期

#### 6.2 ユニット
- [ ] `buildBoardUrl` / `buildBoardShortUrl` の生成ロジック
- [ ] `createUniqueBoardShortId` の重複回避
- [ ] `toSlugBase` の日本語対応

## 実装スケッチ（コード例）

### lib/board-utils.ts
```typescript
import { supabase } from '@/lib/supabase';
import { generateShortId } from '@/lib/card-utils';

async function boardExistsByShortId(s: string) {
  const { data } = await supabase.from('boards').select('id').eq('short_id', s).limit(1);
  return !!data?.length;
}

export async function createUniqueBoardShortId(): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const s = generateShortId();
    if (!(await boardExistsByShortId(s))) return s;
  }
  throw new Error('Failed to generate unique board short_id');
}

export async function getNextBoardIdShort(): Promise<number> {
  const { data } = await supabase
    .from('boards')
    .select('id_short')
    .order('id_short', { ascending: false })
    .limit(1);
  return data?.[0]?.id_short ? data[0].id_short + 1 : 1;
}

export async function getBoardByShortId(short_id: string) {
  const { data } = await supabase
    .from('boards')
    .select('*')
    .eq('short_id', short_id)
    .single();
  return data;
}
```

### lib/board-url.ts
```typescript
import type { Board } from '@/lib/supabase';

export function buildBoardUrl(b: Pick<Board, 'short_id' | 'id_short' | 'slug'>) {
  const slug = b.id_short ? `${b.id_short}-${b.slug}` : b.slug;
  return slug ? `/b/${b.short_id}/${slug}` : `/b/${b.short_id}`;
}

export function buildBoardShortUrl(b: Pick<Board, 'short_id'>) {
  return `/b/${b.short_id}`;
}
```

### app/b/[short_id]/[[...slug]]/page.tsx
```tsx
import { notFound, redirect } from 'next/navigation';
import { getBoardByShortId } from '@/lib/board-utils';
import { buildBoardUrl } from '@/lib/board-url';

export default async function BoardPage({
  params
}: {
  params: Promise<{ short_id: string; slug?: string[] }>
}) {
  const { short_id, slug } = await params;
  const board = await getBoardByShortId(short_id);

  if (!board) notFound();

  const expected = board.id_short && board.slug
    ? `${board.id_short}-${board.slug}`
    : board.slug || '';
  const canonical = expected ? `/b/${short_id}/${expected}` : `/b/${short_id}`;
  const current = slug?.join('/') || '';

  if (current !== expected) redirect(canonical);

  return <KanbanBoard initialBoardId={board.id} />;
}
```

## 参考実装

既存のカードURL実装を完全に踏襲:
- `lib/card-url.ts` → `lib/board-url.ts`
- `lib/card-utils.ts` → `lib/board-utils.ts`
- `lib/slug.ts` (共通で使用)
- `app/c/[short_id]/[[...slug]]/page.tsx` → `app/b/[short_id]/[[...slug]]/page.tsx`

## 外部参考
- [Trello URL Scheme - Atlassian Support](https://support.atlassian.com/trello/docs/automate-with-url-scheme/)
  - Trelloも `/b/<shortlink>/...` 形式の短縮リンクを公式サポート

## 補足・設計判断

### id_short の採番範囲
- **初期**: 全ボード共通の通し番号（シンプル）
- **将来**: Workspace単位に変更可能（`boards.workspace_id` を条件追加）

### ルート `/` の扱い
- 現状の「メインボード表示」は一旦維持
- UIからのボード切替は `/b/...` を使用
- 将来的にはルートをボード一覧にすることも検討

### カードモーダル実装順序
1. **Phase A**: 動作互換（`/c/xxx` → クエリパラメータでモーダル）
2. **Phase B**: Intercepting Routes で洗練（Trelloライク）

## 次アクション（実装順序）

1. ✅ データベースマイグレーション
2. `lib/board-utils.ts` / `lib/board-url.ts` 作成
3. `scripts/backfill-board-short-ids.ts` で既存データ移行
4. `app/b/[short_id]/[[...slug]]/page.tsx` 追加
5. `updateURL(boardId)` 置換 → `router.push(buildBoardUrl(board))`
6. 互換用 `middleware.ts`（任意）
7. E2E/ユニットテスト追加

## 備考

- カードURLと完全に統一された設計
- SEO・共有のしやすさを重視（Trello準拠）
- 段階的実装でリスク最小化
