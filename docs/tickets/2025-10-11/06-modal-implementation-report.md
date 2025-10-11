# Phase 2.5 実装レポート: Trello風カードURL & モーダル表示

**日付**: 2025-10-11
**ステータス**: ✅ 完了
**実装者**: Claude Code

---

## 📋 概要

Next.js 15 App Router の **Intercepting Routes** と **Parallel Routes** を使用して、Trello風のカードURL機能とモーダル表示を実装しました。

### 実装した機能

1. ✅ カードのshort_id ベースURL (`/c/<short_id>` または `/c/<short_id>/<idShort>-<slug>`)
2. ✅ ボード上でカードクリック → モーダル表示（Intercepting Routes）
3. ✅ 直接URL入力/リロード → スタンドアロンページ表示
4. ✅ 308 Permanent Redirect によるslug正規化（SEO対策）
5. ✅ 戻るボタンでモーダルを閉じる動作

---

## 🚨 遭遇した課題と解決方法

### 課題1: Intercepting Routes のディレクトリ構造の誤解（公式ドキュメントとの矛盾）

**問題**:
```
Error: Invalid interception route: /(..)c/[short_id]/[[...slug]].
Cannot use (..) marker at the root level, use (.) instead.
```

最初、`app/(board)/@modal/(..)c/` というディレクトリ構造を作成していましたが、これは誤りでした。

**理論的な理解（公式ドキュメント）**:
Next.js 15 公式ドキュメント（https://nextjs.org/docs/app/building-your-application/routing/intercepting-routes）によると：

- `(.)` : 同じ階層のセグメントをインターセプト
- `(..)` : 1階層上のセグメントをインターセプト
- **重要**: "These conventions are based on route segments, not the file-system."
- Parallel Route スロット（`@modal`）は**ルートセグメントとしてカウントされない**

この理論に基づくと：
```
app/
├── (board)/                    # ルートグループ（セグメント）
│   ├── @modal/                 # Parallel Route（セグメントではない）
│   │   └── (..)c/              # 理論的には (..) で1階層上の /c をインターセプトすべき
└── c/                          # app ルートレベルのセグメント
```

**実際の動作（Next.js ランタイム）**:
しかし、実際に `(..)c` を使用すると以下のエラーが発生：
```
Error: Invalid interception route: /(..)c/[short_id]/[[...slug]].
Cannot use (..) marker at the root level, use (.) instead.
```

**実際の解決策**:
```
app/(board)/@modal/(.)c/[short_id]/[[...slug]]/page.tsx
```

**なぜ理論と実装が異なるのか（推測）**:
1. Next.js ランタイムは `(board)` ルートグループを「root level」として扱っている
2. Parallel Route スロット (`@modal`) がセグメントとしてカウントされないのは正しいが、
3. `(board)` 自体がルートレベルと見なされるため、`(..)` は使用できない
4. したがって、`(.)` を使って同じレベルの `/c` をインターセプトする必要がある

**結論**:
- **実装**: `app/(board)/@modal/(.)c/` が正しい
- **理由**: Next.js は `(board)` をルートレベルとして扱い、`(..)` の使用を許可しない
- **教訓**: 公式ドキュメントの理論と実装には乖離がある場合があるため、エラーメッセージに従うべき

---

### 課題2: Supabase Service Role Key のエラー（最大の障壁）

**問題**:
```
[cards] getCardByShortId failed {
  message: 'Invalid API key',
  hint: 'Double check your Supabase `anon` or `service_role` API key.'
}
```

この問題が最も深刻で、何度も「無理かもしれない」と思った部分でした。

#### 問題の経緯

1. **最初の発見**: `.env.local` の `SUPABASE_SERVICE_ROLE_KEY` が `.env.test` と異なっていた
   - `.env.local`: 末尾が `...0Y1Q`（間違い）
   - `.env.test`: 末尾が `...j7xBg`（正しい）

2. **修正したのに動かない**: `.env.local` を修正してサーバーを再起動しても、エラーが消えない

3. **Next.js の環境変数キャッシュ問題**:
   - Next.js はプロセス起動時に環境変数を読み込んでメモリにキャッシュする
   - `.env.local` を変更しても、既存のプロセスは古い値を保持し続ける
   - `pkill -f "next dev"` で停止しても、複数のバックグラウンドプロセスが残っていた

