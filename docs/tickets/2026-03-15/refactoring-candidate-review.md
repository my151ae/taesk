# リファクタリング候補の洗い出し

## Summary
現状の taesk は Timeline 中心で機能拡張が進んでおり、機能自体は hook 分割や helper 分割である程度整理されている。一方で、画面コンテナ層、D&D 制御、CardModal、Tiptap、Google Calendar 連携、E2E の一部がまだ大きく、責務境界が曖昧な箇所が残っている。

今回の観点は以下:
- ファイルサイズが大きく、単一責務を超えている箇所
- desktop / mobile で似たロジックが分散している箇所
- UI と状態管理、ドメイン変換、外部 API 連携が混ざっている箇所
- 将来の機能追加時に回帰や認知負荷が増えやすい箇所

今回はコード読解ベースの整理であり、実動確認やテスト再実行は未実施。

## 対象として確認した主なファイル
- `app/(board)/_components/timeline/TimelineBoardPage.tsx`
- `app/(board)/_components/timeline/DesktopTimelineView.tsx`
- `app/(board)/_components/timeline/MobileTimelineView.tsx`
- `app/(board)/_hooks/useTimelineDragAndDrop.ts`
- `app/components/CardModal.tsx`
- `app/(board)/_components/tiptap/TiptapEditor.tsx`
- `lib/googleCalendarServer.ts`
- `e2e/timeline.spec.ts`

## 優先度付き候補

### 1. TimelineBoardPage のオーケストレーション分離
対象:
- `app/(board)/_components/timeline/TimelineBoardPage.tsx`

現状:
- URL state、view mode、board 初期化、timeline fetch、modal state、viewport、filter、navigation、calendar、D&D、context menu、dialog 表示までを 1 つのコンポーネントで束ねている。
- hook 分割は進んでいるが、ページ自体が依然として巨大な composition root になっている。
- `initialBoard` から導出される初期設定、URL との同期、board preference の永続化などが複数箇所に散っている。

なぜつらいか:
- 新しい Timeline 機能を足すたびに `TimelineBoardPage` に import と state wiring が増える。
- ある state 変更が URL、fetch、scroll、modal のどこへ波及するかが追いづらい。
- 「どの hook が view model を作り、どの hook が副作用を持つか」が読み手にとって明確ではない。

リファクタリング方向:
- `TimelineBoardPage` は「ルーティングされた画面コンテナ」に寄せ、画面用 view model を 1 段まとめる。
- 例えば `useTimelineBoardScreen()` のような hook に、以下を集約する。
  - board initialization
  - URL / view mode / range state
  - timeline fetch / refresh
  - modal open/close
  - context menu state
- JSX 側には `screen.headerProps`, `screen.timelineProps`, `screen.listProps`, `screen.dialogProps` のようなまとまりで渡す。

期待効果:
- 画面全体の依存関係が見通しやすくなる。
- Timeline と List の表示切り替えで必要な state 群をまとめて管理できる。
- 今後、Timeline 画面をテストしやすい presenter/view model 形に近づけられる。

注意点:
- 既存 hook 群をまとめ直す際に、責務を重複させないこと。
- 「hook を増やしただけで実質複雑性は変わらない」状態を避けるため、state の所有者を整理する必要がある。

### 2. Desktop / Mobile TimelineView の共通化
対象:
- `app/(board)/_components/timeline/DesktopTimelineView.tsx`
- `app/(board)/_components/timeline/MobileTimelineView.tsx`

現状:
- どちらも timeline event と external calendar event を同時に描画している。
- 時間軸、重なりレイアウト、pointer preview、drag overlay、active stack item といった概念が両方にある。
- それぞれの UI は違うが、表示モデルや振る舞いの一部がかなり重複している。

