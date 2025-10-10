# Ticket 2026: Trello風カードURL（短縮ID + スラッグ）

**Date**: 2025-10-10
**Priority**: 🔵 Medium
**Status**: 🟢 完了
**Phase**: 2.5 (URL Routing拡張)

## 概要

Trello本家と同じURL設計に変更：
- カードごとに**短い一意ID (short_id)** を持たせる
- URLは `/c/:short_id` または `/c/:short_id/:slug`
- スラッグは飾りで、なくても開ける
- スラッグ不一致は301リダイレクト

## 背景

現在のURL設計（`?board=xxx`）では：
- ボード依存なので、カード単体でのリンク共有ができない
- URLが長くて読みにくい
- Trelloのようなシンプルな `/c/AbCdefGh` 形式が欲しい

## Trello本家の設計

### カードの識別子（3種）

1. **id**: 24文字の長いID（MongoDB風hex） - API基本キー
2. **shortLink**: **8文字**の短いID - **全ボードで一意** - **URLの核**
3. **idShort**: ボード内通し番号（#123） - **ボード内でのみ一意**

### URL形式

- **shortUrl**: `https://trello.com/c/<shortLink>`（短縮版）
- **url**: `https://trello.com/c/<shortLink>/<idShort>-<slug>`（見栄え版）

**ポイント**:
- 解決キーは **`shortLink`** のみ
- `<idShort>-<slug>` は読みやすさ/SEO用
- スラッグが変わってもリンクは生きる

## 実装方針

### 1. データモデル拡張

**cards テーブルに追加**:
```sql
ALTER TABLE cards ADD COLUMN short_id VARCHAR(10) UNIQUE;
ALTER TABLE cards ADD COLUMN id_short INTEGER; -- ボード内連番（任意）
ALTER TABLE cards ADD COLUMN slug TEXT;
```

- `short_id`: 8〜10桁 Base62（全体で一意）
- `id_short`: ボード内連番（UI表示用 #123）
- `slug`: タイトルから自動生成

### 2. short_id生成ロジック

```typescript
// Base62エンコード（0-9a-zA-Z）
const BASE62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

function generateShortId(): string {
  // UUIDの一部をBase62に変換 or ランダム生成
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += BASE62[Math.floor(Math.random() * 62)];
  }
  return result;
}

// 衝突チェック付き生成
async function createUniqueShortId(): Promise<string> {
  let shortId = generateShortId();
  while (await cardExists(shortId)) {
    shortId = generateShortId();
  }
  return shortId;
}
```

### 3. slug生成ロジック

```typescript
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // 特殊文字削除
    .replace(/\s+/g, '-')      // スペース→ハイフン
    .replace(/-+/g, '-')       // 連続ハイフン→1つ
    .trim();
}

// 日本語対応版
function slugifyJa(title: string): string {
  return encodeURIComponent(
    title
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim()
  );
}
```

### 4. URL設計

#### Next.js App Router構造

```
app/
├── c/
│   └── [short_id]/
│       └── [[...slug]]/
│           └── page.tsx
```

#### ルーティングロジック

```typescript
// app/c/[short_id]/[[...slug]]/page.tsx
export default async function CardPage({
  params,
}: {
  params: { short_id: string; slug?: string[] };
}) {
  const { short_id, slug } = params;

  // 1. short_idでカード取得
  const card = await getCardByShortId(short_id);
  if (!card) notFound();

  // 2. 正規URLの構築
  const expectedSlug = card.id_short
    ? `${card.id_short}-${card.slug}`
    : card.slug;
  const canonicalPath = `/c/${short_id}/${expectedSlug}`;

  // 3. スラッグ不一致なら301リダイレクト
  const currentPath = slug?.join('/') || '';
  if (currentPath !== expectedSlug) {
    redirect(canonicalPath, 'replace'); // Next.js 15の永続リダイレクト
  }

  // 4. カード表示（モーダルまたは専用ページ）
  return <CardView card={card} />;
}
```

