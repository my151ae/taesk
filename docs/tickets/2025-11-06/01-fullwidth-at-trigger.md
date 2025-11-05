# 全角＠トリガー対応チケット

**作成日**: 2025-11-06
**担当**: Claude Code
**ステータス**: 🔴 未実装（技術的課題あり）
**優先度**: Medium
**関連チケット**: [02-mention-display-improvement.md](../2025-11-05/02-mention-display-improvement.md)

---

## 概要

@メンション機能で、半角`@`だけでなく全角`＠`でもサジェストを表示できるようにする。

### 現状
- ✅ 半角`@`のみサポート
- ❌ 全角`＠`では候補が表示されない
- ⚠️ IME入力中の全角→半角変換で`@`になった場合は動作する

---

## 問題点

### 1. TipTap Suggestionの型制約

**ファイル**: `@tiptap/suggestion` の型定義
**問題**: `char` プロパティが `string` 型のみを許可

```typescript
// TipTapの型定義（推測）
interface SuggestionOptions {
  char: string;  // ← 正規表現を受け付けない
  items: (props: { query: string }) => any[];
  // ...
}
```

**試した実装**:
```typescript
// MentionSuggestion.tsx
export function createMentionSuggestion(searchProfiles) {
  return {
    char: /[@＠]/,  // ← TypeScriptエラー
    items: async ({ query }) => { ... },
  };
}
```

**エラー**:
```
Type 'RegExp' is not assignable to type 'string'
```

### 2. 型アサーション `as any` の問題

**試した実装**:
```typescript
// CommentEditor.tsx
suggestion: {
  ...createMentionSuggestion(searchProfiles),
  char: /[@＠]/,  // ← ランタイムでは動作するが...
} as any  // ← 型エラー回避
```

**結果**:
- TypeScriptエラーは解消
- **しかし、E2Eテストで候補が表示されない**
- TipTapの内部実装が正規表現を期待通りに処理していない可能性

### 3. TipTap内部のマッチング処理

**推測される問題**:
- TipTap Suggestionは内部で `char` を文字列として扱っている
- 正規表現が渡されても、適切にマッチング処理を行えない
- カスタムマッチャーの実装が必要

---

## 解決策の検討

### 案1: カスタムマッチャーの実装 ⭐ 推奨

TipTap Suggestionの `find` 関数をカスタマイズする。

```typescript
// MentionSuggestion.tsx
export function createMentionSuggestion(searchProfiles) {
  return {
    // デフォルトのchar（型エラー回避用）
    char: '@',

    // カスタムマッチャーでオーバーライド
    find: (props: { text: string; from: number; to: number }) => {
      const { text } = props;

      // 正規表現で全角・半角両方をマッチ
      const pattern = /(^|[\s\u3000.,;:()\[\]{}<>\/\\'"""''！、。？…—-])([@＠])([^\s@＠]*)$/;
      const match = text.match(pattern);

      if (!match) return null;

      const prefix = match[1] || '';
      const trigger = match[2];  // @ or ＠
      const query = match[3] || '';

      return {
        range: {
          from: props.from - query.length - 1,  // trigger + query
          to: props.to,
        },
        query,
        text: `${trigger}${query}`,
      };
    },

    items: async ({ query }) => {
      return await searchProfiles(query);
    },

    // ... render など
  };
}
```

**メリット**:
- 全角・半角両方に対応
- トリガー前の文脈（空白・句読点など）も正確に判定
- メールアドレス（`user@domain.com`）との誤判定を防止

**デメリット**:
- TipTapの内部実装に依存（ドキュメント化されていない可能性）
- `find` 関数の型定義を確認する必要がある

### 案2: IME入力のインターセプト

全角入力時に自動で半角に変換する。

```typescript
// CommentEditor.tsx
editorProps: {
  handleDOMEvents: {
    compositionend: (view, event) => {
      const { state, dispatch } = view;
      const { tr, selection } = state;

      // カーソル前のテキストを取得
      const textBefore = state.doc.textBetween(
        Math.max(0, selection.from - 10),
        selection.from
      );

      // 全角＠を半角＠に置換
      if (textBefore.endsWith('＠')) {
        const from = selection.from - 1;
        const to = selection.from;
        dispatch(tr.insertText('@', from, to));
        return true;
      }

      return false;
    },
  },
},
```

**メリット**:
- TipTap Suggestionの変更不要
- 実装がシンプル

**デメリット**:
- ユーザーの入力を強制的に変更（UX的に望ましくない）
- IME確定後にしか動作しない（変換候補表示中は無効）

### 案3: 入力プレーンテキストの前処理

エディタに入力される前にNFKC正規化を適用。

