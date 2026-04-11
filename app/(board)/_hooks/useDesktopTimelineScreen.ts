"use client";

import { useMemo } from "react";
import type { TimelineBoardScreenProps } from "@/app/(board)/_components/timeline/TimelineBoardScreen";
import type { useTimelineBoardViewModels } from "@/app/(board)/_hooks/useTimelineBoardViewModels";

type ViewModels = ReturnType<typeof useTimelineBoardViewModels>;

type UseDesktopTimelineScreenArgs = {
  viewModels: ViewModels;
  timelineTransitionPending: boolean;
  overdueSortOrder: TimelineBoardScreenProps["desktop"]["overdueSortOrder"];
  onOverdueSortOrderChange: TimelineBoardScreenProps["desktop"]["onOverdueSortOrderChange"];
  handleRenameCardTitle: NonNullable<TimelineBoardScreenProps["desktop"]["timelineViewProps"]["onRenameCardTitle"]>;
  sensors: TimelineBoardScreenProps["desktop"]["dndProps"]["sensors"];
  handleDragStart: TimelineBoardScreenProps["desktop"]["dndProps"]["handleDragStart"];
  handleDragMove: TimelineBoardScreenProps["desktop"]["dndProps"]["handleDragMove"];
  handleDragEnd: TimelineBoardScreenProps["desktop"]["dndProps"]["handleDragEnd"];
  handleDragCancel: TimelineBoardScreenProps["desktop"]["dndProps"]["handleDragCancel"];
  overlayCardData: TimelineBoardScreenProps["desktop"]["overlayProps"]["overlayCardData"];
  overlayTimelineEvent: TimelineBoardScreenProps["desktop"]["overlayProps"]["overlayTimelineEvent"];
  overlayBucketEntryItem: TimelineBoardScreenProps["desktop"]["overlayProps"]["overlayBucketCard"];
  overlayOverdueEntryItem: TimelineBoardScreenProps["desktop"]["overlayProps"]["overlayOverdueCard"];
  leftPanelProps: TimelineBoardScreenProps["desktop"]["leftPanelProps"];
};

export function useDesktopTimelineScreen({
  viewModels,
  timelineTransitionPending,
  overdueSortOrder,
  onOverdueSortOrderChange,
  handleRenameCardTitle,
  sensors,
  handleDragStart,
  handleDragMove,
  handleDragEnd,
  handleDragCancel,
  overlayCardData,
  overlayTimelineEvent,
  overlayBucketEntryItem,
  overlayOverdueEntryItem,
  leftPanelProps,
}: UseDesktopTimelineScreenArgs): TimelineBoardScreenProps["desktop"] {
  return useMemo(
    () => ({
      activeView: viewModels.desktop.mainPanel.tabs.activeKey,
      timelineTransitionPending,
      tabItems: viewModels.desktop.mainPanel.tabs.items.filter((item) =>
        viewModels.desktop.mainPanel.tabs.availableKeys.includes(item.key),
      ),
      onTabChange: viewModels.desktop.mainPanel.tabs.onChange,
      leftPanelProps,
      overdueSortOrder,
      onOverdueSortOrderChange,
      timelineToolbarProps: viewModels.desktop.mainPanel.views.timeline.toolbar,
      timelineViewProps: {
        ...viewModels.desktop.mainPanel.views.timeline.body,
        onRenameCardTitle: handleRenameCardTitle,
      },
      listToolbarProps: viewModels.desktop.mainPanel.views.list.toolbar,
      listViewProps: {
        ...viewModels.desktop.mainPanel.views.list.body,
        onRenameCardTitle: handleRenameCardTitle,
      },
      monthToolbarProps: viewModels.desktop.mainPanel.views.month.toolbar,
      monthViewProps: {
        ...viewModels.desktop.mainPanel.views.month.body,
        onRenameCardTitle: handleRenameCardTitle,
      },
      dndProps: {
        sensors,
        handleDragStart,
        handleDragMove,
        handleDragEnd,
        handleDragCancel,
      },
      overlayProps: {
        overlayCardData,
        overlayTimelineEvent,
        overlayBucketCard: overlayBucketEntryItem,
        overlayOverdueCard: overlayOverdueEntryItem,
      },
    }),
    [
      handleDragCancel,
      handleDragEnd,
      handleDragMove,
      handleDragStart,
      handleRenameCardTitle,
      leftPanelProps,
      onOverdueSortOrderChange,
      overdueSortOrder,
      overlayBucketEntryItem,
      overlayCardData,
      overlayOverdueEntryItem,
      overlayTimelineEvent,
      sensors,
      timelineTransitionPending,
      viewModels.desktop.mainPanel.tabs.activeKey,
      viewModels.desktop.mainPanel.tabs.availableKeys,
      viewModels.desktop.mainPanel.tabs.items,
      viewModels.desktop.mainPanel.tabs.onChange,
      viewModels.desktop.mainPanel.views.list.body,
      viewModels.desktop.mainPanel.views.list.toolbar,
      viewModels.desktop.mainPanel.views.month.body,
      viewModels.desktop.mainPanel.views.month.toolbar,
      viewModels.desktop.mainPanel.views.timeline.body,
      viewModels.desktop.mainPanel.views.timeline.toolbar,
    ],
  );
}
