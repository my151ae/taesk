import type { DueBucket, Priority } from '@/lib/supabase';
import type { JSONContent } from '@tiptap/react';

export type ReminderMinuteOption = 0 | 5 | 10 | 15 | 30 | 60;

export type CardModalSavePayload = {
  id: string;
  title: string;
  content: JSONContent | Record<string, unknown> | Array<unknown>;
  excerpt: string;
  tags?: string[];
  due_date?: string | null;
  priority?: Priority;
  assigneeIds?: string[];
  assigneeTouched?: boolean;
  due_start?: string | null;
  due_end?: string | null;
  start_reminder_enabled?: boolean;
  start_reminder_minutes?: ReminderMinuteOption;
  end_reminder_enabled?: boolean;
  end_reminder_minutes?: ReminderMinuteOption;
  due_bucket?: DueBucket | null;
  due_bucket_position?: number | null;
  duration?: number;
  checked?: boolean;
  isAutoSave?: boolean;
  forceHistorySnapshot?: boolean;
  restoreFromHistory?: boolean;
  historySourceId?: string;
};
