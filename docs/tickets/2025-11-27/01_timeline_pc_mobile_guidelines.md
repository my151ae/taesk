# 01. TimelineBoard PC / Mobile 分離実装ガイド

対象リポジトリ: `my151ae/taesk`（想定）

## 0. このドキュメントの目的

本ドキュメントは、タイムライン機能を以下の方針で実装するためのガイドラインです。

- PC とモバイルで **UI コンポーネントを分離**する
- モバイル専用で **framer-motion によるスワイプジェスチャー**を導入する
- PC では従来通り **dnd-kit によるドラッグ操作**を使う
- 両者がイベントレベルで競合しないようにする

現在の基準コミット:

- `f8a18bf`  
  - `"docs: Add design guidelines and update existing documentation."`  
  - この時点では **スワイプ機能は未導入**、PC のドラッグは正常に動作している

過去の試行:

- `b25655b`  
  - `"Introduce a mobile-responsive timeline view with swipe gestures using framer-motion"`  
  - framer-motion のスワイプジェスチャーが **PC の dnd-kit ドラッグと競合**したためロールバック済み

本ガイドラインは、`f8a18bf` 以降の実装方針を定めなおすためのものです。

---

## 1. 全体方針

### 1-1. コンポーネント分割の考え方

- タイムラインの UI は **デバイスごとにコンポーネントを分ける**
  - PC 用: `DesktopTimelineView`
  - モバイル用: `MobileTimelineView`（スワイプ対応）
- データ取得・ビジネスロジックは **`TimelineBoardPage` に集約**し、  
  各ビューには同じ props（同じデータ構造）を渡す

### 1-2. 表示切り替えの方法

- Next.js + SSR を考慮し、**画面幅による表示切り替えは Tailwind CSS のレスポンシブクラスで行う**
  - JS の `window.innerWidth` や UA ベースの「デバイス検出」は基本的に使わない
- 例:
  - モバイル専用: `className="block md:hidden"`
  - PC 専用: `className="hidden md:block"`

これにより、

- PC 側で **モバイル用コンポーネント（スワイプ）はそもそもレンダリングされない**
- モバイル側で **PC 用コンポーネント（ドラッグ）はレンダリングされない**

ため、framer-motion と dnd-kit のイベントが競合しない設計になります。

---

## 2. ファイル構成（想定）

既存の構成に合わせて、以下のような配置を推奨します。

```text
src/
  app/
    timeline/
      page.tsx                 // TimelineBoardPage（ルーティングエントリ）
  features/
    timeline/
      components/
        DesktopTimelineView.tsx
        MobileTimelineView.tsx
        AbList.tsx             // A/B リスト本体（共通化できる部分）
```

※ 実際のディレクトリ構成に合わせてパスは調整してください。

---

## 3. `TimelineBoardPage` の役割と実装方針

### 3-1. 役割

- データ取得（API コール / サーバーコンポーネントなど）
- タイムライン表示に必要な **共通ロジック** の集約
- **PC / モバイル用コンポーネントへの props 渡し**
- Tailwind による **レスポンシブ出し分け**

### 3-2. 実装イメージ

```tsx
// src/app/timeline/page.tsx（例）

import { DesktopTimelineView } from "@/features/timeline/components/DesktopTimelineView";
import { MobileTimelineView } from "@/features/timeline/components/MobileTimelineView";

export default async function TimelineBoardPage() {
  // 1. データ取得
  const timelineData = await fetchTimelineData(); // 実際の取得処理に置き換え

  // 2. ビジネスロジック・整形など
  const viewModel = buildTimelineViewModel(timelineData);

  // 3. PC / Mobile 出し分け
  return (
    <>
      {/* Mobile: スワイプ付きタイムライン */}
      <div className="block md:hidden">
        <MobileTimelineView viewModel={viewModel} />
      </div>

      {/* Desktop: dnd-kit によるドラッグタイムライン */}
      <div className="hidden md:block">
        <DesktopTimelineView viewModel={viewModel} />
      </div>
    </>
  );
}
```

---

## 4. `MobileTimelineView`（スワイプ実装）

### 4-1. 方針

- framer-motion を使用し、**Google カレンダーのモバイル UI に近いスワイプ操作**を提供する
  - 横方向スワイプで日付 / 期間を切り替え
  - スワイプ中のドラッグアニメーション、スナップ動作を実装
- このコンポーネントは **モバイル専用** とし、PC ではレンダリングしない

### 4-2. 実装のポイント

- `framer-motion` の `motion.div` + `drag="x"` を利用
- スワイプ判定は **閾値（距離・速度）**を設けて、隣のスロットにスナップさせる
- dnd-kit とのイベント競合は、  
  「そもそも同じ DOM に dnd-kit を載せない」ことで避ける（PC と別コンポーネントにしたため）

