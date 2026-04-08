"use client";

import { useMemo } from "react";
import clsx from "clsx";

import type { TimelineSearchResultItem, TimelineTagSummary } from "@/app/(board)/_hooks/useTimelineFiltering";
import type { TimelineOverdueItem } from "@/app/(board)/_utils/timeline-helpers";
import type { OverdueSortOrder } from "@/lib/timeline-overdue-sort";
import type { Notification } from "@/lib/supabase";
import type { TrashCardItem } from "@/lib/api-types/timeline";
import { SidebarSectionShell } from "@/app/(board)/_components/timeline/SidebarSectionShell";
import {
  CompletedSectionBody,
  OverdueSectionBody,
  SearchSectionBody,
  TagsSectionBody,
  TrashSectionBody,
} from "@/app/(board)/_components/timeline/TimelineLeftPanelShared";
import {
  NotificationsSectionActions,
  NotificationsSectionBody,
} from "@/app/(board)/_components/timeline/TimelineNotificationsShared";
import type { IncrementalPanelSectionKey, SidebarSectionKey } from "@/app/(board)/_components/timeline/sidebar-section-types";

type SidebarSectionTone = "danger" | "neutral";

export type DesktopSidebarMenuState = {
  activeSectionKey: SidebarSectionKey | null;
  expandedSectionKey: SidebarSectionKey | null;
  searchQuery: string;
  selectedTags: readonly string[];
};

export type DesktopSidebarMenuActions = {
  onExpandedSectionChange: (key: SidebarSectionKey | null) => void;
  onSearchQueryChange: (value: string) => void;
  onTagToggle: (value: string) => void;
  onTagClear: () => void;
};

export type SidebarVisibleCountState = Record<IncrementalPanelSectionKey, number>;

type DesktopSidebarSectionBase = {
  key: SidebarSectionKey;
  tone: SidebarSectionTone;
  id: string;
  label: string;
  count: number;
};

export type DesktopSidebarSection =
  | (DesktopSidebarSectionBase & {
      key: "overdue";
      tone: "danger";
      items: readonly TimelineOverdueItem[];
    })
  | (DesktopSidebarSectionBase & {
      key: "completed";
      tone: "neutral";
      results: readonly TimelineSearchResultItem[];
    })
  | (DesktopSidebarSectionBase & {
      key: "notifications";
      tone: "neutral";
    })
  | (DesktopSidebarSectionBase & {
      key: "search";
      tone: "neutral";
      results: readonly TimelineSearchResultItem[];
    })
  | (DesktopSidebarSectionBase & {
      key: "tags";
      tone: "neutral";
      tags: readonly TimelineTagSummary[];
      results: readonly TimelineSearchResultItem[];
    })
  | (DesktopSidebarSectionBase & {
      key: "trash";
      tone: "neutral";
      items: readonly TrashCardItem[];
    });

type DesktopSidebarMenuProps = {
  state: DesktopSidebarMenuState;
  actions: DesktopSidebarMenuActions;
  sections: readonly DesktopSidebarSection[];
  visibleCounts: SidebarVisibleCountState;
  onVisibleCountChange: (section: IncrementalPanelSectionKey, nextCount: number) => void;
  overdueSortOrder: OverdueSortOrder;
  onOverdueSortOrderChange: (order: OverdueSortOrder) => void;
  allowOverdueDrag: boolean;
  notifications: readonly Notification[];
  notificationsLoading: boolean;
  notificationsError: string | null;
  notificationUnreadCount: number;
  notificationFeedback: string | null;
  onRetryNotifications: () => void;
  onMarkAllNotificationsRead: () => void;
  onOpenNotification: (notification: Notification) => void;
  onOpenNotificationSettings: () => void;
  onRestoreTrashCard: (cardId: string) => Promise<boolean>;
  openCardModal: (shortId: string | null, source: string) => void;
  onToggleCheck: (cardId: string, checked: boolean) => void;
  onRenameCardTitle?: (cardId: string, nextTitle: string) => Promise<boolean>;
  onCardContextMenu: (e: React.MouseEvent, cardId: string) => void;
  onCardContextMenuByKeyboard: (cardId: string, rect: DOMRect) => void;
  contextMenuCardId: string | null;
  selectedCardIds: ReadonlySet<string>;
  selectionLeadCardId: string | null;
  onShiftSelect: (args: {
    cardId: string;
    laneId: string;
    activeCardId: string | null;
    activeLaneId: string | null;
  }) => void;
  onClearSelection: () => void;
  onActivateCard: (cardId: string, laneId: string) => void;
  activeCardId: string | null;
  activeLaneId: string | null;
};

