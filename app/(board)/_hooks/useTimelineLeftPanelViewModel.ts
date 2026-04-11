"use client";

import { useMemo } from "react";
import type {
  DesktopSidebarMenuActions,
  DesktopSidebarMenuState,
  DesktopSidebarSection,
} from "@/app/(board)/_components/timeline/DesktopSidebarMenu";
import { getTagsSectionPresentation } from "@/app/(board)/_components/timeline/tags-section-presentation";
import { featureFlags } from "@/lib/featureFlags";
import type { UseTimelineBoardViewModelsArgs } from "@/app/(board)/_hooks/useTimelineBoardViewModels";

type LeftPanelArgs = Pick<
  UseTimelineBoardViewModelsArgs,
  | "activeLeftSectionKey"
  | "expandedSectionKey"
  | "searchQuery"
  | "selectedTags"
  | "tagSummaries"
  | "tagResults"
  | "overdue"
  | "completedCurrentMonthCount"
  | "completedCurrentMonthKey"
  | "completedResetKey"
  | "completedGroupedResults"
  | "completedResults"
  | "notificationUnreadCount"
  | "searchResults"
  | "trashItems"
  | "onExpandedSectionChange"
  | "setSearchQuery"
  | "setSelectedTags"
  | "onOpenNotificationSettings"
  | "viewMode"
>;

export function useTimelineLeftPanelViewModel(args: LeftPanelArgs) {
  const onExpandedSectionChange = args.onExpandedSectionChange;
  const setSearchQuery = args.setSearchQuery;
  const setSelectedTags = args.setSelectedTags;
  const tagsSectionPresentation = useMemo(
    () =>
      getTagsSectionPresentation({
        selectedTag: args.selectedTags[0] ?? null,
        tagSummariesCount: args.tagSummaries.length,
        tagResultsCount: args.tagResults.length,
      }),
    [args.selectedTags, args.tagResults, args.tagSummaries],
  );

  const state = useMemo<DesktopSidebarMenuState>(
    () => ({
      activeSectionKey: args.activeLeftSectionKey,
      expandedSectionKey: args.expandedSectionKey,
      searchQuery: args.searchQuery,
      selectedTags: args.selectedTags,
    }),
    [args.activeLeftSectionKey, args.expandedSectionKey, args.searchQuery, args.selectedTags],
  );

  const actions = useMemo<DesktopSidebarMenuActions>(
    () => ({
      onExpandedSectionChange,
      onSearchQueryChange: setSearchQuery,
      onTagToggle: (value: string) =>
        setSelectedTags((prev) => (prev.length === 1 && prev[0] === value ? [] : [value])),
      onTagClear: () => setSelectedTags([]),
    }),
    [onExpandedSectionChange, setSearchQuery, setSelectedTags],
  );

  const sections = useMemo<DesktopSidebarSection[]>(() => {
    const nextSections: DesktopSidebarSection[] = [
      {
        key: "overdue",
        tone: "danger",
        id: "desktop-sidebar-overdue-panel",
        label: "Overdue",
        count: args.overdue.length,
        items: args.overdue,
      },
      {
        key: "completed",
        tone: "neutral",
        id: "desktop-sidebar-completed-panel",
        label: "Completed",
        count: args.completedCurrentMonthCount,
        currentMonthCount: args.completedCurrentMonthCount,
        currentMonthKey: args.completedCurrentMonthKey,
        resetKey: args.completedResetKey,
        groupedResults: args.completedGroupedResults,
        results: args.completedResults,
      },
    ];

    if (featureFlags.notifications) {
      nextSections.push({
        key: "notifications",
        tone: "neutral",
        id: "desktop-sidebar-notifications-panel",
        label: "Notifications",
        count: args.notificationUnreadCount,
      });
    }

    nextSections.push(
      {
        key: "search",
        tone: "neutral",
        id: "desktop-sidebar-search-panel",
        label: "Search",
        count: args.searchQuery.trim() ? args.searchResults.length : 0,
        results: args.searchResults,
      },
      {
        key: "tags",
        tone: "neutral",
        id: "desktop-sidebar-tags-panel",
        label: tagsSectionPresentation.label,
        count: tagsSectionPresentation.count,
        tags: args.tagSummaries,
        results: args.tagResults,
      },
      {
        key: "trash",
        tone: "neutral",
        id: "desktop-sidebar-trash-panel",
        label: "Trash",
        count: args.trashItems.length,
        items: args.trashItems,
      },
    );

    return nextSections;
  }, [
    args.completedCurrentMonthCount,
    args.completedCurrentMonthKey,
    args.completedGroupedResults,
    args.completedResetKey,
    args.completedResults,
    args.notificationUnreadCount,
    args.overdue,
    args.searchQuery,
    args.searchResults,
    args.tagResults,
    args.tagSummaries,
    args.trashItems,
    tagsSectionPresentation,
  ]);

  return {
    state,
    actions,
    sections,
    allowOverdueDrag: args.viewMode === "timeline",
    onOpenNotificationSettings: args.onOpenNotificationSettings,
  };
}