```tsx
// src/features/timeline/components/MobileTimelineView.tsx（イメージ）

import { motion, PanInfo } from "framer-motion";

type Props = {
  viewModel: TimelineViewModel;
};

export const MobileTimelineView: React.FC<Props> = ({ viewModel }) => {
  // 現在表示中のインデックス管理など
  // const [index, setIndex] = useState(0);

  const handleDragEnd = (_e: PointerEvent, info: PanInfo) => {
    // info.offset.x や info.velocity.x を見て
    // 前後のスロットに移動するかどうかを判定
  };

  return (
    <motion.div
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      onDragEnd={handleDragEnd}
    >
      {/* index に応じて viewModel を表示 */}
    </motion.div>
  );
};
```

詳細ロジックは Cursor / ChatGPT に任せる際、  
本ガイドラインの「禁止事項 / 制約」をプロンプトで伝えてください（後述）。

---

## 5. `DesktopTimelineView`（ドラッグ実装）

### 5-1. 方針

- 既存の PC 向けタイムライン実装を **`DesktopTimelineView` コンポーネントとして切り出す**
- `TimelineBoardPage` はデータ取得とビュー切り替えに専念させる

### 5-2. ポイント

- dnd-kit によるドラッグ＆ドロップは従来通りだが、  
  **framer-motion を混在させない**（Desktop 側には入れない）
- A/B リストの UI は、このコンポーネントか、共通コンポーネント (`AbList`) に委譲

---

## 6. A/B リストのレスポンシブ対応

### 6-1. 方針

- **モバイルは横幅いっぱい（`w-full`）**
- **PC はカラムレイアウトに合わせて幅を制御**
  - 例: 2 カラムなら `md:w-1/2`
- コンポーネントとして共通化できる部分は、PC/Mobile 両方で使い回す

### 6-2. クラス指定例

```tsx
export const AbList: React.FC<Props> = ({ items }) => {
  return (
    <div className="w-full md:w-1/2 lg:w-1/3">
      {/* A/B 項目の表示 */}
    </div>
  );
};
```

- モバイル: 1 カラムで縦に積む
- PC: カラム数に応じて `md:w-1/2`, `lg:w-1/3` などを設定

---

## 7. AI に実装を頼むときのプロンプト方針

リポジトリで AI（ChatGPT / Cursor / GitHub Copilot）にコード生成を頼むときは、  
以下の方針を必ず伝える。

### 7-1. 必須の制約

- **PC とモバイルでコンポーネントを分ける**
  - `TimelineBoardPage` で `DesktopTimelineView` / `MobileTimelineView` を Tailwind で切り替える
- **Next.js + SSR なので `window.innerWidth` などで画面幅判定しない**
  - レスポンシブは必ず **Tailwind のクラスで制御**
- **PC 側では framer-motion を使わない**
  - スワイプは `MobileTimelineView` のみに閉じ込める

### 7-2. プロンプト例

> 「このリポジトリでは、TimelineBoardPage で PC / Mobile のビューを  
> `DesktopTimelineView` / `MobileTimelineView` に分けて表示しています。  
>  
> - モバイル（`md` 未満）は `MobileTimelineView` を表示し、framer-motion で横方向スワイプができるタイムライン UI を実装してください。  
> - PC（`md` 以上）は `DesktopTimelineView` を表示し、既存の dnd-kit によるドラッグ操作を使います。  
>  
> Next.js の SSR とハイドレーションエラーを避けるため、  
> `window.innerWidth` や UA を使ったデバイス判定は行わず、  
> Tailwind CSS のレスポンシブクラス（`hidden` / `block` / `md:block` / `md:hidden` など）で出し分けてください。」

---

## 8. 今後の作業ステップ（運用）

1. `f8a18bf` から作業ブランチを切る  
   - 例: `feature/mobile-timeline-swipe`
2. `DesktopTimelineView` を切り出し
3. `MobileTimelineView` を新規作成し、最低限のモック UI を追加
4. `TimelineBoardPage` を本ガイドラインの形にリファクタリング
5. `MobileTimelineView` に framer-motion を追加し、スワイプを実装
6. A/B リストの幅をレスポンシブ対応に調整
7. PC / モバイルそれぞれで以下を確認
   - PC: ドラッグ動作が正常 / スワイプ関係のコードが動いていない
   - モバイル: スワイプが正常 / ドラッグとの競合がない
8. PR 作成時、本ドキュメントへのリンクを貼る
   - 例: `docs/01-timeline-pc-mobile-guidelines.md` を参照していることを説明

---