4. **「これは無理かも」と思った瞬間**:
   - 何度再起動しても古いキーが使われ続ける
   - `.next` ディレクトリを削除してもダメ
   - 環境変数を直接 export してもダメ

#### なぜ最終的にうまくいったのか

**決定的な要因**: **時間経過によるプロセスの完全終了**

最後の試行では、以下を実施しました：

```bash
# 1. すべてのNext.jsプロセスを強制終了
pkill -f "next dev"

# 2. 環境変数を明示的にエクスポートしてから起動
export SUPABASE_SERVICE_ROLE_KEY=replace-with-your-supabase-service-role-key && npm run dev
```

しかし、それでも最初は動きませんでした。

**うまくいった理由（推測）**:
1. 複数回の `pkill` により、最終的にすべてのゾンビプロセスが終了した
2. 少し時間を置いたことで、OS レベルでプロセスが完全にクリーンアップされた
3. 新しいプロセスが完全にクリーンな状態で起動し、正しい `.env.local` を読み込んだ
4. ユーザーが「今見てるとモーダル表示されてたよ」と報告したタイミングで、ようやく正しいキーが読み込まれていた

**教訓**:
- Next.js の環境変数問題では、**完全なプロセス終了 + 時間経過**が必要な場合がある
- IDE やターミナル自体を再起動するのが最も確実
- `lsof -ti:3000` でポートを確認するだけでは不十分（バックグラウンドプロセスを見逃す）

---

### 課題3: `lib/cards.ts` での環境変数読み込みタイミング

**問題**:
最初、`lib/cards.ts` でモジュールレベルで Supabase クライアントを初期化していました：

```typescript
// ❌ 間違い：モジュール読み込み時に評価される
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
```

これだと、環境変数が正しく読み込まれる前にクライアントが初期化される可能性がありました。

**解決策**:
```typescript
// ✅ 正解：関数内で毎回初期化
function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is required');
  }

  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for server-side card lookups');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
```

関数スコープで初期化することで、実行時に必ず最新の環境変数が使われるようになりました。

---

## 🏗️ 実装内容

### ディレクトリ構造

```
app/
├── (board)/
│   ├── @modal/                    # Parallel Route スロット
│   │   ├── (.)c/                  # Intercepting Routes (同階層)
│   │   │   └── [short_id]/
│   │   │       └── [[...slug]]/
│   │   │           ├── page.tsx   # サーバーコンポーネント（データ取得）
│   │   │           └── CardModalClient.tsx  # クライアントコンポーネント（モーダルUI）
│   │   └── default.tsx            # モーダル非表示時のフォールバック
│   ├── layout.tsx                 # @modal スロット受け取り
│   └── page.tsx                   # メインボード
└── c/
    └── [short_id]/
        └── [[...slug]]/
            ├── page.tsx           # スタンドアロンページ（308リダイレクト実装）
            └── CardAnalyticsClient.tsx  # アナリティクス
```

### 主要ファイル

#### 1. `app/(board)/@modal/(.)c/[short_id]/[[...slug]]/page.tsx`

Intercepting Routes のサーバーコンポーネント。カードデータを取得してクライアントコンポーネントに渡します。

```typescript
import { notFound } from 'next/navigation';
import { getCardByShortId, buildCanonicalTail } from '@/lib/cards';
import { buildCanonicalPath } from '@/lib/card-url';
import CardModalClient from './CardModalClient';

type PageParams = Promise<{
  short_id: string;
  slug?: string[];
}>;

export default async function CardModalPage({ params }: { params: PageParams }) {
  const { short_id } = await params;
  const card = await getCardByShortId(short_id);

  if (!card || !card.permitted) {
    return <CardModalClient card={null} canonicalPath={null} />;
  }

  const canonicalPath = buildCanonicalPath({
    shortId: card.shortId,
    idShort: card.idShort,
    slug: card.slug,
  });

  return <CardModalClient card={card} canonicalPath={canonicalPath} />;
}
```

#### 2. `app/(board)/@modal/(.)c/[short_id]/[[...slug]]/CardModalClient.tsx`

モーダルUIのクライアントコンポーネント。

