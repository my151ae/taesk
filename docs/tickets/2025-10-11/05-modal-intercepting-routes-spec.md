# 05: Trello風カードURL・モーダル表示（Intercepting Routes 方式）実装仕様書

作成日: 2025-10-11 (JST)  
対象: Next.js App Router（v14+ / v15 互換想定）  
依頼先: Codex CLI（本仕様の「Codex CLI 実行タスク」節に従って適用）

---

## 0. 目的 / 背景
- Trello同様、**カードは短い一意ID（short_id）を主キー**としてURL解決する。
- **URLは2系統**:  
  - 壊れない最小リンク: `/c/<short_id>`  
  - 可読な正規リンク: `/c/<short_id>/<idShort>-<slug>`
- **モーダル表示は App Router の Intercepting Routes + Parallel Routes**で実現。  
  - **クリック=モーダル表示**（ボード上で）  
  - **直リンク/リロード=単独ページ**（/c の実体ルート）  
  - **戻る=モーダルを閉じる**（履歴整合）
- スラッグは**飾り（人間向け）**であり、**解決は short_id のみ**。スラッグ不一致/欠落は **308 Permanent Redirect** で正規化。

非目標（本仕様の外）:
- 認証・発行権限などの**認可実装の詳細**（ただし 404 で伏せる方針は明示）。
- DnDの内部アルゴリズム（衝突回避のインタラクト最小要件のみ仕様化）。

---

## 1. 成果物（Doneの定義）
この仕様を完了したと判定する条件（Acceptance Criteria）:

1. **URL挙動**
   - `/c/:sid` にアクセスすると、**必ず** `/c/:sid/:idShort-:slug` に **308** で正規化される。  
   - `/c/:sid/:slug` に**直打ち/リロード**しても、カードが**単独ページ**で表示される。  
   - スラッグ不一致（古いタイトルなど）の場合は **308** で最新スラッグへ正規化。  
   - 存在しない/閲覧権限がないカードは **404** を返す（403 は使わない）。

2. **モーダル挙動**
   - ボード上のカードクリックで**モーダル**が開く。  
   - **新規タブ(⌘/Ctrl+Click / 中クリック)** ではモーダルではなく**単独ページ**で開く。  
   - **戻る操作**でモーダルが閉じ、**さらに戻る**とボードの履歴に戻る。

3. **アクセシビリティ**
   - モーダルは `role="dialog"`, `aria-modal="true"`、**フォーカストラップ**、**初期フォーカス**、**Escで閉じる**を満たす。  
   - カード項目は**HTMLの `<a>`（Next `<Link>`）**として提供され、キーボード操作・読み上げが機能する。

4. **SEO**
   - `/c/:sid/:slug` ページは `<link rel="canonical">` を出し、canonical は**絶対URL**。  
   - `metadataBase` が設定されている。

5. **計測**
   - ルーティングイベント（モーダル開閉/単独ページ表示）が**ページビューまたはカスタムイベント**として計測できる。

6. **i18n スラッグ**
   - 日本語等で**空スラッグにならないフォールバック**を実装（`encodeURIComponent` 等）。  
   - スラッグは**サーバー側で一元生成**し、保存・参照先は同一。

7. **DnDとの競合回避**
   - クリックとD&Dが**距離しきい値**で判別され、**意図しないモーダル起動が発生しない**。

---

## 2. URL設計
- 最小リンク: `GET /c/:short_id`
- 正規リンク: `GET /c/:short_id/:idShort-:slug`
- 役割分担:
  - 解決キー: `short_id`（グローバル一意）
  - 表示用補助: `idShort`（ボード内番号）と `slug`（タイトル由来）
- 正規化（リダイレクト）:
  - `/c/:sid` へのアクセス → 必ず `/c/:sid/:idShort-:slug` に **308 Permanent Redirect**
  - `/c/:sid/:wrong-slug` → `/c/:sid/:idShort-:slug` に **308**

---

## 3. ルーティング構成（App Router）

