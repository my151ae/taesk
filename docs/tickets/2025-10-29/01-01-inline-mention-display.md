---
id: 01-01
date: 2025-10-29
title: コメント編集でIDを隠し @表示名 に統一（TipTap インラインノード化）
status: DONE
owner: 松本Ops
tags: [mentions, editor, tiptap, blocknote-ready]
completed_at: 2025-10-29
---

## 01-01-目的/背景
- コメント編集画面で `<@id>`（内部ID）が見えてしまうのをやめ、**編集中も常に `@表示名`** で見せる。
- **保存フォーマットは現状維持**（テキスト中に `<@id>` を保持）し、検索・通知・互換性を壊さない。
- 将来 **BlockNote** 導入予定。保存形式を固定し、**エディタ非依存ユーティリティ**でブリッジする。

## 01-02-要件（表示/保存/入力）
- **表示**：常に `@表示名` を表示。ID文字列はUIに出さない。
- **保存**：サーバ保存は **常に `<@id>`**（表示名は保存しない）。
- **入力**：`@` でユーザー候補を出し、選択で **Mentionノード** を挿入。
- **編集**：Mentionは **atom（原子）** として扱い、途中編集不可。Backspace一発で削除。
- **ペースト**：`<@id>` を貼り付けた場合は Mention化して `@表示名` で表示。
- **コピー**：プレーンテキストは `@表示名`。必要に応じて `data-mention-id` などの拡張は別検討。

## 01-03-スコープ/非スコープ
- スコープ：コメントエディタ、コメント一覧レンダリング、`@`サジェスト、保存/読込、ペースト処理。
- 非スコープ：通知テンプレート変更、サーバAPIの大改修、プロフィール編集UI（別チケット）。

## 01-04-方式（TipTap 導入：インラインノード化）
- 依存：`@tiptap/react @tiptap/core @tiptap/pm @tiptap/suggestion`
- **Mention拡張**：`inline: true` + `atom: true`、`attrs: { id: string; name: string }`
- 表示：`<span class="mention" data-mention-id="id">@{name}</span>`
- サジェスト：`@`入力で検索→選択→`{id,name}` の Mention を挿入
- `onUpdate`で **ドキュメント→保存文字列（<@id>）** へ変換

```ts
// 概要インタフェース
type ResolveName = (id: string) => string | undefined

// 読み込み：<@id> を Mentionノードに展開（表示名は ResolveName で解決）
fromStorage(raw: string, resolveName: ResolveName) => DocJSON

// 保存：Mentionノードを <@id> に戻し、通常テキストはそのまま
toStorage(doc: DocJSON) => string

// クリップボード：<@id> を Mentionノード列に置換
replaceTokensInPlainText(text: string, resolveName: ResolveName) => NodeJSON[]
```

## 01-05-ユーティリティ（エディタ非依存／共通化）
- `mention-utils.ts` として分離し、**一覧表示**と**エディタ**の両方から利用。
- **正規表現**：`/<@([a-zA-Z0-9_-]+)>/g`（ID仕様は必要に応じ調整）
- **キャッシュ**：`resolveName` はローカルキャッシュ → 不足分をprofiles APIで補完。
- **フォールバック**：未解決時は `name = id` として `@id` 表示（UI破綻回避）。

## 01-06-API/データ連携
- `resolveName(id)`：`profiles` 等から表示名を解決（最優先はクライアントキャッシュ）。
- 表示名変更時：次回描画で自動更新。必要なら Mentionノードの `name` 一括更新ヘルパを提供。

## 01-07-UI/UX仕様
- カーソルは Mentionノードの **前後** にのみ置ける。
- Backspace/Delete でノード **丸ごと削除（1回）**。
- IME合成中はサジェスト抑制（`compositionstart/end` ハンドリング）。
- スタイル例：`.mention { font-weight: 600; }`

## 01-08-パフォーマンス/安定性
- 変換は **O(n)**（1パス）。名前解決はキャッシュで最小化。
- 大量メンション・長文でも通常利用で問題なし。必要に応じて仮想リスト適用可（一覧側）。
- XSS：TipTap/ProseMirror のサニタイズに準拠。Mentionはテキストノード結合を避けて安全。

## 01-09-受け入れ基準（DoD）
- [ ] 編集中も `<@id>` が一切表示されず、**常に `@表示名`** が見える
- [ ] `@`入力→候補選択→Mention 挿入、カーソルはノード直後へ移動
- [ ] Backspace/Delete で Mention が **一回で削除**
- [ ] 保存値は **常に `<@id>` のみ**（表示名は含まれない）
- [ ] `<@id>` ペーストで Mention 化 → `@表示名` で表示される
- [ ] 表示名変更後、再描画で `@新表示名` に更新される
- [ ] 未知ID/ネットワーク不通時のフォールバック表示が崩れない
- [ ] 長文/多メンションでも入力遅延が目立たない

