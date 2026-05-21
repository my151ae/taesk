export type GoogleCalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  isAllDay: boolean;
  startUtc?: string;
  endUtc?: string;
  source: 'google_calendar';
  calendarId?: string | null;
  htmlLink?: string | null;
  description?: string | null;
  status?: string | null;
  displayTz?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  location?: string | null;
  attendees?: Record<string, unknown>[] | null;
  conferenceData?: Record<string, unknown> | null;
  etag?: string | null;
};

export type GoogleCalendarEventsResponse = {
  connected: boolean;
  canWrite?: boolean; // Added for v2
  events: GoogleCalendarEvent[];
  source?: 'cache' | 'google' | 'none';
  stale?: boolean;
  lastSyncedAt?: string | null;
  backgroundRefreshRecommended?: boolean;
  status?: 'connected' | 'disconnected';
  error?: string;
};
