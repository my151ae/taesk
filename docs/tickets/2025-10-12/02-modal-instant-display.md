# モーダル即時表示の実装（URL同期・ページ遷移なし）

**作成日**: 2025-10-12
**ステータス**: TODO
**優先度**: High
**担当**: Claude Code

## 問題の概要

### 現状の問題
1. **モーダル表示が遅い（40ms〜789ms）**
   - サーバーサイドレンダリング（SSR）でのデータ取得が原因
   - Intercepting Routes でサーバーコンポーネントが実行されている

2. **ページ遷移が発生する**
   - `/c/:short_id/:slug` に遷移するとボード全体が再レンダリングされる
   - ユーザー体験が悪い

3. **SUPABASE_SERVICE_ROLE_KEY エラー**
   - モーダルページがサーバーサイドで実行されている
   - 環境変数の問題でエラーが発生

### Vercel ログ分析結果
```
durationMs: 40-789ms (平均 100-400ms)
Error: SUPABASE_SERVICE_ROLE_KEY is required for server-side card lookups
```

## 仕様（Trello 準拠 + ページ遷移なし）

### 1. ユーザー挙動

#### 🖥️ PC（マウス）
- **クリック→移動が発生**: ドラッグのみ。**モーダルは出さない**
- **クリック→移動なしでマウスアップ**: **モーダル表示**

#### 📱 モバイル
- **タップ**: **即モーダル表示**（まずローディング UI）
- **長押し**: ドラッグ開始。**動かさなくてもモーダルは出さない**

### 2. ルーティング/URL（ページ遷移なし・即反応）

#### URL 仕様
- ボード: `/`
- ボード + モーダル: `/c/:short_id/:slug`

#### 動作
1. **カードクリック時**:
   - `selectedCardId` をセット
   - **`window.history.replaceState` で即 URL 反映**（遷移なし）
   - モーダルを即座に表示（ローディング状態）

2. **初回ロード時**:
   - `pathname` が `/c/` 始まりなら **short_id からカード検索→モーダル開く**
   - slug が違えば **`replaceState` で正規化**

3. **モーダルクローズ時**:
   - URL を `/` に戻す（`replaceState`）

#### Next.js 設定（推奨）
`next.config.ts` の `rewrites()` で `/c/:short_id* -> /` を追加し、**描画は常に `app/page.tsx` 一箇所**で行う。

### 3. モーダルは即表示（ローディング→中身差し替え）

#### 表示フロー
1. **クリック/タップのフレームでモーダルを開く**（`status: 'loading'` の骨組み表示）
2. データは**並行取得**し、到着後に内容を差し替え
3. エラー時はエラー UI を表示

#### 実装方針
```typescript
// 状態管理
const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
const [cardModalStatus, setCardModalStatus] = useState<'loading' | 'ready' | 'error'>('loading');
const [cardModalData, setCardModalData] = useState<Card | null>(null);

// クリック時
const handleCardClick = (cardId: string) => {
  setSelectedCardId(cardId);
  setCardModalStatus('loading');

  // URL 同期（即時）
  const card = boardData.cards.find(c => c.id === cardId);
  if (card?.short_id) {
    const url = buildCardUrl({ shortId: card.short_id, ... });
    window.history.replaceState({ cardId }, '', url);
  }

  // データ取得（非同期）
  fetchCardDetails(cardId).then(data => {
    setCardModalData(data);
    setCardModalStatus('ready');
  });
};
```

### 4. DnD とクリックの競合回避（@dnd-kit）

#### センサー設定（前チケットで実装済み）
- PC: `MouseSensor { activationConstraint: { distance: 6 } }`
- モバイル: `TouchSensor { activationConstraint: { delay: 350, tolerance: 8 } }`

#### 実装ルール
- **ドラッグ開始/終了で `isDragging` を管理**（前チケットで実装済み）
- **`onClick` 前に参照**して抑止（前チケットで実装済み）

### 5. UI/アクセシビリティ

- モーダルは `role="dialog" aria-modal="true" aria-labelledby="modal-title"`
- Esc/外側クリックで閉じる
- モバイルは `max-h-[90vh] overflow-y-auto`

## 実装タスク

### Task 1: Intercepting Routes の削除
- [ ] `app/(board)/@modal/` ディレクトリを削除
- [ ] `app/(board)/layout.tsx` から `@modal` slot を削除
- [ ] `app/c/[short_id]/[[...slug]]/` を削除（不要）

### Task 2: クライアントサイドモーダル実装
- [ ] `app/(board)/page.tsx` に状態管理を追加
  - `selectedCardId`
  - `cardModalStatus`
  - `cardModalData`
