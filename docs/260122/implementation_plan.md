# カード表示リファイン計画（Timeline & A/Bリスト）

目的: 時刻ラベルの破綻を防ぎつつ、カードの本文プレビューをシンプルなCSSで実装する。  
前提: `TimelineCard` は `timePlacement="out-top"` で時刻がカード外に出る。root への `overflow-hidden` は時刻を潰すため禁止。

---

## 方針サマリ
- **overflow-hidden は内側だけ**: rootではなく「本文ラッパー」に付与し、`out-top` の時刻を保護する。`min-h-0` も同じ箇所に付与。
- **本文は line-clamp 前提（Plan A）**: 既存 `excerpt` は改行を潰して1本化しているため、行ベース truncate はせず `line-clamp` で高さ制御する。
- **A/B は独立スクロールにする**: 外枠ではスクロールさせず、A枠・B枠それぞれのリストを `overflow-y-auto` に。これでカードは内容に応じて可変高にでき、スクロールは各枠で吸収。

---

## 実装ステップ

### 1) `TimelineCard` 内部のレイアウト調整
- **Props 拡張**: `note?: string` を追加し、子要素の上下配置は既存 `childrenPosition` を流用。
- **構造**: 時刻ラベルを含む親 `.relative flex flex-1 flex-col` はそのまま。  
  その内側の本文コンテナに `className="flex flex-1 flex-col gap-1 min-w-0 overflow-hidden min-h-0"` を付与。  
  これで高さクリップしつつ `out-top` は非クリップ。
- **本文表示**: タイトル直下に `note` を追加。共通クラス:
  - `text-[10px] text-slate-600 leading-tight`
  - Tailwind `line-clamp-X` を受け取れるよう `noteClampClass` (デフォルトなし) を props で渡せるようにする。
  - `whitespace-normal break-words` にして折り返し許容、`line-clamp` で行数制御。
- **タイトル**: 既存 `truncate` 維持。

### 2) A/B レイアウト分離 (`TimelineDayBucket`)
- 外枠（全体コンテナ）: 高さ計算は現状維持 (`calc(100vh - ...)`)、`overflow-y-auto` → **`overflow-hidden`** に変更（外側スクロール禁止）。
- A枠/B枠のセクション: **両方 `flex-1 min-h-0`** に統一。既存 `min-h-[240px]` は外すか大幅に弱める（半分レイアウトと相性が悪いため）。
- セクション内部: ヘッダは固定のまま、リスト部に **`flex-1 min-h-0 overflow-y-auto`** を付与して独立スクロールさせる（`pt` 余白は不要。A/B は時間表示しない想定で `timePlacement=\"inline\"`, `timeText` も渡さない）。
- D&Dの自動スクロールがある場合: **A用/B用のスクロール要素をそれぞれ `registerScrollContainer` で登録**するように変更（従来1枠前提なら分岐追加）。

### 3) A/B リストのカード (`TimelineBucketCard`)
- `item.excerpt` を `note` に渡す。
- `TimelineCard` に `noteClampClass` を渡す。初期値は **2行**（例: `line-clamp-2`）。将来の拡張に備え、`noteMaxLines` などの定数/propsで列挙切替できる形にしておく（Tailwindのpurge対策でクラスは列挙）。
- 既存 `paddingClass="py-1"` は維持。`className="min-h-0"` も維持。

### 4) Timeline (`TimelineEventItem`)
- `event.excerpt` を `note` に渡す。
- clamp はかけず、カード高さ依存でクリップされるよう `noteClampClass` なし。
- `TimelineCard` に追加した内側 `overflow-hidden min-h-0` により、短時間イベントでも本文がはみ出さず、時刻（out-top）は可視を維持。

### 5) 型・呼び出し更新
- `TimelineCardProps` へ `note?: string; noteClampClass?: string;`
- 呼び出し元の型 (`TimelineEvent`, `TimelineBucketItem`) は `excerpt` 既存なので追加不要。

### 6) 確認観点
- **時刻が消えない**: `timePlacement="out-top"` でカード root に `overflow-hidden` が無いこと、時刻が欠けないこと。
- **A/B 分離スクロール**: 外枠がスクロールしない／AとBそれぞれのリストだけがスクロールする。上下領域が常にほぼ1:1で割り当てられている。リスト先頭の `out-top` ラベルがスクロール枠で欠けない（`pt-4` で逃げている）。
- **A/B カード高さ**: 本文量に応じて 1〜2行で可変になり、`line-clamp-2` が効いている。
- **Timeline 表示**: 15〜30分カードで本文が1〜2行程度、長時間カードで複数行表示されること。はみ出しクリップは正常。
- **D&D**: A/B どちらでもドラッグ時のオートスクロールが効く（登録コンテナが2系統に分かれている）。
- **インライン編集**: タイトル編集モードでも note がずれないこと。
- **line-clamp 動作**: Tailwind の line-clamp プラグインが有効で、`line-clamp-2` が実際に効いている（効かない場合はプラグイン設定を確認）。

---

## 実装手順チェックリスト
1. `TimelineCard.tsx` に `note`/`noteClampClass` を追加し、本文コンテナへ `overflow-hidden min-h-0` を付与。
2. `TimelineDayBucket.tsx` を A/B 独立スクロール構造へ変更（外枠 overflow-hidden、A/B セクション flex-1 min-h-0、リスト flex-1 min-h-0 overflow-y-auto、scroll container 登録を2枠対応に）。A/B は `timePlacement=\"inline\"` 固定で `timeText` は渡さない。
3. 本文UIをタイトル直下に追加 (`line-clamp` 適用可)。
4. `TimelineBucketCard.tsx` で `note={item.excerpt}` を渡し、`noteClampClass` は列挙で初期2行 (`line-clamp-2`) を指定できるようにする。
5. `TimelineEventItem.tsx` で `note={event.excerpt}` を指定（clampなし）。
6. 手動確認（A/B と Timeline 両方）で時刻欠け、スクロール挙動、カード高さ、D&D をチェック。

---

## 任意の追加検討（実装しないがメモ）
- `excerpt` を改行保持で生成し直す案（行単位 truncate を復活させたい場合）。
