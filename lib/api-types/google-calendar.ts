export type GoogleCalendarEvent = {
  id: string;
  eventKey?: string;
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
  calendarSummary?: string | null;
  calendarBackgroundColor?: string | null;
  calendarForegroundColor?: string | null;
};

export type GoogleCalendarAccessRole = 'none' | 'freeBusyReader' | 'reader' | 'writer' | 'owner';

export type GoogleCalendarListEntry = {
  id: string;
  summary: string;
  primary: boolean;
  hidden: boolean;
  googleSelected: boolean;
  appSelected: boolean;
  accessRole: GoogleCalendarAccessRole;
  selectable: boolean;
  backgroundColor: string | null;
  foregroundColor: string | null;
};

export type GoogleCalendarPartialError = {
  calendarId: string;
  message: string;
  status?: number;
};

export type GoogleCalendarEventsResponse = {
  connected: boolean;
  canWrite?: boolean; // Added for v2
  events: GoogleCalendarEvent[];
  calendars?: GoogleCalendarListEntry[];
  selectedCalendarIds?: string[];
  partialErrors?: GoogleCalendarPartialError[];
  source?: 'cache' | 'google' | 'none';
  stale?: boolean;
  lastSyncedAt?: string | null;
  backgroundRefreshRecommended?: boolean;
  status?: 'connected' | 'disconnected';
  error?: string;
};
