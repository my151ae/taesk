# Step4 /c Short URL Modal Integration — Intercepting Routes Spec
**Status**: Draft → Implementable  
**Owner**: 松本Ops（@yoshinori-matsumoto）  
**Date**: 2025-10-15 (Asia/Tokyo)  
**Scope**: Implement `/c/:short_id/[[...slug]]` using **Intercepting Routes + Parallel Routes** to open *CardModal* over the board, while keeping `/c` as a shareable canonical URL.

---

## 1. Background & Goals
- From Step1–3, the `/c` short-URL work is **not yet started** and must be completed with modal overlay UX that preserves the board context.  
- **Goal**: When a user hits a shareable card link (`/c/:short_id/...`), they get:  
  1) **Soft navigation** from board → card opens as **modal** over board.  
  2) **Hard navigation** (direct/refresh) → the **full card page** renders (non-modal).  
  3) URL canonicalization for mismatched/legacy slugs.

## 2. In/Out of Scope
**In**  
- `/c/:short_id/[[...slug]]` IR + Parallel Routes implementation.  
- Unified slug normalization across `/b` and `/c`.  
- Extend `KanbanBoardClient` to restore/open the card state via `/c`.  
- E2E to cover `/c` flows.

**Out**  
- Visual redesign of modal/card pages.  
- Board data model changes (beyond what's necessary for lookup/slug).

## 3. User Stories & Acceptance Criteria
1) **Open via board → modal**  
   - From board list, navigate to a card → card opens as a modal above the board.  
   - Closing the modal returns to the previous URL/history (back button also closes modal).  
2) **Direct link / refresh → full page**  
   - Visiting `/c/:short_id/[[...slug]]` directly shows the full card page.  
3) **Canonicalization**  
   - `/c/:short_id/wrong-slug` redirects/replaces to `/c/:short_id/<canonical-slug>`.  
4) **Regression-free**  
   - Reloading after closing modal is safe; no console errors; E2E passes for `/c` scenarios.

## 4. Architecture Overview
We will pair **Intercepting Routes** (IR) with **Parallel Routes** (`@modal` slot) to intercept the card route and render it as a modal *within* the current board layout.

### 4.1 Route Map (App Router)
```
app/
  (board)/
    layout.tsx                      # Renders children + modal slot
    b/
      [short_id]/
        [[...slug]]/
          page.tsx                  # Board page (background content)
    @modal/
      (..)c/
        (.)[short_id]/
          (.)[[...slug]]/
            page.tsx                # Modal (intercepted) content for /c when soft-navigated
      default.tsx                   # Return null
  c/
    [short_id]/
      [[...slug]]/
        page.tsx                    # Full card page (hard navigation fallback)
    layout.tsx                      # Optional: card layout if needed
```

> Notes
> - `@modal` is a **slot** (not a segment) and is fed via the parent layout’s props.  
> - `(.)`, `(..)`, `(...)` are **segment-relative** matchers (not filesystem relative).  
> - Interception only applies to **soft navigation**; direct/refresh renders `/c/...` full page.

### 4.2 Layout Contract
```tsx
// app/(board)/layout.tsx
export default function BoardLayout({
  children,
  modal,
}: Readonly<{ children: React.ReactNode; modal: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>
        {children}
        {modal /* modal slot overlays here */}
      </body>
    </html>
  );
}
```

### 4.3 Intercepted Modal Page (Client Component)
```tsx
// app/(board)/@modal/(..)c/(.)[short_id]/(.)[[...slug]]/page.tsx
'use client';
import { useRouter } from 'next/navigation';
import { CardModal } from '@/components/kanban/CardModal';

export default function CardModalIntercepted({
  params: { short_id, slug = [] },
  searchParams,
}: {
  params: { short_id: string; slug?: string[] };
  searchParams?: Record<string, string | string[]>;
}) {
  const router = useRouter();
  const onClose = () => router.back(); // close = go back (UX requirement)

  return (
    <div role="dialog" aria-modal className="fixed inset-0 grid place-items-center bg-black/50">
      <CardModal shortId={short_id} slug={slug} onOpenChange={(open) => !open && onClose()} />
    </div>
  );
}
```

### 4.4 Full Card Page (Hard Navigation)
```tsx
// app/c/[short_id]/[[...slug]]/page.tsx
import { CardPage } from '@/app/_features/card/CardPage';
import { normalizeCardSlugOrRedirect } from '@/lib/urls/card';

export default async function CardFullPage({ params: { short_id, slug = [] } }) {
  const normalized = await normalizeCardSlugOrRedirect({ short_id, slug });
  return <CardPage shortId={short_id} slug={normalized} />;
}
```

### 4.5 Default Slot
```tsx
// app/(board)/@modal/default.tsx
export default function Default() { return null; }
```

