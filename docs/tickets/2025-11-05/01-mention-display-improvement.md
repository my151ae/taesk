# @メンション表示改善とテスト修正

**作成日**: 2025-11-05
**ステータス**: Open
**優先度**: High
**タグ**: `@mentions`, `ui-improvement`, `test-fix`

## 概要

@メンション機能で `display_name` と `username` を併記表示し、Trello風のUI/UXに改善する。また、現在失敗している `comments.spec.ts` のテストを修正する。

## 現在の問題

### 1. UI表示の問題

現在の実装では `display_name` のみ表示されているが、以下の改善が必要：

**望ましい表示形式**:
```
松本良則
@cybermatsu

カードの全てのメンバー (0)
@card
```

- 1行目: Display Name（日本語名など）
- 2行目: @username（英数字ID）

### 2. 検索機能の問題

現在は `display_name` のみで検索しているが、以下の両方で絞り込めるようにする：

- **日本語**: Display Name で検索（例: "松本" → 松本良則）
- **英語**: Username で検索（例: "cyber" → @cybermatsu）

### 3. テストエラー

`comments.spec.ts:332` - `should support @mentions with TipTap editor` が失敗:

```bash
# エラー内容
❌ 2件の失敗 (リトライ含む)

Error 1: サジェストポップアップが表示されない
- Expected: .bg-white.border.border-gray-200.rounded-lg
- Actual: element(s) not found
- Location: comments.spec.ts:350

Error 2: メンション要素が見つからない
- Expected: [data-mention-id] attribute
- Actual: element(s) not found
- Location: comments.spec.ts:377
```

**原因推測**: `username` フィールド追加により、TipTap Mention拡張の設定が不整合を起こしている可能性が高い。

## 実装要件

### Phase 1: データ構造確認

- [x] `profiles` テーブルに `username`, `display_name` が存在することを確認
- [ ] `comments` テーブルの `mentions` 配列に格納される形式を確認
- [ ] 既存のメンション保存ロジックを確認

### Phase 2: サジェストUI改善

**変更箇所**: `app/(board)/_components/CommentsPanel.tsx`

#### 2.1 サジェストアイテムの表示

```tsx
// Before (推測)
suggestion: {
  items: ({ query }) => { /* ... */ },
  render: () => ({
    onStart: (props) => {
      // Single line display
      return `<div>${item.display_name}</div>`;
    }
  })
}

// After
suggestion: {
  items: ({ query }) => {
    // Display name + username で検索
    return users.filter(user =>
      user.display_name.toLowerCase().includes(query.toLowerCase()) ||
      user.username.toLowerCase().includes(query.toLowerCase())
    );
  },
  render: () => ({
    onStart: (props) => {
      return `
        <div class="flex flex-col">
          <span class="font-medium">${item.display_name}</span>
          <span class="text-sm text-gray-500">@${item.username}</span>
        </div>
      `;
    }
  })
}
```

#### 2.2 特殊メンション（@card, @board）の表示

```tsx
{
  label: 'カードの全てのメンバー (X)',
  id: '@card',
  // 2行表示を維持
}
```

### Phase 3: メンション保存形式の調整

**確認事項**:
- `mentions` 配列に `profile_id` or `username` のどちらを保存するか
- TipTap の `mention` node に `data-mention-id` 属性が正しく付与されているか

**変更箇所**:
- `app/api/comments/route.ts`
- `lib/server/comments.ts` (あれば)

### Phase 4: テスト修正

**変更箇所**: `e2e/comments.spec.ts:332`

```typescript
test('should support @mentions with TipTap editor', async ({ page }) => {
  // 修正1: サジェストポップアップのセレクタを修正
  const suggestionPopup = page.locator('[data-testid="mention-suggestions"]');
  // or 実際のクラス名を確認してから修正

  // 修正2: メンション要素の検証
  const mentionInList = commentBody.locator('[data-mention-id]');
  await expect(mentionInList).toBeVisible();

  // 修正3: Display Name + Username の両方を検証
  await expect(mentionInList).toContainText('E2E Test User');
  // or username も検証
});
```

## 実装順序

1. **現在のコードを調査**
   - [ ] `CommentsPanel.tsx` の TipTap Mention 拡張設定を確認
   - [ ] `mentions` 配列の保存形式を確認
   - [ ] サジェストポップアップの実装を確認

2. **UI改善を実装**
   - [ ] サジェストアイテムを2行表示に変更
   - [ ] 検索ロジックを display_name + username 対応に変更
   - [ ] アバター表示を調整（必要に応じて）

3. **保存ロジックを修正**
   - [ ] `data-mention-id` 属性が正しく付与されるよう修正
   - [ ] `mentions` 配列に必要な情報を保存

4. **テストを修正**
   - [ ] セレクタを実装に合わせて修正
   - [ ] タイムアウトを適切に設定
   - [ ] アサーションを現実装に合わせる

5. **動作確認**
   - [ ] ブラウザでサジェスト表示を確認
   - [ ] 日本語/英語での絞り込みを確認
   - [ ] 保存したメンションの表示を確認
   - [ ] E2Eテストが通ることを確認

## 参考資料

- Trello の @メンション UI
- TipTap Mention Extension: https://tiptap.dev/docs/editor/extensions/nodes/mention
- 現在のテストエラーログ: 上記「テストエラー」セクション参照

## 備考

- `username` システムは最近追加されたばかりなので、TipTap の設定が古い形式のままになっている可能性が高い
- テスト修正は実装修正後に行うべき（現在のテストは正しい期待値を持っていない可能性）
- サジェストポップアップの DOM 構造が変更される場合、他のテストにも影響がないか確認すること

## 完了条件

- [ ] サジェストリストで Display Name + Username が2行で表示される
- [ ] 日本語（Display Name）と英語（Username）の両方で絞り込める
- [ ] メンション保存時に `data-mention-id` 属性が付与される
- [ ] `comments.spec.ts` の @mentions テストが全て合格する
- [ ] 他のコメント関連テストが影響を受けていない