- [ ] `handleCardClick` で URL 同期（`replaceState`）
- [ ] `handleModalClose` で URL を `/` に戻す
- [ ] 初回ロード時の URL 復元処理

### Task 3: CardModal のローディング対応
- [ ] `app/components/CardModal.tsx` を更新
  - ローディング UI の追加
  - エラー UI の追加
  - `status` props の追加

### Task 4: next.config.ts の更新
- [ ] `rewrites()` で `/c/:short_id*` を `/` にリライト
- [ ] ビルドエラーがないことを確認

### Task 5: 動作確認
- [ ] PC: クリックでモーダル即表示（< 50ms）
- [ ] PC: ドラッグ中はモーダル開かない
- [ ] モバイル: タップでモーダル即表示
- [ ] モバイル: 長押しでドラッグモード
- [ ] URL が正しく同期される
- [ ] `/c/:short_id/:slug` 直アクセスでモーダル状態で開く
- [ ] ページ遷移が発生しない
- [ ] E2E テスト更新・合格

## 受け入れ基準

1. ✅ **PC**: クリック→**モーダルが即表示（< 50ms、ローディング UI）**／ドラッグ→**モーダルは出ない**
2. ✅ **モバイル**: **タップで即モーダル**／**長押しでドラッグ開始**（モーダル出ない）
3. ✅ `/c/:short_id/:slug` 直アクセスで **モーダル状態で開く**。slug が不正でも**正規化**される
4. ✅ URL は **常にボード描画を維持したまま同期**（**ページ遷移なし**）
5. ✅ コンソールエラー/警告なし
6. ✅ E2E テストがすべて通る

## 技術的な詳細

### URL 同期の実装
```typescript
// クリック時
const url = buildCardUrl({ shortId: card.short_id, slug: card.slug, ... });
window.history.replaceState({ cardId: card.id }, '', url);

// クローズ時
window.history.replaceState({}, '', '/');

// 初回ロード時（useEffect）
useEffect(() => {
  if (typeof window === 'undefined') return;

  const path = window.location.pathname;
  if (path.startsWith('/c/')) {
    const [, , shortId] = path.split('/');
    const card = boardData.cards.find(c => c.short_id === shortId);
    if (card) {
      setSelectedCardId(card.id);

      // Slug 正規化
      const correctUrl = buildCardUrl({ shortId: card.short_id, ... });
      if (path !== correctUrl) {
        window.history.replaceState({ cardId: card.id }, '', correctUrl);
      }
    }
  }
}, [boardData.cards]);
```

### next.config.ts の設定
```typescript
const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/c/:short_id/:slug*',
        destination: '/',
      },
    ];
  },
};
```

### CardModal のローディング UI
```typescript
interface CardModalProps {
  status: 'loading' | 'ready' | 'error';
  card?: Card;
  boards: Board[];
  onSave: ...;
  onDelete: ...;
  onClose: ...;
}

export function CardModal({ status, card, ... }: CardModalProps) {
  if (status === 'loading') {
    return (
      <div className="fixed inset-0 z-50 ...">
        <div className="relative z-10 ...">
          <CardModalSkeleton />
        </div>
      </div>
    );
  }

  if (status === 'error' || !card) {
    return <CardModalError onClose={onClose} />;
  }

  return (
    // 既存の実装
  );
}
```

## パフォーマンス目標

| 指標 | 現状 | 目標 |
|------|------|------|
| モーダル表示速度（PC） | 100-400ms | < 50ms |
| モーダル表示速度（モバイル） | 100-400ms | < 50ms |
| ページ遷移 | あり | なし |
| サーバーレンダリング | あり | なし（完全クライアント） |

## 参考資料

- [Vercel ログ分析結果](/docs/tickets/2025-10-12/00-0845_logs_result.json)
- [History API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/History_API)
- [Next.js Rewrites](https://nextjs.org/docs/app/api-reference/next-config-js/rewrites)
- [dnd-kit Sensors](https://docs.dndkit.com/api-documentation/sensors)

## 関連ファイル

- `app/(board)/@modal/` - 削除対象
- `app/(board)/layout.tsx` - `@modal` slot 削除
- `app/(board)/page.tsx` - URL 同期・状態管理追加
- `app/components/CardModal.tsx` - ローディング対応
- `next.config.ts` - rewrites 追加
- `e2e/kanban.spec.ts` - E2E テスト更新

## 完了条件

- [ ] Intercepting Routes が削除されている
- [ ] モーダルが完全にクライアントサイドで動作する
- [ ] モーダル表示が 50ms 以内
- [ ] URL が正しく同期される（ページ遷移なし）
- [ ] E2E テストがすべて通る
- [ ] コンソールエラー/警告がない
- [ ] Vercel にデプロイして動作確認済み
