
# Mention UI/UX 改善チケット
- Ticket: `docs/tickets/2025-11-05/02-mention-display-improvement.md`
- Latest commit: `f91bc744cf7be0f7f70cf176b9e4a73f7a40dddb`
- Author: 松本Ops

## ゴール
- Trello風に **名前 + ID(@handle)** を横並びで表示（アバター付き）。
- `@` の直後にタイプした文字で絞り込み（日本語IME考慮）。
- **全角 `＠` でも** 同じ挙動で候補を表示。
- アクセシビリティ（キーボード操作とARIA）に対応。

## 画面仕様（候補ポップアップ）
- 幅: コンテンツに合わせ自動、最大高さ: 320px、縦スクロール。
- 1行表示（推奨）: 「松本 良則  @cybermatsu」
  - 補助表示（任意）: 右側に「部署/権限」バッジ。
- 強調: マッチ部分を `<mark>` でハイライト。
- 空状態: 「候補が見つかりません」。読み込み中はスピナー。
- キー操作: ↑/↓で移動、Enter/Tabで確定、Escで閉じる、マウス/タッチ選択可。
- A11y: `role="listbox"`, 項目は `role="option"`、`aria-activedescendant` 管理。

## トリガー & 絞り込み
- トリガー条件: `@` または 全角 `＠` の直後、かつ先頭/空白/記号の直後（メールアドレスは除外）。
- IME 対応: `compositionstart`〜`compositionend` 中は検索を走らせず、`end` 後にデバウンスして実行。
- 正規化（検索キー/候補の双方）:
  - Unicode 正規化 `NFKC`（全角→半角、`＠`→`@`）。
  - 小文字化。
  - `Intl.Collator('ja', {sensitivity: 'base'})` による比較でひら/カタ/大小を吸収。
- マッチルール:
  1) `startsWith` を最優先（名前・ID 両方）
  2) それ以外は `includes`
  3) スコア順: `名前の前方一致 > IDの前方一致 > 部分一致`
- パフォーマンス: 入力を **100–150ms デバウンス**、結果は 20件まで、LRU キャッシュ。

## データモデル（例）
```ts
type Mentionable = {
  id: string;           // user uuid
  handle: string;       // @cybermatsu
  name: string;         // 松本 良則
  avatarUrl?: string;
  group?: 'card' | 'all' | string; // グループメンション用
  meta?: string;        // 部署など
};
```

## 埋め込みフォーマット（例）
- 表示: `@松本 良則`
- 内部: `<span data-mention="user" data-id="...">@松本 良則</span>`
  - もしくはエディタ依存の JSON ノード（Tiptap/Quill/DraftJS など）。

## 正規表現（直近のトリガー検出）
```
/(^|[\s\u3000.,;:()\[\]{}<>\/\\'"“”‘’！、。？…—-])(@|＠)([^\s@]*)$/
```
- 直前が先頭/空白/句読点等のときに発火。
- 第3キャプチャが現在のクエリ。

## 擬似コード（プレーン contenteditable 想定）
```ts
let composing = false;
const collator = new Intl.Collator('ja', { sensitivity: 'base' });

function normalize(s: string) {
  return s.normalize('NFKC').toLowerCase();
}

editor.addEventListener('compositionstart', () => composing = true);
editor.addEventListener('compositionend', () => { composing = false; scheduleSearch(); });
editor.addEventListener('input', () => { if (!composing) scheduleSearch(); });

const scheduleSearch = debounce(() => {
  const { textBeforeCaret } = getTextAroundCaret(editor);
  const m = /(^|[\s\u3000.,;:()\[\]{}<>\/\\'"“”‘’！、。？…—-])(@|＠)([^\s@]*)$/.exec(textBeforeCaret);
  if (!m) return closePopup();

  const query = normalize(m[3] || '');
  const results = searchCandidates(query);
  openOrUpdatePopup(results);
}, 120);

function searchCandidates(q: string) {
  const pool = loadCandidates(); // プリフェッチ or API
  const N = normalize;
  const score = (c: Mentionable) => {
    const name = N(c.name);
    const id = N(c.handle);
    if (name.startsWith(q)) return 3;
    if (id.startsWith(q))   return 2;
    if (name.includes(q) || id.includes(q)) return 1;
    return 0;
  };
  return pool
    .map(c => ({ c, s: score(c) }))
    .filter(x => x.s > 0 || q === '')
    .sort((a, b) => b.s - a.s || collator.compare(a.c.name, b.c.name))
    .slice(0, 20)
    .map(x => x.c);
}
```

