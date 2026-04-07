"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";

import type { TimelineSearchResultItem, TimelineTagSummary } from "@/app/(board)/_hooks/useTimelineFiltering";
import type { TimelineOverdueItem } from "@/app/(board)/_utils/timeline-helpers";
import { useNotificationsStore } from "@/app/(board)/_stores/notifications-store";
import { featureFlags } from "@/lib/featureFlags";
import type { OverdueSortOrder } from "@/lib/timeline-overdue-sort";
import type { Notification } from "@/lib/supabase";
import type { TrashCardItem } from "@/lib/api-types/timeline";
import {
  OverdueSectionBody,
  SearchSectionBody,
  SharedPanelHeader,
  TagsSectionBody,
  TrashSectionBody,
} from "@/app/(board)/_components/timeline/TimelineLeftPanelShared";

export type SidebarSectionKey = "overdue" | "notifications" | "search" | "tags" | "trash";
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

export type DesktopSidebarSection =
  | {
      key: "overdue";
      tone: "danger";
      id: string;
      label: string;
      count: number;
      items: readonly TimelineOverdueItem[];
    }
  | {
      key: "notifications";
      tone: "neutral";
      id: string;
      label: string;
      count: number;
    }
  | {
      key: "search";
      tone: "neutral";
      id: string;
      label: string;
      count: number;
      results: readonly TimelineSearchResultItem[];
    }
  | {
      key: "tags";
      tone: "neutral";
      id: string;
      label: string;
      count: number;
      tags: readonly TimelineTagSummary[];
      results: readonly TimelineSearchResultItem[];
    }
  | {
      key: "trash";
      tone: "neutral";
      id: string;
      label: string;
      count: number;
      items: readonly TrashCardItem[];
    };

export type DesktopSidebarHeaderSlot =
  | {
      sectionKey: SidebarSectionKey;
      actions: React.ReactNode;
    }
  | null;

type DesktopSidebarMenuProps = {
  state: DesktopSidebarMenuState;
  actions: DesktopSidebarMenuActions;
  sections: readonly DesktopSidebarSection[];
  headerSlot?: DesktopSidebarHeaderSlot;
  overdueSortOrder: OverdueSortOrder;
  onOverdueSortOrderChange: (order: OverdueSortOrder) => void;
  allowOverdueDrag: boolean;
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
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v5l3 2" />
      <circle cx="12" cy="12" r="8" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 6l1.5-1.5" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="11" cy="11" r="6" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m20 20-4.2-4.2" />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 5h7l2 2v7l-8 8-6-6 8-8Z" />
      <circle cx="14.5" cy="9.5" r="1.25" fill="currentColor" stroke="none" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 7V5.75A1.75 1.75 0 0 1 10.75 4h2.5A1.75 1.75 0 0 1 15 5.75V7" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 7l.7 11.2A2 2 0 0 0 9.7 20h4.6a2 2 0 0 0 1.99-1.8L17 7" />
    </svg>
  );
}

function NotificationIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h4l-1.1-1.1a2 2 0 0 1-.58-1.42V11a5.3 5.3 0 0 0-3.25-4.88V5a2.07 2.07 0 1 0-4.14 0v1.12A5.3 5.3 0 0 0 6.68 11v3.48c0 .53-.21 1.04-.58 1.42L5 17h4" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.5 17a2.5 2.5 0 0 0 5 0" />
    </svg>
  );
}

const RELATIVE_TIME_FORMATTER = new Intl.RelativeTimeFormat("ja", { numeric: "auto" });

function formatRelativeDateTime(iso: string) {
  const target = new Date(iso);
  const diffMs = target.getTime() - Date.now();
  const diffMinutes = Math.round(diffMs / 60000);
  const absolute = new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(target);

  if (Math.abs(diffMinutes) < 1) {
    return { relative: `たった今 [ ${absolute} ]`, absolute };
  }
  if (Math.abs(diffMinutes) < 60) {
    return { relative: `${RELATIVE_TIME_FORMATTER.format(diffMinutes, "minute")} [ ${absolute} ]`, absolute };
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) {
    return { relative: `${RELATIVE_TIME_FORMATTER.format(diffHours, "hour")} [ ${absolute} ]`, absolute };
  }

  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffDays) < 7) {
    return { relative: `${RELATIVE_TIME_FORMATTER.format(diffDays, "day")} [ ${absolute} ]`, absolute };
  }

  return { relative: absolute, absolute };
}