function OverdueSortToggle({
  order,
  onChange,
  testId,
}: {
  order: OverdueSortOrder;
  onChange: (order: OverdueSortOrder) => void;
  testId: string;
}) {
  const nextOrder = order === "oldest" ? "newest" : "oldest";
  const currentLabel = order === "oldest" ? "古い順" : "新しい順";
  const nextLabel = nextOrder === "oldest" ? "古い順" : "新しい順";

  return (
    <button
      type="button"
      data-testid={testId}
      data-order={order}
      onClick={() => onChange(nextOrder)}
      aria-label={`Overdue の並び順を${nextLabel}に切り替え`}
      title={`現在: ${currentLabel}`}
      className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
    >
      <svg className="h-3 w-3" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d={order === "oldest" ? "M6 14l4-4 4 4M10 6v8" : "M6 6l4 4 4-4M10 14V6"} />
      </svg>
      <span>{currentLabel}</span>
    </button>
  );
}

function OverdueIcon() {
  return (
    <svg className="h-[1.125rem] w-[1.125rem]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v5l3 2" />
      <circle cx="12" cy="12" r="8" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 6l1.5-1.5" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg className="h-[1.125rem] w-[1.125rem]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="11" cy="11" r="6" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m20 20-4.2-4.2" />
    </svg>
  );
}

function CompletedIcon() {
  return (
    <svg className="h-[1.125rem] w-[1.125rem]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m8.5 12 2.2 2.2 4.8-4.9" />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg className="h-[1.125rem] w-[1.125rem]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 5h7l2 2v7l-8 8-6-6 8-8Z" />
      <circle cx="14.5" cy="9.5" r="1.25" fill="currentColor" stroke="none" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="h-[1.125rem] w-[1.125rem]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 7V5.75A1.75 1.75 0 0 1 10.75 4h2.5A1.75 1.75 0 0 1 15 5.75V7" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 7l.7 11.2A2 2 0 0 0 9.7 20h4.6a2 2 0 0 0 1.99-1.8L17 7" />
    </svg>
  );
}

function NotificationIcon() {
  return (
    <svg className="h-[1.125rem] w-[1.125rem]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h4l-1.1-1.1a2 2 0 0 1-.58-1.42V11a5.3 5.3 0 0 0-3.25-4.88V5a2.07 2.07 0 1 0-4.14 0v1.12A5.3 5.3 0 0 0 6.68 11v3.48c0 .53-.21 1.04-.58 1.42L5 17h4" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.5 17a2.5 2.5 0 0 0 5 0" />
    </svg>
  );
}

function SidebarRailButton({
  id,
  label,
  count,
  tone,
  expanded,
  onToggle,
  children,
}: {
  id: string;
  label: string;
  count: number;
  tone: SidebarSectionTone;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const isDanger = tone === "danger";
  const badgeClassName = isDanger
    ? count > 0
      ? "bg-rose-500 text-white"
      : "bg-rose-300 text-white"
    : count > 0
      ? "bg-slate-700 text-white"
      : "bg-slate-400 text-white";

  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={expanded}
      aria-controls={id}
      data-focus-group="sidebar"
      data-focus-part="rail-button"
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key !== "ArrowRight" || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
          return;
        }

        const root = event.currentTarget.closest('[data-testid="desktop-sidebar-shell"]') ?? document;
        const visiblePanel = root.querySelector<HTMLElement>('[id^="desktop-sidebar-"][aria-hidden="false"]');
        const panel = visiblePanel ?? document.getElementById(id);
        if (!panel || panel.hidden || panel.getAttribute("aria-hidden") === "true") {
          return;
        }

        const focusableSelector = [
          '[data-focus-group][data-focus-part][tabindex]:not([tabindex="-1"])',
          'button:not([disabled])',
          'a[href]',
          'input:not([disabled])',
          'textarea:not([disabled])',
          'select:not([disabled])',
          '[tabindex]:not([tabindex="-1"])',
        ].join(", ");

        const nextTarget = Array.from(panel.querySelectorAll(focusableSelector))
          .filter((element): element is HTMLElement => element instanceof HTMLElement)
          .find((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });

        if (!nextTarget) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        window.requestAnimationFrame(() => {
          nextTarget.focus();
        });
      }}
      data-testid={`${id}-toggle`}
      className={clsx(
        "group relative z-10 flex h-8 w-8 items-center justify-center overflow-visible rounded-lg border transition-all duration-150",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
        expanded
          ? isDanger
            ? "border-rose-200 bg-white text-rose-700 shadow-[0_10px_24px_-18px_rgba(251,113,133,0.7)] focus-visible:outline-rose-400"
            : "border-slate-300 bg-white text-slate-700 shadow-[0_10px_24px_-18px_rgba(100,116,139,0.45)] focus-visible:outline-slate-400"
          : "border-transparent bg-white/70 text-slate-500 hover:border-slate-200 hover:bg-white hover:text-slate-800 focus-visible:outline-slate-400"
      )}
    >
      <span
        aria-hidden="true"
        className={clsx(
          "absolute left-[-5px] top-1/2 h-4 w-1 -translate-y-1/2 rounded-full transition-opacity duration-150",
          expanded ? (isDanger ? "bg-rose-300 opacity-100" : "bg-slate-300 opacity-100") : "opacity-0"
        )}
      />
      <span className="relative inline-flex items-center justify-center">
        {children}
        <span
          className={clsx(
            "absolute -right-[0.68rem] -top-[0.62rem] z-20 inline-flex h-[1.05rem] min-w-[1.05rem] items-center justify-center rounded-full px-[0.22rem] text-center text-[8px] font-semibold leading-none shadow-sm",
            badgeClassName
          )}
          data-testid={`${id}-count`}
        >
          {count}
        </span>
      </span>
    </button>
  );
}