## UI（1項目のHTML例）
```html
<li role="option" id="opt-3" class="mention-item">
  <img class="avatar" src="...">
  <span class="name">松本 良則</span>
  <span class="handle">@cybermatsu</span>
  <span class="meta">開発</span>
</li>
```
```css
.mention-item { display:flex; align-items:center; gap:.5rem; padding:.4rem .6rem; }
.mention-item .name { font-weight:600; }
.mention-item .handle { opacity:.7; margin-left:.25rem; }
.mention-item[aria-selected="true"] { outline: 2px solid; }
```

## グループメンション
- 例: `@card`（「カードの全てのメンバー」）。通常ユーザーと同じリストに混在可。
- バッジ表示 `Group` を付与、確定時は専用トークン `data-mention="group"` で埋め込み。

## サーバ/API
- `/api/mentions?q=...&limit=20`
- レスポンスは `Mentionable[]`。サーバ側も **NFKC 正規化** で検索。
- レート制限対策としてクライアント側プリフェッチ + キャッシュ（有効期限 5分）。

## 受け入れ基準（Acceptance Criteria）
- `@`/`＠` 入力後に候補が開き、名前/ID で前方一致 → 部分一致の優先順位で並ぶ。
- 項目は **名前 + @ID** を横並びで表示（アバター有）。
- キーボード（↑↓Enter/Esc）で操作でき、スクリーンリーダーで読める。
- 日本語IME中は候補がちらつかない（composition中は検索しない）。
- メールアドレス（例: user@example.com）入力では候補が出ない。
- `@card` のようなグループ項目も候補・確定できる。

## テストケース（抜粋）
- `＠ま` で全角トリガー→ `松本` が上位に出る。
- `@cyb` で `@cybermatsu` が前方一致で最上位。
- 変換中（かな入力中）はポップアップ非表示。確定後120msで表示。
- 先頭/空白/句読点以外（例: `email@domain`）では非表示。

## 既知のリスク
- 候補件数が多い場合のパフォーマンス→ 仮想リスト化を検討。
- Collator の比較コスト → 事前正規化 + スコアのみ Collator 使用に限定。

---

## 現状分析 (2025-11-05)

### 現在の実装状況

**ファイル構成**:
- `app/(board)/_components/tiptap/CommentEditor.tsx` - TipTap エディタ本体
- `app/(board)/_components/tiptap/MentionSuggestion.tsx` - サジェストUI
- `app/(board)/_components/tiptap/Mention.tsx` - Mention 拡張（推測）
- `lib/mention-utils.ts` - ストレージ変換ユーティリティ

**現在の動作**:
1. **トリガー**: `@` のみ（`char: '@'` in `MentionSuggestion.tsx:124`）
2. **表示**: `@{name}` の1行表示（`MentionSuggestion.tsx:107`）
3. **検索**: `username`, `display_name`, `full_name`, `email` の `includes` マッチ（`CommentEditor.tsx:94-103`）
4. **保存形式**: `<@{uuid}>` トークン（`mention-utils.ts`）
5. **表示形式**: `@{name}` with `.mention` class（`CommentEditor.tsx:186-194`）

### テストエラー詳細

**ファイル**: `e2e/comments.spec.ts:332`
**テスト名**: `should support @mentions with TipTap editor @e2e:essential @feature:comments`

#### エラー 1: サジェストポップアップが見つからない
```
Error: expect(locator).toBeVisible() failed
Locator: .bg-white.border.border-gray-200.rounded-lg
Expected: visible
Timeout: 5000ms
Location: comments.spec.ts:350
```

**原因**: テストが期待するセレクタ `.bg-white.border.border-gray-200.rounded-lg` は、実装では正しく存在するが、以下の可能性：
- Tippy.js がポップアップをレンダリングするタイミングの問題
- `@` 入力後、サジェストが起動していない
- DOM に要素が存在するが、`visibility: hidden` や `opacity: 0` などで非表示

#### エラー 2: メンション要素に `data-mention-id` 属性がない
```
Error: expect(locator).toBeVisible() failed
Locator: [data-testid="comment-body"]
  .filter({ hasText: 'test mention' })
  .locator('[data-mention-id]')
  .filter({ hasText: '@E2E Test User' })
Expected: visible
Timeout: 10000ms
Location: comments.spec.ts:377
```

**現状確認**:
- TipTap拡張（`app/(board)/_components/tiptap/Mention.ts:38-86`）は `renderHTML` 内で `data-mention-id` と `data-mention-name` を出力済み。
- 表示用コンポーネント（`app/(board)/_components/Mention.tsx:35-40`）でも `data-mention-id` を付与している。
- Playwright 失敗ログは「セレクタ一致対象が見つからない」状況を示すのみで、属性欠落を直接確認できていない。

**再考した原因仮説**:
- 投稿後に取得するコメント JSON の `mentions` 配列や本文保存形式が欠落し、`RenderCommentBody` が `<@id>` を変換できていない。
- コメント一覧の再描画タイミングとテストの待機が噛み合わず、DOM 上に目的要素がまだ存在していない。
- Mention ノードの `name` が `undefined` になり、`RenderCommentBody` 上で `@Unknown User` が表示されテキスト一致に失敗している。