```
app/
  layout.tsx                      # metadataBase 設定
  c/
    [short_id]/
      [[...slug]]/
        page.tsx                  # 実体ページ（直リンク/リロード時）
  (board)/
    page.tsx                      # カンバン一覧ページ（通常表示）
    @modal/
      (..)c/
        [short_id]/
          [[...slug]]/
            page.tsx              # インターセプトしてモーダルで表示
```

- `app/c/[short_id]/[[...slug]]/page.tsx` は**実体ページ**（Server Component）：
  - カード取得 → 権限チェック → スラッグ正規化（必要なら `permanentRedirect` 308）→ 単独ページ表示。
- `app/(board)/@modal/(..)c/[short_id]/[[...slug]]/page.tsx` は**インターセプト用**（Server → Client複合）：
  - 同一データ取得を共有（React Cache/SWR 等）し、**モーダルUI**でラップ。  
  - `router.back()` で閉じる（ボタン/Esc）。

> 注意: **rewrites による `/c/* → /` の集約は禁止**。/c は**実体ルート**として保持する。

---

## 4. データ取得 / キャッシュ
- インターフェイス（擬似型）:
  ```ts
  type Card = {
    id: string;          // 内部PK（DB）
    shortId: string;     // URLキー（グローバル一意、Base62想定）
    idShort?: number;    // ボード内連番（任意）
    title: string;
    slug: string;        // サーバー生成・保存
    boardId: string;
    permitted: boolean;  // 呼び出し側の認可結果
  };
  ```
- 取得関数（Server Only）:
  ```ts
  export async function getCardByShortId(shortId: string): Promise<Card | null> {
    // DB検索（shortId にインデックス）
    // 認可チェックを行い、無権限なら null 相当（404方針）
  }
  ```
- キャッシュ:
  - `react/cache` または fetch の `next: { tags: [...] }` を使用。  
  - タイトル変更時: `revalidateTag('card:' + shortId)` を発火できる経路を用意。

---

## 5. スラッグ生成（サーバー一元化）
- 原則: 追加/更新時に**サーバーで slugify**して保存。  
- 仕様:
  1. アルファ数/ハイフンのみの正規化（連続ハイフン圧縮）。
  2. i18n: 正規化結果が空なら `encodeURIComponent(title)` を採用。
  3. `idShort` を持つ場合、**可読URL生成時に先頭へ付与**（`<idShort>-<slug>`）。
- クライアントで**動的に slug を組み立てない**。常にDB保存の `slug` を参照。

---

## 6. 308 正規化ロジック（実体ページ）

```tsx
// app/c/[short_id]/[[...slug]]/page.tsx
import { permanentRedirect, notFound } from 'next/navigation';
import { getCardByShortId } from '@/lib/cards';

export default async function CardPage({ params }: { params: { short_id: string; slug?: string[] }}) {
  const card = await getCardByShortId(params.short_id);
  if (!card || !card.permitted) notFound();

  const expectedTail = card.idShort ? `${card.idShort}-${card.slug}` : card.slug;
  const gotTail = (params.slug ?? []).join('/'); // [[...slug]] を連結

  // slug 省略 or 不一致 → 308 で正規URLへ
  if (expectedTail && gotTail !== expectedTail) {
    permanentRedirect(`/c/${card.shortId}/${expectedTail}`);
  }

  return <CardStandalone card={card} />; // 単独ページ用
}
```

---

## 7. インターセプト（モーダル）実装

```tsx
// app/(board)/@modal/(..)c/[short_id]/[[...slug]]/page.tsx
import { notFound } from 'next/navigation';
import { getCardByShortId } from '@/lib/cards';
import CardModalClient from './CardModalClient';

export default async function CardModalPage({ params }: { params: { short_id: string; slug?: string[] }}) {
  const card = await getCardByShortId(params.short_id);
  if (!card || !card.permitted) {
    // 404 に飛ばす代わりに、モーダルだけ静かに閉じるため null を渡す
    return <CardModalClient card={null} />;
  }
  return <CardModalClient card={card} />;
}
```