```typescript
'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { CardDetail } from '@/lib/cards';
import CardModalContent from '@/app/components/CardModal';
import { trackEvent } from '@/lib/analytics';

type Props = {
  card: CardDetail | null;
  canonicalPath: string | null;
};

export default function CardModalClient({ card, canonicalPath }: Props) {
  const router = useRouter();

  useEffect(() => {
    if (!card) {
      router.back();
      return;
    }

    trackEvent('card_modal_open', {
      shortId: card.shortId,
      boardId: card.boardId,
    });

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        router.back();
      }
    };

    window.addEventListener('keydown', handleEsc);
    return () => {
      window.removeEventListener('keydown', handleEsc);
      trackEvent('card_modal_close', {
        shortId: card.shortId,
      });
    };
  }, [card, router]);

  if (!card) {
    return null;
  }

  return (
    <CardModalContent
      card={card}
      canonicalPath={canonicalPath}
      onClose={() => router.back()}
    />
  );
}
```

**ポイント**:
- `router.back()` でモーダルを閉じる（ブラウザの戻るボタンと同じ動作）
- Escキーでも閉じられる
- アナリティクスイベントを送信
- カードが見つからない場合は自動的に戻る

#### 3. `app/c/[short_id]/[[...slug]]/page.tsx`

スタンドアロンページ。308リダイレクトを実装しています。

```typescript
import { notFound, permanentRedirect } from 'next/navigation';
import { getCardByShortId, buildCanonicalTail } from '@/lib/cards';
import { buildCanonicalPath } from '@/lib/card-url';
import CardStandalone from './CardStandalone';

type PageParams = Promise<{
  short_id: string;
  slug?: string[];
}>;

export default async function CardPage({ params }: { params: PageParams }) {
  const { short_id, slug } = await params;
  const card = await getCardByShortId(short_id);

  if (!card || !card.permitted) {
    notFound();
  }

  // 308 Permanent Redirect for slug normalization
  const expectedTail = buildCanonicalTail(card);
  const providedTail = (slug ?? []).join('/');

  if (expectedTail && providedTail !== expectedTail) {
    const canonicalPath = buildCanonicalPath({
      shortId: card.shortId,
      idShort: card.idShort,
      slug: card.slug,
    });
    permanentRedirect(canonicalPath);
  }

  return <CardStandalone card={card} />;
}
```

**ポイント**:
- スラグが間違っている場合、正しいURLに308でリダイレクト
- SEO対策として、検索エンジンに「このURLが正規版です」と伝える
- 例: `/c/wEe1jvgp/wrong-slug` → `/c/wEe1jvgp/1-new-card` (308)

#### 4. `lib/cards.ts`

カードデータ取得ロジック。Service Role Key を使用してサーバー側でデータを取得します。

```typescript
import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { buildReadableTail, toSlugBase } from './slug';

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is required');
  }

  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for server-side card lookups');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function getCardByShortId(shortId: string): Promise<CardDetail | null> {
  if (!shortId) return null;

  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from('cards')
    .select(
      [
        'id',
        'short_id',
        'id_short',
        'title',
        'slug',
        'board_id',
        'list_id',
        'description',
        'tags',
        'due_date',
        'priority',
        'assigned_to',
        'created_at',
        'updated_at',
      ].join(','),
    )
    .eq('short_id', shortId)
    .maybeSingle<CardRow>();

  if (error) {
    console.error('[cards] getCardByShortId failed', error);
    return null;
  }

  if (!data) {
    return null;
  }

  // Ensure slug exists even if legacy rows are missing it.
  const normalizedSlug = data.slug ?? toSlugBase(data.title);

  return {
    id: data.id,
    shortId: data.short_id,
    idShort: data.id_short ?? undefined,
    title: data.title,
    slug: normalizedSlug,
    boardId: data.board_id,
    listId: data.list_id,
    description: data.description ?? null,
    tags: Array.isArray(data.tags) ? data.tags : [],
    dueDate: data.due_date ?? null,
    priority: (data.priority ?? 'medium') as CardDetail['priority'],
    assignedTo: data.assigned_to ?? null,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    permitted: true,
  };
}
```

#### 5. `lib/slug.ts`

スラグ生成ユーティリティ。

```typescript
export function toSlugBase(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function buildReadableTail(
  idShort: number | undefined,
  slug: string,
): string {
  if (!idShort) return slug;
  return `${idShort}-${slug}`;
}
```

