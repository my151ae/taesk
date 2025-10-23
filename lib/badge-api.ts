/**
 * Badge API utilities for PWA
 * Updates the app icon badge with notification count
 */

/**
 * Check if Badge API is supported
 */
export function isBadgeSupported(): boolean {
  return 'setAppBadge' in navigator && 'clearAppBadge' in navigator;
}

/**
 * Set the app badge count
 */
export async function setAppBadge(count: number): Promise<boolean> {
  if (!isBadgeSupported()) {
    console.warn('Badge API not supported');
    return false;
  }

  try {
    if (count > 0) {
      await (navigator as any).setAppBadge(count);
      console.log('[Badge] Set badge count:', count);
    } else {
      await (navigator as any).clearAppBadge();
      console.log('[Badge] Cleared badge');
    }
    return true;
  } catch (error) {
    console.error('[Badge] Failed to set badge:', error);
    return false;
  }
}

/**
 * Clear the app badge
 */
export async function clearAppBadge(): Promise<boolean> {
  if (!isBadgeSupported()) {
    return false;
  }

  try {
    await (navigator as any).clearAppBadge();
    console.log('[Badge] Cleared badge');
    return true;
  } catch (error) {
    console.error('[Badge] Failed to clear badge:', error);
    return false;
  }
}