なぜつらいか:
- Timeline card の表示ルールを変えると desktop/mobile 両方を追う必要がある。
- Google Calendar の重なりロジックや表示ルールが片方だけ修正されるリスクがある。
- 複雑な表示バグが viewport 固有なのか、共通ロジック由来なのか切り分けにくい。

リファクタリング方向:
- 共通の「timeline render model」を作る。
- 具体的には以下を view 共通層へ寄せる。
  - 日ごとの render item 正規化
  - stacked layout 計算
  - overlay 用 card data 構築
  - indicator / pointer preview / active item の導出
- desktop / mobile は「どのレイアウトで見せるか」に集中させる。

分け方の例:
- `useTimelineRenderModel()`
- `timeline-render-model.ts`
- `TimelineEventLayer`
- `TimelineCalendarLayer`
- `TimelinePreviewLayer`

期待効果:
- 表示差分とロジック差分を分離できる。
- 新しいカード表示要素を追加するときの変更範囲が狭くなる。
- desktop/mobile 間の表示不整合を減らせる。

注意点:
- desktop と mobile は UI の最終形が違うため、無理な完全共通化は逆効果。
- 「表示データの作成」だけ共通化し、最終レンダリングは分けたままにするのが安全。

### 3. useTimelineDragAndDrop の state machine 化
対象:
- `app/(board)/_hooks/useTimelineDragAndDrop.ts`

現状:
- `activeDrag`, `pointerPreview`, `activeResize`, `bucketIndicator`, `isOverABList` など複数 state が同居している。
- helper 分割はされているが、hook 本体に drag lifecycle の分岐がまだ多い。
- event / bucket / overdue で開始条件や drop 条件が分岐し、ポインタ追跡や auto scroll も絡む。

なぜつらいか:
- D&D 系は挙動が壊れたときの再現条件が複雑で、局所修正が別ケースを壊しやすい。
- 「いま drag 中なのか resize 中なのか」「どの preview が正なのか」が state 変数を横断しないとわからない。
- 将来的に keyboard drag や additional drop target を入れるとさらに分岐が増える。

リファクタリング方向:
- drag session を 1 つの明示的なモデルに寄せる。
- `useReducer` か、小さめの state machine を使って以下の状態遷移を定義する。
  - idle
  - dragging-event
  - dragging-bucket
  - dragging-overdue
  - resizing-top
  - resizing-bottom
- pointer preview や bucket indicator は、その state から導出可能な形へ寄せる。

期待効果:
- ハンドラ内の if/else を減らせる。
- テスト時に「どの state で何が起きるべきか」を言語化しやすい。
- drag lifecycle の副作用を集約できる。

注意点:
- 一気に全面 rewrite すると危険なので、まず internal state の整理から始めるのがよい。
- `createPersistPlacement` など既存 helper の再利用前提で段階的に進める。

### 4. CardModal の責務整理
対象:
- `app/components/CardModal.tsx`

現状:
- draft 管理、autosave、history preview、Google Calendar sync、sidebar resize、member picker、focus trap、close 制御などを持つ。
- 専用 hook への切り出しは進んでいるが、コンポーネント本体に still 複数の制御責務が残る。
- `TiptapEditor` と card body sync の扱いも CardModal 側でかなり気を使っている。

なぜつらいか:
- modal の見た目変更と保存ロジック変更が同じファイルに載る。
- close 時や loading 後の同期条件が複雑で、編集ロストを避けるための条件分岐が増えやすい。
- sidebar/history/google sync など周辺機能を追加すると modal shell がさらに膨らむ。

リファクタリング方向:
- `CardModalShell` と `CardModalWorkflow` を分離する。
- UI セクション単位に整理する。
  - header section
  - body editor section
  - metadata/sidebar section
  - history section
- autosave と card sync の制御は hook 側に寄せ、UI 本体では「何を表示するか」に集中させる。

期待効果:
- 編集系の不具合調査時に、UI と保存制御を切り分けて見られる。
- サイドバーや履歴タブだけを触る変更の影響範囲が狭くなる。
- CardModal 自体の再利用性は不要でも、構造上の可読性が上がる。

