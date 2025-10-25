/**
 * App Badging API helpers
 * Provides feature detection wrappers and guarded setters so that
 * callers can optimistically invoke the OS-level badge while still
 * gracefully falling back in unsupported contexts (regular tabs, Firefox, etc.).
 */

let lastBadgeCount: number | null = null;

type BadgeNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

function getNavigator(): BadgeNavigator | null {
  if (typeof window === 'undefined' || typeof window.navigator === 'undefined') {
    return null;
  }
  return window.navigator as BadgeNavigator;
}

export function isAppBadgeSupported(): boolean {
  const nav = getNavigator();
  return Boolean(nav?.setAppBadge);
}

/**
 * Try to set the platform badge count if supported.
 * Returns true when the API existed and resolved successfully.
 */
export async function trySetAppBadge(count?: number): Promise<boolean> {
  const nav = getNavigator();
  if (!nav?.setAppBadge) {
    return false;
  }

  try {
    await nav.setAppBadge(count);
    lastBadgeCount = count ?? null;
    console.debug('[Badge] App badge updated:', count ?? 'dot');
    return true;
  } catch (error) {
    console.warn('[Badge] setAppBadge failed, will fall back:', error);
    return false;
  }
}

/**
 * Clear the platform badge if the API exists.
 */
export async function tryClearAppBadge(): Promise<boolean> {
  const nav = getNavigator();
  if (!nav?.clearAppBadge) {
    return false;
  }

  try {
    await nav.clearAppBadge();
    lastBadgeCount = null;
    console.debug('[Badge] App badge cleared');
    return true;
  } catch (error) {
    console.warn('[Badge] clearAppBadge failed, will fall back:', error);
    return false;
  }
}

export function getLastBadgeCount(): number | null {
  return lastBadgeCount;
}
