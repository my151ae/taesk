"use client";

import { useCallback, useMemo, useState } from "react";
import { JSONContent } from "@tiptap/react";

import type { Card, DueBucket, ProfileSummary } from "@/lib/supabase";
import { normalizeContent } from "@/lib/tiptap";
import type { ReminderMinuteOption } from "@/app/components/card-modal/types";

const REMINDER_MINUTE_OPTIONS = [0, 5, 10, 15, 30, 60] as const;

function resolveInitialAssigneeIds(card: Card): string[] {
  if (card.assignee_ids && card.assignee_ids.length > 0) {
    return card.assignee_ids;
  }
  if (card.assignee_id) {
    return [card.assignee_id];
  }
  return [];
}

type UseCardModalDraftArgs = {
  card: Card;
  profiles: ProfileSummary[];
};

export function useCardModalDraft({ card, profiles }: UseCardModalDraftArgs) {
  const [content, setContent] = useState<JSONContent>(() => normalizeContent(card.content));
  const [title, setTitle] = useState(card.title || "");
  const [tags, setTags] = useState<string[]>(card.tags || []);
  const [tagInput, setTagInput] = useState("");
  const [dueDate, setDueDate] = useState(card.due_date || "");
  const [dueStart, setDueStart] = useState(card.due_start ? card.due_start.slice(0, 5) : "");
  const [dueEnd, setDueEnd] = useState(card.due_end ? card.due_end.slice(0, 5) : "");
  const [startReminderEnabled, setStartReminderEnabled] = useState(Boolean(card.start_reminder_enabled));
  const [startReminderMinutes, setStartReminderMinutes] = useState<ReminderMinuteOption>(
    REMINDER_MINUTE_OPTIONS.includes((card.start_reminder_minutes ?? 0) as ReminderMinuteOption)
      ? (card.start_reminder_minutes ?? 0) as ReminderMinuteOption
      : 0
  );
  const [endReminderEnabled, setEndReminderEnabled] = useState(Boolean(card.end_reminder_enabled));
  const [endReminderMinutes, setEndReminderMinutes] = useState<ReminderMinuteOption>(
    REMINDER_MINUTE_OPTIONS.includes((card.end_reminder_minutes ?? 0) as ReminderMinuteOption)
      ? (card.end_reminder_minutes ?? 0) as ReminderMinuteOption
      : 0
  );
  const [dueBucket, setDueBucket] = useState<DueBucket | null>(card.due_bucket ?? null);
  const [dueBucketPosition, setDueBucketPosition] = useState<number | null>(card.due_bucket_position ?? null);
  const [duration, setDuration] = useState<number | "">(card.duration ?? 60);
  const [checked, setChecked] = useState(card.checked || false);
  const [assigneeIds, setAssigneeIds] = useState<string[]>(() => resolveInitialAssigneeIds(card));
  const [showMemberDropdown, setShowMemberDropdown] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const [assigneeTouched, setAssigneeTouched] = useState(false);
  const [targetBoardId, setTargetBoardId] = useState(card.board_id);
  const [showSidebar, setShowSidebar] = useState(false);
  const [activeSidebarTab, setActiveSidebarTab] = useState<"comments" | "history" | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);

  const filteredProfiles = useMemo(() => {
    const query = memberSearch.trim().toLowerCase();
    const base = !query
      ? profiles
      : profiles.filter((profile) => {
          const username = profile.username?.toLowerCase() ?? "";
          const display = profile.display_name?.toLowerCase() ?? "";
          const name = profile.full_name?.toLowerCase() ?? "";
          const email = profile.email?.toLowerCase() ?? "";
          return (
            username.includes(query) ||
            display.includes(query) ||
            name.includes(query) ||
            email.includes(query)
          );
        });

    return base.filter((profile) => !assigneeIds.includes(profile.id));
  }, [assigneeIds, memberSearch, profiles]);

  const selectedAssignees = useMemo(
    () => profiles.filter((profile) => assigneeIds.includes(profile.id)),
    [assigneeIds, profiles]
  );

  const resetDraft = useCallback((nextCard: Card) => {
    setContent(normalizeContent(nextCard.content));
    setTitle(nextCard.title || "");
    setTags(nextCard.tags || []);
    setTagInput("");
    setDueDate(nextCard.due_date || "");
    setDueStart(nextCard.due_start ? nextCard.due_start.slice(0, 5) : "");
    setDueEnd(nextCard.due_end ? nextCard.due_end.slice(0, 5) : "");
    setStartReminderEnabled(Boolean(nextCard.start_reminder_enabled));
    setStartReminderMinutes(
      REMINDER_MINUTE_OPTIONS.includes((nextCard.start_reminder_minutes ?? 0) as ReminderMinuteOption)
        ? (nextCard.start_reminder_minutes ?? 0) as ReminderMinuteOption
        : 0
    );
    setEndReminderEnabled(Boolean(nextCard.end_reminder_enabled));
    setEndReminderMinutes(
      REMINDER_MINUTE_OPTIONS.includes((nextCard.end_reminder_minutes ?? 0) as ReminderMinuteOption)
        ? (nextCard.end_reminder_minutes ?? 0) as ReminderMinuteOption
        : 0
    );
    setDueBucket(nextCard.due_bucket ?? null);
    setDueBucketPosition(nextCard.due_bucket_position ?? null);
    setDuration(nextCard.duration ?? 60);
    setChecked(nextCard.checked || false);
    setAssigneeIds(resolveInitialAssigneeIds(nextCard));
    setShowMemberDropdown(false);
    setMemberSearch("");
    setAssigneeTouched(false);
    setTargetBoardId(nextCard.board_id);
    setActiveSidebarTab(null);
    setEditorError(null);
  }, []);

  return {
    content,
    setContent,
    title,
    setTitle,
    tags,
    setTags,
    tagInput,
    setTagInput,
    dueDate,
    setDueDate,
    dueStart,
    setDueStart,
    dueEnd,
    setDueEnd,
    startReminderEnabled,
    setStartReminderEnabled,
    startReminderMinutes,
    setStartReminderMinutes,
    endReminderEnabled,
    setEndReminderEnabled,
    endReminderMinutes,
    setEndReminderMinutes,
    dueBucket,
    setDueBucket,
    dueBucketPosition,
    setDueBucketPosition,
    duration,
    setDuration,
    checked,
    setChecked,
    assigneeIds,
    setAssigneeIds,
    showMemberDropdown,
    setShowMemberDropdown,
    memberSearch,
    setMemberSearch,
    assigneeTouched,
    setAssigneeTouched,
    targetBoardId,
    setTargetBoardId,
    showSidebar,
    setShowSidebar,
    activeSidebarTab,
    setActiveSidebarTab,
    editorError,
    setEditorError,
    filteredProfiles,
    selectedAssignees,
    resetDraft,
  };
}
