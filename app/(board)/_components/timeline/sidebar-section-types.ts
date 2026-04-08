"use client";

export type SidebarSectionKey = "overdue" | "completed" | "notifications" | "search" | "tags" | "trash";

export type IncrementalPanelSectionKey = Exclude<SidebarSectionKey, "overdue" | "notifications">;

export const SIDEBAR_SECTION_KEYS: SidebarSectionKey[] = [
  "overdue",
  "completed",
  "notifications",
  "search",
  "tags",
  "trash",
];

export const INCREMENTAL_PANEL_SECTION_KEYS: IncrementalPanelSectionKey[] = [
  "completed",
  "search",
  "tags",
  "trash",
];