function buildNotificationHeadline(notification: Notification) {
  const changeSummary =
    typeof notification.payload?.change_summary === "string" && notification.payload.change_summary.trim().length > 0
      ? notification.payload.change_summary.trim()
      : null;
  if (changeSummary) return changeSummary;

  const timeChange = notification.payload?.time_change;
  if (timeChange && typeof timeChange === "object") {
    const field = timeChange.field === "end" ? "終了" : "開始";
    const before = typeof timeChange.before === "string" && timeChange.before.trim().length > 0 ? timeChange.before : "未設定";
    const after = typeof timeChange.after === "string" && timeChange.after.trim().length > 0 ? timeChange.after : "未設定";
    return `${field} ${before} → ${after}`;
  }

  if (notification.type === "assignee_changed") return "担当に追加されました";
  if (notification.type === "due_soon") return null;
  if (notification.type === "comment_reply" || notification.type === "comment_replied") return "コメントに返信がありました";
  if (notification.type === "comment_created") return "新しいコメントがあります";
  if (notification.type === "mention") return "メンションされました";
  return null;
}

function buildNotificationTitle(notification: Notification) {
  const payloadTitle = typeof notification.payload?.card_title === "string" ? notification.payload.card_title.trim() : "";
  if (payloadTitle.length > 0) return payloadTitle;
  const message = typeof notification.payload?.message === "string" ? notification.payload.message.trim() : "";
  if (message.length > 0) return message;
  return "Untitled card";
}