## 5. URL Rules
- **Canonical**: `/c/:short_id/:canonical-slug`  
- **Optional slug**: `/c/:short_id` resolves to canonical slug server-side and **redirects** (308) or **replaceState** in client as needed.  
- **Board page keeps its own `/b/:short_id/[[...slug]]`** unchanged.

### 5.1 Canonicalization Helpers
```ts
// /lib/urls/card.ts
export async function canonicalizeCardSlug(shortId: string): Promise<string> {
  // Fetch card by shortId and derive slug (kebab-case of title, include id hash if policy requires)
  // return '' (empty) if no slug policy
}

export async function normalizeCardSlugOrRedirect({
  short_id, slug,
}: { short_id: string; slug: string[] }) {
  const canonical = await canonicalizeCardSlug(short_id);
  const current = Array.isArray(slug) ? slug.join('/') : (slug || '');
  if (canonical && current != canonical) {
    // Next.js 308 redirect in RSC
    return redirect(`/c/{short_id}/{canonical}`.replace('{short_id}', short_id).replace('{canonical}', canonical));
  }
  return canonical ? canonical.split('/') : slug;
}
```

## 6. Data Loading
- **Board**: load by board short_id when rendering board background.  
- **Card**: load by card short_id (and board linkage if needed to validate access).  
- ISR/Cache: keep existing policies; ensure modal fetches don’t break cache keys.  
- **Permissions**: handle 403/404 consistently for both modal and full page.

## 7. Navigation Matrix
| How user got there | URL | Rendered UI | Behavior |
|---|---|---|---|
| Board → click card (soft) | `/c/:short_id/...` | **Modal** over board via IR in `@modal` | Close modal = `router.back()` |
| Direct link / refresh (hard) | `/c/:short_id/...` | **Full card page** | Back/forward keeps history |
| Wrong/missing slug | `/c/:short_id/wrong` | Redirect to canonical | 308 on server or `replaceState` on client |

## 8. State & History
- **Close modal**: `router.back()` (no duplicate URLs in history).  
- **Reopen on forward**: naturally handled by IR when navigating forward to the intercepted URL.  
- **Refresh**: slot falls back to `default.tsx` and full page renders (Parallel Routes behavior).

## 9. Error Handling
- Card not found → 404 page; keep board visible if soft navigated; show toast if appropriate.  
- Board failed to load (soft) → fallback to full card page.  
- Permission denied → 403; redact card title from slug generation if required.

## 10. Integration with Existing Code
- Reuse `buildCardUrl` / `buildBoardUrl` helpers; add `/c` variants.  
- Extend `KanbanBoardClient` restore logic to open modal when current URL is `/c/...`.  
- Ensure no duplication of side effects between modal and full-page components (share fetch & view model).

## 11. Testing (Playwright)
- `/c/:short_id` opens modal over board when navigated from board.  
- Direct open `/c/:short_id` renders full page.  
- `wrong-slug` auto-normalizes to canonical.  
- Close modal → returns to board URL; refresh is stable.  
- Axe accessibility on modal (focus trap, aria-modal, ESC closes).

## 12. Analytics
- `card_view_open` (context: modal/full-page, source, board_id, card_id).  
- `card_view_close` (reason: back, close-button, ESC).

## 13. Performance & DX
- Ensure modal bundle is light (code-split CardModal subtree).  
- Avoid double fetching (co-locate data fetching in RSC layer; pass minimal props to client).

## 14. Feature Flag & Rollout
- Gate with `NEXT_PUBLIC_FEATURE_IR_STEP4 = 'on'` (client-visible) and `FEATURE_IR_STEP4` (server).  
- Dark launch to internal users; compare session metrics vs query-param fallback.

## 15. Risks & Mitigations
- **IR edge-case regressions** across versions → pin Next.js minor; add E2E coverage for soft vs hard.  
- **Slot default behavior** (no default.tsx) → add `default.tsx` to avoid 404 when hard nav.  
- **Multiple interceptors** for the same target → avoid ambiguous intercepts; keep a single source of truth under `(board)/@modal`.

## 16. Migration Plan
1) Land folder skeleton behind feature flags.  
2) Implement canonicalization helpers and tests.  
3) Wire `KanbanBoardClient` to open modal for `/c` URLs.  
4) Ship E2E & a11y checks.  
5) Enable flag for internal; then GA.

---

### Appendix A: Minimal Skeleton
```bash
app/
  (board)/
    layout.tsx
    b/[short_id]/[[...slug]]/page.tsx
    @modal/
      default.tsx
      (..)c/(.)[short_id]/(.)[[...slug]]/page.tsx
  c/[short_id]/[[...slug]]/page.tsx
```

### Appendix B: Close Behavior
- Close button calls `router.back()`; ESC is wired to the same.  
- Do **not** push a duplicate board URL when opening modal; rely on intercept + back.

---

**Ready to build.**
