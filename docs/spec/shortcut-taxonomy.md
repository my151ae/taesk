# Shortcut Taxonomy

Taesk の shortcut registry と status shortcut bar は、以下の taxonomy を SSOT として使う。

この taxonomy は shortcut 解決専用であり、board navigation / URL state の SSOT ではない。`pp` / `mp` を中心とした `BoardUiState` は別モデルとして扱う。

## 目的

- shortcut の表示条件を UI 構造に沿って安定して表現する
- `focusGroup` / `focusPart` や sidebar state など既存情報を、無理に置き換えず resolver で吸収する
- `ShortcutsModal` と status bar が同じ語彙で shortcut を説明できるようにする

## 軸

### `scope`

最上位レイヤーだけを表す。

- `board`
- `modal`
- `context-menu`

`left-panel` / `right-panel` や `timeline` / `list` は `scope` に入れない。

### `region`

各 `scope` の中での配置場所を表す。

- `sidebar`
- `main-panel`
- `modal-title`
- `modal-body`
- `shortcuts-modal`

`shortcuts-modal` は独立 scope ではなく、`scope=modal` 配下の region として扱う。

### `section`

sidebar 内の意味的なまとまりを表す。

- `overdue`
- `search`

### `view`

main-panel 内の表示モードを表す。

- `timeline`
- `list`

`timeline` / `list` は `section` ではなく `view` として扱う。

### `part`

実際にフォーカスや操作が当たる単位を表す。

- `card`
- `checkbox`
- `title`
- `editor`

### `state`

shortcut を見せるかどうかを左右する状態。

- `active`
- `editing`
- `readonly`
- `dragging`
- `menu-open`

MVP では主に `active` と `readonly` を使う。

## 代表例

### Sidebar の overdue card

- `scope=board`
- `region=sidebar`
- `section=overdue`
- `part=card`

### Sidebar の search input / search result

- 入力欄: `scope=board, region=sidebar, section=search`
- 検索カード: `scope=board, region=sidebar, section=search, part=card`

### Main panel の timeline card

- `scope=board`
- `region=main-panel`
- `view=timeline`
- `part=card`

時間付き Timeline event と A/B bucket card は、shortcut 上は同じ `view=timeline, part=card` を共有する。両者で shortcut セットを分ける必要が出た場合だけ、別軸の追加を検討する。

### Main panel の list card

- `scope=board`
- `region=main-panel`
- `view=list`
- `part=card`

### CardModal の title / body

- title: `scope=modal, region=modal-title, part=title`
- body: `scope=modal, region=modal-body, part=editor`

### Shortcuts modal

- `scope=modal`
- `region=shortcuts-modal`

現時点では `Esc` で閉じる shortcut のみを持つ。

## Resolver Rules

- `focusGroup` 単独では descriptor を確定しない
- `focusGroup=timeline` は `region=main-panel, view=timeline` の候補になる
- `focusGroup=bucket` は曖昧なので、そのままでは解決しない

`focusGroup=bucket` を確定するときは、次の UI 情報を使う。

- sidebar なら `expandedSectionKey`
- search 結果なら result `kind`
- main-panel なら `activeView`
- card open source など、呼び出し元が既に知っている文脈

## Modal Boundary Rules

CardModal の title/body 境界は矢印キーによる focus-only とする。

- title -> body: `ArrowDown`
- title -> body start: `ArrowRight`
- body -> title: `ArrowUp`
- body -> title end: `ArrowLeft`
- title の `Enter` は境界移動や構造変換を行わない

詳細は [keyboard-navigation.md](./keyboard-navigation.md) を参照。

## Registry Notes

- registry は shortcut 表示定義の SSOT
- `ShortcutsModal` は registry をそのまま表で表示する
- status bar は同じ registry を current context でフィルタして使う
- shortcut は「非表示」と「表示するが disabled」を分けて扱う
  - 文脈が違う shortcut は出さない
  - 文脈は合うが実行不能な shortcut は disabled 表示で残す
- Tiptap 本文では runtime capability を使って `undo` / `redo` / `Tab` / `Shift+Tab` の enabled 状態を判定する
- 旧 `timeline-card` / `cardmodal-title` / `cardmodal-editor` は移行用 alias として残してよいが、新規追加は descriptor ベースで行う
