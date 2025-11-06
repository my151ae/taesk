# 全角＠専用 Suggestion 追加チケット（02）

**作成日**: 2025-11-06  
**担当**: 松本Ops / フロントエンドチーム  
**ステータス**: 🟡 着手可（仕様確定＆実装タスク化）  
**優先度**: Medium（UX 改善・影響範囲はフロントのみ）  
**関連**: 01-fullwidth-at-trigger.md（調査版）

---

## 決定事項（What & Why）
- コメントエディタの @メンションに **全角 `＠`（U+FF20）専用の Suggestion を追加**し、半角 `@` と同等の候補表示・挿入を実現する。  
- 既存の半角 `@` 用 Suggestion は維持。**2本立て**（`@` / `＠`）で運用する。  
- 検索クエリは **NFKC 正規化**して一元化（`items` 内で `query.normalize('NFKC')`）。

**狙い**: 公開 API の範囲で安定実装。TipTap 内部のマッチャーへ依存しないため、将来の破壊的変更リスクを抑える。

---

## 実装方針（How）
### 1) 新規 Extension: `ZenkakuMentionTrigger`
- `@tiptap/suggestion` を利用し、**`char: '＠'`** を指定した Suggestion を追加。
- `pluginKey` はユニーク（例: `new PluginKey('zenkakuMention')`）。
- `items` は NFKC 正規化後に既存のプロフィール検索へ接続。
- `command` は既存のメンション挿入ロジックを共用（range は Suggestion 提供値を使用）。

#### 擬似コード
```ts
import { Extension } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import { insertMention } from './mentionCommand' // 既存の共通挿入関数を想定
import { getMentionCandidates } from './mentionSearch' // 既存の検索を想定

export const ZenkakuMentionTrigger = Extension.create({
  name: 'zenkakuMentionTrigger',
  addProseMirrorPlugins() {
    return [
      Suggestion({
        char: '＠', // U+FF20
        pluginKey: new PluginKey('zenkakuMention'),
        items: async ({ query }) => {
          const q = (query ?? '').normalize('NFKC')
          return getMentionCandidates(q)
        },
        command: ({ editor, range, props }) => {
          insertMention(editor, range, props)
        },
        // 必要なら allowedPrefixes 等も設定
      }),
    ]
  },
})
```

### 2) 既存エディタへの組み込み
- コメントエディタ初期化で `ZenkakuMentionTrigger` を `.use()`。  
- 既存の `@` 用 Mention/Suggestion とは別プラグインとして読み込む。

### 3) 仕様の補足
- 入力テキストは変更しない（自動変換なし）。  
- サジェスト候補検索のみ NFKC で正規化。  
- スキーマ変更不要。

---

## テスト計画
- **ユニット**: `items` 正規化・検索、`command` の range 挿入。
- **E2E（Playwright）**:
  - `＠` 直後でポップアップ表示。
  - 全角文字列で候補フィルタ（例: `＠まつ`）。
  - 半角/全角混在（`＠test` / `@テスト`）。
  - メールアドレス誤起動抑止（`user＠example.com`）。
  - Undo/Redo、文中・文末、連打、長文での遅延。
- **手動**: Win/MS-IME・macOS日本語IM × Chrome/Safari。

---

## 影響範囲・リスク
- 影響はコメントエディタのフロントのみ。バックエンド/データモデル影響なし。
- リスク: IME/ブラウザ差、複数 Suggestion 併用時の競合（`pluginKey` 重複防止で回避）。
- パフォーマンス: `items` での正規化は軽微。候補検索の負荷は既存と同等。

---

## 工数の目安
- 実装: 0.5d
- 手動検証: 0.5d
- E2E 追加: 0.5d
- バッファ・CI 安定化: 0.5d

**合計**: 1〜2 d

---

## 代替案（参考）
- **findSuggestionMatch のカスタム**で 1 プラグイン運用  
  → バージョン依存・内部仕様の追従コストが上がるため今回は採らない。  
- **compositionend で全角→半角変換**  
  → 入力書き換えは UX 面でマイナス。

---

## 実装タスク
- [ ] `ZenkakuMentionTrigger` 追加（`char: '＠'`、`pluginKey` 付与）
- [ ] `items` 内で `query.normalize('NFKC')`
- [ ] 既存 Mention 挿入ロジックの共用
- [ ] E2E シナリオ追加（全角トリガ）
- [ ] QA/主要環境での手動検証
- [ ] ドキュメント更新（運用/回帰テスト手順）

---

## 参考リンク
- TipTap Suggestion ドキュメント（`char` / `pluginKey` / `findSuggestionMatch`）: https://tiptap.dev/docs/editor/api/utilities/suggestion
- Mention ノード: https://tiptap.dev/docs/editor/extensions/nodes/mention
- 複数 Suggestion の併用に関するディスカッション（`pluginKey` のユニーク化）: https://github.com/ueberdosis/tiptap/discussions/1768