```tsx
// app/(board)/@modal/(..)c/[short_id]/[[...slug]]/CardModalClient.tsx
'use client';
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

type Props = { card: any | null };

export default function CardModalClient({ card }: Props) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);

  // 存在しない/権限なし → モーダルだけ閉じる
  useEffect(() => { if (!card) router.back(); }, [card, router]);

  // Esc で閉じる
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') router.back(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);

  // 簡易フォーカストラップ（必要なら react-focus-lock 等に置換）
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const toFocus = el.querySelector<HTMLElement>('[data-autofocus]') ?? el;
    toFocus.focus();
  }, []);

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={() => router.back()} />
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="relative mx-auto my-8 max-w-3xl rounded-2xl bg-white p-6 shadow-lg outline-none"
      >
        <button onClick={() => router.back()} aria-label="閉じる" data-autofocus>×</button>
        {card ? <CardView card={card} /> : null}
      </div>
    </div>
  );
}
```

---

## 8. ボード→カードへのリンク（Link 仕様）

```tsx
import Link from 'next/link';

function CardTile({ card }: { card: { shortId: string; idShort?: number; slug: string; title: string }}) {
  const tail = card.idShort ? `${card.idShort}-${card.slug}` : card.slug;
  const href = `/c/${card.shortId}/${tail}`;

  return (
    <Link
      href={href}
      prefetch={false}     // 大量カードでの帯域暴走防止
      scroll={false}       // モーダル時のスクロールジャンプ防止
      aria-label={`カードを開く: ${card.title}`}
      onClick={(e) => {
        // 新規タブ/中クリックはそのまま（インターセプトしない）
        if (e.metaKey || e.ctrlKey || e.button === 1) return;
        // 同一タブ時はモーダルがインターセプトして表示される（特別な処理は不要）
      }}
    >
      <div className="rounded-xl border p-3 hover:shadow">…</div>
    </Link>
  );
}
```

---

## 9. DnD とクリックの競合回避（最小要件）

```tsx
let start: {x:number; y:number} | null = null;
const THRESHOLD = 5; // px

function onPointerDown(e: React.PointerEvent) {
  start = { x: e.clientX, y: e.clientY };
}

function onPointerUp(e: React.PointerEvent) {
  if (!start) return;
  const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y) > THRESHOLD;
  if (moved) {
    // DnD と見なす → クリック扱いしない
    return;
  }
  // ここで Link にフォールスルー（Link の onClick が実行される）
}
```

- これをカードタイルのラッパに付与し、**ドラッグ開始と微小移動のクリック**を判別。

---

## 10. SEO / メタデータ

```tsx
// app/layout.tsx
export const metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_ORIGIN ?? 'https://example.com'),
};
```

```tsx
// app/c/[short_id]/[[...slug]]/page.tsx （抜粋）
export async function generateMetadata({ params }: { params: { short_id: string; slug?: string[] }}) {
  const card = await getCardByShortId(params.short_id);
  if (!card || !card.permitted) return {};
  const tail = card.idShort ? `${card.idShort}-${card.slug}` : card.slug;
  const pathname = `/c/${card.shortId}/${tail}`;
  return {
    title: `${card.title} | Board`,
    alternates: { canonical: pathname }, // metadataBase により絶対URL化
    openGraph: { title: card.title },
  };
}
```

---

## 11. セキュリティ / 権限
- **無権限は 404**（存在を秘匿）。`getCardByShortId`は権限なし時に `null` を返す。
- インターセプト側は `card === null` を受け取ったら**自動でモーダルを閉じる**（単独ページへは出さない）。

---

## 12. テレメトリ（例）
- 単独ページ表示: `analytics.page('/c/[sid]/[slug]')`
- モーダル表示: `analytics.track('card_modal_open', { sid, boardId })`
- モーダル閉: `analytics.track('card_modal_close', { sid })`

※ ライブラリは既存採用のものを使用（例: Vercel Analytics, GA, Amplitude 等）。

---