注意点:
- Tiptap が非制御寄りなので、同期タイミングを崩すと本文初期化や autosave が壊れやすい。
- ここは見た目より state ownership を先に整理するべき。

### 5. TiptapEditor のコアと拡張の分離
対象:
- `app/(board)/_components/tiptap/TiptapEditor.tsx`
- `lib/tiptap.ts`

現状:
- editor 初期化、block action menu、clipboard paste、画像変換、upload error 処理、focus bridge などが一体化している。
- カスタム編集体験が増えるほど、このファイルに機能が積まれる構造になっている。

なぜつらいか:
- Tiptap 周辺は DOM イベント、editor transaction、JSONContent 変換が絡み、1 箇所で読むと負荷が高い。
- block action と image paste は独立した concern なのに同居している。
- エディタ挙動の変更が画像処理や keyboard navigation に思わぬ影響を出しやすい。

リファクタリング方向:
- editor core を薄くして、周辺機能を plugin-like に分ける。
- 分離候補:
  - block action UI / command
  - image paste / upload handling
  - focus bridge / title navigation
  - markdown import/export helper
- React component と ProseMirror command 群を分けるだけでも読みやすさが大きく改善する。

期待効果:
- Tiptap 固有の不具合を局所的に追いやすい。
- block action や画像関連だけの修正がしやすい。
- editor 機能追加時に「どこへ書くか」が明確になる。

注意点:
- editor transaction 周りは小さく切りすぎても追いづらい。
- まずは UI と command/helper の分離から始めるのが安全。

### 6. Google Calendar サーバ層の境界整理
対象:
- `lib/googleCalendarServer.ts`
- `lib/google-calendar/*`

現状:
- facade 的な 1 ファイルに normalize、API client 取得、watch export、DB persist、sync orchestration の窓口が混在している。
- 実際には `lib/google-calendar/` 配下に分割が進んでいるが、まだ入口ファイル側の責務が厚い。

なぜつらいか:
- 「Google API の変換ロジック」と「Taesk に適用する同期ロジック」が同じ層に見える。
- 障害時に、OAuth なのか watch なのか mapping なのか persistence なのかを切り分けにくい。
- テストを書く場合も、依存境界が広いとモック対象が増える。

リファクタリング方向:
- 入口を facade に徹しさせる。
- 以下の境界を意識して役割をさらに分ける。
  - Google event mapper
  - event repository
  - sync coordinator
  - watch coordinator
- `googleCalendarServer.ts` は再 export と高水準 orchestrator のみに寄せる。

期待効果:
- 障害解析と責務理解がしやすい。
- 仕様変更時に affected layer を特定しやすい。
- Google Calendar 周りの unit test を増やしやすい。

注意点:
- すでに部分分割されているため、大規模整理の優先度は Timeline 本体より一段下。
- Timeline/Modal ほど即効性はないが、保守性には効く。

### 7. E2E とくに timeline.spec.ts の分割
対象:
- `e2e/timeline.spec.ts`

現状:
- fixture 作成、Supabase admin 操作、clipboard helper、Tiptap helper、assertion、個別シナリオが 1 ファイルに集中している。
- 行数が極端に大きく、変更時に読む範囲が広い。

なぜつらいか:
- テスト失敗時に「fixture 壊れ」「helper 壊れ」「本体壊れ」のどこが原因か切り分けにくい。
- editor 周りや timeline 周りの helper が spec に閉じていて再利用されない。
- テストコードの重さが、機能コードの変更速度を下げる可能性がある。

リファクタリング方向:
- 次のような層に分ける。
  - `e2e/helpers/timeline-fixtures.ts`
  - `e2e/helpers/timeline-editor.ts`
  - `e2e/helpers/timeline-assertions.ts`
  - `e2e/timeline/*.spec.ts` のシナリオ分割
