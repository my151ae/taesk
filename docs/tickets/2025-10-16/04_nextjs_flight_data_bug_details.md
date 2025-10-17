# Next.js Flight Data Bug - Technical Deep Dive

**Date**: 2025-10-16
**Affected Version**: Next.js 15.5.x (confirmed on 15.5.4)
**Status**: 🔴 Unresolved (upstream bug)
**Tracking**: Internal workaround implemented

## Bug Summary

### Error Message
```
Uncaught TypeError: e is not iterable
```

### Location
```
next/dist/client/components/react-dev-overlay/internal/helpers/nodeStackFrames.js
↓
fillCacheWithNewSubTreeData (Next.js App Router internal)
```

## Technical Root Cause

### Flight Data Merge Process

Next.js App Router uses "Flight Data" (React Server Component streaming format) to update the client-side cache when navigating between routes.

```typescript
// Simplified internal Next.js logic
function fillCacheWithNewSubTreeData(cache, existingCache, flightData) {
  const [segmentPath, ...rest] = flightData;

  // BUG: segmentPath can be null when notFound()/redirect() is in Flight Data
  for (const segment of segmentPath) {  // ❌ TypeError: null is not iterable
    // ...
  }
}
```

### When Does segmentPath Become Null?

When an **intercepted route** returns special responses:
- `notFound()` from `next/navigation`
- `redirect()` / `permanentRedirect()` from `next/navigation`

These responses get serialized into Flight Data, but the internal cache merge logic doesn't handle them correctly, resulting in `null` in `segmentPath`.

## Reproduction Steps

### Minimal Reproduction

1. **Setup**: Parallel Routes + Intercepting Routes
   ```
   app/
   ├── (board)/
   │   ├── layout.tsx              # accepts @modal slot
   │   └── @modal/(...)c/[id]/page.tsx  # intercepts /c/[id]
   └── c/[id]/page.tsx             # standalone page
   ```

2. **Server Component** (`c/[id]/page.tsx`):
   ```typescript
   export default async function CardPage({ params }) {
     const card = await getCard(params.id);

     if (!card) {
       notFound();  // ❌ This causes the bug when intercepted
     }

     return <div>{card.title}</div>;
   }
   ```

3. **Trigger**:
   ```typescript
   // Client-side navigation to non-existent card
   router.push('/c/INVALID_ID');
   ```

4. **Result**: `Uncaught TypeError: e is not iterable`

### Real-World Reproduction in Taesk

**Scenario 1**: Unsynced card
```typescript
// User creates card → clicks immediately (before Supabase sync completes)
handleAddCard()  // Card gets temporary ID, no short_id yet
  ↓
User clicks card → router.push('/c/undefined/...')
  ↓
Server returns notFound()
  ↓
❌ Crash
```

**Scenario 2**: Deleted card with stale URL
```typescript
// User has /c/ABC123 open in another tab
Card gets deleted from database
  ↓
User refreshes /c/ABC123
  ↓
Server returns notFound()
  ↓
❌ Crash
```

**Scenario 3**: Direct navigation to invalid URL
```typescript
// User types wrong URL or follows broken link
router.push('/c/INVALID99')
  ↓
Server returns notFound()
  ↓
❌ Crash
```

## Why This Happens

### Flight Data Format (Simplified)

Normal response:
```javascript
[
  ["children", "c", "children", "ABC123", ...],  // segmentPath
  <React.Component />,                            // component
  // ...
]
```

Response with `notFound()`:
```javascript
[
  null,  // ❌ segmentPath is null
  "notFound",
  // ...
]
```

### Cache Merge Failure

```typescript
// Next.js internal (simplified)
const [segmentPath, ...] = flightData;

// When notFound() is in Flight Data:
segmentPath = null

// Later in the code:
for (const segment of segmentPath) {  // ❌ null is not iterable
  // ...
}
```

## Workarounds

### 1. Avoid Real Navigation (✅ Current Implementation)

**Strategy**: Use query parameters instead of path-based navigation for modals

```typescript
// ❌ Before (crashes)
router.push('/c/ABC123/1-card-title');

// ✅ After (safe)
router.push('/b/boardId?card=ABC123');
```

**How it works**:
- No real navigation to `/c/...` route
- No Flight Data merge
- No crash

**Trade-offs**:
- ✅ 100% crash-proof
- ✅ Fast (no network request)
- ❌ URL is not `/c/...` format
- ❌ Less elegant

### 2. Always Return Valid Flight Data (⚠️ Complex)

