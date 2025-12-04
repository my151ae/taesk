export type GoogleCalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  isAllDay: boolean;
  source: 'google_calendar';
  calendarId?: string | null;
  htmlLink?: string | null;
};

export type GoogleCalendarEventsResponse = {
  connected: boolean;
  events: GoogleCalendarEvent[];
  status?: 'connected' | 'disconnected';
  error?: string;
};