- まず helper 抽出だけでも十分効果がある。

期待効果:
- テストメンテの心理的コストが下がる。
- editor helper や fixture が他 spec にも流用しやすくなる。
- 失敗時に壊れたレイヤーを見つけやすくなる。

注意点:
- Playwright の共通 helper 化で過抽象化すると、逆に読みづらくなる。
- 操作 helper は薄く、assertion helper はドメイン語彙に寄せるのがよい。

## 優先度の考え方
優先度は「影響範囲の広さ」と「機能追加時の摩擦の大きさ」で整理する。

高:
- TimelineBoardPage
- Desktop / Mobile TimelineView 共通化
- useTimelineDragAndDrop

中:
- CardModal
- TiptapEditor
- e2e/timeline.spec.ts

中〜低:
- Google Calendar サーバ層

理由:
- Timeline は運用 UI の中心で、ここが複雑だと今後の変更コストが直接高くなる。
- D&D は挙動不良の調査コストが高く、早めに構造を整える価値がある。
- CardModal / Tiptap は複雑だが、Timeline 画面本体ほど全体波及は大きくない。
- Google Calendar は重要だが、すでに分割の土台があるため相対優先度は下げられる。

## 着手順の提案
### Phase 1
- `TimelineBoardPage` の screen/view-model 化
- `DesktopTimelineView` / `MobileTimelineView` で render model 共通化

目的:
- 画面全体の見通しを改善し、今後の修正時に触る範囲を減らす。

### Phase 2
- `useTimelineDragAndDrop` の internal state 整理
- `CardModal` の modal shell と workflow 分離

目的:
- 回帰しやすいインタラクション層を安定化する。

### Phase 3
- `TiptapEditor` の plugin / helper 分割
- `e2e/timeline.spec.ts` の helper / spec 分割
- 必要に応じて `googleCalendarServer.ts` の facade 化強化

目的:
- 周辺機能とテストの保守コストを下げる。

## 小さく始める場合の最初の一手
最も安全に始めるなら、以下の順がよい。

1. `TimelineBoardPage` の props 集約
- 既存 hook は維持したまま、view へ渡す props を grouped object 化する。

2. Timeline 共通 render model の抽出
- desktop/mobile 両方で使う event normalization と layout 計算を共通化する。

3. D&D state の集約
- `activeDrag` 系 state を 1 つの drag session オブジェクトへ寄せる。

この順なら、大規模 rewrite を避けつつ、保守性改善の効果を早く出しやすい。

## 候補ごとの詳細設計メモ

### A. TimelineBoardPage をどう薄くするか
現状の具体的な混線:
- `useTimelineBoardController` の結果を受けて URL / range / anchor を持つ。
- `useTimelineNavigation` で前後移動や day range 遷移を扱う。
- `useTimelineCalendar` で Google Calendar 側の state を持つ。
- `useTimelineCardActions` で card 操作系を抱える。
- `useTimelineScrollSync` で desktop/mobile/list 間のスクロール同期も扱う。
- 終盤では `useTimelineBoardViewModels` で view props を組み立てている。

つまり、すでに hook 分割はあるが、`TimelineBoardPage` はまだ以下の責務を横断している。
- state owner
- use case coordinator
- view prop assembler
- dialog/router integrator

ここで起きやすい問題:
- 新機能を 1 つ足すと、controller hook、action hook、view model hook、page JSX の複数箇所に同時変更が発生する。
- view model と source state の距離が遠く、どこで最終決定されるか追いづらい。
- 「page は composition root」というより、「中間層ロジックも握る root」になっている。

分割後の目標像:
```ts
function TimelineBoardPage({ initialBoard }: Props) {
  const screen = useTimelineBoardScreen({ initialBoard });
  return <TimelineBoardScreen {...screen} />;
}
```

