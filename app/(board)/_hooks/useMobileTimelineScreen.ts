"use client";

import { useMemo } from "react";
import type { TimelineBoardScreenProps } from "@/app/(board)/_components/timeline/TimelineBoardScreen";
import type { useTimelineBoardViewModels } from "@/app/(board)/_hooks/useTimelineBoardViewModels";
import { getTagsSectionPresentation } from "@/app/(board)/_components/timeline/tags-section-presentation";

type ViewModels = ReturnType<typeof useTimelineBoardViewModels>;

type UseMobileTimelineScreenArgs = {
  viewModels: ViewModels;
  viewMode: TimelineBoardScreenProps["mobile"]["viewMode"];
  timelineTransitionPending: boolean;
  leftPanelProps: TimelineBoardScreenProps["mobile"]["leftPanelProps"];
  mobileLeftPanelMode: "overdue" | "completed" | "notifications" | "search" | "tags" | "trash" | "none";
  selectedTags: string[];
  tagSummaries: Array<{ name: string; count: number }>;
  tagResults: unknown[];
  searchQuery: string;
  overdueCount: number;
  onMobileLeftPanelSelect: (key: "overdue" | "completed" | "notifications" | "search" | "tags" | "trash") => void;
  overdueSortOrder: TimelineBoardScreenProps["desktop"]["overdueSortOrder"];
  onOverdueSortOrderChange: TimelineBoardScreenProps["desktop"]["onOverdueSortOrderChange"];
};

export function useMobileTimelineScreen({
  viewModels,
  viewMode,
  timelineTransitionPending,
  leftPanelProps,
  mobileLeftPanelMode,
  selectedTags,
  tagSummaries,
  tagResults,
  searchQuery,
  overdueCount,
  onMobileLeftPanelSelect,
  overdueSortOrder,
  onOverdueSortOrderChange,
}: UseMobileTimelineScreenArgs): TimelineBoardScreenProps["mobile"] {
  const currentMobileSection = useMemo(
    () =>
      leftPanelProps.sections.find((section) => section.key === mobileLeftPanelMode) ??
      leftPanelProps.sections.find((section) => section.key === "overdue"),
    [leftPanelProps.sections, mobileLeftPanelMode],
  );

  const tagsSectionPresentation = useMemo(
    () =>
      getTagsSectionPresentation({
        selectedTag: selectedTags[0] ?? null,
        tagSummariesCount: tagSummaries.length,
        tagResultsCount: tagResults.length,
      }),
    [selectedTags, tagResults.length, tagSummaries.length],
  );

  return useMemo(
    () => ({
      viewMode,
      timelineTransitionPending,
      timelineProps: viewModels.mobile.timeline,
      listProps: viewModels.mobile.list,
      monthProps: viewModels.mobile.month,
      leftPanelProps,
      selectorPresentation: {
        currentSection:
          mobileLeftPanelMode === "completed" ||
          mobileLeftPanelMode === "notifications" ||
          mobileLeftPanelMode === "search" ||
          mobileLeftPanelMode === "tags" ||
          mobileLeftPanelMode === "trash"
            ? mobileLeftPanelMode
            : "overdue",
        selectorItems: leftPanelProps.sections.map((section) => ({
          key: section.key,
          label: section.label,
        })),
        triggerLabel:
          currentMobileSection?.key === "search"
            ? searchQuery.trim() || "Search"
            : currentMobileSection?.key === "tags"
              ? tagsSectionPresentation.triggerLabel
              : currentMobileSection?.label ?? "Overdue",
        onSelect: onMobileLeftPanelSelect,
      },
      currentSectionChrome: {
        title: currentMobileSection?.label ?? "Overdue",
        count: currentMobileSection?.count ?? overdueCount,
        tone: currentMobileSection?.tone ?? "danger",
        headerAccessory:
          mobileLeftPanelMode === "overdue"
            ? {
                kind: "overdue-sort" as const,
                order: overdueSortOrder,
                onChange: onOverdueSortOrderChange,
              }
            : null,
        secondaryActionsKind: mobileLeftPanelMode === "notifications" ? "notifications" : null,
      },
    }),
    [
      currentMobileSection,
      leftPanelProps,
      mobileLeftPanelMode,
      onMobileLeftPanelSelect,
      onOverdueSortOrderChange,
      overdueCount,
      overdueSortOrder,
      searchQuery,
      tagsSectionPresentation.triggerLabel,
      timelineTransitionPending,
      viewMode,
      viewModels.mobile.list,
      viewModels.mobile.month,
      viewModels.mobile.timeline,
    ],
  );
}