```typescript
// CommentEditor.tsx
onUpdate: ({ editor }) => {
  const doc = editor.getJSON();

  // 全角＠を半角＠に正規化（NFKC）
  const normalized = normalizeContent(doc);

  if (JSON.stringify(normalized) !== JSON.stringify(doc)) {
    editor.commands.setContent(normalized, false);  // undoHistory無視
  }

  const storageText = toStorage(normalized);
  onChange(storageText);
},
```

**メリット**:
- 保存時に統一される
- 他の全角記号も一括処理可能

**デメリット**:
- リアルタイムのサジェスト表示には対応できない
- エディタ内容を強制的に書き換える（カーソル位置がずれる可能性）

---

## 推奨実装手順

### Phase 1: TipTap Suggestionの調査

1. `@tiptap/suggestion` のソースコードを確認
2. `find` 関数の型定義とデフォルト実装を調査
3. カスタマイズ可能な範囲を把握

```bash
# node_modules/@tiptap/suggestion を確認
cat node_modules/@tiptap/suggestion/dist/index.d.ts
```

### Phase 2: カスタムマッチャーの実装

1. `MentionSuggestion.tsx` に `find` 関数を追加
2. 正規表現 `/(^|[\s\u3000.,;:()\[\]{}<>\/\\'"""''！、。？…—-])([@＠])([^\s@＠]*)$/` でマッチ
3. トリガー位置と範囲を正確に返す

### Phase 3: E2Eテストの追加

```typescript
// comments.spec.ts
test('should support full-width ＠ trigger @feature:comments', async ({ page }) => {
  // ... modal open

  const editor = page.locator('.ProseMirror').last();
  await editor.click();

  // 全角＠を入力
  await editor.pressSequentially('＠');
  await page.waitForTimeout(1000);

  // サジェストポップアップが表示されることを確認
  const suggestionPopup = page.locator('.bg-white.border.border-gray-200.rounded-lg');
  await expect(suggestionPopup).toBeVisible({ timeout: 5000 });

  // 候補を選択
  const userOption = suggestionPopup.locator('button').first();
  await userOption.click();

  // メンション要素が挿入されることを確認
  const mention = editor.locator('.mention');
  await expect(mention).toBeVisible();
});
```

### Phase 4: エッジケースのテスト

- [ ] 全角＠の後に全角文字（例: `＠まつ`）
- [ ] 半角・全角混在（例: `＠test`、`@テスト`）
- [ ] IME変換中の動作（compositionstart/compositionend）
- [ ] メールアドレスとの区別（例: `user＠example.com`）

---

## 既知のリスク

### 1. TipTapのバージョン依存

- 現在使用中のバージョン: 要確認
- `find` 関数のAPIが将来変更される可能性
- マイナーバージョンアップで動作が変わるリスク

### 2. パフォーマンス

- カスタムマッチャーは入力のたびに実行される
- 正規表現のコストが高い場合、入力遅延が発生
- デバウンス処理が必要な場合あり

### 3. IME入力との互換性

- Windows/Mac/Linux でIMEの動作が異なる
- Chrome/Firefox/Safari で挙動が異なる可能性
- `compositionstart`/`compositionend` イベントの扱い

---

## 代替案: エディタライブラリの変更

TipTapの制約が厳しい場合、別のリッチテキストエディタを検討：

### Draft.js
- Facebook製、Reactとの統合が良好
- カスタムデコレータで柔軟なトリガー処理
- ⚠️ メンテナンスがあまり活発ではない

### Slate
- モダンなReactエディタフレームワーク
- 完全にカスタマイズ可能
- ⚠️ 学習曲線が急

### Lexical
- Meta製、Draft.jsの後継
- 高パフォーマンス、モジュラー設計
- ✅ 積極的にメンテナンスされている

---

## 関連ファイル

- `app/(board)/_components/tiptap/CommentEditor.tsx` - エディタ本体
- `app/(board)/_components/tiptap/MentionSuggestion.tsx` - サジェストUI
- `app/(board)/_components/tiptap/Mention.tsx` - Mention拡張
- `e2e/comments.spec.ts` - E2Eテスト

---

## 参考リンク

- [TipTap Suggestion Extension](https://tiptap.dev/api/utilities/suggestion)
- [TipTap Custom Extensions](https://tiptap.dev/guide/custom-extensions)
- [NFKC Normalization](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/normalize)
- [IME Events](https://developer.mozilla.org/en-US/docs/Web/API/CompositionEvent)

---

## 次のアクション

1. [ ] TipTap Suggestionのソースコード調査
2. [ ] `find` 関数の型定義確認
3. [ ] カスタムマッチャーのプロトタイプ実装
4. [ ] 手動テストで動作確認
5. [ ] E2Eテスト追加
6. [ ] ドキュメント更新

---

**更新履歴**:
- 2025-11-06: チケット作成（Phase 2実装中に全角対応を断念）
