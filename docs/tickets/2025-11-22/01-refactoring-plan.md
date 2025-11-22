# タイムライン機能のリファクタリング計画

## 目的
現在約2000行ある `TimelineBoardPage.tsx` を、機能（レイアウトやドラッグ＆ドロップ）を壊すことなく、安全に小さなコンポーネントやユーティリティファイルに分割し、管理しやすくする。

## 安全に進めるための戦略
**「一度にすべてを変えない」** ことが鉄則です。以下のルールを守ります。
1. **小さなステップ**: 1つの作業ごとに、必ず動作確認を行う。
2. **ロジックは変えない**: コードの場所を移動するだけで、中身の処理（ロジック）は書き換えない。
3. **こまめなコミット**: 1ステップ完了するごとに git commit し、何かあってもすぐに戻せるようにする。

## 手順

### 1. ユーティリティと型の切り出し (リスク: 低)
**ゴール**: ヘルパー関数と型定義をメインファイルから移動させる。ロジックには一切触れないため、最も安全なステップ。
**作成ファイル**: `app/(board)/_utils/timeline-helpers.ts`
**移動するもの**:
- 型定義: `TimelineDay`, `TimelineEvent`, `TimelineBucketItem`, `TimelineResponse`, `UserProfile` など
- ヘルパー関数: `minuteToPixels`, `getMinutesFromTime`, `getIsoDateJst` など
- 定数: `HOUR_HEIGHT`, `TIMELINE_HEIGHT` など

### 2. ヘッダー部分の切り出し (リスク: 低)
**ゴール**: フィルターやユーザーメニューなどのヘッダー部分を別コンポーネントにする。メインのタイムライン処理とは独立しているため安全。
**作成ファイル**: `app/(board)/_components/timeline/TimelineHeader.tsx`
**必要なProps**:
- `board`, `modalBoards`
- 各種表示切り替えステート (`showBoardMenu` など)
- フィルター関連のステート (`searchQuery` など)

### 3. タイムライングリッドの切り出し (リスク: 中)
**ゴール**: 時間軸やイベント表示のメイン部分を別コンポーネントにする。ここが一番複雑なので慎重に行う。
**作成ファイル**: `app/(board)/_components/timeline/TimelineGrid.tsx`
**必要なProps**:
- `data` (イベントデータ)
- `viewportHeight` (高さ計算用)
- ドラッグ＆ドロップ関連のProps (`activeDrag`, `pointerPreview` など)
- **注意点**: `DndContext` (ドラッグ＆ドロップの親) は `TimelineBoardPage` に残し、中身だけを切り出すことで、ドラッグ機能への影響を最小限にする。

### 4. A/B バケットの切り出し (オプション)
**ゴール**: 画面左側の「Today/Tomorrow」バケットを別コンポーネントにする。
**作成ファイル**: `app/(board)/_components/timeline/TimelineBuckets.tsx`

## 検証項目
各ステップの完了ごとに、以下の確認を必ず行う。
- [ ] `npm run build` で型エラーが出ないこと
- [ ] ページが正常に表示されること
- [ ] ドラッグ＆ドロップが今まで通り動くこと
- [ ] フィルター機能が動くこと