**Strategy**: Never throw `notFound()` in intercepted routes

```typescript
// app/@modal/(...)c/[id]/page.tsx
export default async function InterceptedCard({ params }) {
  const card = await getCard(params.id);

  if (!card) {
    // ❌ Don't do this:
    // notFound();

    // ✅ Return valid component:
    return <div>Card not found</div>;
  }

  return <CardModal card={card} />;
}
```

**Trade-offs**:
- ✅ Can use `/c/...` URLs
- ❌ Complex error handling
- ❌ Can't use Next.js built-in `notFound()`
- ❌ Still risky if any code path throws

### 3. Guard Against Unsynced Cards (⚠️ Partial)

**Strategy**: Only navigate when `short_id` exists

```typescript
const handleCardClick = (card: Card) => {
  if (!card.short_id) {
    console.warn('Card not synced yet');
    return;  // Don't navigate
  }

  router.push(`/c/${card.short_id}`);
};
```

**Trade-offs**:
- ✅ Prevents unsynced card crashes
- ❌ Doesn't prevent invalid URL crashes
- ❌ UX: Can't open card immediately after creation

## Current Implementation (Taesk)

We use **Workaround #1** (query parameters):

```typescript
// app/(board)/_components/KanbanBoardClient.tsx:1594-1609
const handleOpenCardModal = (card: Card) => {
  const currentUrl = new URL(window.location.href);
  const basePath = getBoardPath(currentBoard) || currentUrl.pathname;

  currentUrl.pathname = basePath;
  currentUrl.searchParams.set('card', card.short_id);  // Query param

  router.push(`${currentUrl.pathname}${currentUrl.search}`, { scroll: false });
};
```

**Additional safety**:
- Guard against unsynced cards (Workaround #3)
- E2E tests to prevent regression

## Future Resolution

### When Can We Revert to `/c/...` URLs?

**Condition 1**: Next.js fixes the bug
- Monitor Next.js releases for fixes to `fillCacheWithNewSubTreeData`
- Test with new versions before upgrading

**Condition 2**: We upgrade Next.js
- Check release notes for mentions of:
  - "Flight Data"
  - "Intercepting Routes"
  - "Parallel Routes"
  - "notFound in intercepted routes"

**Condition 3**: Regression tests pass
- Run E2E test: `should handle invalid card URL gracefully without crashing`
- Manually test: Navigate to `/c/INVALID_ID` and verify no crash

### Migration Path Back to `/c/...` URLs

```typescript
// 1. Remove query parameter logic
const handleOpenCardModal = (card: Card) => {
  const canonicalPath = buildCardUrl(card);  // /c/ABC123/1-title
  router.push(canonicalPath, { scroll: false });
};

// 2. Ensure intercepted route handles errors gracefully
// app/@modal/(...)c/[id]/page.tsx
export default async function InterceptedCard({ params }) {
  const card = await getCard(params.id);

  if (!card) {
    // ✅ Now safe (after Next.js fix)
    notFound();
  }

  return <CardModal card={card} />;
}

// 3. Update E2E tests to expect /c/... URLs
await expect(page).toHaveURL(/\/c\/[A-Za-z0-9]+/);
```

## References

### Related Next.js Issues
- GitHub Issues to watch (search for "fillCacheWithNewSubTreeData")
- App Router discussions about notFound() in intercepted routes

### Taesk Documentation
- [URL Navigation Crash Fix](./03_url_navigation_crash_fix.md) - Implementation details
- [Routing & Card URLs](../detail/routing.md) - Current architecture

### Current Version Lock
- **Next.js**: 15.5.4 (locked in package.json)
- **React**: 18.3.1
- **Last verified**: 2025-10-16

## Monitoring

### Production Monitoring
If reverting to `/c/...` URLs:
- Add Sentry error tracking for "is not iterable"
- Add analytics for `notFound()` responses in intercepted routes
- Set up alerts for sudden error rate increases

### Testing Before Upgrade
```bash
# 1. Upgrade Next.js
npm install next@latest

# 2. Run regression tests
npx playwright test e2e/kanban.spec.ts -g "invalid card URL"

# 3. Manual test
# Navigate to http://localhost:3000/c/INVALID_ID
# Verify: No "e is not iterable" error in console

# 4. If tests pass, update docs and commit
```

---

**Status**: Awaiting Next.js fix
**Workaround**: Query parameter navigation (stable)
**Impact**: Low (functionality preserved, URL format changed)