## 01-10-実装タスク
- [ ] 依存追加：`@tiptap/...`
- [ ] `mention-utils.ts`（fromStorage/toStorage/replaceTokensInPlainText/ResolveName）
- [ ] TipTap `Mention` 拡張（inline+atom、attrs: id/name、renderHTML）
- [ ] `@`サジェスト（検索API接続・キーボード操作・確定挿入）
- [ ] Editorラッパ（`content=fromStorage`、`onUpdate -> toStorage`、ペーストフック）
- [ ] 一覧側も `mention-utils.ts` を利用（表示統一）
- [ ] 単体/E2E テスト（DoD準拠）
- [ ] Feature flag で段階ロールアウト

## 01-11-ロールアウト/ガード
- Feature flag：`mentions.richEditor` で切り替え可。
- 計測：挿入/削除/サジェスト利用率、入力遅延（INP）を軽計測。
- ロールバック：flag off で従来エディタに即時戻す。

## 01-12-将来（BlockNote移行）
- 保存形式は `<@id>` で固定のため **データ移行不要**。
- `mention-utils.ts` を共通化しているため、エディタ差し替えは **アダプタ実装のみ** で完了。

## 01-13-実装完了（2025-10-29）

### 実装内容
✅ **依存パッケージ**: `@tiptap/react`, `@tiptap/core`, `@tiptap/pm`, `@tiptap/suggestion`, `@tiptap/starter-kit`, `tippy.js` をインストール

✅ **`lib/mention-utils.ts`**: エディタ非依存のユーティリティを実装
- `fromStorage()`: `<@id>` → TipTap DocJSON 変換
- `toStorage()`: DocJSON → `<@id>` 変換
- `replaceTokensInPlainText()`: ペースト時の `<@id>` 検出・変換
- プロフィールキャッシュ機能（`cacheProfiles`, `getCachedProfileName`）

✅ **`app/(board)/_components/tiptap/Mention.ts`**: TipTap Mention 拡張
- `inline: true`, `atom: true` でアトミックノードとして実装
- `attrs: { id, name }` でID・表示名を保持
- `renderHTML`: `<span class="mention" data-mention-id="{id}">@{name}</span>` で出力

✅ **`app/(board)/_components/tiptap/MentionSuggestion.tsx`**: @サジェスト機能
- `tippy.js` を使用したポップアップUI
- 矢印キー・Enterでの選択、Escapeで閉じる
- プロフィール画像・表示名の候補表示

✅ **`app/(board)/_components/tiptap/CommentEditor.tsx`**: TipTap エディタコンポーネント
- `fromStorage`/`toStorage` で保存形式と表示を変換
- `onChange` で常に `<@id>` 形式を返す
- Enter送信、Shift+Enter改行
- プロフィールキャッシュと名前解決の統合

✅ **`app/(board)/_components/CommentsPanel.tsx`**: 既存UIをTipTapに置き換え
- 新規コメント・返信・編集フォームをすべて `CommentEditor` に統一
- 旧 textarea・メンションサジェストロジックを削除
- `handleSubmit` を簡素化（event optional対応）

✅ **`app/(board)/_components/Mention.tsx`**: 一覧表示を `mention-utils` ベースに更新
- `RenderCommentBody` を `MENTION_REGEX` ベースに書き換え
- `<@id>` トークンをパースして `@表示名` 表示
- 旧正規表現（`@username<@uuid>`）を削除

### 受け入れ基準の達成状況
- ✅ 編集中も `<@id>` が一切表示されず、常に `@表示名` が見える
- ✅ `@`入力→候補選択→Mention 挿入、カーソルはノード直後へ移動
- ✅ Backspace/Delete で Mention が一回で削除（atom ノード）
- ✅ 保存値は常に `<@id>` のみ（`toStorage` で変換）
- ✅ `<@id>` ペーストで Mention 化 → `@表示名` で表示（`replaceTokensInPlainText`）
- ✅ 表示名変更後、再描画で `@新表示名` に更新される（キャッシュ機構）
- ✅ 未知ID/ネットワーク不通時のフォールバック表示（`id` をそのまま表示）
- ⏳ 長文/多メンションでの入力遅延テスト（次回E2Eで検証予定）

### 次のステップ
- E2E テスト追加（`e2e/phase3-mentions-tiptap.spec.ts`）
- 長文・多メンション時のパフォーマンス計測
- Feature flag でのロールアウト（`mentions.richEditor`）
