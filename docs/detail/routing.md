# Routing & Card URLs

このドキュメントでは、Taesk の Next.js 15 Intercepting Routes を使用したカードURL機能とモーダル表示について説明します。

## 📋 概要

Trello風のカードURL機能を実装し、以下を実現しています：

- **カードごとの個別URL**: `/c/<short_id>` または `/c/<short_id>/<idShort>-<slug>`
- **モーダル表示**: ボードからカードクリック → モーダルで開く
- **スタンドアロンページ**: 直接URL入力やリロード → フルページで表示
- **SEO最適化**: 308リダイレクトでcanonical URLに正規化

## 🔗 URL構造

### URL形式

カードには2種類のURL形式があります：

```
/c/<short_id>                      # 短縮形 (必須)
/c/<short_id>/<idShort>-<slug>     # 可読形 (推奨)
```

#### 例

- `/c/wEe1jvgp` - 短縮ID（8文字、base62エンコード）
- `/c/wEe1jvgp/1-new-card` - idShort + slug付き（SEO対応）
- `/c/wEe1jvgp/1-機能追加` - 日本語slug対応

### Short ID生成

`short_id` は以下のルールで生成されます：

```typescript
// lib/card-utils.ts
function createUniqueShortId(): string {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 10000);
  const combined = timestamp * 10000 + random;
  return base62Encode(combined); // 8文字の英数字
}
```

- **長さ**: 8文字固定
- **文字種**: `0-9A-Za-z` (base62)
- **一意性**: タイムスタンプ + ランダム値

### Slug生成

`slug` は以下のルールで生成されます：

```typescript
// lib/slug.ts
export function toSlugBase(title: string): string {
  const base = title
    .normalize('NFKD')          // Unicode正規化
    .toLowerCase()               // 小文字化
    .replace(/[\u0300-\u036f]/g, '') // アクセント記号削除
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf\- ]+/g, ' ') // 日本語許可
    .trim()
    .replace(/\s+/g, '-')       // スペース → ハイフン
    .replace(/\-+/g, '-');      // 連続ハイフン削除

  return base || encodeURIComponent(title); // フォールバック
}
```

- **多言語対応**: 日本語、中国語、ひらがな、カタカナをサポート
- **フォールバック**: ASCII以外のみの場合は `encodeURIComponent` を使用

## 🚪 Intercepting Routes

### ディレクトリ構造

```
app/
├── (board)/                      # Route Group
│   ├── @modal/                   # Parallel Route
│   │   ├── (.)c/                 # Intercepting Route
│   │   │   └── [short_id]/
│   │   │       └── [[...slug]]/
│   │   │           ├── page.tsx         # モーダル用サーバーコンポーネント
│   │   │           └── CardModalClient.tsx # モーダルUI (Client Component)
│   │   └── default.tsx          # モーダルなし時のフォールバック
│   ├── layout.tsx               # @modal スロットを受け取るレイアウト
│   └── page.tsx                 # ボード本体
└── c/                           # カードの実際のルート
    └── [short_id]/
        └── [[...slug]]/
            ├── page.tsx             # スタンドアロンページ
            └── CardAnalyticsClient.tsx # アナリティクス
```

### Intercepting Routes の規約

Next.js 15.5.4 では、以下の規約が実装上正しいことが確認されています：

| パターン | 動作 | 説明 |
|---------|-----|------|
| `(.)c` | ✅ 動作 | Route Group 内から同階層の `/c` をインターセプト |
| `(..)c` | ❌ エラー | "Cannot use (..) marker at the root level" |
| `(...)c` | ❌ 機能しない | 常にスタンドアロンページに遷移 |

**重要**: 公式ドキュメントでは `(..)c` が理論的に正しいとされていますが、実装上は `(.)c` が正しく動作します。

### 動作の流れ

#### 1. ボードからカードクリック（Intercepting Route）

```
ユーザー: カードをクリック
   ↓
Next.js: Link コンポーネントで /c/<short_id>/<idShort>-<slug> にナビゲート
   ↓
Next.js: Intercepting Route (.)c にマッチ
   ↓
レンダリング: app/(board)/@modal/(.)c/[short_id]/[[...slug]]/page.tsx
   ↓
結果: モーダル表示（ボードは背景に残る）
```

#### 2. 直接URL入力/リロード（スタンドアロンページ）

```
ユーザー: URL直接入力 or ページリロード
   ↓
Next.js: /c/<short_id>/<idShort>-<slug> にアクセス
   ↓
Next.js: Intercepting Route にマッチしない
   ↓
レンダリング: app/c/[short_id]/[[...slug]]/page.tsx
   ↓
結果: フルページ表示
```

## 🔄 308 Permanent Redirect

### 目的

SEO最適化のため、すべてのカードURLを正規化します：

- `/c/wEe1jvgp` → `/c/wEe1jvgp/1-new-card` (idShort + slug 追加)
- `/c/wEe1jvgp/wrong-slug` → `/c/wEe1jvgp/1-new-card` (slug 修正)

### 実装

```typescript
// app/c/[short_id]/[[...slug]]/page.tsx
export default async function CardPage({ params }: PageParams) {
  const { short_id, slug } = await params;
  const card = await getCardByShortId(short_id);

  if (!card || !card.permitted) {
    notFound();
  }

  const expectedTail = buildCanonicalTail(card);
  const providedTail = (slug ?? []).join('/');

  // slug が期待と異なる場合、308 リダイレクト
  if (expectedTail && providedTail !== expectedTail) {
    const canonicalPath = buildCanonicalPath({
      shortId: card.shortId,
      idShort: card.idShort,
      slug: card.slug,
    });
    permanentRedirect(canonicalPath);
  }

  // 以下、ページレンダリング
}
```

### 308 vs 301

