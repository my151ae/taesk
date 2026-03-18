# Timeline Refactor Ownership Map

このメモは 2026-03-18 時点の現コードを一次情報として整理した ownership map。
docs は補助資料として参照し、owner と consumer はコードから判定する。

## TimelineBoardPage

| area | owner | current consumer | move target | risk | regression test |
| --- | --- | --- | --- | --- | --- |
| URL state (`resolvedState`, `updateUrlForTimeline`, `updateUrlForList`, `setCard`) | `useTimelineUrlState` | `TimelineBoardPage`, `useCardModal`, `useTimelineScrollSync`, `useTimelineBoardController` | public contract は凍結し、page wiring のみ `useTimelineBoardScreen` へ移す | URL 契約を再抽象化すると list/timeline 切替が壊れる | timeline URL 直開き、list window 切替、card query open |
| grouped props / render wiring | `TimelineBoardPage` | Desktop/Mobile view, dialogs, modal, context menu | `useTimelineBoardScreen` + `TimelineBoardScreen` | page と view の責務が再混線する | timeline/list 切替、desktop/mobile 表示、dialog open |
| timeline/list toolbar + tab composition | `TimelineBoardPage` + `useTimelineBoardViewModels` | `DesktopTimelineView`, `DesktopListView`, `MobileTimelineView`, `MobileListView` | `useTimelineBoardViewModels` を土台に grouped props 化 | view model と screen の責務重複 | tab 切替、toolbar day range/list preset |
| drag overlay data | `TimelineBoardPage` | `TimelineDragOverlayCard` | shared overlay helper + screen grouped props | drag 中カード種別ごとの差分が崩れる | event/bucket/overdue drag overlay |

## View Models / Render Calculations

| area | owner | current consumer | move target | risk | regression test |
| --- | --- | --- | --- | --- | --- |
| desktop/mobile panel props | `useTimelineBoardViewModels` | `TimelineBoardPage` | 維持。下層に shared function を追加 | 上位に新しい巨大 view-model を作ると再肥大化 | desktop tabs, mobile timeline/list |
| card/calendar merge + sort | `TimelineColumn`, `MobileTimelineColumn` | desktop/mobile timeline views | `timeline-render-model.ts` shared function | stacked layout 差分が device ごとにずれる | overlapping timeline events, calendar overlap |
| all-day layout metadata | `DesktopTimelineView`, `MobileTimelineView` | desktop/mobile Google all-day rendering | `timeline-render-model.ts` shared function | all-day span 計算が端日で崩れる | all-day Google rendering |
| overlay metadata (`activeBuckets`, overlay card data) | `TimelineBoardPage`, `MobileTimelineView` | drag overlay | `timeline-render-model.ts` shared function | bucket/overdue overlay 判定が壊れる | bucket/overdue drag overlay |
| active stack item derivation | desktop/mobile timeline views | card/calendar focus state | shared helper の入力に寄せるが state owner は各 view に残す | interaction を shared 化しすぎると UI が壊れる | focus ring, context menu focus retain |

## Drag and Drop

| area | owner | current consumer | move target | risk | regression test |
| --- | --- | --- | --- | --- | --- |
| drag lifecycle (`handleDragStart/Move/End/Cancel`) | `useTimelineDragAndDrop` | desktop/mobile DnD | `dragSession` → `interactionState` | drag preview / bucket indicator 残留 | timeline drag, bucket reorder, overdue -> timeline |
| drag preview / bucket indicator / `isOverABList` | `useTimelineDragAndDrop` | desktop/mobile views | `dragSession` に集約 | UI が複数 state を横断し続ける | drag cancel, drop to A/B, drop to timeline |
| resize lifecycle | `useTimelineDragAndDrop` | desktop timeline | `interactionState` に統合 | resize と drag の相互排他が崩れる | resize top/bottom, persisted duration |
| pointer/autoscroll/drop/persist helper | dedicated helper files | `useTimelineDragAndDrop` | 維持 | helper まで巻き戻すと変更範囲が広がる | drag autoscroll, drop payload persistence |

## CardModal

| area | owner | current consumer | move target | risk | regression test |
| --- | --- | --- | --- | --- | --- |
| draft state | `useCardModalDraft` | `CardModal` | 維持 | draft owner を変えると編集ロスト | modal edit + autosave |
| lifecycle (`onCloseRef`, focus trap, initial sync, request close`) | `CardModal` | modal shell | `useCardModalLifecycle` | escape / overlay close / loading sync 崩れ | modal open/close, loading after open |
| autosave timers + flush | `CardModal` | title/body/due handlers | `useCardModalAutoSave` | unsaved close, flush order 崩れ | autosave debounce, close with pending edits |
| member dropdown refs / outside close | `CardModal` | header member picker | `useCardModalMemberPicker` | dropdown 残留、search reset 漏れ | member add/remove, outside click close |
| history / resize / Google sync | dedicated hooks | `CardModal` | 維持 | 既存分割を壊すだけで効果が薄い | history preview, sidebar resize, sync CTA |

## TiptapEditor

| area | owner | current consumer | move target | risk | regression test |
| --- | --- | --- | --- | --- | --- |
| clipboard image extraction + error parsing | `TiptapEditor` | paste/upload flow | `tiptap-image-paste.ts` | image paste 失敗時の文言と fallback が崩れる | image paste, oversized image |
| block action item definition + menu UI | `TiptapEditor` | block menu | `tiptap-block-menu.tsx` | keyboard menu navigation regress | block menu keyboard, insert/duplicate/delete |
| editor command / transaction logic | `TiptapEditor` | block actions | 次段で command helper 化 | command を早く分けすぎると selection 崩れ | block action persistence |
| focus/title bridge | `TiptapEditor` | `CardModal` | bridge layer へ後段分離 | title/body navigation regress | ArrowDown/ArrowRight title-body boundary |

## E2E

| area | owner | current consumer | move target | risk | regression test |
| --- | --- | --- | --- | --- | --- |
| auth state / fixture creation | `e2e/timeline.spec.ts` | timeline spec | `e2e/helpers/timeline-fixtures.ts` | fixture と spec の責務が混ざる | test board bootstrap |
| paste helpers | `e2e/timeline.spec.ts` | timeline spec | `e2e/helpers/timeline-editor.ts` | editor regression と helper regression の切り分け不能 | markdown paste, image paste |
| assertions / scenarios | `e2e/timeline.spec.ts` | timeline spec | helper 抽出後に分割 | spec を先に割ると fixture 共有が複雑化 | timeline core scenario set |
