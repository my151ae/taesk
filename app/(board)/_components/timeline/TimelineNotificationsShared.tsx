"use client";

import clsx from "clsx";

import type { Notification } from "@/lib/supabase";
import { LoadMoreFooter } from "@/app/(board)/_components/timeline/TimelineLeftPanelShared";
import { formatPushNotificationCopy } from "@/lib/shared/notification-push";

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
  if (notification.type === "daily_digest") {
    return formatPushNotificationCopy(notification.type, notification.payload).body;
  }

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
  if (notification.type === "daily_digest") {
    return formatPushNotificationCopy(notification.type, notification.payload).title;
  }

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
  const hasCardTarget = typeof notification.payload?.card_short_id === "string" && notification.payload.card_short_id.trim().length > 0;
  const hasBoardTarget =
    typeof notification.payload?.board_short_id === "string" && notification.payload.board_short_id.trim().length > 0;
  const canOpen = hasCardTarget || hasBoardTarget;

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
            <p className="mt-0.5 whitespace-pre-wrap break-words text-[10px] leading-tight text-slate-600">{headline}</p>
          ) : null}
          {commentBody ? (
            <p className="mt-0.5 line-clamp-2 text-[10px] leading-tight text-slate-500">{commentBody}</p>
          ) : null}
          {!canOpen ? (
            <p className="mt-0.5 text-[11px] text-amber-700">関連画面なし</p>
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

export function NotificationsSectionActions({
  unreadCount,
  onMarkAllAsRead,
  onOpenSettings,
  className,
  markAllButtonTestId,
  settingsButtonTestId,
}: {
  unreadCount: number;
  onMarkAllAsRead: () => void;
  onOpenSettings: () => void;
  className?: string;
  markAllButtonTestId?: string;
  settingsButtonTestId?: string;
}) {
  return (
    <div className={clsx("flex h-8 items-center justify-end gap-2 border-b border-slate-200/80 bg-slate-50 px-3", className)}>
      {unreadCount > 0 ? (
        <button
          type="button"
          onClick={onMarkAllAsRead}
          data-testid={markAllButtonTestId}
          className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 hover:border-slate-300 hover:text-slate-900"
        >
          Mark all read
        </button>
      ) : null}
      <button
        type="button"
        onClick={onOpenSettings}
        data-testid={settingsButtonTestId}
        className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 hover:border-slate-300 hover:text-slate-900"
      >
        Settings
      </button>
    </div>
  );
}

export function NotificationsSectionBody({
  notifications,
  loading,
  loadingMore,
  error,
  hasMore,
  feedback,
  onRetry,
  onLoadMore,
  onOpenNotification,
}: {
  notifications: readonly Notification[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  feedback: string | null;
  onRetry: () => void;
  onLoadMore: () => void;
  onOpenNotification: (notification: Notification) => void;
}) {
  if (loading) {
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

  if (error) {
    return (
      <div className="px-3 py-4">
        <div className="rounded-2xl border border-rose-200 bg-rose-50/70 px-3 py-3 text-[11px] text-rose-700/90">
          <p>{error}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 rounded-full border border-rose-200 bg-white px-2 py-1 font-semibold text-rose-700"
          >
            再試行
          </button>
        </div>
      </div>
    );
  }

  if (notifications.length === 0) {
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
      {feedback ? (
        <div className="px-3 pt-3">
          <p className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
            {feedback}
          </p>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-200 [scrollbar-gutter:stable]">
        <div className="space-y-4 px-2 py-4">
          {notifications.map((notification) => (
            <NotificationActivityRow
              key={notification.id}
              notification={notification}
              onOpen={onOpenNotification}
            />
          ))}
        </div>
        <LoadMoreFooter
          canLoadMore={hasMore}
          onLoadMore={onLoadMore}
          disabled={loadingMore}
          label={loadingMore ? "読み込み中..." : "さらに表示"}
          testId="notifications-load-more"
        />
      </div>
    </div>
  );
}
