"use client";

export type SidebarSectionKey = "overdue" | "completed" | "notifications" | "search" | "parents" | "tags" | "trash";

export type IncrementalPanelSectionKey = Exclude<SidebarSectionKey, "overdue" | "notifications">;

export const SIDEBAR_SECTION_KEYS: SidebarSectionKey[] = [
  "overdue",
  "completed",
  "notifications",
  "search",
  "parents",
  "tags",
  "trash",
];

export const INCREMENTAL_PANEL_SECTION_KEYS: IncrementalPanelSectionKey[] = [
  "completed",
  "search",
  "parents",
  "tags",
  "trash",
];
