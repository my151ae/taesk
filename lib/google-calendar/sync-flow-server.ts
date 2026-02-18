import "server-only";

type GoogleApiErrorShape = {
  code?: number;
  response?: { status?: number };
};

export async function fetchEventsWithTokenFallback<TEvent>(args: {
  syncToken: string | null | undefined;
  fetchWithSyncToken: (syncToken: string) => Promise<TEvent[]>;
  clearSyncToken: () => Promise<void>;
  fetchAndCacheRange: () => Promise<TEvent[]>;
  toGoogleApiError: (error: unknown) => GoogleApiErrorShape;
  onSyncTokenError?: (error: unknown) => void;
}): Promise<TEvent[]> {
  const {
    syncToken,
    fetchWithSyncToken,
    clearSyncToken,
    fetchAndCacheRange,
    toGoogleApiError,
    onSyncTokenError,
  } = args;

  if (syncToken) {
    try {
      const events = await fetchWithSyncToken(syncToken);
      if (events.length > 0) {
        return events;
      }
    } catch (error) {
      const parsed = toGoogleApiError(error);
      const status = parsed.code || parsed.response?.status;
      if (status === 410) {
        await clearSyncToken();
      } else {
        onSyncTokenError?.(error);
      }
    }
  }

  return fetchAndCacheRange();
}