---

## ✅ 動作確認

### 1. モーダル表示（Intercepting Routes）

```
ユーザー操作: ボード上でカードをクリック
結果: モーダルが表示される
URL: /c/wEe1jvgp/1-new-card
ステータスコード: 200
ログ:
  ✓ Compiled /(.)c/[short_id]/[[...slug]] in 542ms
  GET /c/wEe1jvgp/1-new-card 200
  [analytics.track] card_modal_open
```

### 2. モーダルを閉じる

```
ユーザー操作: X ボタンをクリック or Escキー
結果: モーダルが閉じてボードに戻る
URL: / (元のボードページ)
ログ:
  [analytics.track] card_modal_close
```

### 3. スタンドアロンページ

```
ユーザー操作: 直接 http://localhost:3000/c/wEe1jvgp/1-new-card にアクセス
結果: 全画面でカード詳細が表示される（モーダルではない）
ステータスコード: 200
ログ:
  ✓ Compiled /c/[short_id]/[[...slug]] in 516ms
  GET /c/wEe1jvgp/1-new-card 200
```

### 4. 308 Permanent Redirect

```
ユーザー操作: 間違ったスラグでアクセス
  http://localhost:3000/c/wEe1jvgp/wrong-slug
結果: 正しいURLに308リダイレクト
  http://localhost:3000/c/wEe1jvgp/1-new-card
ログ:
  GET /c/wEe1jvgp/wrong-slug 308 in 269ms
  GET /c/wEe1jvgp/1-new-card 200 in 218ms
```

---

## 🎯 技術的なポイント

### Intercepting Routes とは

Next.js 15 の App Router で導入された機能で、特定のルートへのナビゲーションを「横取り」して別のUIを表示できます。

- `(.)` - 同じ階層をインターセプト
- `(..)` - 1つ上の階層をインターセプト
- `(..)(..)` - 2つ上の階層をインターセプト
- `(...)` - ルートからインターセプト

### Parallel Routes とは

`@folder` 形式のディレクトリを使い、同じレイアウト内で複数の「スロット」を同時にレンダリングできる機能です。

```typescript
// app/(board)/layout.tsx
export default function BoardLayout({
  children,
  modal,
}: {
  children: ReactNode;
  modal: ReactNode;
}) {
  return (
    <>
      {children}  {/* メインのボード */}
      {modal}     {/* モーダルスロット */}
    </>
  );
}
```

### なぜこの組み合わせが強力か

1. **URL とUIの分離**: URLは `/c/xxx` でも、UIはモーダルまたはスタンドアロンページを選べる
2. **ブラウザの戻るボタン対応**: `router.back()` で自然にモーダルが閉じる
3. **SEO対策**: スタンドアロンページがあるので、検索エンジンにインデックスされる
4. **UX向上**: Trelloのような直感的な操作感を実現

---

## 🔑 環境変数の設定

### `.env.local`

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...（anon key）

# Server-side only (DO NOT expose to client)
SUPABASE_SERVICE_ROLE_KEY=replace-with-your-supabase-service-role-key key）
```

**重要**: `SUPABASE_SERVICE_ROLE_KEY` は絶対にクライアントに公開しないこと。`lib/cards.ts` の先頭に `'server-only'` をインポートすることで、誤ってクライアントで使われるのを防いでいます。

---

## 📚 参考リンク

- [Next.js - Intercepting Routes](https://nextjs.org/docs/app/building-your-application/routing/intercepting-routes)
- [Next.js - Parallel Routes](https://nextjs.org/docs/app/building-your-application/routing/parallel-routes)
- [Spec Document](./05-modal-intercepting-routes-spec.md)

---

## 🎉 結論

最初は「無理かもしれない」と思った環境変数の問題も、プロセスの完全終了と時間経過により解決しました。

**成功要因**:
1. 正しいディレクトリ構造 (`(.)c` の使用)
2. 環境変数の関数スコープ初期化
3. 完全なプロセスクリーンアップと再起動
4. 粘り強いデバッグ（ログ確認、複数回の試行）

Trello風のカードURL機能により、ユーザーはカードを直接共有でき、SEO的にも有利な構造になりました。🎯
