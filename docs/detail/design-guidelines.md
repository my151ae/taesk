# Design & Responsive Guidelines

Timeline ボードの UI 実装で守るべき共通ルールをまとめます。SSR/ハイドレーションエラー回避を最優先に、PC/Mobile での責務分離とレイアウト仕様を明確化します。

## 1. レスポンシブ基本原則

- **画面幅判定は JS で行わず Tailwind のレスポンシブクラスで出し分ける**（`hidden`, `md:block`, `md:hidden` など）。
- Next.js App Router では `window.innerWidth` / UA 判定による条件レンダリングを禁止。SSR 時に要素ツリーがずれるとハイドレーションエラーの原因になる。
- ロジック・データ取得は共通化し、UI コンポーネントだけを CSS で切り替える。

### AI への依頼テンプレ
> PC とスマホで UI を分けたいです。ロジックやデータ取得は共通のまま、Tailwind の `hidden` / `block` / `md:block` / `md:hidden` で出し分けてください。Next.js (App Router) なので `window.innerWidth` などの JS 判定は使わず、CSS のレスポンシブ制御でお願いします。

## 2. Timeline の PC / Mobile 分離

- **PC:** `DesktopTimelineView` で dnd-kit によるドラッグ＆リサイズを提供。framer-motion を混在させない。
- **Mobile:** `MobileTimelineView` で framer-motion の横スワイプを実装。PC ではレンダリングしない（`block md:hidden`）。
- `TimelineBoardPage` で両ビューを Tailwind で切り替え、データ/ロジックは共通 props を渡すだけにする。

### スワイプ vs ドラッグの競合回避
- コンポーネントを分離し、DOM を共有しない。PC に framer-motion を入れない。Mobile に dnd-kit を入れない。
- オーバーレイ構造（Timeline 上に A/B を重ねる）でも、PC/Mobile のイベントは別コンポーネントに閉じ込める。

## 3. レイアウト仕様（PC）

- 縦スクロール: 24h × 40px (= `TIMELINE_HEIGHT`) を丸ごと 1 つのスクロールコンテナで扱う。右端に標準スクロールバーが出る構造を維持。
- A/B リスト: Timeline の左端から A/B 左端までがタイムライン描画域。A/B はタイムライン上にオーバーレイで重ねる（今後もこの前提を維持）。
- 1 日あたりのタイムライン幅は A/B リスト分を確保し、重なっても実質的に A/B 左端までで止まるよう半幅に収める。
- ヘッダー: 軸 + 日ラベルの 2 カラム構成を保持。スクロールエリアとヘッダーの幅を一致させ、スクロールバー分の余白を確保する。

## 4. レイアウト仕様（Mobile）

- framer-motion の横スワイプで日送り。スワイプ閾値は距離・速度で判定し、スナップさせる。
- タイムラインは 1 日単位で表示し、A/B は同日分だけ右側に配置（幅 55/45% など、画面全幅を使う）。
- dnd-kit は入れない。タップとチェックボックスで操作するシンプルな UI にする。

## 5. 禁止・注意事項

- `window.innerWidth` / `matchMedia` / UA 判定での条件レンダリング禁止（SSR ずれ防止）。
- PC 側に framer-motion を入れない。Mobile 側に dnd-kit を入れない。
- レイアウトを大きく組み替える場合は、ヘッダーのカラム幅とスクロール領域の高さ (`TIMELINE_HEIGHT`) が一致するかを確認する。

## 6. 参考プロンプト（Timeline 用）
> TimelineBoardPage で PC/Mobile のビューを分けています。
> - モバイル（md 未満）は MobileTimelineView を表示し、framer-motion で横方向スワイプができる UI にしてください。
> - PC（md 以上）は DesktopTimelineView を表示し、既存の dnd-kit によるドラッグ＆リサイズを使います。
> SSR でのハイドレーションエラーを避けるため、`window.innerWidth` や UA 判定は使わず、Tailwind の `hidden` / `md:block` などで出し分けてください。

## 7. オーバーレイ構造を維持する理由

- タイムラインと A/B を同一座標系で扱えるため、D&D の衝突判定やスクロール同期がシンプル。
- 縦スクロールを 1 つにまとめ、ヘッダーとの幅合わせを保つ。DOM 量や描画負荷はオーバーレイ有無で大きく変わらない。

## 8. よくある修正ポイント

- 画面幅で条件レンダリングしている場合は Tailwind の出し分けに差し替える。
- スクロールが途中で切れる場合は、内側グリッドの高さが `TIMELINE_HEIGHT` を満たしているか、外側の `overflow-y-auto` が残っているか確認。
- A/B 列の幅が重なる場合は、タイムライン列を半幅（または A/B 分を差し引いた幅）に縮める。