`useTimelineBoardScreen` に含めたいもの:
- routing / URL state
- board initialization
- data fetching / refresh
- modal and dialog state
- context menu state
- view model composition

`TimelineBoardScreen` に残すもの:
- JSX のみ
- desktop/mobile/list/dialog の組み立て
- イベントハンドラの受け渡し

さらに進める場合:
- `useTimelineBoardScreen` の戻り値を `header`, `timeline`, `list`, `dialogs`, `modal`, `shortcuts` のように分ける。
- prop 名のフラット化を避け、オブジェクト単位で流す。

移行ステップ:
1. まず `TimelineBoardPage` の JSX に渡している props を logical group にまとめる。
2. その grouped object を返す `useTimelineBoardScreen` を作り、中身は page 側の既存コードを移すだけにする。
3. その後、screen hook 内で近い責務の state をさらに内包する。

完了条件:
- `TimelineBoardPage.tsx` 自体では `useXxx` の大量呼び出しが消え、画面の組み立てだけに見える。
- Timeline/List/Dialog への props が grouped object 化されている。
- 画面の新機能追加時に page 本体へ新しい state を増やさずに済む。

### B. Desktop / Mobile の共通 render model は何をまとめるべきか
現状の具体的な重複:
- 両 view とも時間軸の高さ計算を持つ。
- timeline event と external calendar event の両方を描画する。
- `normalizeTimelineItems` と `calculateStackedEventLayout` をベースに位置決めを行う。
- pointer preview や active stack item の概念が共通する。

重複の質:
- JSX が似ているというより、描画前の計算モデルが似ている。
- このタイプは UI コンポーネント統合ではなく、計算結果の共通化が正解になりやすい。

共通化したい出力の例:
```ts
type TimelineRenderDay = {
  day: TimelineDay;
  items: Array<{
    key: string;
    kind: "card" | "calendar";
    top: number;
    height: number;
    left: string;
    width: string;
    zIndex: number;
    presentationMode?: "full-width" | "stacked";
    data: TimelineEvent | ExternalCalendarEntry;
  }>;
  pointerPreview: {
    visible: boolean;
    top: number;
    height: number;
    label: string;
  } | null;
};
```

こうしておくと:
- desktop は grid/column 表示へ変換するだけ
- mobile は 1 カラム積み表示へ変換するだけ

view 固有に残すべきもの:
- スクロールレイアウト
- all-day row の出し方
- モバイルでのタップしやすさや情報圧縮
- desktop の zoom 操作

避けるべきこと:
- desktop と mobile を 1 コンポーネントに統合すること
- DnD の結線まで共通層へ押し込むこと

完了条件:
- 共通関数または hook が「render に必要な数値・表示種別」を返す。
- desktop/mobile 側で同じ layout 計算を別々に持たない。
- カード表示ルール変更時に、まず共通 render model を見る構造になる。

### C. D&D を reducer 化するときの見方
現状の具体的な signal:
- `handleDragStart`, `handleDragMove`, `handleDragEnd` が drag lifecycle の中心。
- resize 系は `handleResizeStart`, `handleResizeMove`, `handleResizeEnd` で別系統になっている。
- 一方で UI が使う state は `activeDrag`, `pointerPreview`, `activeResize`, `bucketIndicator`, `isOverABList` に分かれる。

これは実質的に、単一の「編集中インタラクション状態」が分散表現されている。

reducer に寄せたときのイメージ:
```ts
type InteractionState =
  | { mode: "idle" }
  | { mode: "dragging"; source: "event" | "bucket" | "overdue"; cardId: string; preview: ...; bucketIndicator: ... }
  | { mode: "resizing"; edge: "top" | "bottom"; cardId: string; startMinutes: number; duration: number };
```

この形の利点:
- UI 側が `if (state.mode === "dragging")` のように解釈できる。
- preview や indicator が「あるべきときにだけ存在する」。
- drag と resize の相互排他が型で表現できる。

