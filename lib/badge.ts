/**
 * App Badging API helpers
 * Provides feature detection wrappers and guarded setters so that
 * callers can optimistically invoke the OS-level badge while still
 * gracefully falling back in unsupported contexts (regular tabs, Firefox, etc.).
 */

let lastBadgeCount: number | null = null;

function hasNavigator(): navigator is Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
} {
  return typeof navigator !== 'undefined';
}

export function isAppBadgeSupported(): boolean {
  return hasNavigator() && typeof navigator.setAppBadge === 'function';
}

/**
 * Try to set the platform badge count if supported.
 * Returns true when the API existed and resolved successfully.
 */
export async function trySetAppBadge(count?: number): Promise<boolean> {
  if (!isAppBadgeSupported()) {
    return false;
  }

  try {
    await navigator.setAppBadge?.(count);
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
  if (!hasNavigator() || typeof navigator.clearAppBadge !== 'function') {
    return false;
  }

  try {
    await navigator.clearAppBadge();
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