function NotificationActivityRow({
  notification,
  onOpen,
}: {
  notification: Notification;
  onOpen: (notification: Notification) => void;
}) {
  const { relative, absolute } = formatRelativeDateTime(notification.created_at);
  const isUnread = !notification.read_at;
  const commentBody =
    typeof notification.payload?.comment_body === "string" && notification.payload.comment_body.trim().length > 0
      ? notification.payload.comment_body.trim()
      : null;
  const title = buildNotificationTitle(notification);
  const headline = buildNotificationHeadline(notification);
  const canOpen = typeof notification.payload?.card_short_id === "string" && notification.payload.card_short_id.trim().length > 0;

  return (
    <button
      type="button"
      onClick={() => onOpen(notification)}
      className={clsx(
        "group relative w-full rounded-none border px-2 py-1.5 text-left shadow-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500",
        isUnread
          ? "border-sky-200 bg-sky-50/80 hover:border-sky-300 hover:bg-sky-50"
          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/80"
      )}
      aria-label={isUnread ? `${title} 未読通知` : `${title} 通知`}
      title={canOpen ? absolute : `${absolute} / この通知はカードを開けません`}
    >
      <span
        aria-hidden="true"
        className={clsx(
          "absolute inset-y-1 left-0 w-1 rounded-r-full",
          isUnread ? "bg-sky-500" : "bg-transparent"
        )}
      />
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 pt-1">
          <div className="flex items-start gap-1.5 pr-9">
            <span
              className="absolute -top-4 left-0 bg-transparent px-0 text-[10px] font-normal text-slate-500"
              title={absolute}
            >
              {relative}
            </span>
            {isUnread ? (
              <span
                aria-hidden="true"
                className="mt-[0.4rem] h-2 w-2 shrink-0 rounded-full bg-sky-600"
              />
            ) : null}
            <p
              className={clsx(
                "min-w-0 whitespace-pre-wrap break-words text-[11px] leading-tight text-slate-800",
                isUnread ? "font-semibold text-slate-900" : "font-semibold text-slate-800"
              )}
            >
              {title}
            </p>
          </div>
          {headline ? (
            <p className="mt-0.5 text-[10px] leading-tight text-slate-600">{headline}</p>
          ) : null}
          {commentBody ? (
            <p className="mt-0.5 line-clamp-2 text-[10px] leading-tight text-slate-500">{commentBody}</p>
          ) : null}
          {!canOpen ? (
            <p className="mt-0.5 text-[11px] text-amber-700">この通知は既読になりますが、カードは開けません</p>
          ) : null}
        </div>
        <span
          aria-hidden="true"
          className="absolute right-2 top-2 inline-flex h-4 w-4 items-center justify-center rounded-sm border border-slate-200 bg-white text-slate-500 transition group-hover:border-sky-300 group-hover:text-sky-600"
        >
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 5h5v5" />
            <path d="M10 14 19 5" />
            <path d="M19 14v4a1 1 0 0 1-1 1h-4" />
            <path d="M10 5H6a1 1 0 0 0-1 1v4" />
          </svg>
        </span>
      </div>
    </button>
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
      ? "bg-rose-200 text-rose-800"
      : "bg-rose-100 text-rose-700"
    : count > 0
      ? "bg-slate-200 text-slate-800"
      : "bg-slate-200 text-slate-500";

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
        "group relative flex h-8 w-8 items-center justify-center rounded-lg border transition-all duration-150",
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
            "absolute -right-1.5 -top-1.5 min-w-[1rem] rounded-full px-[0.28rem] py-[0.18rem] text-center text-[8px] font-semibold leading-none shadow-sm",
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
  headerSlot = null,
  overdueSortOrder,
  onOverdueSortOrderChange,
  allowOverdueDrag,
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
  const [notificationFeedback, setNotificationFeedback] = useState<string | null>(null);
  const {
    notifications,
    loading: notificationsLoading,
    error: notificationsError,
    unreadCount,
    fetchNotifications,
    markAsRead,
    markAllAsRead,
  } = useNotificationsStore();

  const notificationSection = useMemo<DesktopSidebarSection | null>(() => {
    if (!featureFlags.notifications) return null;
    return {
      key: "notifications",
      tone: "neutral",
      id: "desktop-sidebar-notifications-panel",
      label: "Notifications",
      count: unreadCount,
    };
  }, [unreadCount]);

  const sortedNotifications = useMemo(() => {
    return [...notifications].sort((a, b) => {
      const createdDiff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (createdDiff !== 0) return createdDiff;
      return b.id.localeCompare(a.id);
    });
  }, [notifications]);

  const allSections = useMemo(() => {
    const overdueSection = sections.find((section) => section.key === "overdue");
    const searchSection = sections.find((section) => section.key === "search");
    const tagsSection = sections.find((section) => section.key === "tags");
    const trashSection = sections.find((section) => section.key === "trash");
    return [
      overdueSection,
      notificationSection,
      searchSection,
      tagsSection,
      trashSection,
    ].filter((section): section is DesktopSidebarSection => Boolean(section));
  }, [notificationSection, sections]);

  const resolvedHeaderSlot = useMemo<DesktopSidebarHeaderSlot>(() => {
    if (headerSlot) return headerSlot;
    if (!featureFlags.notifications) return null;
    return {
      sectionKey: "notifications",
      actions: (
        <>
          {unreadCount > 0 ? (
            <button
              type="button"
              onClick={() => {
                void markAllAsRead();
              }}
              className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 hover:border-slate-300 hover:text-slate-900"
            >
              Mark all read
            </button>
          ) : null}
          <button
            type="button"
            onClick={onOpenNotificationSettings}
            className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 hover:border-slate-300 hover:text-slate-900"
          >
            Settings
          </button>
        </>
      ),
    };
  }, [headerSlot, markAllAsRead, onOpenNotificationSettings, unreadCount]);

  const handleToggleSection = (key: SidebarSectionKey) => {
    actions.onExpandedSectionChange(state.expandedSectionKey === key ? null : key);
  };

  const getSectionIcon = (key: SidebarSectionKey) => {
    switch (key) {
      case "overdue":
        return <OverdueIcon />;
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

  const handleNotificationOpen = async (notification: Notification) => {
    setNotificationFeedback(null);
    await markAsRead(notification.id);
    const cardShortId =
      typeof notification.payload?.card_short_id === "string" ? notification.payload.card_short_id.trim() : "";
    if (!cardShortId) {
      setNotificationFeedback("この通知は既読にしました。関連カードは開けません。");
      return;
    }
    openCardModal(cardShortId, "notifications");
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
      if (notificationsLoading) {
        return (
          <div className="space-y-2 px-3 py-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="animate-pulse rounded-2xl border border-slate-200 bg-white px-3 py-3">
                <div className="h-3 w-1/3 rounded bg-slate-200" />
                <div className="mt-2 h-3 w-5/6 rounded bg-slate-200" />
                <div className="mt-2 h-3 w-2/3 rounded bg-slate-100" />
              </div>
            ))}
          </div>
        );
      }

      if (notificationsError) {
        return (
          <div className="px-3 py-4">
            <div className="rounded-2xl border border-rose-200 bg-rose-50/70 px-3 py-3 text-[11px] text-rose-700/90">
              <p>{notificationsError}</p>
              <button
                type="button"
                onClick={() => void fetchNotifications()}
                className="mt-2 rounded-full border border-rose-200 bg-white px-2 py-1 font-semibold text-rose-700"
              >
                再試行
              </button>
            </div>
          </div>
        );
      }

      if (sortedNotifications.length === 0) {
        return (
          <div className="px-3 py-4">
            <p className="rounded-2xl border border-dashed border-slate-200 bg-white/90 px-3 py-3 text-[11px] text-slate-500">
              通知はありません
            </p>
          </div>
        );
      }

      return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {notificationFeedback ? (
            <div className="px-3 pt-3">
              <p className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                {notificationFeedback}
              </p>
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-200 [scrollbar-gutter:stable]">
            <div className="space-y-4 px-2 py-4">
              {sortedNotifications.map((notification) => (
                <NotificationActivityRow
                  key={notification.id}
                  notification={notification}
                  onOpen={(item) => {
                    void handleNotificationOpen(item);
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      );
    }

    if (section.key === "search") {
      return (
        <SearchSectionBody
          query={state.searchQuery}
          results={section.results}
          onQueryChange={actions.onSearchQueryChange}
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
      <div className="flex w-[2.5rem] shrink-0 flex-col items-center gap-2 border-r border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(248,250,252,0.8))] px-0.5 py-2.5">
        <div className="h-0.5" aria-hidden="true" />
        {allSections.map((section) => (
          <SidebarRailButton
            key={section.key}
            id={section.id}
            label={section.label}
            count={section.count}
            tone={section.tone}
            expanded={state.activeSectionKey === section.key}
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
            const isDanger = section.tone === "danger";
            const showHeaderSlot = expanded && resolvedHeaderSlot?.sectionKey === section.key;

            return (
              <section
                key={section.key}
                className={clsx("min-h-0 min-w-0 flex-1 flex-col overflow-hidden", expanded ? "flex" : "hidden")}
                aria-hidden={!expanded}
              >
                <SharedPanelHeader
                  title={section.label}
                  count={section.count}
                  tone={isDanger ? "danger" : "neutral"}
                  accessory={section.key === "overdue" ? (
                    <OverdueSortToggle
                      order={overdueSortOrder}
                      onChange={onOverdueSortOrderChange}
                      testId="desktop-sidebar-overdue-sort-toggle"
                    />
                  ) : null}
                  className={isDanger ? "bg-rose-50/40" : undefined}
                />

                {showHeaderSlot ? (
                  <div className="flex h-8 items-center justify-end gap-2 border-b border-slate-200/80 bg-slate-50 px-3">
                    {resolvedHeaderSlot?.actions}
                  </div>
                ) : null}

                <div
                  id={section.id}
                  data-testid={section.id}
                  aria-hidden={!expanded}
                  hidden={!expanded}
                  className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
                >
                  {renderSectionContent(section)}
                </div>
              </section>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
