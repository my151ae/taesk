import type { Checklist } from '@/lib/checklist';
import type { DueBucket } from '@/lib/supabase';
import type { JSONContent } from '@tiptap/react';

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
  start_reminder_enabled?: boolean;
  start_reminder_minutes?: 0 | 5 | 10 | 15 | 30 | 60;
  end_reminder_enabled?: boolean;
  end_reminder_minutes?: 0 | 5 | 10 | 15 | 30 | 60;
  durationMinutes: number | null;
  title: string;
  content?: JSONContent | null;
  excerpt?: string | null;
  tags: string[];
  checked: boolean;
  checklist?: Checklist | null;
  due_bucket?: DueBucket | null;
  due_bucket_position?: number | null;
  assignee_id?: string | null;
  assignee_ids?: string[] | null;
  assigned_to?: string | null;
  duration?: number | null;
  short_id: string | null;
  slug: string | null;
}

export interface TimelineBucketItem {
  card_id: string;
  title: string;
  content?: JSONContent | null;
  excerpt?: string | null;
  due_date: string | null;
  due_start: string | null;
  due_end: string | null;
  start_reminder_enabled?: boolean;
  start_reminder_minutes?: 0 | 5 | 10 | 15 | 30 | 60;
  end_reminder_enabled?: boolean;
  end_reminder_minutes?: 0 | 5 | 10 | 15 | 30 | 60;
  checked: boolean;
  checklist?: Checklist | null;
  tags: string[];
  assignee_id?: string | null;
  assignee_ids?: string[] | null;
  assigned_to?: string | null;
  duration?: number | null;
  due_bucket?: DueBucket | null;
  short_id: string | null;
  slug: string | null;
  bucketPosition: number | null;
}

export interface TimelineOverdueItem {
  card_id: string;
  title: string;
  content?: JSONContent | null;
  excerpt?: string | null;
  due_date: string | null;
  due_start: string | null;
  due_end: string | null;
  start_reminder_enabled?: boolean;
  start_reminder_minutes?: 0 | 5 | 10 | 15 | 30 | 60;
  end_reminder_enabled?: boolean;
  end_reminder_minutes?: 0 | 5 | 10 | 15 | 30 | 60;
  checked: boolean;
  checklist?: Checklist | null;
  tags: string[];
  assignee_id?: string | null;
  assignee_ids?: string[] | null;
  assigned_to?: string | null;
  duration?: number | null;
  due_bucket?: DueBucket | null;
  due_bucket_position?: number | null;
  short_id: string | null;
  slug: string | null;
}

export interface TimelineResponse {
  days: TimelineDay[];
  events: TimelineEvent[];
  abBuckets: Record<string, TimelineBucketItem[]>;
  overdue: TimelineOverdueItem[];
  serverNow: string;
  startOffset?: number;
  range?: number;
  availableTags?: string[];
}
