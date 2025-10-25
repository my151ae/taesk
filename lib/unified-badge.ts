import { trySetAppBadge, tryClearAppBadge } from './badge';
import { setupFaviconBadge, setFaviconBadge, clearFaviconBadge } from './favicon-badge';

let originalTitle: string | null = null;
let cachedStandaloneMode: boolean | null = null;

function withDocument<T>(fn: (doc: Document) => T): T | undefined {
  if (typeof document === 'undefined') {
    return undefined;
  }
  return fn(document);
}

function ensureOriginalTitle() {
  if (originalTitle === null) {
    withDocument((doc) => {
      originalTitle = doc.title || 'Taesk';
    });
  }
}

function updateDocumentTitle(count: number) {
  withDocument((doc) => {
    ensureOriginalTitle();
    if (!originalTitle) {
      originalTitle = doc.title;
    }
    if (!originalTitle) {
      return;
    }

    if (count > 0) {
      const capped = count > 99 ? '99+' : String(count);
      doc.title = `(${capped}) ${originalTitle}`;
    } else {
      doc.title = originalTitle;
    }
  });
}

function isStandaloneDisplayMode(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  if (cachedStandaloneMode !== null) {
    return cachedStandaloneMode;
  }

  const matchMedia = window.matchMedia?.('(display-mode: standalone)');
  const standalone = Boolean(matchMedia?.matches || (window.navigator as any)?.standalone);
  cachedStandaloneMode = standalone;
  return standalone;
}

export function initializeUnifiedBadge(baseIconHref?: string): void {
  ensureOriginalTitle();
  setupFaviconBadge(baseIconHref);
}

export async function setUnifiedBadge(count: number): Promise<void> {
  ensureOriginalTitle();
  updateDocumentTitle(count);

  const ok = await trySetAppBadge(count > 0 ? count : undefined);
  const preferAppBadgeOnly = isStandaloneDisplayMode();

  if (ok && preferAppBadgeOnly) {
    if (count === 0) {
      clearFaviconBadge();
    }
    return;
  }

  if (count > 0) {
    await setFaviconBadge(count);
  } else {
    clearFaviconBadge();
  }
}

export async function clearUnifiedBadge(): Promise<void> {
  updateDocumentTitle(0);
  const ok = await tryClearAppBadge();
  if (!ok) {
    clearFaviconBadge();
  }
}