段階的移行案:
1. まず `activeDrag + pointerPreview + bucketIndicator + isOverABList` を 1 つの `dragSession` に集約する。
2. その後 `activeResize` を `interactionState` へ統合する。
3. 最後に `handleDragStart/Move/End` 内の分岐を reducer action dispatch ベースへ寄せる。

テスト観点:
- event drag -> timeline drop
- bucket drag -> bucket reorder
- overdue drag -> timeline convert
- resize top / bottom
- cancel 時に preview と indicator が必ず消えること

完了条件:
- UI が複数の boolean/state を並べて drag 状態を解釈しなくて済む。
- cancel/end 後に残留 state が起きにくい。
- 新しい drop target を追加する際の変更箇所が reducer と persist helper 周辺に限定される。

### D. CardModal を section 単位で再編する案
現状の具体的な混線:
- draft は `useCardModalDraft`
- history は `useCardModalHistory`
- sidebar resize は `useCardModalResize`
- Google sync は `useCardModalGoogleSync`
- それでも modal 本体には focus trap、close 制御、autosave timer、loading 後同期、member dropdown 制御が残る

つまり hook 抽出はされているが、「モーダル全体のワークフロー制御」はまだコンポーネント本体にいる。

整理案:
```ts
CardModal
  CardModalShell
  CardModalHeaderSection
  CardModalBodySection
  CardModalSidebarSection
  CardModalHistorySection
```

hook の再配置候補:
- `useCardModalLifecycle`
  - open/close
  - focus trap
  - close confirmation
- `useCardModalAutoSave`
  - debounce
  - max wait
  - pending content flush
- `useCardModalMemberPicker`
  - dropdown open/close
  - filter
  - selection

この分割のメリット:
- 「見た目」と「保存制御」を別々に触れる。
- autosave 問題の調査で UI を読まずに済む。
- member picker の改修が modal 全体の理解を要求しなくなる。

移行時に注意する点:
- `TiptapEditor` が非制御寄りなので、card prop 変更時の reset と autosave flush の順序が重要。
- `requestCloseRef` まわりを壊すと escape / click outside / unsaved close が崩れる。

完了条件:
- `CardModal.tsx` は modal section の組み立て中心になる。
- autosave と close 制御のタイマー管理が独立 hook にいる。
- loading 後の card sync 条件が UI から切り離されている。

### E. TiptapEditor をどこで切るか
現状の具体的な機能塊:
- エラー文言整形
- clipboard 画像抽出
- HTML 内 data URL 画像抽出
- block action menu UI
- upload and insert
- focus bridge 登録
- title へのフォーカス要求
- signed URL 再適用

このファイルは「Tiptap の React component」であると同時に、
- image ingestion service
- block action controller
- keyboard navigation bridge
にもなっている。

安全な切り方:
1. pure helper を先に外へ出す
- clipboard image extraction
- upload response parsing
- block action item generation

2. editor command 群を分ける
- duplicate block
- insert above / below
- toggle details

3. React UI を分ける
- `BlockActionMenu`
- image upload state 表示

4. 最後に bridge 層を分ける
- body focus bridge
- title focus request bridge

特に先にやる価値があるもの:
- `extractImageFilesFromClipboard*`
- `parseErrorMessage`
- block action menu とその command 群

理由:
- pure function に近く、分離しても壊れにくい。
- テストしやすい。
- Tiptap 本体の読解量を減らせる。

完了条件:
- `TiptapEditor.tsx` を開いたときに、主に editor setup と event wiring だけが見える。
- clipboard/image 関連の helper が外へ出ている。
- block action の UI と command が editor 本体から見て明確に別責務になっている。

### F. Google Calendar サーバ層の実務的な整理案
現状の具体的な状態:
- `lib/google-calendar/` 配下への分割は進んでいる。
- しかし `lib/googleCalendarServer.ts` には normalize/persist/watch/export/facade が残る。
- そのため「このファイルは facade なのか実装本体なのか」がやや曖昧。