### 実装が不足している点

1. ✅ **トリガー**: 全角 `＠` 未対応
2. ✅ **表示**: Display Name + Username の2行表示が未実装
3. ✅ **検索**:
   - NFKC 正規化なし
   - スコアリング（前方一致優先）なし
   - `Intl.Collator` 未使用
4. ✅ **IME 対応**: `compositionstart`/`compositionend` ハンドリングなし
5. ❓ **HTML 属性**: コード上は付与済みだが、E2E では見つからないため保存/描画パスの検証が必要
6. ⚠️ **アクセシビリティ**: `role="listbox"`, `role="option"`, `aria-activedescendant` なし

### 修正が必要なファイル

#### 1. `MentionSuggestion.tsx` (UI改善)
```tsx
// Line 84: 1行（横並び）表示に統一（Trello風）
<div className="flex items-center gap-2">
  <span className="font-semibold text-sm">{item.name}</span>
  <span className="text-xs opacity-70">@{item.handle}</span>
</div>

// 全角 ＠ トリガー対応（TipTap editor 初期化時に追加）
const editor = useEditor({
  // ... existing config
  onCreate: ({ editor }) => {
    const el = editor.view.dom as HTMLElement;
    el.addEventListener('beforeinput', (e: InputEvent) => {
      if (e.data === '＠') {
        e.preventDefault();
        editor.commands.insertContent('@'); // Suggestion起動
      }
    });
  },
});
```

#### 2. `CommentEditor.tsx` (検索ロジック改善)
```tsx
// Line 71-117: searchProfiles を以下に置き換え
const searchProfiles = useMemo(
  () => async (query: string) => {
    const normalizedQuery = query.normalize('NFKC').toLowerCase();
    const collator = new Intl.Collator('ja', { sensitivity: 'base' });

    const scored = profiles
      .map(p => {
        const name = (p.display_name || p.full_name || '').normalize('NFKC').toLowerCase();
        const handle = (p.username || '').normalize('NFKC').toLowerCase();

        let score = 0;
        if (name.startsWith(normalizedQuery)) score = 3;
        else if (handle.startsWith(normalizedQuery)) score = 2;
        else if (name.includes(normalizedQuery) || handle.includes(normalizedQuery)) score = 1;

        return { profile: p, score };
      })
      .filter(x => x.score > 0 || !query.trim())
      .sort((a, b) => b.score - a.score || collator.compare(a.profile.display_name || '', b.profile.display_name || ''))
      .slice(0, 20);

    return scored.map(x => ({
      id: x.profile.id,
      name: x.profile.display_name || x.profile.full_name || 'Unknown',
      handle: x.profile.username || x.profile.id.slice(0, 8),
      avatar_url: x.profile.avatar_url || undefined,
    }));
  },
  [profiles]
);
```

#### 3. `comments.spec.ts` (テスト安定化)
```typescript
// サジェスト表示待ちを Tippy の root に揃える
const suggestionPopup = page.locator('.bg-white.border.border-gray-200.rounded-lg');
await expect(suggestionPopup).toBeVisible({
  timeout: 5000,
  message: 'Mention suggestion should appear after pressing @',
});

// コメント反映待ちのリトライを追加（属性が出るまで waitFor する）
const mentionInList = commentBody.locator('[data-mention-id]', {
  hasText: '@E2E Test User',
});
await mentionInList.waitFor({ state: 'visible', timeout: 10000 });
```

### 実装優先順位

#### Phase 1: テストを通すための最小修正（優先度: High）
1. コメント投稿レスポンスで `mentions` / `<@id>` 保存が崩れていないか API を確認し、E2E で DOM が取得できるよう調整
2. `comments.spec.ts` の待機/ロケータを安定化（上記例）
3. サジェストポップアップの表示タイミングを調整

#### Phase 2: UI改善（優先度: Medium）
1. `MentionSuggestion.tsx` で Display Name + Username 2行表示
2. `CommentEditor.tsx` で NFKC 正規化 + スコアリング検索
3. 全角 `＠` トリガー対応

#### Phase 3: UX改善（優先度: Low）
1. IME composing 中のサジェスト抑制
2. デバウンス調整（120-150ms）
3. アクセシビリティ（ARIA属性）

### 次のアクション

1. ✅ Mention 関連コンポーネントの実装状況を確認
2. 🔍 コメント保存フローと `mentions` 配列の整合性を調査（テスト再現必須）
3. 🔁 `comments.spec.ts` の待機調整を行い、E2E を通す
4. ⏭️ UI/UX 改善フェーズ（2行表示・正規化・IME対応）へ移行