### 5. カード作成時の処理

```typescript
const handleAddCard = async (listId: string) => {
  const shortId = await createUniqueShortId();
  const idShort = await getNextIdShort(boardId); // ボード内連番

  const newCard: Card = {
    id: uuidv4(),
    short_id: shortId,
    id_short: idShort,
    title: 'New Card',
    slug: 'new-card',
    list_id: listId,
    board_id: boardId,
    // ... 他のフィールド
  };

  await supabase.from('cards').insert(newCard);
};
```

### 6. カードタイトル更新時の処理

```typescript
const handleEditCard = async (id: string, title: string, ...) => {
  const newSlug = slugify(title);

  await supabase
    .from('cards')
    .update({
      title,
      slug: newSlug,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  // URLは自動的に301リダイレクトされるので何もしない
};
```

### 7. UI: コピー用リンクボタン

```tsx
<div className="flex gap-2">
  {/* 短縮リンク（壊れない） */}
  <button
    onClick={() => {
      navigator.clipboard.writeText(`${origin}/c/${card.short_id}`);
      toast.success('Short link copied!');
    }}
  >
    📋 Copy Short Link
  </button>

  {/* 読みやすいリンク */}
  <button
    onClick={() => {
      const slug = card.id_short ? `${card.id_short}-${card.slug}` : card.slug;
      navigator.clipboard.writeText(`${origin}/c/${card.short_id}/${slug}`);
      toast.success('Full link copied!');
    }}
  >
    📋 Copy Readable Link
  </button>
</div>
```

## 実装タスク

- [ ] Database migration: `short_id`, `id_short`, `slug` カラム追加
- [ ] Base62 short_id生成関数実装
- [ ] slugify関数実装（日本語対応）
- [ ] id_short（ボード内連番）自動採番実装
- [ ] カード作成時に short_id/id_short/slug 自動生成
- [ ] カード更新時に slug 自動更新
- [ ] Next.js Dynamic Route作成: `app/c/[short_id]/[[...slug]]/page.tsx`
- [ ] 301リダイレクトロジック実装
- [ ] カードモーダルまたは専用ページUI実装
- [ ] 「リンクをコピー」ボタン追加（短縮版 + 読みやすい版）
- [ ] 既存カードに short_id をバックフィル（マイグレーション）
- [ ] E2Eテスト追加（`/c/:short_id` でカードが開く）
- [ ] 既存の `?card=xxx` パラメータとの共存確認
- [ ] コミット

## URL例

```
# 短縮版（最小・壊れない）
https://taesk.vercel.app/c/AbCdefGh

# 読みやすい版（SEO・可読性）
https://taesk.vercel.app/c/AbCdefGh/123-fix-login-error

# スラッグ間違い → 301リダイレクト
https://taesk.vercel.app/c/AbCdefGh/old-title
→ 301 → https://taesk.vercel.app/c/AbCdefGh/123-fix-login-error
```

## メリット

1. **ボード移動しても壊れない** - short_idはカード固有
2. **タイトル変更しても壊れない** - 解決キーはshort_id、スラッグは飾り
3. **短くて扱いやすい** - `/c/AbCdefGh` だけでOK
4. **SEOフレンドリー** - `/c/AbCdefGh/123-fix-login-error` で可読性
5. **Trello本家と同じUX** - 学習コストゼロ

## 参考

- Trello REST API - Cards: https://developer.atlassian.com/cloud/trello/rest/api-group-cards/
- Trello URL Scheme: https://support.atlassian.com/ja/trello/docs/automate-with-url-scheme/

## 完了条件

- [x] `/c/:short_id` でカードが開く
- [x] `/c/:short_id/:slug` でカードが開く
- [x] スラッグ不一致時に301リダイレクト
- [x] リンクコピーボタンが動作
- [x] 既存カードにshort_idがバックフィルされている
- [x] E2Eテストが通る（28/28 passed）