実務的には、ここは全面改修より「役割の明文化」が先。

やるとよいこと:
- `googleCalendarServer.ts` の責務をコメントではなく構造で制限する。
- mapper と repository をさらに外出しする。
- ファイル名で意図を出す。
  - `google-calendar/event-mapper.ts`
  - `google-calendar/event-repository.ts`
  - `google-calendar/sync-coordinator.ts`

ここでの狙い:
- 障害調査時に入口と実装層を迷わないこと
- onboarding 時にファイルの役割がすぐわかること

完了条件:
- `googleCalendarServer.ts` は facade / public entry に見える。
- normalize と DB 永続化の実装詳細が別ファイルで追える。

### G. E2E の分割をどう進めるか
現状の具体的な肥大化要因:
- Supabase fixture 作成
- auth state 解析
- clipboard paste helper
- image paste helper
- timeline 固有 assertion
- editor serialization helper
- 個別テストシナリオ

これは「spec が helper の置き場になっている」状態。

推奨する最小分割:
- `e2e/helpers/auth-state.ts`
- `e2e/helpers/timeline-fixtures.ts`
- `e2e/helpers/timeline-editor.ts`
- `e2e/helpers/timeline-assertions.ts`

さらに進めるなら:
- `e2e/timeline/rendering.spec.ts`
- `e2e/timeline/drag-and-drop.spec.ts`
- `e2e/timeline/card-modal.spec.ts`
- `e2e/timeline/calendar.spec.ts`

ただし注意点:
- spec 分割を先にやりすぎると fixture の共有が複雑化する。
- 先に helper 抽出、その後にシナリオ分割の順が安全。

完了条件:
- `timeline.spec.ts` を読まなくても fixture/helper の場所がわかる。
- 失敗時に「fixture 層か UI 層か」が判断しやすい。
- 同じ editor/timeline helper を他 spec に使い回せる。

## 変更コストとリスク感
ざっくりした感覚値としては以下。

### 高コスト・高効果
- TimelineBoardPage
- Desktop/Mobile 共通 render model
- useTimelineDragAndDrop

理由:
- 依存範囲が広い
- ただし改善すると以後の開発速度に効く

### 中コスト・中〜高効果
- CardModal
- TiptapEditor
- e2e/timeline.spec.ts

理由:
- 局所性はあるが、編集体験や回帰調査に効く

### 中コスト・中効果
- Google Calendar サーバ層

理由:
- 構造改善の価値は高いが、直近の UI 開発速度への寄与は相対的に小さい

## このドキュメントを次にどう使うか
次の一歩としては 2 通りある。

1. 実作業向けに落とす
- 候補 1 つを選び、タスク分解した実装 plan を別 md に切る

2. 先に評価用の基準を作る
- 「このファイルは責務過多とみなす条件」を決め、他ファイルも同じ観点で棚卸しする

実務的には、まず `TimelineBoardPage` を対象にした実装計画書を 1 本切るのが一番進めやすい。

## 補足観察
- `app/(board)` 配下にコンポーネントと hook が多く集まっており、Timeline 機能の集積点になっている。
- 大きなファイルが UI 本体、エディタ、D&D、通知/権限まわりに偏っており、Timeline 中心の成長痛が見える。
- hook 分割自体はかなり進んでいるため、「ゼロから分ける」より「所有責務を再定義する」段階に入っている。

## 結論
最優先で見るべきは Timeline 本体の composition 整理である。`TimelineBoardPage`、desktop/mobile view、D&D の 3 点を先に整えると、その後の CardModal、Tiptap、E2E の改善も進めやすくなる。

現状は「分割はされているが、全体としてはまだ Timeline 機能が密結合」という状態に見える。したがって、次のリファクタリングは細かい helper 追加よりも、画面全体の責務境界を一段引き直す方向が妥当。
