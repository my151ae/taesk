export interface UserProfile {
  id: string;
  username: string | null;
  display_name: string | null;
  full_name: string | null;
  avatar_url: string | null;
  email: string | null;
}

export interface TimelineDay {
  key: string;
  label: string;
  isoDate: string;
}

export interface TimelineEvent {
  card_id: string;
  due_date: string;
  due_start: string | null;
  due_end: string | null;
  durationMinutes: number | null;
  title: string;
  tags: string[];
  priority: string | null;
  checked: boolean;
  assignee_id?: string | null;
  assignee_ids?: string[] | null;
  assigned_to?: string | null;
  short_id: string | null;
  slug: string | null;
}

export interface TimelineBucketItem {
  card_id: string;
  title: string;
  due_date: string | null;
  due_start: string | null;
  due_end: string | null;
  checked: boolean;
  tags: string[];
  assignee_id?: string | null;
  assignee_ids?: string[] | null;
  assigned_to?: string | null;
  short_id: string | null;
  slug: string | null;
  bucketPosition: number | null;
}

export interface TimelineResponse {
  days: TimelineDay[];
  events: TimelineEvent[];
  abBuckets: Record<string, TimelineBucketItem[]>;
  serverNow: string;
}