export function DesktopSidebarMenu({
  state,
  actions,
  sections,
  visibleCounts,
  onVisibleCountChange,
  overdueSortOrder,
  onOverdueSortOrderChange,
  allowOverdueDrag,
  notifications,
  notificationsLoading,
  notificationsError,
  notificationUnreadCount,
  notificationFeedback,
  onRetryNotifications,
  onMarkAllNotificationsRead,
  onOpenNotification,
  onOpenNotificationSettings,
  onRestoreTrashCard,
  openCardModal,
  onToggleCheck,
  onRenameCardTitle,
  onCardContextMenu,
  onCardContextMenuByKeyboard,
  contextMenuCardId,
  selectedCardIds,
  selectionLeadCardId,
  onShiftSelect,
  onClearSelection,
  onActivateCard,
  activeCardId,
  activeLaneId,
}: DesktopSidebarMenuProps) {
  const allSections = useMemo(() => sections, [sections]);

  const handleToggleSection = (key: SidebarSectionKey) => {
    actions.onExpandedSectionChange(state.expandedSectionKey === key ? null : key);
  };

  const getSectionIcon = (key: SidebarSectionKey) => {
    switch (key) {
      case "overdue":
        return <OverdueIcon />;
      case "completed":
        return <CompletedIcon />;
      case "notifications":
        return <NotificationIcon />;
      case "search":
        return <SearchIcon />;
      case "tags":
        return <TagIcon />;
      case "trash":
        return <TrashIcon />;
      default:
        return null;
    }
  };

  const renderSectionContent = (section: DesktopSidebarSection) => {
    if (section.key === "overdue") {
      return (
        <OverdueSectionBody
          items={section.items}
          allowDrag={allowOverdueDrag}
          openCardModal={openCardModal}
          onToggleCheck={onToggleCheck}
          onRenameCardTitle={onRenameCardTitle}
          onCardContextMenu={onCardContextMenu}
          onCardContextMenuByKeyboard={onCardContextMenuByKeyboard}
          contextMenuCardId={contextMenuCardId}
          selectedCardIds={selectedCardIds}
          selectionLeadCardId={selectionLeadCardId}
          onShiftSelect={onShiftSelect}
          onClearSelection={onClearSelection}
          onActivateCard={onActivateCard}
          activeCardId={activeCardId}
          activeLaneId={activeLaneId}
        />
      );
    }

    if (section.key === "notifications") {
      return (
        <NotificationsSectionBody
          notifications={notifications}
          loading={notificationsLoading}
          error={notificationsError}
          feedback={notificationFeedback}
          onRetry={onRetryNotifications}
          onOpenNotification={onOpenNotification}
        />
      );
    }

    if (section.key === "search") {
      return (
        <SearchSectionBody
          query={state.searchQuery}
          results={section.results}
          onQueryChange={actions.onSearchQueryChange}
          visibleCount={visibleCounts.search}
          onVisibleCountChange={(nextCount) => onVisibleCountChange("search", nextCount)}
          openCardModal={openCardModal}
          onToggleCheck={onToggleCheck}
          onRenameCardTitle={undefined}
          onCardContextMenu={onCardContextMenu}
          onCardContextMenuByKeyboard={onCardContextMenuByKeyboard}
          contextMenuCardId={contextMenuCardId}
          selectedCardIds={selectedCardIds}
          selectionLeadCardId={selectionLeadCardId}
          onShiftSelect={onShiftSelect}
          onClearSelection={onClearSelection}
          onActivateCard={onActivateCard}
          activeCardId={activeCardId}
          activeLaneId={activeLaneId}
        />
      );
    }

    if (section.key === "completed") {
      return (
        <CompletedSectionBody
          results={section.results}
          visibleCount={visibleCounts.completed}
          onVisibleCountChange={(nextCount) => onVisibleCountChange("completed", nextCount)}
          openCardModal={openCardModal}
          onToggleCheck={onToggleCheck}
          onRenameCardTitle={undefined}
          onCardContextMenu={onCardContextMenu}
          onCardContextMenuByKeyboard={onCardContextMenuByKeyboard}
          contextMenuCardId={contextMenuCardId}
          selectedCardIds={selectedCardIds}
          selectionLeadCardId={selectionLeadCardId}
          onShiftSelect={onShiftSelect}
          onClearSelection={onClearSelection}
          onActivateCard={onActivateCard}
          activeCardId={activeCardId}
          activeLaneId={activeLaneId}
        />
      );
    }

    if (section.key === "trash") {
      return (
        <TrashSectionBody
          items={section.items}
          visibleCount={visibleCounts.trash}
          onVisibleCountChange={(nextCount) => onVisibleCountChange("trash", nextCount)}
          onRestoreTrashCard={onRestoreTrashCard}
          openCardModal={openCardModal}
        />
      );
    }

    return (
      <TagsSectionBody
        tags={section.tags}
        results={section.results}
        selectedTags={state.selectedTags}
        onTagToggle={actions.onTagToggle}
        onTagClear={actions.onTagClear}
        visibleCount={visibleCounts.tags}
        onVisibleCountChange={(nextCount) => onVisibleCountChange("tags", nextCount)}
        openCardModal={openCardModal}
        onToggleCheck={onToggleCheck}
        onRenameCardTitle={undefined}
        onCardContextMenu={onCardContextMenu}
        onCardContextMenuByKeyboard={onCardContextMenuByKeyboard}
        contextMenuCardId={contextMenuCardId}
        selectedCardIds={selectedCardIds}
        selectionLeadCardId={selectionLeadCardId}
        onShiftSelect={onShiftSelect}
        onClearSelection={onClearSelection}
        onActivateCard={onActivateCard}
        activeCardId={activeCardId}
        activeLaneId={activeLaneId}
      />
    );
  };

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(241,245,249,0.94))]">
      <div className="z-10 flex w-[2.5rem] shrink-0 flex-col items-center gap-2 overflow-visible border-r border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(248,250,252,0.8))] px-0.5 py-2.5">
        <div className="h-0.5" aria-hidden="true" />
        {allSections.map((section) => (
          <SidebarRailButton
            key={section.key}
            id={section.id}
            label={section.label}
            count={section.count}
            tone={section.tone}
            expanded={state.expandedSectionKey === section.key}
            onToggle={() => handleToggleSection(section.key)}
          >
            {getSectionIcon(section.key)}
          </SidebarRailButton>
        ))}
      </div>

      {state.expandedSectionKey ? (
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {allSections.map((section) => {
            const expanded = state.expandedSectionKey === section.key;

            return (
              <SidebarSectionShell
                key={section.key}
                title={section.label}
                count={section.count}
                tone={section.tone}
                panelId={section.id}
                expanded={expanded}
                headerAccessory={
                  section.key === "overdue" ? (
                    <OverdueSortToggle
                      order={overdueSortOrder}
                      onChange={onOverdueSortOrderChange}
                      testId="desktop-sidebar-overdue-sort-toggle"
                    />
                  ) : null
                }
                secondaryActions={
                  expanded && section.key === "notifications" ? (
                    <NotificationsSectionActions
                      unreadCount={notificationUnreadCount}
                      onMarkAllAsRead={onMarkAllNotificationsRead}
                      onOpenSettings={onOpenNotificationSettings}
                    />
                  ) : null
                }
                headerClassName={section.tone === "danger" ? "bg-rose-50/40" : undefined}
              >
                {renderSectionContent(section)}
              </SidebarSectionShell>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
