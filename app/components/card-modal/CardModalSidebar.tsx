"use client";

import type { CSSProperties } from "react";
import type { CardContentHistoryMeta, ProfileSummary } from "@/lib/supabase";
import CommentsPanel from "@/app/(board)/_components/CommentsPanel";

type SidebarTab = "comments" | "history";

type CardModalSidebarProps = {
  sidebarWidth: number;
  cardId: string;
  boardId: string;
  profiles: ProfileSummary[];
  activeTab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  historyItems: CardContentHistoryMeta[];
  historyLoading: boolean;
  historyError: string | null;
  selectedHistoryId: string | null;
  onSelectHistory: (historyId: string) => void;
};

export default function CardModalSidebar({
  sidebarWidth,
  cardId,
  boardId,
  profiles,
  activeTab,
  onTabChange,
  historyItems,
  historyLoading,
  historyError,
  selectedHistoryId,
  onSelectHistory,
}: CardModalSidebarProps) {
  return (
    <div
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
      className="flex-1 min-h-0 border-t sm:border-t-0 sm:border-l border-slate-100 dark:border-gray-700 overflow-y-auto flex flex-col shrink-0 w-full sm:flex-none sm:w-[var(--sidebar-width)]"
    >
      <div className="flex-1 min-h-0 flex flex-col p-6">
        <div className="mb-4 flex items-center gap-2">
          <button
            type="button"
            onClick={() => onTabChange("comments")}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold ${activeTab === "comments"
              ? "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
              : "text-slate-500 hover:bg-slate-100 dark:text-gray-400 dark:hover:bg-gray-700"
              }`}
          >
            Comments
          </button>
          <button
            type="button"
            onClick={() => onTabChange("history")}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold ${activeTab === "history"
              ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
              : "text-slate-500 hover:bg-slate-100 dark:text-gray-400 dark:hover:bg-gray-700"
              }`}
          >
            履歴
          </button>
        </div>

        {activeTab === "comments" ? (
          <div className="flex-1 min-h-0">
            <CommentsPanel
              cardId={cardId}
              boardId={boardId}
              initialProfiles={profiles}
            />
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
            {historyLoading && (
              <p className="text-xs text-slate-500">履歴を読み込み中...</p>
            )}
            {historyError && (
              <p className="text-xs text-red-600">{historyError}</p>
            )}
            {!historyLoading && !historyError && historyItems.length === 0 && (
              <p className="text-xs text-slate-500">履歴はまだありません。</p>
            )}
            {historyItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectHistory(item.id)}
                className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${selectedHistoryId === item.id
                  ? "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/20"
                  : "border-slate-200 hover:bg-slate-50 dark:border-gray-700 dark:hover:bg-gray-700/50"
                  }`}
              >
                <p className="text-[11px] font-semibold text-slate-700 dark:text-gray-200">
                  {new Date(item.created_at).toLocaleString("ja-JP")}
                </p>
                <p className="mt-1 line-clamp-2 text-[11px] text-slate-500 dark:text-gray-400">
                  {item.excerpt || "(本文なし)"}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