- **308 Permanent Redirect**: POST リクエストのメソッドを保持
- **301 Moved Permanently**: POST → GET に変換される可能性

Taesk では将来的な API 互換性のため 308 を使用しています。

## 📊 メタデータ生成

### generateMetadata

```typescript
export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { short_id } = await params;
  const card = await getCardByShortId(short_id);

  if (!card || !card.permitted) {
    return {};
  }

  const canonicalPath = buildCanonicalPath({
    shortId: card.shortId,
    idShort: card.idShort,
    slug: card.slug,
  });

  return {
    title: `${card.title} | Taesk`,
    alternates: {
      canonical: canonicalPath,
    },
    openGraph: {
      title: card.title,
      description: card.description ?? undefined,
      url: canonicalPath,
    },
  };
}
```

### metadataBase

`app/layout.tsx` でベースURLを設定：

```typescript
const appOrigin = process.env.NEXT_PUBLIC_APP_ORIGIN ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(appOrigin),
  // ...
};
```

## 🔐 権限チェック

### Service Role Key

カード情報の取得には Supabase Service Role Key を使用：

```typescript
// lib/cards.ts
function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Environment variables not set');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
```

### RLS ポリシー

将来的には RLS ポリシーで権限チェックを実装予定：

- 公開カード: 全ユーザーアクセス可能
- 非公開カード: 所有者 + メンバーのみ

現在は `permitted: true` を固定で返しています。

## 📱 アナリティクス

### カード表示トラッキング

```typescript
// app/c/[short_id]/[[...slug]]/CardAnalyticsClient.tsx
'use client';

export default function CardAnalyticsClient({ ... }) {
  useEffect(() => {
    // ページロード時のトラッキング
    trackEvent('card_view', {
      shortId: cardShortId,
      boardId,
      viewType: 'standalone',
    });

    // canonical URL と異なる場合の警告
    if (currentPath !== canonicalPath) {
      console.warn('[CardAnalytics] Non-canonical URL accessed:', {
        current: currentPath,
        canonical: canonicalPath,
      });
    }
  }, [cardShortId, boardId, currentPath, canonicalPath]);

  return null;
}
```

## 🧪 テスト

### 確認項目

1. ✅ **ボードからカードクリック** → モーダル表示
2. ✅ **Close ボタン** → ブラウザの戻る機能でモーダルを閉じてボードに戻る
3. ✅ **直接 URL アクセス** → スタンドアロンページ表示
4. ✅ **308 Permanent Redirect** → slug 正規化が動作
5. ✅ **Esc キー** → モーダルを閉じる
6. ✅ **多言語 slug** → 日本語などが正しく処理される

### 手動テスト手順

```bash
# 1. Dev サーバー起動
npm run dev

# 2. ボードにアクセス
open http://localhost:3000

# 3. カードをクリック → モーダルが開くことを確認

# 4. 直接URLアクセス
open http://localhost:3000/c/<short_id>

# 5. 間違ったslugでアクセス → 308リダイレクトを確認
open http://localhost:3000/c/<short_id>/wrong-slug
```

## ⚠️ 既知の問題と注意事項

### Intercepting Routes の規約

**問題**: 公式ドキュメントと実装の動作が異なる

- **公式**: Parallel Route スロット (`@modal`) はセグメントとしてカウントされない → `(..)c` が正しいはず
- **実装**: Next.js 15.5.4 では `(.)c` が正しく動作

**結論**: 実装上の動作を優先し、エラーメッセージに従うべき

### Runtime設定

```typescript
export const runtime = 'nodejs';
```

Edge Runtime ではなく Node.js Runtime を明示的に指定しています。これにより：

- Supabase Service Role Key が正しく読み込まれる
- `generateMetadata` が安定動作する

## 📚 参考資料

### Next.js 公式ドキュメント

- [Intercepting Routes](https://nextjs.org/docs/app/building-your-application/routing/intercepting-routes)
- [Parallel Routes](https://nextjs.org/docs/app/building-your-application/routing/parallel-routes)
- [Metadata](https://nextjs.org/docs/app/building-your-application/optimizing/metadata)
- [permanentRedirect](https://nextjs.org/docs/app/api-reference/functions/permanentRedirect)

### 関連チケット

- [Phase 2.3: Card URL Implementation](../tickets/2025-10-09/05-trello-style-card-urls-spec.md)
- [Phase 2.5: Modal Implementation Report](../tickets/2025-10-11/06-modal-implementation-report.md)

## 🔧 トラブルシューティング

### モーダルが表示されない

**症状**: カードをクリックしてもモーダルが開かず、スタンドアロンページに遷移する

**原因**: Intercepting Routes のディレクトリ構造が間違っている

**解決策**:
1. `app/(board)/@modal/(.)c/` が存在することを確認
2. `app/(board)/layout.tsx` が `modal` スロットを受け取っていることを確認
3. サーバーを再起動 (`pkill -f "next dev" && npm run dev`)

### 308 リダイレクトが動作しない

**症状**: 間違った slug でアクセスしても正規化されない

**原因**: `permanentRedirect` の条件が正しくない

**解決策**:
1. `buildCanonicalTail` が正しい値を返すか確認
2. `slug` の join が正しいか確認 (`(slug ?? []).join('/')`)
3. デバッグログを追加して確認

### Service Role Key エラー

**症状**: "Invalid API key" エラーが発生

**原因**: `.env.local` の `SUPABASE_SERVICE_ROLE_KEY` が間違っている

**解決策**:
1. Supabase ダッシュボードから正しいキーをコピー
2. `.env.local` を更新
3. サーバーを完全に再起動（`pkill -f "next dev"`）
4. 数秒待ってから `npm run dev`

---

**最終更新**: 2025-10-11
