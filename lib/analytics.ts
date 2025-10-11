'use client';

/**
 * Lightweight analytics wrapper. Delegates to `window.analytics` when present
 * (Segment/Amplitude/etc) and falls back to console logging in development.
 */
type AnalyticsClient = {
  page?: (name: string) => void;
  track?: (event: string, payload?: Record<string, unknown>) => void;
};

function getClient(): AnalyticsClient | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { analytics?: AnalyticsClient }).analytics ?? null;
}

export function page(name: string) {
  if (typeof window === 'undefined') return;
  const client = getClient();
  if (client?.page) {
    client.page(name);
  } else if (process.env.NODE_ENV !== 'production') {
    console.info('[analytics.page]', name);
  }
}

export function track(event: string, payload?: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  const client = getClient();
  if (client?.track) {
    client.track(event, payload);
  } else if (process.env.NODE_ENV !== 'production') {
    console.info('[analytics.track]', event, payload);
  }
}