## 13. 移行手順
1. `next.config.js` から `/c/*` → `/` の **rewrites を削除**（存在する場合）。
2. ディレクトリ構成を**本仕様通りに追加**。
3. `getCardByShortId` の**認可/インデックス**を確認。
4. 旧ルーティングの参照箇所（`replaceState` 前提の実装など）を**削除/置換**。
5. スラッグ生成を**サーバー一元化**（保存時処理に寄せる）。
6. QA（下記 E2E テスト）を全て通す。

---

## 14. ロールバック戦略
- 新実装の `/c/*` を残したまま、**インターセプト側だけ無効化**すれば、直リンクのみで運用可能。  
- 最悪時は `next.config.js` で `/c/*` を旧実装へ **302** で戻す（恒久化は不可、あくまで一時回避）。

---

## 15. E2E / 回帰テスト観点（必須）
- **直リンク**: `/c/:sid/:slug` → 単独ページ表示、OG/タイトル/Canonical 確認。
- **最小リンク**: `/c/:sid` → **308** で正規リンクへ。
- **スラッグ不一致**: 古いURL → **308** 正規化。
- **新規タブ**: カードを `⌘/Ctrl+Click` → 単独ページで表示。
- **戻る**: モーダルを開く→**戻る**で閉じる→さらに**戻る**でボード履歴。
- **i18n**: 日本語タイトルで非空スラッグ生成、URL表示崩れ無し。
- **A11y**: Tab移動でモーダル内にフォーカスが閉じ込められる、Escで閉じる。
- **DnD**: スクロール/ドラッグ中に誤モーダル起動なし（しきい値で判別）。
- **権限**: 無権限カードは 404、インターセプト時は自動クローズ。
- **計測**: イベントが期待通り送信される。

---

## 16. 依存関係（任意）
- フォーカストラップを厳密にする場合のみ:
  ```bash
  npm i react-focus-lock
  ```
  - 上記を使う場合は `CardModalClient` の簡易実装を置換。

---

## 17. Codex CLI 実行タスク
以下を **順序どおり**に適用するよう Codex CLI に依頼してください。

1. **ルーティング追加**
   - 新規作成:  
     - `app/c/[short_id]/[[...slug]]/page.tsx`（本仕様「6.」「10.」のコードを反映）  
     - `app/(board)/@modal/(..)c/[short_id]/[[...slug]]/page.tsx`  
     - `app/(board)/@modal/(..)c/[short_id]/[[...slug]]/CardModalClient.tsx`
2. **メタデータ設定**
   - 既存 `app/layout.tsx` に `metadataBase` 追記（「10.」参照）。
3. **データ取得**
   - `lib/cards.ts` に `getCardByShortId` を実装。shortId インデックスと認可を確認。
4. **リンク改修**
   - ボードのカードタイルを `<Link prefetch={false} scroll={false}>` 化（「8.」参照）。
5. **DnD競合回避**
   - しきい値ロジックをカードタイルラッパへ組み込み（「9.」参照）。
6. **旧実装の撤去**
   - `next.config.js` の `/c/*` rewrite があれば削除。  
   - `replaceState` 前提の履歴いじりを撤去。
7. **QA**
   - 「15. E2E / 回帰テスト観点」を**全件**通す。

---

## 18. 付録: 例示ユーティリティ（サーバー）

```ts
// lib/slug.ts (server-only)
export function toSlugBase(title: string): string {
  const base = title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf\- ]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/\-+/g, '-');
  return base || encodeURIComponent(title);
}

export function buildReadableTail(idShort: number | undefined, slug: string) {
  return idShort ? `${idShort}-${slug}` : slug;
}

export function buildCanonicalPath(card: { shortId: string; idShort?: number; slug: string }) {
  return `/c/${card.shortId}/${buildReadableTail(card.idShort, card.slug)}`;
}
```

---

以上。**本仕様どおりに実装すれば「強引な実装」を完全置換**でき、直リンク/モーダル/戻る/SEO/A11y/計測の全要件を充足します。
