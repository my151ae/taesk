# Refactoring Candidates (2025-11-21)

## 1. `TimelineBoardPage.tsx` Decomposition

The `TimelineBoardPage.tsx` file has grown to nearly 2000 lines. To improve maintainability and readability, we should split it into smaller, focused components and utilities.

### 1.1 Extract Helper Functions
Move date and time utility functions to a dedicated file (e.g., `lib/timeline-utils.ts` or `app/(board)/_utils/timeline-helpers.ts`).
- `minuteToPixels`
- `getMinutesFromTime`
- `getIsoDateJst`
- `getNowMinutesJst`
- `minutesToTime`
- `timeLabel`
- `withJstMidnight`
- `toLocalDay`

### 1.2 Extract Sub-components
Break down the main render method into smaller components.
- **`TimelineHeader`**: Encapsulate the header logic (BoardPicker, ShareDialog, Filters, ProfileSettings).
- **`TimelineGrid`**: The main 24h grid rendering logic.
- **`AbBucketSection`**: The A/B list rendering logic (currently `renderAbCard`).

### 1.3 Extract Drag & Drop Logic
The DnD handlers (`handleDragStart`, `handleDragMove`, `handleDragEnd`) are complex and take up a significant portion of the component. Consider moving them to a custom hook `useTimelineDragAndDrop`.

## 2. `NotificationsBell.tsx` Navigation

There is a TODO in `NotificationsBell.tsx`:
```typescript
// TODO: Navigate to card if notification has card context
```
Currently, clicking a notification does not navigate to the relevant card. We should implement this navigation logic, likely using `router.push` with the card's short ID (e.g., `?card=SHORT_ID`).

## 3. `useBoardFilters.ts` Optimization

(Optional) Review `useBoardFilters` to ensure it handles large datasets efficiently, although it seems performant for now.
