# Routing & Card URLs

このドキュメントでは、Taesk の Next.js 15 Intercepting Routes を使用したカードURL機能とモーダル表示について説明します。Timeline ボードも同じ仕組みを用い、Kanban 遺産を経由せずにカードモーダルを開きます。

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
├── (board)/
│   ├── layout.tsx                    # @modal parallel route を提供
│   ├── page.tsx                      # ルート / を canonical board へ permanent redirect
│   ├── _components/timeline/TimelineBoardPage.tsx  # Timeline UI + モーダル制御
│   └── @modal/(...)c/[short_id]/[[...slug]]/page.tsx  # body スクロール制御のみを行う hook
├── board/page.tsx                    # MAIN_BOARD_ID を取得して TimelineBoardPage を描画
├── b/[short_id]/[[...slug]]/page.tsx # ボード canonical ルート (SSR)
└── c/[short_id]/[[...slug]]/page.tsx # カードスタンドアロンページ
```

### Intercepting Routes のポイント

- `(...)c` パターンを使用して `/c` ルートをインターセプト
- サーバー側では UI を描画せず、モーダル開閉時に `document.body` に `overflow-hidden` を付与/解除するだけ
- 実際のモーダル UI は `TimelineBoardPage` → `CardModal` がクライアント側で制御

### 動作の流れ

#### 1. ボードからカードクリック（Intercepting Route）

```
ユーザー: カードをクリック
   ↓
Next.js: `router.push` で `/c/<short_id>/<idShort>-<slug>` へ遷移
   ↓
Intercepting Route にマッチし、サーバー側では body overflow をロックするのみ
   ↓
`TimelineBoardPage` が `cardModalShortIdRef` を更新 → `CardModal` をクライアントで描画
   ↓
結果: ボードは背景に残り、カードがモーダルで開く
```

#### 2. 直接URL入力/リロード（スタンドアロンページ）

```
ユーザー: URL直接入力 or ページリロード
   ↓
Next.js: `/c/<short_id>/<idShort>-<slug>` を直接レンダリング
   ↓
`normalizeCardSlugOrRedirect` が正規 URL を計算し、誤った slug は 308 Redirect
   ↓
結果: フルページ表示（共有用 / SEO 対応）
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
const { card } = await normalizeCardSlugOrRedirect(short_id, slug);
if (!card) notFound();

const boardUrl = card.board ? buildBoardUrl(card.board) : '';
return (
  <CardFullPage>
    <Link href={boardUrl}>ボードを開く</Link>
  </CardFullPage>
);
```

### 308 vs 301

- **308 Permanent Redirect**: POST リクエストのメソッドを保持
- **301 Moved Permanently**: POST → GET に変換される可能性

Taesk では将来的な API 互換性のため 308 を使用しています。

## URL 正規化と `updateURL`

- Timeline ヘッダーのボード切替は `buildBoardUrl` + `router.push` が **一度の遷移** で canonical URL に移動（以前の `/b/:sid` → `/b/:sid/:tail` 二段階遷移は撤廃）
- モーダル表示時は `modalReturnPathRef` と `lastBoardPathRef` を保持し、`router.back()` で `/` に落ちた場合でも確実に元のボードへ `replace`
- Playwright の `should update URL immediately when switching boards` も canonical URL への到達のみを確認するよう更新済み

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

### 検証手順（Playwright / DevTools MCP）

```bash
# 1) Playwright で検証（JSON レポート必須 / 単一ワーカー）
# - Playwright が webServer.command 経由で `NODE_ENV=test npm run dev` を起動する
# - 手動で `npm run dev` は実行しない
PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/routing.json \
  PW_WORKERS=1 \
  npx playwright test --project=core --reporter=json

# 2) JSON を確認
sed -n '/^{/,$p' test-results/routing.json | jq '.stats'

# 3) 追加で UI のレンダリングを見たい場合は chrome-devtools MCP で
# - スナップショット取得
# - console / network を確認
# を行う（手動サーバー起動はしない）

# 4) 308 リダイレクトや ?card の挙動は E2E spec にテストケースを追加/更新して担保する
```

## ⚠️ 既知の問題と注意事項

### Next.js App Router のクラッシュ回避（2025-10-16）

**⚠️ 重要**: モーダル表示時のURL形式を一時的に変更しています

#### なぜ `/c/...` ではなく `?card=...` を使用しているか

**理想**: `/c/<short_id>/<idShort>-<slug>` 形式（Trello風、美しい、SEO対応）

**現実**: Next.js 15.5.x のバグにより、この形式でクラッシュが発生

**問題**: Next.js 15.5.x で `fillCacheWithNewSubTreeData` の "e is not iterable" エラー
- **原因**: インターセプトされたルートの Flight Data に `notFound()` や `redirect()` が混在すると、`segmentPath` に `null` が紛れ込みクラッシュ
- **再現条件**: 未同期または不正な `short_id` で `/c/...` への URL 遷移が発火

**現在の対策** (2025-10-16〜):
1. **クエリパラメータベースのナビゲーション**: `/b/...?card=<short_id>` 形式に一時変更
2. **未同期カードのガード**: `short_id` が無いカードは URL 更新を抑止
3. **E2E テストで監視**: 無効な URL でのクラッシュ防止を継続的に検証

**将来の対応**:
- ✅ Next.js の次期バージョンでバグが修正されたら `/c/...` 形式に戻す予定
- 📋 バージョンアップ前に必ず E2E テスト実行（`should handle invalid card URL gracefully`）
- 📋 [移行手順](../tickets/2025-10-16/04_nextjs_flight_data_bug_details.md#migration-path-back-to-c-urls) を参照

#### 現在の動作

**モーダル表示時**:
```
URL: /b/4WvvAVw1/1-main-board?card=GKT5kB4e
     ^^^^^^^^^^^^^^^^^^^^^^^^  ^^^^^^^^^^^^^^
     ボードのcanonical URL    カードのshort_id
```

**直接アクセス時**（共有・SEO用）:
```
URL: /c/GKT5kB4e/1-new-card
     ^^^^^^^^^^^^^^^^^^^^^^^^^^^
     ✅ この形式は引き続き利用可能（スタンドアロンページ）
```

#### 技術的詳細

**当時の状況（参考）**:
- Next.js 15.5.x 系でクラッシュが確認され、暫定回避として `?card=` 形式を採用
- 現在も互換性のため `?card=` 形式を維持しつつ、`/c/<short_id>/...` は共有/直アクセス用として利用

**詳細情報**:
- [実装の詳細](../tickets/2025-10-16/03_url_navigation_crash_fix.md)
- [バグの技術解説](../tickets/2025-10-16/04_nextjs_flight_data_bug_details.md)

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
3. Playwright 実行前にポート 3000 を解放し、孤立プロセスを停止してから再実行:
   - `lsof -i :3000`
   - `pkill -f 'node .*next dev'`
   - `pkill -f 'playwright test'`

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
3. Playwright を再実行（webServer.command が自動起動する）

---

**最終更新**: 2025-10-16
